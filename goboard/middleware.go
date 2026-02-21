package main

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

// responseWriter captures status and size
type responseWriter struct {
	http.ResponseWriter
	status int
	size   int64
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	size, err := rw.ResponseWriter.Write(b)
	rw.size += int64(size)
	return size, err
}

func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return http.NewResponseController(rw.ResponseWriter).Hijack()
}

func (rw *responseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}

// LoggerMiddleware logs requests with status and duration
func LoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddUint64(&totalRequests, 1)
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"bytes", rw.size,
			"duration", time.Since(start),
		)
	})
}

// RecoveryMiddleware handles panics gracefully
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("Panic recovered", "error", rec)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// FirewallMiddleware enforces whitelist/blacklist rules
func FirewallMiddleware(cfg *Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			remoteIP, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				remoteIP = r.RemoteAddr
			}

			// Blacklist check
			for _, bIP := range cfg.Blacklist {
				if bIP == remoteIP {
					slog.Warn("Access denied: IP in blacklist", "ip", remoteIP, "path", r.URL.Path)
					http.Error(w, "Forbidden", http.StatusForbidden)
					return
				}
			}

			// Whitelist check
			if len(cfg.Whitelist) > 0 {
				allowed := false
				for _, wIP := range cfg.Whitelist {
					if wIP == remoteIP {
						allowed = true
						break
					}
				}
				if !allowed {
					slog.Warn("Access denied: IP not in whitelist", "ip", remoteIP, "path", r.URL.Path)
					http.Error(w, "Forbidden", http.StatusForbidden)
					return
				}
			}

			next.ServeHTTP(w, r)
		})
	}
}
