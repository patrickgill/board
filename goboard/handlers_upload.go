package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func UploadHandler(uploadDir string, maxUploadMB int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, int64(maxUploadMB)<<20)
		if err := r.ParseMultipartForm(int64(maxUploadMB) << 20); err != nil {
			logger.Warn("Failed to parse form", "error", err)
			http.Error(w, "File too large or invalid", http.StatusBadRequest)
			return
		}

		files := r.MultipartForm.File["file"]
		if len(files) == 0 {
			http.Error(w, "No files uploaded", http.StatusBadRequest)
			return
		}

		var uploaded []map[string]string

		for _, handler := range files {
			file, err := handler.Open()
			if err != nil {
				logger.Error("Failed to open uploaded file", "filename", handler.Filename, "error", err)
				continue
			}
			defer file.Close()

			// Sanitize filename
			originalName := filepath.Base(handler.Filename)
			cleanName := strings.ReplaceAll(originalName, " ", "_")
			cleanName = strings.ReplaceAll(cleanName, "%", "")

			// Prevent collisions
			filePath := filepath.Join(uploadDir, cleanName)
			if _, err := os.Stat(filePath); err == nil {
				ext := filepath.Ext(cleanName)
				name := strings.TrimSuffix(cleanName, ext)
				cleanName = name + "_" + randomID() + ext
				filePath = filepath.Join(uploadDir, cleanName)
			}

			dst, err := os.Create(filePath)
			if err != nil {
				logger.Error("Failed to create file", "filename", cleanName, "error", err)
				continue
			}

			if _, err := io.Copy(dst, file); err != nil {
				dst.Close()
				logger.Error("Failed to save file", "filename", cleanName, "error", err)
				continue
			}
			dst.Close()

			logger.Info("File uploaded", "filename", cleanName, "size", handler.Size)
			uploaded = append(uploaded, map[string]string{
				"url":      "/uploads/" + cleanName,
				"filename": cleanName,
				"original": originalName,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(uploaded)
	}
}

func ServeUploadsHandler(uploadDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		http.StripPrefix("/uploads/", http.FileServerFS(os.DirFS(uploadDir))).ServeHTTP(w, r)
	}
}
