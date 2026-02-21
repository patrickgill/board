# Architecture & Implementation Plan - RustBoard Rewrite

This plan outlines the steps to rewrite the GoBoard project in Rust, using Rust Edition 2024 and modern asynchronous patterns.

## 1. Project Infrastructure
- **Edition**: Use Rust 2024 for the latest language features and optimizations.
- **Framework**: `axum` for HTTP and WebSockets, `tokio` for the async runtime.
- **State Management**: `Arc<Hub>` and `Config` wrapped in a shared `AppState`.

## 2. Modules
- `config.rs`: Handles TOML configuration loading and default creation.
- `system.rs`: Gathers system statistics (CPU, Memory, Disks, Processes) using the `sysinfo` crate.
- `fs_handler.rs`: Manages static asset serving. Supports:
    - Loading from an embedded or external `static.zip`.
    - Direct serving of pre-gzipped files.
    - Transparent decompression for clients without `Accept-Encoding: gzip`.
    - Fallback to the local `static/` directory.
- `hub.rs`: The "brain" of the collaborative editor.
    - Manages WebSocket connections via `DashMap`.
    - Broadcasts document updates and user presence.
    - Handles periodic persistence to disk.
    - Watches the filesystem for external changes to the board file.
- `handlers.rs`: REST API endpoints for configuration, uploads, and file listing.

## 3. Implementation Steps

### Phase 1: Environment Setup
- [ ] Update `Cargo.toml` to edition `2024`.
- [ ] Ensure all dependencies are compatible with the target environment (Windows).

### Phase 2: Configuration & Embedding
- [ ] Ensure `default.toml` is correctly embedded and used as a fallback.
- [ ] Ensure the favicon and other small assets are embedded.

### Phase 3: Static Asset Logic
- [ ] Refine `serve_from_zip` to handle edge cases in Zip exploration.
- [ ] Verify MIME type detection using `mime_guess`.

### Phase 4: WebSocket & Persistence Logic
- [ ] implement refined error handling for WebSocket disconnects.
- [ ] Use `notify` crate for efficient cross-platform file watching.

### Phase 5: Testing & Verification
- [ ] Run `cargo check` and `cargo clippy` to ensure code quality.
- [ ] Manually verify the web interface once the server is running.

## 4. Key Differences from Go Implementation
- **Concurrency**: Using `tokio` tasks and `broadcast`/`mpsc` channels instead of Go routines and native channels.
- **State**: `DashMap` for concurrent-safe client storage.
- **System Info**: `sysinfo` provides a more unified API in Rust compared to multiple specialized Go libraries.
