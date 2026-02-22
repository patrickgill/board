package main

import (
	"encoding/json"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type FileInfo struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	ModTime  int64  `json:"mod_time"`
	IsImage  bool   `json:"is_image"`
	MimeType string `json:"mime_type"`
	URL      string `json:"url"`
}

func GetFiles(uploadDir string) ([]FileInfo, error) {
	entries, err := os.ReadDir(uploadDir)
	if err != nil {
		return nil, err
	}

	files := []FileInfo{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}

		ext := filepath.Ext(e.Name())
		mimeType := mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}

		isImage := strings.HasPrefix(mimeType, "image/")

		files = append(files, FileInfo{
			Name:     e.Name(),
			Size:     info.Size(),
			ModTime:  info.ModTime().Unix(),
			IsImage:  isImage,
			MimeType: mimeType,
			URL:      "/uploads/" + e.Name(),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].ModTime > files[j].ModTime
	})

	return files, nil
}

func FilesHandler(uploadDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		files, err := GetFiles(uploadDir)
		if err != nil {
			if os.IsNotExist(err) {
				http.Error(w, "Upload directory does not exist", http.StatusNotFound)
				return
			}
			logger.Error("Failed to list files", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(files)
	}
}
