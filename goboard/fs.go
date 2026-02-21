package main

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ZipFS implements fs.FS using an embedded zip archive.
// It prioritizes .gz versions of files and reports if they are gzipped.
type ZipFS struct {
	Reader *zip.Reader
	index  map[string]*zip.File
}

func (z *ZipFS) Open(name string) (fs.File, error) {
	if name == "." {
		return &ZipDirFile{name: "."}, nil
	}

	// Try .gz version first for passthrough
	if f, ok := z.index[name+".gz"]; ok {
		offset, err := f.DataOffset()
		if err != nil {
			return nil, err
		}
		return &ZipFile{
			SectionReader: io.NewSectionReader(bytes.NewReader(staticArchive), offset, int64(f.CompressedSize64)),
			header:        &f.FileHeader,
			gzipped:       true,
		}, nil
	}

	// Try exact match
	if f, ok := z.index[name]; ok {
		offset, err := f.DataOffset()
		if err != nil {
			return nil, err
		}
		return &ZipFile{
			SectionReader: io.NewSectionReader(bytes.NewReader(staticArchive), offset, int64(f.CompressedSize64)),
			header:        &f.FileHeader,
			gzipped:       false,
		}, nil
	}

	return nil, fs.ErrNotExist
}

type ZipFile struct {
	*io.SectionReader
	header  *zip.FileHeader
	gzipped bool
}

func (f *ZipFile) IsGzipped() bool { return f.gzipped }
func (f *ZipFile) Stat() (fs.FileInfo, error) {
	return f.header.FileInfo(), nil
}
func (f *ZipFile) Close() error { return nil }

type ZipDirFile struct {
	name string
}

func (d *ZipDirFile) Stat() (fs.FileInfo, error) {
	return &ZipDirInfo{name: d.name}, nil
}
func (d *ZipDirFile) Read([]byte) (int, error) { return 0, io.EOF }
func (d *ZipDirFile) Close() error             { return nil }

type ZipDirInfo struct {
	name string
}

func (i *ZipDirInfo) Name() string       { return filepath.Base(i.name) }
func (i *ZipDirInfo) Size() int64        { return 0 }
func (i *ZipDirInfo) Mode() fs.FileMode  { return fs.ModeDir | 0755 }
func (i *ZipDirInfo) ModTime() time.Time { return time.Now() }
func (i *ZipDirInfo) IsDir() bool        { return true }
func (i *ZipDirInfo) Sys() any           { return nil }

func loadStaticAssets() {
	if len(staticArchive) == 0 {
		logger.Warn("Static archive empty, using live static directory")
		staticFS = os.DirFS("static")
		return
	}

	zr, err := zip.NewReader(bytes.NewReader(staticArchive), int64(len(staticArchive)))
	if err != nil {
		logger.Error("Failed to open static zip", "error", err)
		staticFS = os.DirFS("static")
		return
	}

	index := make(map[string]*zip.File)
	for _, f := range zr.File {
		index[f.Name] = f
	}

	staticFS = &ZipFS{
		Reader: zr,
		index:  index,
	}
	logger.Info("Loaded static assets from zip archive", "files", len(zr.File), "size", len(staticArchive))
}

// StaticHandler serves the static assets with gzip passthrough support
func StaticHandler(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}
	path = strings.TrimPrefix(path, "/")

	f, err := staticFS.Open(path)
	if err != nil {
		// Redirect all non-existing URLs to '/' with a 301
		http.Redirect(w, r, "/", http.StatusMovedPermanently)
		return
	}
	defer f.Close()

	stat, _ := f.Stat()
	if stat.IsDir() {
		http.FileServer(http.FS(staticFS)).ServeHTTP(w, r)
		return
	}

	// Determine content type
	ctype := mime.TypeByExtension(filepath.Ext(path))
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Vary", "Accept-Encoding")

	// Handle compression
	if gf, ok := f.(interface{ IsGzipped() bool }); ok && gf.IsGzipped() {
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
		} else {
			// Client doesn't support gzip, decompress on the fly
			gz, err := gzip.NewReader(f)
			if err != nil {
				logger.Error("Decompression failed", "path", path, "error", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}
			defer gz.Close()
			io.Copy(w, gz)
			return
		}
	}

	http.ServeContent(w, r, path, startTime, f.(io.ReadSeeker))
}
