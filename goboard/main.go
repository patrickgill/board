package main

import (
	"context"
	_ "embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

var logger *slog.Logger

// Set at build time via -ldflags "-X main.version=..."
var version = "dev"
var buildStamp = "dev"

var (
	startTime     = time.Now()
	totalRequests uint64
	appHub        *Hub
	localIP       string
)

//go:embed build/static.zip
var staticArchive []byte

var staticFS fs.FS

//go:embed winres/icon16.png
var faviconData []byte

func main() {
	fmt.Printf("GoBoard v%s (Build %s)\n", version, buildStamp)

	logger = slog.New(slog.NewTextHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	logger.Info("GoBoard", "version", version, "build", buildStamp)

	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)
	exeName := filepath.Base(exePath)
	base := strings.TrimSuffix(exeName, filepath.Ext(exeName))

	loadStaticAssets()

	cfg := loadConfig(exeDir, base)

	logger.Info("Config loaded",
		"port", cfg.Port,
		"board_file", cfg.BoardFile,
		"upload_dir", cfg.UploadDir,
		"max_upload_mb", cfg.MaxUploadMB,
	)

	// Discover all local IPs for logging
	ips, _ := GetAllLocalIPs()
	localIP = GetPreferredOutboundIP()

	logger.Info("Server started", "local_url", "http://"+net.JoinHostPort("localhost", cfg.Port))

	// Log all found IPs
	if len(ips) > 0 {
		for _, ip := range ips {
			logger.Info("Server started", "network_url", "http://"+net.JoinHostPort(ip, cfg.Port))
		}
	} else if localIP != "" {
		// Fallback if GetAllLocalIPs failed but Outbound worked
		logger.Info("Server started", "network_url", "http://"+net.JoinHostPort(localIP, cfg.Port))
	}

	appHub = newHub(cfg.BoardFile, cfg.NoWatch)
	go appHub.run()

	mux := NewRouter(&cfg)
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: mux,
	}

	// Channel to listen for errors from ListenAndServe
	serverError := make(chan error, 1)

	go func() {
		logger.Info("Server started", "url", "http://localhost:"+cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverError <- err
		}
	}()

	// Channel to listen for signals
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverError:
		logger.Error("Server failed to start", "error", err)
	case sig := <-quit:
		logger.Info("Server is shutting down...", "signal", sig.String())

		// Shutdown context with 30 second timeout
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		// Shutdown Hub first
		if appHub != nil {
			appHub.Stop()
		}

		if err := srv.Shutdown(ctx); err != nil {
			logger.Error("Server forced to shutdown", "error", err)
		}
	}

	logger.Info("Server stopped")
}
