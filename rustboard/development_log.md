# RustBoard Development Log

This document logs the major implementation steps and design decisions made during the rewrite of GoBoard into RustBoard.

## 1. Project Initialization
- **Cargo Setup**: Initialized new project with `cargo init`.
- **Rust Edition 2024**: Configured `Cargo.toml` to use the latest Rust 2024 edition.
- **Dependency Strategy**: Initially targeted version-compatible crates, then pivoted to a "Latest Only" policy (Axum 0.8+, Sysinfo 0.38+, Tokio 1.43+).

## 2. Core Module Implementation
- **`config.rs`**: Implemented TOML-based configuration loading with environment variable overrides and default fallback.
- **`system.rs`**: Built a system monitoring layer using `sysinfo`. Consolidates CPU, Memory, Disk, Network, and Process information.
- **`fs_handler.rs`**: Developed an advanced static asset server that:
  - Supports embedded or external `static.zip`.
  - Transparently serves gzipped files with proper headers.
  - Decompresses assets on-the-fly if needed.
  - Falls back to a local `static/` directory for developer agility.
- **`hub.rs`**: Ported the WebSocket collaboration engine.
  - Uses `tokio::sync::broadcast` for message distribution.
  - Uses `DashMap` for high-performance concurrent client management.
  - Implemented coalesced disk writes to prevent I/O bottlenecks during rapid typing.
  - Integrated filesystem watching (`notify`) to sync external changes back to the hub.
- **`handlers.rs`**: Implemented REST API endpoints for configuration, system info, file listing, and dynamic endpoint discovery (`/hw`, `/endpoints`).
  - Refactored file uploads to use streaming multipart handlers, keeping memory usage constant regardless of file size.

## 3. Stabilization & Compatibility (Axum 0.8 / Sysinfo 0.38)
- **WebSocket Fixes**: Migrated from `String` to `Utf8Bytes` and added `Bytes::from_static` for favicon data to meet Axum 0.8 requirements.
- **Multipart Fixes**: Updated upload handlers to accommodate mutable field access in Axum 0.8.
- **Sysinfo Modernization**:
  - Migrated from individual trait-based refreshes to standalone `Disks`, `Networks`, `Users`, and `Components` structs.
  - Fixed hostname and uptime retrieval to use associated functional calls on the `System` struct.
- **Ownership Resolution**: Fixed multiple `move` errors in async closures by managing `Arc` clones and specific cleanup IDs.

## 4. Finalization
- **Compiler Optimization**: Resolved a `STATUS_STACK_BUFFER_OVERRUN` crash by trimming unused feature flags and streamlining the dependency graph.
- **Code Quality**: Applied `cargo clippy` and `cargo fix` to remove all unused imports and warnings.
- **Release**: Built the final optimized binary in `target/release/rustboard.exe`.

## 📌 Maintenance Note
A "No-Downgrade" policy has been established in `notes.txt`. Always prioritize upgrading to the latest stable crate versions.
