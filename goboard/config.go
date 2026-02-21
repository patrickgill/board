package main

import (
	_ "embed"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

// Config holds all configurable settings.
type Config struct {
	Port        string   `toml:"port"`
	BoardFile   string   `toml:"board_file"`
	UploadDir   string   `toml:"upload_dir"`
	MaxUploadMB int      `toml:"max_upload_mb"`
	NoWatch     bool     `toml:"no_watch"`
	Whitelist   []string `toml:"whitelist"`
	Blacklist   []string `toml:"blacklist"`
}

//go:embed goboard.toml
var defaultConfigFS []byte

func loadConfig(exeDir, baseName string) Config {
	cfg := Config{
		Port:        "8080",
		BoardFile:   baseName + ".md",
		UploadDir:   "uploads",
		MaxUploadMB: 100,
		NoWatch:     true,
		Whitelist:   []string{},
		Blacklist:   []string{},
	}

	configPath := filepath.Join(exeDir, baseName+".toml")
	if _, err := os.Stat(configPath); err == nil {
		if _, err := toml.DecodeFile(configPath, &cfg); err != nil {
			logger.Warn("Failed to parse config", "path", configPath, "error", err, "using_defaults", true)
		} else {
			logger.Info("Loaded config", "path", configPath)
		}
	} else {
		if err := os.WriteFile(configPath, defaultConfigFS, 0644); err != nil {
			logger.Warn("Could not create config", "path", configPath, "error", err)
		} else {
			logger.Info("Created default config file", "path", configPath)
		}
	}

	if envPort := os.Getenv("PORT"); envPort != "" {
		cfg.Port = envPort
	}

	if !filepath.IsAbs(cfg.BoardFile) {
		cfg.BoardFile = filepath.Join(exeDir, cfg.BoardFile)
	}
	if !filepath.IsAbs(cfg.UploadDir) {
		cfg.UploadDir = filepath.Join(exeDir, cfg.UploadDir)
	}

	return cfg
}
