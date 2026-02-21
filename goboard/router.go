package main

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func NewRouter(cfg *Config) *chi.Mux {
	mux := chi.NewRouter()

	// Global Middleware
	mux.Use(LoggerMiddleware)
	mux.Use(RecoveryMiddleware)
	mux.Use(FirewallMiddleware(cfg))

	// API Endpoints
	mux.Get("/favicon*", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(faviconData)
	})

	mux.Get("/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"version":       version,
			"build_stamp":   buildStamp,
			"local_ip":      localIP,
			"port":          cfg.Port,
			"max_upload_mb": cfg.MaxUploadMB,
		})
	})

	// Diagnostic Handlers
	mux.Get("/stats", StatsHandler)
	mux.Get("/info", InfoHandler)
	mux.Get("/system", SystemHandler)
	mux.Get("/hw", HardwareHandler)
	mux.Get("/endpoints", EndpointsHandler(mux))

	// WebSocket
	mux.Get("/ws", func(w http.ResponseWriter, r *http.Request) {
		WebSocketHandler(w, r)
	})

	// Upload Handlers
	mux.Post("/upload", UploadHandler(cfg.UploadDir, cfg.MaxUploadMB))
	mux.Get("/uploads", FilesHandler(cfg.UploadDir))
	mux.Get("/uploads/*", ServeUploadsHandler(cfg.UploadDir))

	// Files Index Page
	mux.Get("/files", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/files/", http.StatusMovedPermanently)
	})

	mux.Get("/files/", func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = "/files.html"
		StaticHandler(w, r)
	})

	// Static Assets (priority last)
	mux.Handle("/*", http.HandlerFunc(StaticHandler))

	return mux
}
