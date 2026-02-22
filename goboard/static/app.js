const statusDot = document.getElementById('connection-status');
const statusText = document.getElementById('status-text');
const statusContainer = document.getElementById('status-container');
const appLogo = document.getElementById('app-logo');
const fileUpload = document.getElementById('file-upload');

let socket;
let clientId = '';
let isRemoteUpdate = false;
let editor;
let remoteCursors = {}; // Map<clientId, boolean> — just tracks presence
let pendingContent = null; // Buffer content until editor is ready
let reconnectTimer = null;
let reconnectDelay = 1000;

// Theme Logic
const themeBtn = document.getElementById('theme-btn');
let currentTheme = localStorage.getItem('goboard-theme');

if (!currentTheme) {
    currentTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
document.documentElement.setAttribute('data-theme', currentTheme);
updateThemeIcon();

if (themeBtn) {
    themeBtn.onclick = () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('goboard-theme', currentTheme);
        updateThemeIcon();
        if (editor) {
            editor.setTheme(currentTheme);
        }
    };
}

function updateThemeIcon() {
    if (themeBtn) {
        themeBtn.textContent = currentTheme === 'dark' ? '☼' : '☾';
        themeBtn.title = currentTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
}

// Start network immediately
connect();
loadConfig();

// Initialize CodeMirror 6 editor (GoEditor bundle loads synchronously)
editor = GoEditor.init(document.getElementById('editor-container'), {
    theme: currentTheme,
    onChange: throttle((content) => {
        if (!isRemoteUpdate) {
            broadcast(content);
        }
    }, 500),
    onCursorChange: throttle((offset) => {
        sendCursor(offset);
    }, 100),
});

if (pendingContent !== null) {
    isRemoteUpdate = true;
    editor.setValue(pendingContent);
    isRemoteUpdate = false;
    pendingContent = null;
}

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
        statusDot.classList.remove('reconnecting');
        statusText.innerText = 'Online';
        reconnectDelay = 1000; // Reset backoff on successful connect
    };

    socket.onclose = (e) => {
        statusDot.classList.remove('online');
        statusDot.classList.add('reconnecting');
        statusText.innerText = 'Reconnecting...';
        statusContainer.title = '';
        Object.keys(remoteCursors).forEach(id => editor && editor.clearRemoteCursor(id));
        remoteCursors = {};
        // Exponential backoff: 1s, 2s, 4s, max 10s
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 3000);
    };

    socket.onerror = () => {
        // onclose will fire after this, which handles reconnection
    };

    socket.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'init') {
                clientId = msg.id;
                // Handle content
                if (msg.content != null && msg.content !== '') {
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
                        const cursorOffset = editor.getCursorOffset();
                        editor.setValue(msg.content || '');
                        editor.setCursorOffset(cursorOffset);
                        isRemoteUpdate = false;
                    }
                }
            } else if (msg.type === 'presence') {
                updatePresence(msg.count, msg.users, msg.ids);
            } else if (msg.type === 'cursor') {
                updateRemoteCursor(msg.id, msg.cursor);
            }
        } catch (err) {
            console.error('WebSocket message error:', err, e.data?.substring?.(0, 200));
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

    // Cleanup ghost cursors for users that have left
    if (ids && editor) {
        Object.keys(remoteCursors).forEach(id => {
            if (!ids.includes(id) && id !== clientId) {
                editor.clearRemoteCursor(id);
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
    if (id === clientId || !editor) return;
    remoteCursors[id] = true;
    editor.setRemoteCursor(id, offset);
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

        // Show build stamp in About modal if available
        if (cfg.build_stamp) {
            const buildDiv = document.getElementById('about-build');
            if (buildDiv) {
                buildDiv.innerText = `Build: ${cfg.build_stamp}`;
            }
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

        connect();

    } catch (e) {
        console.error('Config load failed:', e);
        // Fallback to connect if config fails
        connect();
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

            const sel = editor.getSelection();
            editor.insertAt(sel.from, sel.to, insertText);

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



// About Info Box (clicked via logo)
(function () {
    const modal = document.getElementById('about-modal');
    const closeBtn = document.getElementById('close-about-modal');
    const statsDiv = document.getElementById('about-stats');

    if (appLogo) {
        appLogo.style.cursor = 'pointer';
        appLogo.onclick = async () => {
            if (statsDiv) statsDiv.innerHTML = '<div style="padding:20px;">Loading stats...</div>';

            try {
                const res = await fetch('/stats');
                if (res.ok) {
                    const data = await res.json();
                    let html = '';
                    const renderStats = (obj, indent = 0) => {
                        for (const key in obj) {
                            if (typeof obj[key] === 'object' && obj[key] !== null) {
                                html += `<div style="margin-top:4px; font-weight:bold;">${key.replace(/_/g, ' ')}:</div>`;
                                renderStats(obj[key], indent + 10);
                            } else {
                                const val = obj[key];
                                const label = key.replace(/_/g, ' ');
                                html += `<div style="padding-left:${indent}px;">${label}: ${val}</div>`;
                            }
                        }
                    };
                    renderStats(data);
                    statsDiv.innerHTML = html;
                }
            } catch (e) {
                if (statsDiv) statsDiv.innerHTML = 'Failed to load stats';
                console.error('Failed to fetch stats:', e);
            }

            if (modal) modal.style.display = 'flex';
        };
    }

    if (closeBtn && modal) {
        closeBtn.onclick = () => modal.style.display = 'none';
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }
})();

// Host/Hardware Info Modal Logic
(function () {
    const modal = document.getElementById('host-modal');
    const closeBtn = document.getElementById('close-host-modal');
    const dump = document.getElementById('host-dump');
    const title = document.getElementById('modal-title');

    function setup(btnId, modalTitle, url) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.onclick = async () => {
            if (modal) modal.style.display = 'flex';
            if (title) title.textContent = modalTitle;
            if (dump) dump.textContent = 'Loading...';

            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(res.statusText + ' (' + res.status + ')');
                if (res.headers.get('X-Cached') === 'true' && title) {
                    title.textContent = modalTitle + ' (Cached)';
                }
                const data = await res.json();
                dump.textContent = JSON.stringify(data, null, 2);
            } catch (e) {
                if (dump) dump.textContent = 'Error: ' + e.message;
            }
        };
    }

    setup('host-btn', 'System Status', '/system');
    setup('hw-btn', 'Hardware Details', '/hw');

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
                preview = `<div class="file-preview-img" style="background-image: url('${file.url}');"></div>`;
            } else {
                const mt = file.mime_type || '';
                let icon = '📄';

                if (mt.startsWith('audio/')) icon = '🎵';
                else if (mt.startsWith('video/')) icon = '🎬';
                else if (mt.startsWith('text/')) icon = '📝';
                else if (mt === 'application/pdf') icon = '📄';
                else if (mt.includes('zip') || mt.includes('archive') || mt.includes('compressed')) icon = '📦';
                else if (mt === 'application/x-msdownload' || mt === 'application/x-msi' || mt.includes('executable')) icon = '⚙️';

                preview = `<div class="file-preview-icon">${icon}</div>`;
            }

            // Human readable size
            let sizeStr = '';
            const bytes = file.size;
            if (bytes === 0) {
                sizeStr = 'Empty';
            } else if (bytes < 1024) {
                sizeStr = bytes + ' B';
            } else if (bytes < 1024 * 1024) {
                sizeStr = (bytes / 1024).toFixed(1) + ' KB';
            } else {
                sizeStr = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
                    const sel = editor.getSelection();
                    editor.insertAt(sel.from, sel.to, text);
                    if (modal) modal.style.display = 'none';
                }
            };

            grid.appendChild(item);
        });
    }
})();

// Global Modal Controls
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modals = document.querySelectorAll('.modal-overlay');
        modals.forEach(m => m.style.display = 'none');
    }
});
