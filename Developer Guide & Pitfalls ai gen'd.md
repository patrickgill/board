# AGENTS.md - Developer Guide & Pitfalls

This document is a guide for future AI agents working on **GoBoard**. It specifically highlights past mistakes, architectural decisions, and "gotchas" to avoid repeating errors.

## 🚨 CRITICAL PITFALLS (Read First)

### 1. WebSocket Middleware & `http.Hijacker`
**The Mistake**: When implementing custom logging middleware (wrapping `http.ResponseWriter` to capture status/size), we initially settled for a struct that only implemented `http.ResponseWriter`.
**The Consequence**: WebSocket connections failed with error `501 Not Implemented` or `accepted connection but failed to upgrade`, because the `http.ResponseController` (used by `websocket` lib) couldn't type-assert the wrapper to `http.Hijacker`.
**The Fix**: Ensure any custom `responseWriter` struct implements `Hijack()`:
```go
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
    if hj, ok := rw.ResponseWriter.(http.Hijacker); ok {
        return hj.Hijack()
    }
    return nil, nil, http.ErrNotSupported
}
```

### 2. UI Complexity (Monaco vs. Simple Text)
**The Mistake**: We tried to use the Monaco Editor (a heavy code editor) inside a "Host Info" modal to display a simple JSON dump.
**The Consequence**: The editor failed to render correctly (blank content) because it was initialized inside a hidden (`display: none`) container, leading to zero-height issues, or simply being overkill complexity.
**The Lesson**: For simple debug/info views, **prefer simple HTML** (e.g., `<pre>` tags) over complex JS components. Stability and readability > "fancy" unnecessarily.

### 3. Dependency Bloat ("Streamlining")
**The Mistake**: We used `github.com/google/uuid` and `github.com/go-chi/chi` for meaningful but replaceable functionality.
**The Fix**: 
- **UUID**: Replaced with a simple `crypto/rand` hex generator (`randomID()`). We don't need RFC-compliant UUIDs for internal client tracking, just unique strings.
- **Routing**: Replaced `chi` with Go 1.22+ `http.ServeMux`. It supports path values (`/path/{id}`) and methods (`GET /path`), making third-party routers unnecessary for this project scope.

## 🏗️ Architecture Decisions

### Standard Library Preference
We aggressively prefer the Go Standard Library (`stdlib`):
- **Logging**: Use `log/slog` (structured logging), not `logrus` or `zap`.
- **Config**: Use `stdlib` or simple file reading where possible (though `BurntSushi/toml` is currently used and acceptable).
- **HTTP**: `net/http` + `ServeMux`.

### Frontend Assets
- **Embedding**: All static files (`static/`) MUST be embedded using `//go:embed`. Do not rely on the physical file system for production binaries. Check `main.go` `staticFS` variable.

### Concurrency Patterns
- **Hub**: The `Hub` struct manages all WebSocket clients. It uses `sync.Mutex` for map access and channels (`broadcast`, `register`, `unregister`) for communication.
- **File Watcher**: `fsnotify` is used to detect external edits. Be careful of **infinite loops** where the server saves the file, triggers the watcher, and reloads itself. Use debouncing/timestamps or content checking.

## 🛠️ Evolution & Refactoring history
- **Moved to Host Packages**: Host-specific logic (IP discovery, system stats) was moved from `main.go` to `goboard/hostinfo` to clean up `main.go`.
- **Imports Cleanup**: Be careful when refactoring network code. `net` and `net/http` are distinct. If you remove `net` usages (like `net.Dial`), ensure you don't inadvertently break `http` server dependencies (though `http` covers most needs).

## Future Directives
- **Keep it Simple**: Do not introduce new dependencies unless absolutely solved a complex problem (e.g., Image processing).
- **Verify WebSockets**: After touching any HTTP middleware or routing logic, **verify WebSocket connections still work**. They are fragile to middleware changes.
