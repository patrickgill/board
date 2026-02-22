//go:build ignore

package main

import (
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

func main() {
	progname := "goboard"
	now := time.Now()
	version := "1.0.0"
	buildStamp := now.Format("20060102.1504")
	binary := filepath.Join("build", progname)
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}

	os.MkdirAll("build", 0755)

	// Bundle CodeMirror 6 editor
	if err := buildEditorBundle(); err != nil {
		fmt.Fprintf(os.Stderr, "Error building editor bundle: %v\n", err)
		os.Exit(1)
	}

	// Create zip archive with pre-gzipped files
	if err := createGzippedZip("static", filepath.Join("build", "static.zip")); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating archive: %v\n", err)
		os.Exit(1)
	}

	// Generate Windows PE resources (icon, version info, manifest)
	if runtime.GOOS == "windows" {
		stampWinResVersion(now, version)

		fmt.Println("Generating PE resources...")
		winres := exec.Command("go-winres", "make")
		winres.Stdout = os.Stdout
		winres.Stderr = os.Stderr
		if err := winres.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: go-winres failed: %v\n", err)
		}
	}

	fmt.Printf("Building %s v%s (Build %s) → %s\n", progname, version, buildStamp, binary)

	args := []string{
		"build",
		"-ldflags", fmt.Sprintf("-X main.version=%s -X main.buildStamp=%s", version, buildStamp),
		"-o", binary,
		".",
	}

	cmd := exec.Command("go", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Build failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Done.")
}

// buildEditorBundle runs esbuild to bundle editor-src/index.js into
// static/vendor/cm6/editor.bundle.js. Run `npm install` in editor-src first.
func buildEditorBundle() error {
	fmt.Println("Bundling CodeMirror 6...")
	if err := os.MkdirAll(filepath.Join("static", "vendor", "cm6"), 0755); err != nil {
		return err
	}

	// Resolve absolute paths so they remain valid after chdir into editor-src.
	editorSrc, err := filepath.Abs("editor-src")
	if err != nil {
		return err
	}
	outfile, err := filepath.Abs(filepath.Join("static", "vendor", "cm6", "editor.bundle.js"))
	if err != nil {
		return err
	}
	fmt.Println("Installing npm dependencies...")
	npmInstall := exec.Command("npm", "install")
	npmInstall.Dir = editorSrc
	npmInstall.Stdout = os.Stdout
	npmInstall.Stderr = os.Stderr
	if err := npmInstall.Run(); err != nil {
		return fmt.Errorf("npm install failed: %w", err)
	}

	esbuildBin := filepath.Join(editorSrc, "node_modules", ".bin", "esbuild")

	cmd := exec.Command(esbuildBin,
		"index.js",
		"--bundle",
		"--minify",
		"--outfile="+outfile,
	)
	cmd.Dir = editorSrc
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// createGzippedZip creates a zip archive where each file is internally gzipped.
// This allows serving the raw compressed stream to clients that support Content-Encoding: gzip.
func createGzippedZip(srcDir, dstFile string) error {
	fmt.Printf("Creating gzipped zip: %s -> %s\n", srcDir, dstFile)

	out, err := os.Create(dstFile)
	if err != nil {
		return err
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	defer zw.Close()

	totalFiles := 0

	err = filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		// Create zip header for a stored (uncompressed) entry,
		// because we are doing the GZIP manually inside the entry.
		fh := &zip.FileHeader{
			Name:   rel + ".gz",
			Method: zip.Store, // We store the already-gzipped data
		}
		fh.Modified = info.ModTime()

		w, err := zw.CreateHeader(fh)
		if err != nil {
			return err
		}

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()

		gw, _ := gzip.NewWriterLevel(w, gzip.BestCompression)
		if _, err := io.Copy(gw, f); err != nil {
			gw.Close()
			return err
		}
		totalFiles++
		return gw.Close()
	})

	if err == nil {
		fmt.Printf("Total files packed: %d\n", totalFiles)
	}
	return err
}

// stampWinResVersion updates winres.json with the current build version.
// PE version uses MAJOR.YEAR.MMDD.HHMM format (each fits in uint16).
// The string version will use the format 0.YYYY.MMDD.HHMM.
func stampWinResVersion(now time.Time, versionStr string) {
	path := filepath.Join("winres", "winres.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		return
	}

	// Build PE-compatible version: 0.YYYY.MMDD.HHMM
	peVersion := fmt.Sprintf("0.%d.%d.%d",
		now.Year(),
		int(now.Month())*100+now.Day(),
		now.Hour()*100+now.Minute(),
	)

	// Update RT_VERSION fixed fields
	if rtVersion, ok := cfg["RT_VERSION"].(map[string]any); ok {
		if v1, ok := rtVersion["#1"].(map[string]any); ok {
			if v0, ok := v1["0000"].(map[string]any); ok {
				if fixed, ok := v0["fixed"].(map[string]any); ok {
					fixed["file_version"] = peVersion
					fixed["product_version"] = peVersion
				}
				if info, ok := v0["info"].(map[string]any); ok {
					if en, ok := info["0409"].(map[string]any); ok {
						en["FileVersion"] = versionStr
						en["ProductVersion"] = versionStr
					}
				}
			}
		}
	}

	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return
	}
	os.WriteFile(path, out, 0644)
}
