/**
 * Playlist Import Module
 * 
 * Supports importing playlists from:
 *   - Spotify URL (via /api/spotify serverless function)
 *   - Manual text (one song per line)
 *   - CSV file
 *   - Excel (.xlsx) file (via SheetJS)
 */

const PlaylistImporter = {
    _isImporting: false,
    _abortController: null,
    _previewTracks: [],
    _playlistName: '',

    // Column header keywords for auto-detection (partial match)
    TITLE_KEYWORDS: ['title', 'song', 'track name', 'track_name', 'name', 'judul', 'lagu', 'musik', 'music'],
    ARTIST_KEYWORDS: ['artist', 'singer', 'artis', 'penyanyi', 'by', 'band', 'performer'],
    // Columns to skip — these contain IDs/URIs, not song names
    SKIP_KEYWORDS: ['uri', 'url', 'id', 'link', 'href', 'duration', 'release', 'date', 'popularity', 'explicit', 'added', 'genre', 'label', 'danceability', 'energy', 'key', 'loudness', 'mode', 'speechiness', 'acousticness', 'instrumentalness', 'liveness', 'valence', 'tempo', 'time signature'],

    /**
     * Initialize — setup listeners
     */
    init() {
        this._setupListeners();
        console.log('PlaylistImporter initialized');
    },

    /**
     * Setup event listeners
     */
    _setupListeners() {
        // Import button in sidebar
        document.getElementById('importPlaylistBtn')?.addEventListener('click', () => this.showModal());

        // Close modal
        document.getElementById('importModalClose')?.addEventListener('click', () => this.hideModal());
        document.getElementById('importModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'importModal') this.hideModal();
        });

        // Tab switching
        document.querySelectorAll('[data-import-tab]').forEach(tab => {
            tab.addEventListener('click', () => this._switchTab(tab.dataset.importTab));
        });

        // Import actions
        document.getElementById('importSpotifyBtn')?.addEventListener('click', () => this._handleSpotifyImport());
        document.getElementById('importTextBtn')?.addEventListener('click', () => this._handleTextImport());
        document.getElementById('importFileBtn')?.addEventListener('click', () => this._handleFileImport());

        // File drop zone
        const dropZone = document.getElementById('importDropZone');
        const fileInput = document.getElementById('importFileInput');

        dropZone?.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone?.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        dropZone?.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) this._handleFileDrop(file);
        });
        dropZone?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this._handleFileDrop(file);
        });

        // Preview actions
        document.getElementById('importCreateBtn')?.addEventListener('click', () => this._createFromPreview());
        document.getElementById('importBackBtn')?.addEventListener('click', () => this._showInputStep());

        // Select all / deselect all
        document.getElementById('importSelectAll')?.addEventListener('click', () => this._toggleSelectAll());

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !document.getElementById('importModal')?.classList.contains('hidden')) {
                this.hideModal();
            }
        });
    },

    // ==========================================
    // Modal Control
    // ==========================================

    showModal() {
        document.getElementById('importModal')?.classList.remove('hidden');
        this._showInputStep();
        this._switchTab('spotify');
    },

    hideModal() {
        document.getElementById('importModal')?.classList.add('hidden');
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        this._isImporting = false;
    },

    _switchTab(tab) {
        // Update tab buttons
        document.querySelectorAll('[data-import-tab]').forEach(el => {
            el.classList.toggle('active', el.dataset.importTab === tab);
        });
        // Update tab content
        document.querySelectorAll('.import-tab-content').forEach(el => {
            el.classList.toggle('hidden', el.id !== `importTab_${tab}`);
        });
    },

    _showInputStep() {
        document.getElementById('importInputStep')?.classList.remove('hidden');
        document.getElementById('importPreviewStep')?.classList.add('hidden');
        document.getElementById('importProgressStep')?.classList.add('hidden');
    },

    _showProgressStep(message) {
        document.getElementById('importInputStep')?.classList.add('hidden');
        document.getElementById('importPreviewStep')?.classList.add('hidden');
        document.getElementById('importProgressStep')?.classList.remove('hidden');
        document.getElementById('importProgressText').textContent = message || 'Processing...';
        document.getElementById('importProgressBar').style.width = '0%';
    },

    _updateProgress(current, total, message) {
        const pct = Math.round((current / total) * 100);
        document.getElementById('importProgressBar').style.width = `${pct}%`;
        document.getElementById('importProgressText').textContent = message || `Matching ${current}/${total}...`;
    },

    // ==========================================
    // Import Handlers
    // ==========================================

    async _handleSpotifyImport() {
        const input = document.getElementById('importSpotifyUrl');
        const url = input?.value.trim();
        if (!url) {
            UI.showToast('Please paste a Spotify playlist URL', 'warning');
            return;
        }

        if (!url.includes('spotify.com/playlist') && !url.includes('spotify:playlist:')) {
            UI.showToast('Invalid Spotify playlist URL', 'error');
            return;
        }

        this._showProgressStep('Fetching Spotify playlist...');

        try {
            this._isImporting = true;
            const response = await fetch(`/api/spotify?url=${encodeURIComponent(url)}`, {
                signal: AbortSignal.timeout(25000)
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `Server error ${response.status}`);
            }

            const data = await response.json();
            if (!data.tracks || data.tracks.length === 0) {
                throw new Error('No tracks found in playlist');
            }

            this._playlistName = data.name || 'Spotify Import';
            await this._resolveAndPreview(data.tracks);
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('Spotify import error:', e);
            UI.showToast(`Import failed: ${e.message}`, 'error');
            this._showInputStep();
        } finally {
            this._isImporting = false;
        }
    },

    _handleTextImport() {
        const textarea = document.getElementById('importTextArea');
        const text = textarea?.value.trim();
        if (!text) {
            UI.showToast('Please paste a song list', 'warning');
            return;
        }

        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) {
            UI.showToast('No songs found in text', 'warning');
            return;
        }

        const tracks = lines.map(line => this._parseTextLine(line));
        this._playlistName = 'Imported Playlist';
        this._showProgressStep(`Matching ${tracks.length} songs...`);
        this._resolveAndPreview(tracks);
    },

    async _handleFileImport() {
        const fileInput = document.getElementById('importFileInput');
        const file = fileInput?.files[0];
        if (!file) {
            UI.showToast('Please select a file', 'warning');
            return;
        }
        this._handleFileDrop(file);
    },

    async _handleFileDrop(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (!['csv', 'xlsx', 'xls'].includes(ext)) {
            UI.showToast('Please upload a .csv or .xlsx file', 'error');
            return;
        }

        this._playlistName = file.name.replace(/\.[^.]+$/, '');
        this._showProgressStep(`Reading ${file.name}...`);

        try {
            let tracks;
            if (ext === 'csv') {
                tracks = await this._parseCSV(file);
            } else {
                tracks = await this._parseExcel(file);
            }

            if (!tracks || tracks.length === 0) {
                UI.showToast('No songs found in file', 'warning');
                this._showInputStep();
                return;
            }

            // Update file info display
            const fileInfo = document.getElementById('importFileInfo');
            if (fileInfo) {
                fileInfo.textContent = `${file.name} — ${tracks.length} songs detected`;
                fileInfo.classList.remove('hidden');
            }

            await this._resolveAndPreview(tracks);
        } catch (e) {
            console.error('File parse error:', e);
            UI.showToast(`Failed to read file: ${e.message}`, 'error');
            this._showInputStep();
        }
    },

    // ==========================================
    // Parsers
    // ==========================================

    /**
     * Parse a single text line into {title, artist}
     * Formats: "Title - Artist", "Artist - Title", "Title"
     */
    _parseTextLine(line) {
        // Remove leading numbers like "1.", "1)", "01."
        line = line.replace(/^\d+[.)]\s*/, '');

        // Try splitting by " - " or " – " (em dash)
        const separators = [' - ', ' – ', ' — ', ' by ', '\t'];
        for (const sep of separators) {
            const idx = line.indexOf(sep);
            if (idx > 0) {
                return {
                    title: line.substring(0, idx).trim(),
                    artist: line.substring(idx + sep.length).trim()
                };
            }
        }

        return { title: line.trim(), artist: '' };
    },

    /**
     * Parse CSV file
     */
    async _parseCSV(file) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) return [];

        // Detect delimiter
        const firstLine = lines[0];
        const delimiter = firstLine.includes('\t') ? '\t' : 
                         firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

        const rows = lines.map(line => this._splitCSVRow(line, delimiter));
        return this._detectColumnsAndExtract(rows);
    },

    /**
     * Split a CSV row handling quoted fields
     */
    _splitCSVRow(line, delimiter) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === delimiter && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    },

    /**
     * Parse Excel file using SheetJS
     */
    async _parseExcel(file) {
        if (typeof XLSX === 'undefined') {
            UI.showToast('Excel support is loading, please try again...', 'info');
            return [];
        }

        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        return this._detectColumnsAndExtract(rows);
    },

    /**
     * Auto-detect title/artist columns from a 2D array of rows
     * Smart matching: supports multi-word headers like "Track Name", "Artist Name(s)"
     * Skips columns with URI/URL/ID content
     */
    _detectColumnsAndExtract(rows) {
        if (rows.length === 0) return [];

        const firstRow = rows[0].map(cell => String(cell || '').toLowerCase().trim());

        let titleCol = -1;
        let artistCol = -1;
        let hasHeader = false;

        // Score each column for title/artist match
        // Higher score = better match
        let bestTitleScore = 0;
        let bestArtistScore = 0;

        for (let i = 0; i < firstRow.length; i++) {
            const header = firstRow[i];

            // Skip if this column header contains a skip keyword
            const shouldSkip = this.SKIP_KEYWORDS.some(kw => header.includes(kw));
            if (shouldSkip) continue;

            // Check title match (longer keyword match = higher priority)
            for (const kw of this.TITLE_KEYWORDS) {
                if (header.includes(kw) && kw.length > bestTitleScore) {
                    titleCol = i;
                    bestTitleScore = kw.length;
                    hasHeader = true;
                }
            }

            // Check artist match
            for (const kw of this.ARTIST_KEYWORDS) {
                if (header.includes(kw) && kw.length > bestArtistScore) {
                    artistCol = i;
                    bestArtistScore = kw.length;
                    hasHeader = true;
                }
            }
        }

        // Fallback: if title col contains "track" but we also found "track name", 
        // the longer match wins (already handled above by score)

        // No header detected — assume col 0 = title, col 1 = artist
        if (titleCol === -1) titleCol = 0;
        if (artistCol === -1 && rows[0].length > 1) artistCol = titleCol === 0 ? 1 : 0;

        const dataRows = hasHeader ? rows.slice(1) : rows;

        return dataRows
            .map(row => {
                let title = String(row[titleCol] || '').trim();
                let artist = artistCol >= 0 ? String(row[artistCol] || '').trim() : '';

                // Filter out spotify URIs that leaked as titles
                if (title.startsWith('spotify:') || title.startsWith('http')) {
                    return null;
                }

                // Clean up artist field — Spotify uses semicolons for multiple artists
                artist = artist.replace(/;/g, ', ');

                return { title, artist };
            })
            .filter(t => t !== null && t.title.length > 0);
    },

    // ==========================================
    // Deezer Resolution
    // ==========================================

    /**
     * Resolve tracks via Deezer and show preview
     */
    async _resolveAndPreview(rawTracks) {
        this._abortController = new AbortController();
        const total = rawTracks.length;
        const resolved = [];

        // Batch: 5 concurrent, 200ms gap between batches
        const BATCH_SIZE = 5;
        const BATCH_DELAY = 200;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            if (this._abortController.signal.aborted) return;

            const batch = rawTracks.slice(i, i + BATCH_SIZE);
            const promises = batch.map(track => this._searchDeezer(track));
            const results = await Promise.all(promises);

            results.forEach((result, idx) => {
                resolved.push({
                    original: rawTracks[i + idx],
                    match: result,
                    selected: result !== null
                });
            });

            this._updateProgress(Math.min(i + BATCH_SIZE, total), total, 
                `Matching songs ${Math.min(i + BATCH_SIZE, total)}/${total}...`);

            // Rate limit delay
            if (i + BATCH_SIZE < total) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        this._previewTracks = resolved;
        this._showPreview();
    },

    /**
     * Search a single track on Deezer
     */
    async _searchDeezer(track) {
        try {
            const query = track.artist 
                ? `${track.title} ${track.artist}` 
                : track.title;

            const results = await MusicAPI.deezer.search(query, 3);
            if (!results || results.length === 0) return null;

            // Find best match
            const titleLower = track.title.toLowerCase();

            // Prefer exact title match
            const bestMatch = results.find(r => 
                r.title?.toLowerCase().includes(titleLower) || 
                titleLower.includes(r.title?.toLowerCase())
            ) || results[0];

            return bestMatch; // Already formatted by MusicAPI.deezer.formatTrack
        } catch (e) {
            console.error('Deezer search error for:', track.title, e);
            return null;
        }
    },

    // ==========================================
    // Preview UI
    // ==========================================

    _showPreview() {
        document.getElementById('importInputStep')?.classList.add('hidden');
        document.getElementById('importProgressStep')?.classList.add('hidden');
        document.getElementById('importPreviewStep')?.classList.remove('hidden');

        const nameInput = document.getElementById('importPlaylistName');
        if (nameInput) nameInput.value = this._playlistName;

        const matched = this._previewTracks.filter(t => t.match);
        const total = this._previewTracks.length;

        document.getElementById('importMatchCount').textContent = 
            `${matched.length}/${total} songs matched`;

        const list = document.getElementById('importPreviewList');
        if (!list) return;

        list.innerHTML = this._previewTracks.map((item, idx) => {
            if (item.match) {
                return `
                    <label class="import-preview-item" data-index="${idx}">
                        <input type="checkbox" ${item.selected ? 'checked' : ''} 
                               class="import-checkbox" data-idx="${idx}">
                        <img src="${item.match.cover || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%23333%22 width=%221%22 height=%221%22/></svg>'}" 
                             class="import-preview-cover" alt="">
                        <div class="import-preview-info">
                            <p class="import-preview-title">${item.match.title}</p>
                            <p class="import-preview-artist">${item.match.artist}</p>
                        </div>
                        <span class="import-preview-badge matched">✓</span>
                    </label>
                `;
            } else {
                return `
                    <div class="import-preview-item not-found" data-index="${idx}">
                        <div class="import-checkbox-placeholder"></div>
                        <div class="import-preview-cover-placeholder"></div>
                        <div class="import-preview-info">
                            <p class="import-preview-title text-gray-500">${item.original.title}</p>
                            <p class="import-preview-artist text-gray-600">${item.original.artist || 'Unknown artist'}</p>
                        </div>
                        <span class="import-preview-badge not-matched">✗</span>
                    </div>
                `;
            }
        }).join('');

        // Checkbox listeners
        list.querySelectorAll('.import-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const idx = parseInt(cb.dataset.idx);
                this._previewTracks[idx].selected = cb.checked;
                this._updateCreateButton();
            });
        });

        this._updateCreateButton();
    },

    _updateCreateButton() {
        const selected = this._previewTracks.filter(t => t.selected && t.match).length;
        const btn = document.getElementById('importCreateBtn');
        if (btn) {
            btn.textContent = `Create Playlist (${selected} songs)`;
            btn.disabled = selected === 0;
        }
    },

    _toggleSelectAll() {
        const allChecked = this._previewTracks.filter(t => t.match).every(t => t.selected);
        this._previewTracks.forEach(t => {
            if (t.match) t.selected = !allChecked;
        });
        document.querySelectorAll('.import-checkbox').forEach(cb => {
            cb.checked = !allChecked;
        });
        this._updateCreateButton();
    },

    // ==========================================
    // Create Playlist
    // ==========================================

    async _createFromPreview() {
        const nameInput = document.getElementById('importPlaylistName');
        const name = nameInput?.value.trim() || this._playlistName || 'Imported Playlist';

        const selected = this._previewTracks
            .filter(t => t.selected && t.match)
            .map(t => t.match);

        if (selected.length === 0) {
            UI.showToast('No songs selected', 'warning');
            return;
        }

        // Create playlist
        const playlist = await PlaylistManager.createPlaylist(name);
        
        // Add all tracks (silent — no individual toasts)
        for (const track of selected) {
            await PlaylistManager.addTrackToPlaylist(playlist.id, track, true);
        }

        UI.showToast(`Imported "${name}" with ${selected.length} songs!`, 'success');
        this.hideModal();
        
        // Open the new playlist
        PlaylistManager.viewPlaylist(playlist.id);
    }
};
