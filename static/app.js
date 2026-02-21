const statusDot = document.getElementById('connection-status');
const statusText = document.getElementById('status-text');
const statusContainer = document.getElementById('status-container');
const fileUpload = document.getElementById('file-upload');

let socket;
let clientId = '';
let isRemoteUpdate = false;
let editor;
let remoteCursors = {}; // Map<clientId, IEditorDecorationsCollection>
let pendingContent = null; // Buffer content until editor is ready
let reconnectTimer = null;
let reconnectDelay = 1000;

// Start network immediately
connect();
loadConfig();

// Configure Monaco AMD loader
require.config({
    paths: { vs: 'vendor/monaco/vs' }
});

// Initialize Monaco Editor
require(['vs/editor/editor.main'], function () {
    // Define a custom dark theme to match our UI
    monaco.editor.defineTheme('goboard-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'keyword', foreground: '7f6df2' },
            { token: 'comment', foreground: '6a9955' },
            { token: 'string', foreground: 'ce9178' },
        ],
        colors: {
            'editor.background': '#1e1e1e',
            'editor.foreground': '#cccccc',
            'editor.lineHighlightBackground': '#2a2a2a',
            'editor.selectionBackground': '#264f78',
            'editorCursor.foreground': '#aeafad',
            'editorWhitespace.foreground': '#3b3b3b',
        }
    });

    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: '',
        language: 'markdown',
        theme: 'goboard-dark',
        fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontSize: 15,
        lineHeight: 24,
        padding: { top: 20 },
        minimap: { enabled: false },
        wordWrap: 'on',
        lineNumbers: 'on',
        glyphMargin: false,
        folding: true,
        renderLineHighlight: 'line',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        bracketPairColorization: { enabled: true },
        guides: { indentation: true },
        // Writing-focused settings — no code IDE features
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: 'off',
        wordBasedSuggestions: 'off',
        parameterHints: { enabled: false },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: {
            vertical: 'auto',
            horizontal: 'hidden',
            verticalScrollbarSize: 8,
        },
    });

    // Listen for content changes
    // Listen for content changes (Throttled to 500ms)
    editor.onDidChangeModelContent(throttle(() => {
        if (!isRemoteUpdate) {
            broadcast(editor.getValue());
        }
    }, 500));

    // Broadcast cursor position (Throttled to 100ms)
    editor.onDidChangeCursorPosition(throttle((e) => {
        const model = editor.getModel();
        if (model) {
            const offset = model.getOffsetAt(e.position);
            sendCursor(offset);
        }
    }, 100));

    // Apply any content that arrived while Monaco was loading
    if (pendingContent !== null) {
        isRemoteUpdate = true;
        editor.setValue(pendingContent);
        isRemoteUpdate = false;
        pendingContent = null;
    }
});

// WebSocket
function connect() {
    // Prevent duplicate connections
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
        return;
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onopen = () => {
        statusDot.classList.add('online');
        statusText.innerText = 'Online';
        reconnectDelay = 1000; // Reset backoff on successful connect
    };

    socket.onclose = (e) => {
        statusDot.classList.remove('online');
        statusText.innerText = 'Reconnecting...';
        // Exponential backoff: 1s, 2s, 4s, max 10s
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    };

    socket.onerror = () => {
        // onclose will fire after this, which handles reconnection
    };

    socket.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'init') {
            clientId = msg.id;
            // Handle content
            if (msg.content) {
                if (editor) {
                    isRemoteUpdate = true;
                    editor.setValue(msg.content);
                    isRemoteUpdate = false;
                } else {
                    pendingContent = msg.content;
                }
            }
            // Handle presence
            updatePresence(msg.count, msg.users, msg.ids);
        } else if (msg.type === 'update') {
            if (msg.id !== clientId && editor) {
                const current = editor.getValue();
                if (current !== (msg.content || '')) {
                    isRemoteUpdate = true;
                    // Preserve cursor position across remote updates
                    const pos = editor.getPosition();
                    editor.setValue(msg.content || '');
                    if (pos) editor.setPosition(pos);
                    isRemoteUpdate = false;
                }
            }
        } else if (msg.type === 'presence') {
            updatePresence(msg.count, msg.users, msg.ids);
        } else if (msg.type === 'cursor') {
            updateRemoteCursor(msg.id, msg.cursor);
        }
    };
}

let isCustomMessage = false;

function updatePresence(count, users, ids) {
    if (!isCustomMessage) {
        statusText.innerText = count === 1 ? '1 connection' : `${count} connections`;
    }
    const title = users && users.length > 0 ? users.join('\n') : '';
    if (statusContainer) statusContainer.title = title;

    // Cleanup ghost cursors
    if (ids) {
        Object.keys(remoteCursors).forEach(id => {
            // If the user is no longer present (and it's not us)
            if (!ids.includes(id) && id !== clientId) {
                if (remoteCursors[id]) {
                    remoteCursors[id].clear();
                }
                delete remoteCursors[id];
            }
        });
    }
}

function broadcast(content) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'update',
            content: content,
            id: clientId
        }));
    }
}

function sendCursor(offset) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'cursor',
            cursor: offset,
            id: clientId
        }));
    }
}

function updateRemoteCursor(id, offset) {
    if (!editor || id === clientId) return;

    const model = editor.getModel();
    if (!model) return;

    const pos = model.getPositionAt(offset);

    // Get or create collection
    let collection = remoteCursors[id];
    if (!collection) {
        collection = editor.createDecorationsCollection();
        remoteCursors[id] = collection;
    }

    const colorIndex = Math.abs(hashCode(id)) % 8;
    const colorClass = 'cursor-color-' + colorIndex;

    collection.set([
        {
            range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            options: {
                beforeContentClassName: 'remote-cursor ' + colorClass,
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
            }
        }
    ]);
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

function throttle(func, limit) {
    let lastFunc;
    let lastRan;
    return function () {
        const context = this;
        const args = arguments;
        if (!lastRan) {
            func.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function () {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    }
}

// Config
let maxUploadMB = 100; // Default fallback

async function loadConfig() {
    try {
        const res = await fetch('/config');
        const cfg = await res.json();

        // Show version in logo
        if (cfg.version) {
            const logo = document.querySelector('.logo strong');
            if (logo) logo.innerText = `GoBoard ${cfg.version}`;
        }

        // Show local IP if available
        if (cfg.local_ip && cfg.port) {
            const hostLink = document.getElementById('host-link');
            if (hostLink) {
                hostLink.href = `http://${cfg.local_ip}:${cfg.port}`;
                hostLink.textContent = `${cfg.local_ip}:${cfg.port}`;
                hostLink.title = 'Open on local network';
                hostLink.style.display = 'inline-block';
            }
        }

        if (cfg.max_upload_mb) {
            maxUploadMB = cfg.max_upload_mb;
        }

    } catch (e) {
        console.error('Config load failed:', e);
    }
}

// File upload
fileUpload.onchange = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !editor) return;

    isCustomMessage = true;
    const totalFiles = files.length;

    let successes = 0;
    let failed = 0;
    let lastError = '';

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        statusText.innerText = `Uploading ${i + 1}/${totalFiles}...`;

        const fd = new FormData();
        fd.append('file', file);

        try {
            const res = await fetch('/upload', { method: 'POST', body: fd });
            if (!res.ok) {
                let msg = res.statusText;
                try { msg = await res.text(); } catch (e) { }

                if (res.status === 413 || msg.toLowerCase().includes('too large')) {
                    throw new Error(`File too large (>${maxUploadMB}MB)`);
                }
                throw new Error(msg || `Status ${res.status}`);
            }
            const uploaded = await res.json();

            // Handle array or single object (backward compatibility)
            const list = Array.isArray(uploaded) ? uploaded : [uploaded];

            let insertText = '';
            list.forEach(f => {
                const ext = (f.filename || '').split('.').pop().toLowerCase();
                const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
                const name = f.original || f.filename;
                const link = isImage ? `![${name}](${f.url})` : `[${name}](${f.url})`;
                insertText += link + '\n';
            });

            const selection = editor.getSelection();
            const op = { range: selection, text: insertText, forceMoveMarkers: true };
            editor.executeEdits("insert-file", [op]);

            successes++;
        } catch (err) {
            console.error(`Failed to upload ${file.name}:`, err);
            failed++;
            lastError = err.message;
        }
    }

    // Clear input
    fileUpload.value = '';

    if (failed > 0) {
        statusText.innerText = failed === totalFiles ? `Upload failed: ${lastError}` : `Uploaded ${successes}/${totalFiles} (${failed} failed)`;
    } else {
        statusText.innerText = totalFiles === 1 ? 'Upload complete' : `Uploads: ${totalFiles} complete`;
    }
};



// Host Info Modal Logic
// Host/Hardware Info Modal Logic
(function () {
    const modal = document.getElementById('host-modal');
    const closeBtn = document.getElementById('close-host-modal');
    const dump = document.getElementById('host-dump');
    const title = document.getElementById('modal-title');

    let infoEditor = null;

    function setup(btnId, modalTitle, url) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.onclick = async () => {
            if (modal) modal.style.display = 'flex';
            if (title) title.textContent = modalTitle;
            if (dump) dump.innerHTML = '<div style="padding:20px;">Loading...</div>';

            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(res.statusText + ' (' + res.status + ')');
                if (res.headers.get('X-Cached') === 'true' && title) {
                    title.textContent = modalTitle + ' (Cached)';
                }
                const data = await res.json();

                // Initialize Monaco for Info if not exists
                if (!infoEditor) {
                    dump.innerHTML = ''; // Clear loading text
                    infoEditor = monaco.editor.create(dump, {
                        value: JSON.stringify(data, null, 2),
                        language: 'json',
                        theme: 'goboard-dark',
                        readOnly: true,
                        automaticLayout: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        folding: true,
                        lineNumbers: 'off',
                        renderLineHighlight: 'none',
                    });
                } else {
                    dump.innerHTML = ''; // Clear loading/error text, imperative for monaco mount
                    // If the editor's domNode was removed by innerHTML='', we need to re-append or re-create
                    // Ideally we shouldn't wipe dump.innerHTML if editor exists.
                    // Let's attach editor to a dedicated container instead.
                }

                // Better approach: Check if editor model exists and updates
                if (infoEditor) {
                    // Ensure the editor is still attached to the DOM
                    if (!dump.contains(infoEditor.getDomNode())) {
                        dump.innerHTML = '';
                        infoEditor = monaco.editor.create(dump, {
                            value: JSON.stringify(data, null, 2),
                            language: 'json',
                            theme: 'goboard-dark',
                            readOnly: true,
                            automaticLayout: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            folding: true,
                            lineNumbers: 'off',
                            renderLineHighlight: 'none',
                        });
                    } else {
                        infoEditor.setValue(JSON.stringify(data, null, 2));
                        infoEditor.setScrollTop(0);
                    }
                }

            } catch (e) {
                if (dump) dump.textContent = 'Error: ' + e.message;
            }
        };
    }

    setup('host-btn', 'System Status', '/host');
    setup('ghw-btn', 'Hardware Details', '/hw');

    if (closeBtn && modal) {
        closeBtn.onclick = () => modal.style.display = 'none';
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }
})();

// Files Modal Logic
(function () {
    const modal = document.getElementById('files-modal');
    const closeBtn = document.getElementById('close-files-modal');
    const showBtn = document.getElementById('files-btn');
    const grid = document.getElementById('files-grid');

    if (!showBtn) return;

    showBtn.onclick = async () => {
        if (modal) modal.style.display = 'flex';
        if (grid) grid.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">Loading files...</div>';

        try {
            const res = await fetch('/uploads');
            if (!res.ok) throw new Error(res.statusText);
            const files = await res.json();
            renderFiles(files);
        } catch (e) {
            if (grid) grid.innerHTML = `<div style="padding: 20px; color: #ff5252;">Error loading files: <br>${e.message}</div>`;
        }
    };

    if (closeBtn) {
        closeBtn.onclick = () => {
            if (modal) modal.style.display = 'none';
        }
    }

    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }

    function renderFiles(files) {
        if (!grid) return;

        if (!files || files.length === 0) {
            grid.innerHTML = '<div style="padding: 20px; color: var(--text-dim);">No files uploaded yet.</div>';
            return;
        }

        grid.innerHTML = '';
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'file-item';

            // Preview
            let preview = '';
            if (file.is_image) {
                // Use background image for cover fit
                preview = `<div class="file-preview-img" style="background-image: url('${file.url}');"></div>`;
            } else {
                // Determine icon based on extension
                const ext = (file.name.split('.').pop() || '').toLowerCase();
                let icon = '📄';
                if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) icon = '📦';
                else if (['mp3', 'wav', 'ogg'].includes(ext)) icon = '🎵';
                else if (['mp4', 'webm', 'mov'].includes(ext)) icon = '🎬';
                else if (['pdf', 'doc', 'docx'].includes(ext)) icon = '📝';
                else if (['exe', 'msi', 'bin', 'dll'].includes(ext)) icon = '⚙️';
                else if (['txt', 'md', 'json', 'xml', 'log'].includes(ext)) icon = '📃';

                preview = `<div class="file-preview-icon">${icon}</div>`;
            }

            // Human readable size
            let sizeStr = '';
            if (file.size === 0) {
                sizeStr = 'Empty file';
            } else if (file.size < 1024) {
                sizeStr = file.size + ' B';
            } else if (file.size < 1024 * 1024) {
                sizeStr = (file.size / 1024).toFixed(1) + ' KB';
            } else {
                sizeStr = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
            }

            // Format date
            const date = new Date(file.mod_time * 1000).toLocaleString();

            item.innerHTML = `
                ${preview}
                <div class="file-info">
                    <div class="file-name" title="${file.name}">${file.name}</div>
                    <div class="file-meta" title="Modified: ${date}">${sizeStr}</div>
                </div>
            `;

            // Click to insert link or image into editor
            item.onclick = () => {
                if (editor) {
                    const text = file.is_image ? `![${file.name}](${file.url})` : `[${file.name}](${file.url})`;
                    const selection = editor.getSelection();
                    const op = { range: selection, text: text, forceMoveMarkers: true };
                    editor.executeEdits("insert-file", [op]);
                    if (modal) modal.style.display = 'none';
                }
            };

            grid.appendChild(item);
        });
    }
})();
