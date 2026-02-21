(function() {
    const filesBody = document.getElementById('files-body');
    const searchInput = document.getElementById('search-input');
    const clearSearch = document.getElementById('clear-search');
    const statsInfo = document.getElementById('stats-info');
    let allFiles = [];

    async function fetchFiles() {
        try {
            const res = await fetch('/uploads');
            if (!res.ok) throw new Error('Failed to fetch files');
            allFiles = await res.json();
            renderFiles(allFiles);
            updateStats();
        } catch (err) {
            console.error(err);
            filesBody.innerHTML = `<tr><td colspan="5" style="color: #ff5252;">Error: ${err.message}</td></tr>`;
        }
    }

    function formatSize(bytes) {
        if (bytes === 0) return 'Empty';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatDate(unix) {
        const d = new Date(unix * 1000);
        return d.toLocaleString();
    }

    function getIcon(file) {
        if (file.is_image) return '🖼️';
        const mt = file.mime_type || '';
        
        if (mt.startsWith('audio/')) return '🎵';
        if (mt.startsWith('video/')) return '🎬';
        if (mt.startsWith('text/')) return '📝';
        if (mt === 'application/pdf') return '📄';
        if (mt.includes('zip') || mt.includes('archive') || mt.includes('compressed')) return '📦';
        if (mt === 'application/x-msdownload' || mt === 'application/x-msi' || mt.includes('executable')) return '⚙️';
        
        return '📄';
    }

    function formatMime(mt) {
        if (!mt) return 'Unknown';
        // Clean up common types
        if (mt === 'application/octet-stream') return 'Binary';
        if (mt === 'application/x-msdownload') return 'Executable';
        
        // Remove prefixes for better display
        return mt.replace('application/', '')
                 .replace('video/', '')
                 .replace('audio/', '')
                 .replace('image/', '')
                 .replace('text/', '')
                 .toUpperCase();
    }

    function renderFiles(files) {
        if (!files || files.length === 0) {
            filesBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-dim);">No files here.</td></tr>';
            return;
        }

        filesBody.innerHTML = files.map(file => `
            <tr>
                <td class="col-icon" title="${formatMime(file.mime_type)}">${getIcon(file)}</td>
                <td class="col-name"><a href="${file.url}" target="_blank">${file.name}</a></td>
                <td class="col-date">${formatDate(file.mod_time)}</td>
                <td class="col-size">${formatSize(file.size)}</td>
                <td class="col-actions">
                    <div class="action-buttons">
                        <a href="${file.url}" download="${file.name}" title="Download" class="btn-action">💾</a>
                        <button onclick="copyToClipboard('${file.url}')" title="Copy Link" class="btn-action">🔗</button>
                        <a href="${file.url}" target="_blank" title="Open" class="btn-action">↗️</a>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function updateStats() {
        if (!allFiles) return;
        const totalSize = allFiles.reduce((acc, f) => acc + f.size, 0);
        statsInfo.innerText = `${allFiles.length} file(s) • ${formatSize(totalSize)} total`;
    }

    window.copyToClipboard = function(url) {
        const fullUrl = window.location.origin + url;
        navigator.clipboard.writeText(fullUrl).catch(err => {
            console.error('Failed to copy: ', err);
        });
    };

    function clearFilter() {
        searchInput.value = '';
        renderFiles(allFiles);
        clearSearch.style.visibility = 'hidden';
    }

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        clearSearch.style.visibility = query ? 'visible' : 'hidden';
        const filtered = allFiles.filter(f => f.name.toLowerCase().includes(query));
        renderFiles(filtered);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            clearFilter();
        }
    });

    if (clearSearch) {
        clearSearch.onclick = clearFilter;
        clearSearch.style.visibility = 'hidden';
    }

    fetchFiles();
})();
