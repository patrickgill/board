trying to upgrade Monaco


it reverted?

taskkill /F /IM goboard.exe /T 2>$null
Remove-Item -Recurse -Force "static/vendor/monaco"
New-Item -ItemType Directory -Force "static/vendor/monaco"
npm pack monaco-editor@latest --pack-destination static/vendor/monaco
$tgz = Get-ChildItem static\vendor\monaco\*.tgz | Select-Object -ExpandProperty FullName
tar -xzf $tgz -C static\vendor\monaco --strip-components=1 "package/min"
Remove-Item $tgz
# Strip 'smart' languages (CSS, HTML, JSON, TS)
if (Test-Path "static/vendor/monaco/min/vs/language") { Remove-Item -Recurse -Force "static/vendor/monaco/min/vs/language" }
# Strip all basic languages except markdown
Get-ChildItem -Path "static/vendor/monaco/min/vs/basic-languages" -Directory | Where-Object { $_.Name -ne "markdown" } | Remove-Item -Recurse -Force
# Rebuild and run
go run build.go
.\build\goboard.exe



loader.js
 0.42.0-dev-20230906(e7d7a5b072e74702a912a4c855a3bda21a7757e7



# web framework



https://gofiber.io/
https://github.com/gofiber/awesome-fiber


https://github.com/gin-gonic/gin
88k




# TODO
AI


Resources
embed literal string/binary, native
embed struct in binary, dummy data to start with. for super-host idea later.
get markdown rendering working (like Obsidian)


is this the best high-level architecture design?
i don't want functions mingling business logic and ... logic


Host info


# editor


⏺ It's called Live Preview (sometimes "live editing" or "inline preview").

The broader category is WYSIWYG-adjacent or hybrid editor — distinct from pure WYSIWYG (which fully hides markup) and pure plain-text (which shows only raw
syntax). The defining characteristic is: markdown syntax is hidden/rendered for all text except the block or line the cursor is on.

Obsidian calls it "Live Preview" in their UI. CodeMirror 6's documentation refers to the mechanism as decoration-based content replacement using WidgetType.







# Awesome Go
https://github.com/avelino/awesome-go


Editor
Enable line numbers
try CodeMirror

try Ace
https://ace.c9.io/


# Endpoints
/endpoints
list all

/os
OS info tab, network hosts
os/dump


/build or /info
debug.ReadBuildInfo()
list this go projects version
list relevant go libraries used
list version numbers



Host
Import github.com/shirou/gopsutil/v4/cpu, host, mem, disk, net.
go mod tidy 


# DONE
when service is connected from non-localhost list it
add coloured cursor position for each user, if they have a position
is uuid needed? why was it used?
incorporate better logging. color, but accept NO_COLOR


library changes
gorilla websocket is from 2024
changed to github.com/gorilla/websocket


FILES
upload files
download files

upload images


# editor
you know i'd rather not use minified versions necessarily


# firewall
built-in firewall
a way to block external IPs
blacklist IP/s
whitelist IP/s


errors
The open_browser_url tool failed multiple times with the following error: failed to create browser context: failed to install playwright: $HOME environment variable is not set.

antigravity
https://www.reddit.com/r/google_antigravity/comments/1qlyhm9/fix_windows_after_todays_update_browser_not/
[FIX] [Windows] After today’s update – Browser not opening / Playwright fails ($HOME not set) 



# distribution
minify assets
optimize compilation
virus scan
malware scan
packaging


# uploading

```
curl -X POST -F "file=@microsoftfavicon.ico" http://localhost:8080/upload
```

The server will return a JSON object with the URL of the uploaded file:
json
{"url": "/uploads/image.png"}



# URL
if a rubbish endpoint is accessed
redirect to index
/asdfasdf -> /
301 (Permanent Redirect) or 302 (Temporary Redirect) instead of 404

wildcard route to catch all non-matching URLs

```
// Custom 404 handler
func notFoundHandler(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "404 Not Found: The page you're looking for does not exist.", http.StatusNotFound)
}

// in main
// Catch-all route for non-existing URLs (404 handler)
r.Handle("/*", http.StripPrefix("/", http.HandlerFunc(notFoundHandler)))

//!!!

// Catch-all route to handle all non-existing URLs and redirect to '/' with a 301
r.Handle("/*", http.RedirectHandler("/", http.StatusMovedPermanently)) // 301 is http.StatusMovedPermanently

r.Handle("/*", http.RedirectHandler("/", http.StatusSeeOther)) // 303 is http.StatusSeeOther
```




# gopsutil

wmi equivalent installed with go mod tidy
PS D:\devel\projects\goboard> go mod tidy
go: downloading github.com/power-devops/perfstat v0.0.0-20240221224432-82ca36839d55
go: downloading github.com/stretchr/testify v1.11.1
go: downloading github.com/lufia/plan9stats v0.0.0-20211012122336-39d0f177ccd0
go: downloading github.com/tklauser/go-sysconf v0.3.16
go: downloading github.com/yusufpapurcu/wmi v1.2.4
go: downloading github.com/ebitengine/purego v0.9.1
go: downloading github.com/go-ole/go-ole v1.2.6
go: downloading github.com/tklauser/numcpus v0.11.0
go: downloading gopkg.in/yaml.v3 v3.0.1
go: downloading github.com/davecgh/go-spew v1.1.1
go: downloading github.com/pmezard/go-difflib v1.0.0





# 

type EnvKeyType string

const (
	HostProcEnvKey    EnvKeyType = "HOST_PROC"
	HostSysEnvKey     EnvKeyType = "HOST_SYS"
	HostEtcEnvKey     EnvKeyType = "HOST_ETC"
	HostVarEnvKey     EnvKeyType = "HOST_VAR"
	HostRunEnvKey     EnvKeyType = "HOST_RUN"
	HostDevEnvKey     EnvKeyType = "HOST_DEV"
	HostRootEnvKey    EnvKeyType = "HOST_ROOT"
	HostProcMountinfo EnvKeyType = "HOST_PROC_MOUNTINFO"
)




# Compression
https://github.com/klauspost/compress/



# Zero
https://zero.rocicorp.dev/


https://jsonjoy.com/specs/json-crdt







# Logging
Pro-Tip: The "New" Way (slog)

In modern Go (post 1.21), don't use fmt.Printf for stats. Use the structured logger log/slog. This allows you to export these stats directly to monitoring tools like Grafana or Datadog in a machine-readable format:



logging
https://betterstack.com/community/guides/logging/logging-in-go/


Pro-Tip: The "New" Way (slog)

In modern Go (post 1.21), don't use fmt.Printf for stats. Use the structured logger log/slog. This allows you to export these stats directly to monitoring tools like Grafana or Datadog in a machine-readable format:
Go

import "log/slog"

slog.Info("system_stats", 
    "cpu_usage", cpus[0], 
    "mem_free_gb", v.Available/1e9,
    "disk_usage_pct", d.UsedPercent,
)

Would you like me to show you how to wrap this into a simple JSON API so you can view these stats in a web browser?


logging colour
go get github.com/fatih/color

tint
https://github.com/lmittmann/tint
```go
// Using tint for a polished look
handler := tint.NewHandler(os.Stdout, &tint.Options{
    Level:      slog.LevelDebug,
    TimeFormat: "15:04:05",
})
logger := slog.New(handler)
```



# the editing bug

ai notes
Fix: I implemented coalesced writes. The server now handles broadcasts instantly in memory and only persists the state to disk at most once every 2 seconds. This keeps the WebSocket loop lightning-fast even during heavy collaborative typing.




# Super host
download goboard from a local server
send data back to this super host instead of local-write only

serve zip/exe goboard
embed signature
signature has superhost IP
client binary  reads this signature if it exists
lets client know where to send notes


# 
speed test
thrash the service
Go vs. Rust




#
