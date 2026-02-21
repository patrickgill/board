# Project Overview
GoBoard is a lightweight, real-time collaborative whiteboard application built in Go. It allows users to edit and view a shared Markdown document simultaneously via WebSockets, with persistence to a simple local file. Designed for simplicity ("streamlined"), it compiles to a single self-contained binary with embedded assets and minimal dependencies.

## Repository Structure
- `main.go`: The monolithic entry point containing the HTTP server, WebSocket `Hub` logic, configuration loading, and routing.
- `static/`: Frontend assets (HTML, CSS, JS) served directly to the client; embedded into the binary during build.
- `hostinfo/`: A dedicated package for gathering system statistics (CPU, generic host info) to display in the UI.
- `winres/`: Windows-specific resources (e.g., application icon) and manifest rules.
- `build.go`: Custom build script that handles version injection, resource embedding, and platform-specific build steps.
- `goboard.toml`: Default configuration file template.
- `go.mod` / `go.sum`: Dependency definitions.

## Build & Development Commands

```bash
# Install dependencies
go mod tidy

# Run Development Server (Direct)
# Starts the server on port 8080 (default)
go run main.go

# Build Binary (Production/Distribution)
# Uses the custom build script to embed resources and set version
go run build.go

# Run the Built Binary
./build/goboard.exe

# Testing (Standard Go)
go test ./...
```

## Code Style & Conventions
- **Formatting**: Strictly follow standard Go formatting (`gofmt`).
- **Logging**: Use `log/slog` for all logging. maintain structured logging patterns (key-value pairs).
  - Example: `slog.Info("Server started", "url", url)`
- **Imports**: Group standard library imports first, then third-party, then local packages.
- **Naming**: camelCase for internal variables, PascalCase for exported symbols.
- **Files**: Keep core logic in `main.go` unless it grows significantly; prefer "streamlined" code over aggressive abstraction.

## Architecture Notes

### High-Level Flow
```mermaid
graph TD
    User[Browser Client] -->|HTTP/WS| Server[Go Server (main.go)]
    Server -->|Static Files| EmbeddedFS[//go:embed static]
    Server -->|WS Protocol| Hub[WebSocket Hub]
    Hub -->|Broadcast| Clients[Connected Clients]
    Hub -->|Save| FileSys[Local File (goboard.md)]
    FileSys -->|fsnotify| Watcher[File Watcher]
    Watcher -->|Reload| Hub
```

### Components
1.  **HTTP Layer**: Uses Go 1.22+ `http.ServeMux` for routing.
    -   **Middleware**: Custom `withLogging` and `withRecovery` wrappers. **CRITICAL**: The `responseWriter` wrapper implements `http.Hijacker` to allow WebSocket upgrades.
2.  **WebSocket Hub**: Manages active connections.
    -   **Protocol**: JSON messages (`type`: "init", "update", "presence").
    -   **Sync**: Optimistic concurrency. Last write wins (mostly), but "update" events broadcast content to all.
3.  **Persistence**:
    -   **Atomic Writes**: Saves content to `file.tmp` then renames to `file.md` to ensure data integrity.
    -   **Watcher**: Watches the file directory for external changes and syncs them back to the state.
4.  **Host Info**: `hostinfo` package gathers system stats for the `/host/dump` API.

### Static Asset Optimization (Performance) via Gzipped Zip Passthrough
We use a **Gzipped Zip Passthrough** strategy to minimize memory usage and maximize performance:
1.  **Build Phase**: `build.go` creates `build/static.zip`. Each file from `static/` is individually gzipped and stored in the zip with the `.gz` extension (using the `Store` method to avoid double compression).
2.  **Runtime Embedding**: The `static.zip` is embedded as a `[]byte` in the binary.
3.  **Zero-Allocation Serving**:
    -   `ZipFS` uses `io.NewSectionReader` over the embedded byte slice. This reads directly from the binary's data segment without copying file contents to the heap.
    -   `StaticHandler` looks for the `.gz` version of requested files.
    -   If found, it sends the raw compressed bytes with `Content-Encoding: gzip`.
    -   The browser handles the decompression, resulting in faster load times and minimal server memory usage (only metadata is in RAM).
4.  **Headers**:
    -   `Content-Type`: Correctly detected based on original extension.
    -   `Content-Encoding`: Set to `gzip` for passthrough.
    -   `Vary`: Set to `Accept-Encoding` for proxy compatibility.

This approach keeps memory usage low (~20-30MB) even with large asset libraries like Monaco Editor.

### Optimization of WebSocket Hub
To prevent "broken editing" feel and "ghost connections":
1.  **Ghost Cursor Cleanup**: The server sends unique client IDs in presence updates. The frontend automatically prunes any cursors whose IDs are no longer in the active user list.
2.  **Debounced Storage (Coalesced Writes)**: The server handles broadcasts instantly in memory but only persists the state to disk at most once every 2 seconds (`saveTicker`). This prevents the main WebSocket loop from blocking on slow disk I/O during heavy collaboration.

## Testing Strategy
-   **Unit Tests**: Standard `go test` for logic packages (`hostinfo`).
-   > TODO: Add comprehensive unit tests for `Hub` logic and message serialization.
-   **Manual Testing**: Launch server, open two browser tabs/windows, verify typing updates appear in both (sync).

## Security & Compliance
-   **Authentication**: Currently **NO** authentication. The board is open to anyone with network access.
-   **Input Handling**: Markdown is rendered on the client side; raw text is stored.
-   **Dependencies**: Minimal set (`coder/websocket`, `BurntSushi/toml`, `gopsutil`, `fsnotify`).
-   > TODO: Implement basic auth or an allowlist for production use.

## Agent Guardrails
1.  **Http.Hijacker Mandatory**: If modifying HTTP middleware, **YOU MUST** ensure the `Hijacker` interface is implemented on any `ResponseWriter` wrapper. Failing to do so breaks WebSockets immediately.
    - *Context*: We previously broke WebSockets by forgetting to implement `Hijacker` on a logging wrapper.
2.  **Keep UI Simple**: Do not introduce complex UI frameworks (React, Vue) or heavy editor components (Monaco) unless explicitly requested. Stick to Vanilla JS/HTML.
    - *Context*: We tried Monaco for a simple JSON dump and it failed (blank UI). Use `<pre>` tags for dumps.
3.  **Dependency Check**: Do not add "crufty" libraries (e.g., `google/uuid`, `gorilla/mux`, `chi`) if the standard library or simple helpers suffice.
    - *Context*: We purposely removed `chi` and `uuid` to streamline the project.
4.  **Formatting**: Always run `go fmt` equivalent logic (e.g., via tool) on Go code.
5.  **Embed Imports**: When using `//go:embed`, you **MUST** import the `embed` package. If the package is not otherwise used, use a blank import `import _ "embed"` to prevent auto-formatters from removing it and breaking the build.

## Project Roadmap & Future Ideas

### 1. The "Obsidian" Upgrade (Rich Preview)
*   **Real-time Toggle**: A "Preview" button using [marked.js](https://marked.js.org/) to render Markdown.
*   **Diagram Support**: Integrate [Mermaid.js](https://mermaid.js.org/).
*   **LaTeX Support**: Professional math rendering using [KaTeX](https://katex.org/).

### 2. Advanced Collaboration UX
*   **Selection Syncing**: Sync text selections, not just cursors.
*   **User Nicknames**: Allow temporary names/colors (e.g., `[JD] John`).
*   **"Follow" Mode**: "Teleport" view to another user's cursor location.

### 3. Admin & Security Layer
*   **Real-time Dashboard**: Beautiful "Status" tab with CPU/RAM live graphs (e.g., using [Chart.js](https://www.chartjs.org/)).
*   **IP Firewall UI**: Whitelist/Blacklist IPs on the fly.
*   **Token Access**: Simple password or "Secret URL" protection.

### 4. Technical Optimizations
*   **Brotli Compression**: Swap Gzip for Brotli in `build.go` for potentially 20% smaller binaries.
*   **Self-Updating Binary**: Checking GitHub for updates and self-replacing.
*   **Revision History**: Side-panel showing previous versions (snapshots).

### 5. Visual Polish
*   **Glassmorphism**: Modern translucent backgrounds.
*   **Sound Micro-interactions**: Subtle sounds for uploads/tabs.

## Extensibility Hooks
-   **Configuration**: `goboard.toml` allows changing `port`, `board_file`, `upload_dir`.
-   **Environment Variables**: `PORT` env var overrides the config port.
-   **Frontend**: `static/app.js` can be extended with new message types for richer collaboration features.

## Further Reading
-   [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - (Detailed architectural decisions - if available)
-   [README.md](./README.md) - User-facing documentation.
