package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"runtime/debug"
	"sync/atomic"
	"time"

	"os"

	"github.com/go-chi/chi/v5"
	"github.com/shirou/gopsutil/v4/process"
)

func StatsHandler(w http.ResponseWriter, r *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	rss := "0.00 MB"
	if p, err := process.NewProcess(int32(os.Getpid())); err == nil {
		if mem, err := p.MemoryInfo(); err == nil {
			rss = fmt.Sprintf("%.2f MB", float64(mem.RSS)/1024/1024)
		}
	}

	appHub.mu.Lock()
	activeConns := len(appHub.clients)
	appHub.mu.Unlock()

	stats := map[string]any{
		"runtime":            "go/chi",
		"version":            version,
		"build":              buildStamp,
		"uptime":             time.Since(startTime).Round(time.Second).String(),
		"start_time":         startTime.Format(time.RFC3339),
		"goroutines":         runtime.NumGoroutine(),
		"active_connections": activeConns,
		"total_requests":     atomic.LoadUint64(&totalRequests),
		"memory": map[string]string{
			"rss":        rss,
			"heap_used":  fmt.Sprintf("%.2f MB", float64(m.HeapAlloc)/1024/1024),
			"heap_total": fmt.Sprintf("%.2f MB", float64(m.HeapSys)/1024/1024),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func InfoHandler(w http.ResponseWriter, r *http.Request) {
	info := map[string]any{
		"project": map[string]string{
			"version": version,
			"build":   buildStamp,
		},
	}

	if buildInfo, ok := debug.ReadBuildInfo(); ok {
		info["BuildInfo"] = map[string]any{
			"GoVersion": buildInfo.GoVersion,
			"Path":      buildInfo.Path,
			"Main":      buildInfo.Main,
			"Deps":      buildInfo.Deps,
			"Settings":  buildInfo.Settings,
		}

		// Extract module dependencies
		modules := make(map[string]string)
		for _, dep := range buildInfo.Deps {
			modules[dep.Path] = dep.Version
		}
		info["modules"] = modules
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

func SystemHandler(w http.ResponseWriter, r *http.Request) {
	info := GetInfo(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

func HardwareHandler(w http.ResponseWriter, r *http.Request) {
	refresh := r.URL.Query().Get("refresh") == "true"
	info, cached, err := GetGHWInfo(refresh)
	if err != nil {
		logger.Error("Failed to get GHW info", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if cached {
		w.Header().Set("X-Cached", "true")
	}
	json.NewEncoder(w).Encode(info)
}

func EndpointsHandler(mux *chi.Mux) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var endpoints []string
		walkFunc := func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
			endpoints = append(endpoints, fmt.Sprintf("%s %s", method, route))
			return nil
		}
		if err := chi.Walk(mux, walkFunc); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(endpoints)
	}
}
