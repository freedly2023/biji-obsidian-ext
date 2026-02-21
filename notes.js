(function () {
    'use strict';

    // Shared constants — single source of truth
    const BIJI_API_BASE = 'https://get-notes.luojilab.com/voicenotes/web/notes';
    const BIJI_EXPORT_API = 'https://get-notes.luojilab.com/voicenotes/web/export/tasks';
    const SUBMIT_API_URL = 'https://get-notes.luojilab.com/voicenotes/web/notes/stream';
    const DEFAULT_SETTINGS = {
        filenameTemplate: '{date}-{title}',
        dateFormat: 'YYYY-MM-DD',
        transcriptMode: 'none',
        folderMode: 'flat',
        frontmatterFields: {
            title: true,
            created: true,
            modified: true,
            source: true,
            type: true,
            tags: true,
            biji_id: true,
            exported: true,
        },
        imageFormat: 'link',
        includeAudioLink: true,
        includeImages: true,
        voiceSentenceSplit: true,
        tagPrefix: '#',
        // Export
        exportMode: 'zip',
        vaultSubfolder: 'biji-notes',
        contentFetchConcurrency: 5,
        transcriptFetchConcurrency: 5,
        zipExportConcurrencyLight: 6,
        zipExportConcurrencyHeavy: 2,
        vaultWriteConcurrency: 4,
        // Advanced
        discoveryMode: false,
        fetchDelay: 500,
        scanDepth: 10,
        // Link submission buttons
        enableInjectBtn: true,
        injectBtnYoutube: true,
        injectBtnBilibili: true,
        injectBtnXiaoyuzhou: true,
        // Feed management
        feedAutoCheck: false,
        feedCheckInterval: 60,
        feedAutoSubmit: true,
    };

    // chrome.storage.local Promise wrappers
    function storageGet(keys) {
        return new Promise(resolve => {
            chrome.storage.local.get(keys, resolve);
        });
    }
    function storageSet(items) {
        return new Promise(resolve => {
            chrome.storage.local.set(items, resolve);
        });
    }
    function storageRemove(keys) {
        return new Promise(resolve => {
            chrome.storage.local.remove(keys, resolve);
        });
    }

    // Settings loader — async version of window.loadSettings
    async function loadSettings() {
        const data = await storageGet('settings');
        return Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    }
    // Callback-based version for backward compatibility with existing JS
    function loadSettingsCb(cb) {
        chrome.storage.local.get('settings', function (data) {
            const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
            if (cb)
                cb(settings);
        });
    }

    // Sort utilities
    // Previously window.sortNotesByDate in shared.js
    function sortNotesByDate(arr) {
        arr.sort((a, b) => {
            const tA = a.createdAt
                ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime()
                : 0;
            const tB = b.createdAt
                ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime()
                : 0;
            return tB - tA;
        });
        return arr;
    }

    // Unified date formatting utilities
    // Previously in shared.js (MD.formatDate, MD.formatDateShort) and subscription-shared.js (formatRelativeDate)
    function pad2(n) {
        return String(n).padStart(2, '0');
    }
    function toDate(dateStr) {
        try {
            const d = new Date(typeof dateStr === 'number' ? dateStr * 1000 : dateStr);
            if (isNaN(d.getTime()))
                return null;
            return d;
        }
        catch {
            return null;
        }
    }
    function formatDate(dateStr) {
        if (!dateStr)
            return null;
        const d = toDate(dateStr);
        if (!d)
            return String(dateStr);
        return (d.getFullYear() + '-' +
            pad2(d.getMonth() + 1) + '-' +
            pad2(d.getDate()) + 'T' +
            pad2(d.getHours()) + ':' +
            pad2(d.getMinutes()) + ':' +
            pad2(d.getSeconds()));
    }
    function formatDateShort(dateStr, fmt) {
        if (!dateStr)
            return null;
        const d = toDate(dateStr);
        if (!d)
            return null;
        const Y = String(d.getFullYear());
        const M = pad2(d.getMonth() + 1);
        const D = pad2(d.getDate());
        if (fmt === 'YYYYMMDD')
            return Y + M + D;
        if (fmt === 'YYYY/MM/DD')
            return Y + '/' + M + '/' + D;
        return Y + '-' + M + '-' + D;
    }
    function formatRelativeDate(isoStr) {
        if (!isoStr)
            return '';
        try {
            const d = new Date(isoStr);
            const now = new Date();
            const diff = now.getTime() - d.getTime();
            if (diff < 60000)
                return '刚刚';
            if (diff < 3600000)
                return Math.floor(diff / 60000) + '分钟前';
            if (diff < 86400000)
                return Math.floor(diff / 3600000) + '小时前';
            if (diff < 604800000)
                return Math.floor(diff / 86400000) + '天前';
            return d.toISOString().substring(0, 10);
        }
        catch {
            return '';
        }
    }

    // Unified sanitization / escaping utilities
    // Previously in shared.js (escapeHtml), subscription-shared.js (escHtml),
    // and feed-manager.js (decodeXmlEntities, stripHtml)
    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escapeHtmlAttr(str) {
        if (!str)
            return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function decodeXmlEntities(str) {
        if (!str)
            return '';
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    function stripHtml(html) {
        if (!html)
            return '';
        return html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
    }
    function htmlToText(html) {
        if (!html)
            return '';
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('style, script, link, noscript').forEach(el => el.remove());
        return (div.textContent || '').trim();
    }
    function looksLikeHtmlFragment$1(text) {
        if (!text)
            return false;
        if (text.indexOf('<') === -1 || text.indexOf('>') === -1)
            return false;
        return /<\/?[a-z][\w:-]*(\s[^>]*)?>/i.test(text);
    }
    function parseSentenceList(raw) {
        if (!raw || raw.charAt(0) !== '{')
            return null;
        try {
            const obj = JSON.parse(raw);
            const list = obj.sentence_list || obj.sentenceList || obj.sentences;
            if (!Array.isArray(list) || list.length === 0)
                return null;
            return list
                .map((s) => s.text || s.content || s.sentence || '')
                .filter(Boolean)
                .join('\n\n');
        }
        catch (_) {
            return null;
        }
    }
    function normalizeTranscript(raw) {
        if (!raw)
            return '';
        const parsed = parseSentenceList(raw);
        if (parsed)
            return parsed;
        // Avoid stripping normal text like "<音乐>" that is not real HTML tags.
        if (looksLikeHtmlFragment$1(raw)) {
            return htmlToText(raw) || stripHtml(raw) || raw;
        }
        return raw;
    }

    // Markdown converter — extracted from shared.js MD object
    function formatTags(tags) {
        if (!tags || !Array.isArray(tags))
            return [];
        return tags
            .map(t => {
            const name = typeof t === 'string' ? t : t.name || t.label || '';
            return name.replace(/\s+/g, '-');
        })
            .filter(Boolean);
    }
    function frontmatter(note, settings) {
        const fields = (settings && settings.frontmatterFields) || {
            title: true,
            created: true,
            modified: true,
            source: true,
            type: true,
            tags: true,
            biji_id: true,
            exported: true,
        };
        const lines = ['---'];
        if (fields.title) {
            const title = note.title || 'Untitled';
            lines.push('title: "' + title.replace(/"/g, '\\"') + '"');
        }
        if (fields.created) {
            const created = formatDate(note.createdAt);
            if (created)
                lines.push('created: ' + created);
        }
        if (fields.modified) {
            const modified = formatDate(note.updatedAt);
            if (modified)
                lines.push('modified: ' + modified);
        }
        if (fields.source) {
            lines.push('source: "biji.com (Get笔记)"');
        }
        if (fields.type && note.type) {
            lines.push('type: ' + note.type);
        }
        if (fields.tags) {
            const tags = formatTags(note.tags);
            if (tags.length > 0) {
                lines.push('tags:');
                tags.forEach(t => {
                    lines.push('  - "' + t + '"');
                });
            }
        }
        if (fields.biji_id && note.id) {
            lines.push('biji_id: "' + note.id + '"');
        }
        if (fields.exported) {
            lines.push('exported: ' + formatDate(new Date().toISOString()));
        }
        lines.push('---');
        return lines.join('\n');
    }
    function htmlToMd(html) {
        let md = html;
        md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
        md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
        md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
        md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
        md = md.replace(/<br\s*\/?>/gi, '\n');
        md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
        md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
        md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
        md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
        md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
        md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
        md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
        md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');
        md = md.replace(/<[^>]+>/g, '');
        md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        md = md.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
        md = md.replace(/\n{3,}/g, '\n\n');
        return md.trim();
    }
    function formatImage(img, index, settings) {
        const url = typeof img === 'string' ? img : (img.url || img.src || '');
        if (!url)
            return '';
        if (settings && settings.imageFormat === 'obsidian') {
            const fname = url.split('/').pop().split('?')[0] || 'image-' + (index + 1) + '.png';
            return '![[' + fname + ']]';
        }
        return '![图片 ' + (index + 1) + '](' + url + ')';
    }
    function convert(note, settings) {
        const parts = [frontmatter(note, settings), ''];
        if (note.title) {
            parts.push('# ' + note.title);
            parts.push('');
        }
        let content = note.content || '';
        if (content.includes('<') && content.includes('>')) {
            content = htmlToMd(content);
        }
        else {
            content = content.replace(/\r\n/g, '\n');
            if (note.type === 'voice' && (!settings || settings.voiceSentenceSplit !== false)) {
                content = content.replace(/([。！？.!?])\s*/g, '$1\n\n');
            }
        }
        parts.push(content);
        if (note.audioUrl && (!settings || settings.includeAudioLink !== false)) {
            parts.push('', '---', '**录音**: [收听](' + note.audioUrl + ')');
        }
        if (note.images && note.images.length > 0 && (!settings || settings.includeImages !== false)) {
            parts.push('', '---', '## 图片', '');
            note.images.forEach((img, i) => {
                const line = formatImage(img, i, settings);
                if (line)
                    parts.push(line);
            });
        }
        return parts.join('\n');
    }
    function looksLikeMarkdown(text) {
        return (/^#{1,6}\s/m.test(text) ||
            /\*\*[^*]+\*\*/m.test(text) ||
            /\*[^*]+\*/m.test(text) ||
            /\[.+?\]\(.+?\)/m.test(text) ||
            /^[-*+]\s/m.test(text) ||
            /^\d+\.\s/m.test(text) ||
            /^---$/m.test(text) ||
            /^>\s/m.test(text));
    }
    function mdToHtml(md) {
        let html = md;
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/^---$/gm, '<hr>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
        html = html.replace(/\n\n+/g, '</p><p>');
        html = '<p>' + html + '</p>';
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/\n/g, '<br>');
        return html;
    }
    function convertTranscript(note, settings) {
        const parts = [frontmatter(note, settings), ''];
        parts.push('# ' + (note.title || 'Untitled') + ' — Transcript');
        parts.push('');
        let content = normalizeTranscript(note.rawTranscript || '') || note.content || '';
        if (content.includes('<') && content.includes('>')) {
            content = htmlToMd(content);
        }
        parts.push(content);
        return parts.join('\n');
    }
    // Re-export as MD namespace object for backward compatibility during migration
    const MD = {
        formatDate,
        formatDateShort,
        formatTags,
        frontmatter,
        htmlToMd,
        formatImage,
        convert,
        _looksLikeMarkdown: looksLikeMarkdown,
        mdToHtml,
        convertTranscript,
    };

    // Export Tracker — tracks which note IDs have been exported
    // Extracted from shared.js ExportTracker
    let _exportedSet = null;
    let _lastExportTime = null;
    function load(cb) {
        chrome.storage.local.get(['exportedIds', 'lastExportTime'], function (data) {
            _exportedSet = new Set(data.exportedIds || []);
            _lastExportTime = data.lastExportTime || null;
            if (cb)
                cb();
        });
    }
    function markExported(ids) {
        if (!_exportedSet)
            _exportedSet = new Set();
        ids.forEach(id => _exportedSet.add(id));
        _lastExportTime = new Date().toISOString();
        chrome.storage.local.set({
            exportedIds: Array.from(_exportedSet),
            lastExportTime: _lastExportTime,
        });
    }
    function isExported(id) {
        return _exportedSet ? _exportedSet.has(id) : false;
    }
    function getNewCount(notes) {
        return notes.filter(n => !isExported(n.id)).length;
    }
    function getNewNotes(notes) {
        return notes.filter(n => !isExported(n.id));
    }
    function clear(cb) {
        _exportedSet = new Set();
        _lastExportTime = null;
        chrome.storage.local.remove(['exportedIds', 'lastExportTime'], function () {
            if (cb)
                cb();
        });
    }
    const ExportTracker = { load, markExported, isExported, getNewCount, getNewNotes, clear };

    // File naming utilities
    // Previously window.* globals in shared.js
    function sanitizeFilename(name) {
        return name
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 100);
    }
    function getDateParts(note, settings) {
        const raw = note.createdAt;
        if (!raw)
            return { date: 'undated', year: 'undated', month: '00' };
        try {
            const d = new Date(typeof raw === 'number' ? raw * 1000 : raw);
            if (isNaN(d.getTime()))
                return { date: 'undated', year: 'undated', month: '00' };
            const fmt = (settings && settings.dateFormat) || 'YYYY-MM-DD';
            const dateStr = formatDateShort(raw, fmt) || 'undated';
            return {
                date: dateStr,
                year: String(d.getFullYear()),
                month: String(d.getMonth() + 1).padStart(2, '0'),
            };
        }
        catch {
            return { date: 'undated', year: 'undated', month: '00' };
        }
    }
    function filename(note, settings) {
        const template = (settings && settings.filenameTemplate) || '{date}-{title}';
        const parts = getDateParts(note, settings);
        const title = note.title ? sanitizeFilename(note.title) : 'note-' + note.id;
        let result = template
            .replace(/\{date\}/g, parts.date)
            .replace(/\{title\}/g, title)
            .replace(/\{id\}/g, note.id || 'unknown')
            .replace(/\{type\}/g, note.type || 'text')
            .replace(/\{year\}/g, parts.year)
            .replace(/\{month\}/g, parts.month);
        const segments = result.split('/').map(seg => seg.replace(/[<>:"|?*]/g, '').trim());
        result = segments.join('/');
        if (!result.endsWith('.md'))
            result += '.md';
        return result;
    }
    function getFolderPrefix(note, settings) {
        const mode = (settings && settings.folderMode) || 'flat';
        const template = (settings && settings.filenameTemplate) || '{date}-{title}';
        if (template.indexOf('/') !== -1)
            return '';
        if (mode === 'flat')
            return '';
        if (mode === 'byType')
            return (note.type || 'text') + '/';
        if (mode === 'byTag') {
            const tags = formatTags(note.tags);
            return tags.length > 0 ? tags[0] + '/' : 'untagged/';
        }
        if (mode === 'byMonth') {
            const parts = getDateParts(note, settings);
            return parts.year + '-' + parts.month + '/';
        }
        return '';
    }
    function fullPath(note, settings) {
        return getFolderPrefix(note, settings) + filename(note, settings);
    }
    function getFileExt(format) {
        if (format === 'pdf')
            return '.pdf';
        if (format === 'docx')
            return '.docx';
        return '.md';
    }
    function fullPathWithFormat(note, settings, format) {
        let path = fullPath(note, settings);
        if (format !== 'md') {
            path = path.replace(/\.md$/, getFileExt(format));
        }
        return path;
    }
    function deduplicateFilename(fn, used, ext) {
        if (!used[fn])
            return fn;
        const base = fn.replace(ext, '');
        let c = 2;
        while (used[base + '-' + c + ext])
            c++;
        return base + '-' + c + ext;
    }

    // Server Exporter — export notes via biji.com API (PDF/DOCX)
    // Extracted from shared.js ServerExporter
    function exportNote(noteId, format) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'exportNote', noteId, format }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || 'Message failed'));
                    return;
                }
                if (!response || response.error) {
                    reject(new Error((response && response.error) || 'Export failed'));
                    return;
                }
                fetch(response.access_url)
                    .then(res => {
                    if (!res.ok)
                        throw new Error('Download failed: ' + res.status);
                    return res.blob();
                })
                    .then(resolve)
                    .catch(reject);
            });
        });
    }
    const ServerExporter = { exportNote };

    // Image Fetcher — fetch images as ArrayBuffer or Base64
    // Extracted from shared.js ImageFetcher
    const _cache = {};
    function fetchAsArrayBuffer(url) {
        if (_cache[url] && _cache[url].arrayBuffer) {
            return Promise.resolve(_cache[url]);
        }
        return fetch(url)
            .then(res => {
            if (!res.ok)
                throw new Error('Image fetch failed: ' + res.status);
            return res.arrayBuffer();
        })
            .then(buf => {
            return new Promise(resolve => {
                const blob = new Blob([buf]);
                const img = new Image();
                img.onload = function () {
                    const result = {
                        arrayBuffer: buf,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        blob: blob,
                    };
                    _cache[url] = result;
                    URL.revokeObjectURL(img.src);
                    resolve(result);
                };
                img.onerror = function () {
                    const result = { arrayBuffer: buf, width: 400, height: 300, blob: blob };
                    _cache[url] = result;
                    URL.revokeObjectURL(img.src);
                    resolve(result);
                };
                img.src = URL.createObjectURL(blob);
            });
        });
    }
    function fetchAsBase64(url) {
        if (_cache[url] && _cache[url].base64) {
            return Promise.resolve(_cache[url].base64);
        }
        return fetch(url)
            .then(res => {
            if (!res.ok)
                throw new Error('Image fetch failed: ' + res.status);
            return res.blob();
        })
            .then(blob => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = function () {
                    const base64 = reader.result;
                    if (!_cache[url])
                        _cache[url] = {};
                    _cache[url].base64 = base64;
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        });
    }
    function clearCache() {
        for (const key of Object.keys(_cache)) {
            delete _cache[key];
        }
    }
    const ImageFetcher = { fetchAsArrayBuffer, fetchAsBase64, clearCache };

    // PDF Converter — generate PDFs from notes
    // Extracted from shared.js PDFConverter
    const PDF_LIGHTWEIGHT = {
        html2canvasScale: 1.35,
        html2pdfJpegQuality: 0.82,
        canvasJpegQuality: 0.82,
        jsPdfCompress: true,
    };
    const PDF_RENDER_SAFETY = {
        bottomReservePx: 24,
        lineDescentPadPx: 4,
        htmlBottomPadPx: 24,
    };
    function looksLikeHtmlFragment(text) {
        if (!text)
            return false;
        if (text.indexOf('<') === -1 || text.indexOf('>') === -1)
            return false;
        return /<\/?[a-z][\w:-]*(\s[^>]*)?>/i.test(text);
    }
    function stripInlineMarkdown(text) {
        if (!text)
            return '';
        let out = text;
        out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt) => {
            const label = (alt || '').trim();
            return label ? '[图片] ' + label : '[图片]';
        });
        out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
        out = out.replace(/`([^`]+)`/g, '$1');
        out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
        out = out.replace(/__([^_]+)__/g, '$1');
        out = out.replace(/\*([^*\n]+)\*/g, '$1');
        out = out.replace(/_([^_\n]+)_/g, '$1');
        out = out.replace(/~~([^~]+)~~/g, '$1');
        return out;
    }
    function isMarkdownTableRow(line) {
        const trimmed = line.trim();
        if (!trimmed)
            return false;
        return /\|/.test(trimmed) && trimmed.replace(/\|/g, '').trim().length > 0;
    }
    function isMarkdownTableSeparator(line) {
        return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());
    }
    function splitMarkdownTableRow(line) {
        let raw = line.trim();
        if (raw.startsWith('|'))
            raw = raw.slice(1);
        if (raw.endsWith('|'))
            raw = raw.slice(0, -1);
        return raw.split('|').map(cell => stripInlineMarkdown(cell.trim()));
    }
    function textDisplayWidth(text) {
        let width = 0;
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            width += code > 255 ? 2 : 1;
        }
        return width;
    }
    function padDisplayText(text, width) {
        const delta = Math.max(0, width - textDisplayWidth(text));
        return text + ' '.repeat(delta);
    }
    function renderTableText(rows) {
        if (!rows || rows.length === 0)
            return [];
        const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
        const normalized = rows.map(r => {
            const out = r.slice(0, colCount);
            while (out.length < colCount)
                out.push('');
            return out;
        });
        const colWidths = Array(colCount).fill(0);
        normalized.forEach(r => {
            r.forEach((cell, idx) => {
                colWidths[idx] = Math.max(colWidths[idx], textDisplayWidth(cell));
            });
        });
        const makeBorder = (left, mid, right) => left + colWidths.map(w => '─'.repeat(w + 2)).join(mid) + right;
        const lines = [];
        lines.push(makeBorder('┌', '┬', '┐'));
        normalized.forEach((row, idx) => {
            const rowLine = '│ ' + row.map((cell, i) => padDisplayText(cell, colWidths[i])).join(' │ ') + ' │';
            lines.push(rowLine);
            if (idx === 0 && normalized.length > 1) {
                lines.push(makeBorder('├', '┼', '┤'));
            }
        });
        lines.push(makeBorder('└', '┴', '┘'));
        return lines;
    }
    function markdownToReadableText(md) {
        if (!md)
            return '';
        const lines = md.replace(/\r\n/g, '\n').split('\n');
        const rendered = [];
        let inCodeFence = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (/^```/.test(trimmed)) {
                inCodeFence = !inCodeFence;
                rendered.push('');
                continue;
            }
            if (inCodeFence) {
                rendered.push(line);
                continue;
            }
            if (!trimmed) {
                rendered.push('');
                continue;
            }
            if (i + 1 < lines.length &&
                isMarkdownTableRow(line) &&
                isMarkdownTableSeparator(lines[i + 1])) {
                const tableRows = [splitMarkdownTableRow(line)];
                i += 2;
                while (i < lines.length && isMarkdownTableRow(lines[i])) {
                    tableRows.push(splitMarkdownTableRow(lines[i]));
                    i++;
                }
                i -= 1;
                renderTableText(tableRows).forEach(tl => rendered.push(tl));
                rendered.push('');
                continue;
            }
            const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
            if (headingMatch) {
                rendered.push(stripInlineMarkdown(headingMatch[2]).trim());
                rendered.push('');
                continue;
            }
            if (/^---+$/.test(trimmed)) {
                rendered.push('────────────────');
                rendered.push('');
                continue;
            }
            const quoteMatch = /^>\s+(.+)$/.exec(line);
            if (quoteMatch) {
                rendered.push('“' + stripInlineMarkdown(quoteMatch[1]).trim() + '”');
                continue;
            }
            const orderedMatch = /^(\s*)(\d+)\.\s+(.+)$/.exec(line);
            if (orderedMatch) {
                rendered.push((orderedMatch[1] || '') + orderedMatch[2] + '. ' + stripInlineMarkdown(orderedMatch[3]).trim());
                continue;
            }
            const unorderedMatch = /^(\s*)[-*+]\s+(.+)$/.exec(line);
            if (unorderedMatch) {
                rendered.push((unorderedMatch[1] || '') + '• ' + stripInlineMarkdown(unorderedMatch[2]).trim());
                continue;
            }
            rendered.push(stripInlineMarkdown(line));
        }
        return rendered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function normalizeRenderableText(raw) {
        if (!raw)
            return '';
        if (looksLikeHtmlFragment(raw)) {
            const md = htmlToMd(raw);
            const readable = markdownToReadableText(md);
            return readable || htmlToText(raw) || stripHtml(raw) || raw;
        }
        if (looksLikeMarkdown(raw)) {
            return markdownToReadableText(raw);
        }
        return raw;
    }
    function softWrapLongTokens(text) {
        if (!text)
            return '';
        return text
            .split(/(\s+)/)
            .map(token => {
            if (!token || /\s+/.test(token) || token.length <= 64)
                return token;
            const parts = token.match(/.{1,32}/g);
            return parts ? parts.join('\u200B') : token;
        })
            .join('');
    }
    function textToParagraphsHtml(text, splitSentences = false) {
        if (!text)
            return '';
        let normalized = text.replace(/\r\n/g, '\n');
        if (splitSentences) {
            normalized = normalized.replace(/([。！？.!?])\s*/g, '$1\n\n');
        }
        const paragraphs = normalized.split(/\n\n+/);
        let html = '';
        paragraphs.forEach(p => {
            if (p.trim()) {
                const wrapped = softWrapLongTokens(p.trim());
                if (/[┌┬┐├┼┤└┴┘│]/.test(wrapped)) {
                    html += '<pre style="margin: 10px 0; white-space: pre-wrap; font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.6;">' +
                        escapeHtml(wrapped) + '</pre>';
                }
                else {
                    html += '<p style="margin: 10px 0;">' +
                        escapeHtml(wrapped).replace(/\n/g, '<br>') + '</p>';
                }
            }
        });
        return html;
    }
    function buildMergedPdfHtml(note, settings) {
        let html = "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; width: 700px; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333; word-break: break-word; overflow-wrap: anywhere;\">";
        html +=
            '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
                escapeHtml(note.title || 'Untitled') + '</h1>';
        const date = formatDate(note.createdAt);
        if (date) {
            html +=
                '<div style="font-size: 12px; color: #888; margin-bottom: 16px;">' +
                    escapeHtml(date) + ' | ' + escapeHtml(note.type || 'text') + '</div>';
        }
        let main = normalizeRenderableText(note.content || '');
        html += textToParagraphsHtml(main, note.type === 'voice' && settings.voiceSentenceSplit !== false);
        if (note.audioUrl && settings.includeAudioLink !== false) {
            html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
            html += '<p style="margin: 10px 0;"><strong>录音</strong>: ' + escapeHtml(note.audioUrl) + '</p>';
        }
        const raw = normalizeTranscript(note.rawTranscript || '');
        if (raw.trim()) {
            html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
            html += '<h2 style="font-size: 16px; margin-bottom: 12px;">原始文字记录</h2>';
            html += textToParagraphsHtml(raw, false);
        }
        html += '</div>';
        return html;
    }
    function wrapTextByWidth(ctx, text, maxWidthPx) {
        if (!text)
            return [''];
        const lines = [];
        let line = '';
        for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);
            const test = line + ch;
            if (line && ctx.measureText(test).width > maxWidthPx) {
                lines.push(line);
                line = ch;
            }
            else {
                line = test;
            }
        }
        if (line)
            lines.push(line);
        return lines.length > 0 ? lines : [''];
    }
    async function _createA4PdfInstance() {
        const jsPdfCtor = window.jspdf?.jsPDF || window.jsPDF;
        if (jsPdfCtor) {
            return new jsPdfCtor({
                unit: 'mm',
                format: 'a4',
                orientation: 'portrait',
                compress: PDF_LIGHTWEIGHT.jsPdfCompress,
            });
        }
        if (typeof html2pdf === 'undefined') {
            throw new Error('html2pdf library not loaded');
        }
        const seedOpt = {
            margin: [0, 0, 0, 0],
            filename: 'seed.pdf',
            image: { type: 'jpeg', quality: PDF_LIGHTWEIGHT.html2pdfJpegQuality },
            html2canvas: {
                scale: PDF_LIGHTWEIGHT.html2canvasScale,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
            },
            jsPDF: {
                unit: 'mm',
                format: 'a4',
                orientation: 'portrait',
                compress: PDF_LIGHTWEIGHT.jsPdfCompress,
            },
        };
        const seedWorker = html2pdf()
            .set(seedOpt)
            .from('<div style="width:1px;height:1px;overflow:hidden;">.</div>', 'string');
        const seeded = (seedWorker && typeof seedWorker.toPdf === 'function')
            ? seedWorker.toPdf()
            : seedWorker;
        const pdf = (seeded && typeof seeded.get === 'function')
            ? await Promise.resolve(seeded.get('pdf'))
            : seeded && seeded.prop && seeded.prop.pdf
                ? seeded.prop.pdf
                : null;
        if (!pdf) {
            throw new Error('Failed to resolve jsPDF from html2pdf worker');
        }
        const pageCount = (pdf.internal && typeof pdf.internal.getNumberOfPages === 'function')
            ? pdf.internal.getNumberOfPages()
            : 0;
        if (pageCount > 1 && typeof pdf.deletePage === 'function') {
            for (let i = pageCount; i > 1; i--)
                pdf.deletePage(i);
        }
        if (pageCount === 0 && typeof pdf.addPage === 'function') {
            pdf.addPage();
        }
        if (typeof pdf.setPage === 'function') {
            pdf.setPage(1);
        }
        return pdf;
    }
    async function _generateMergedPdfByCanvas(note, settings, opts) {
        const logPrefix = opts && opts.logPrefix ? opts.logPrefix : 'Merged PDF';
        function toPlainText(raw) {
            return normalizeRenderableText(raw);
        }
        const mainTextRaw = toPlainText(note.content || '');
        let mainText = mainTextRaw.replace(/\r\n/g, '\n');
        if (note.type === 'voice' && settings.voiceSentenceSplit !== false) {
            mainText = mainText.replace(/([。！？.!?])\s*/g, '$1\n\n');
        }
        const transcriptText = normalizeTranscript(note.rawTranscript || '').replace(/\r\n/g, '\n');
        const pageWidthPx = 1240;
        const pageHeightPx = 1754;
        const marginPx = 72;
        const maxTextWidthPx = pageWidthPx - marginPx * 2;
        const maxY = pageHeightPx - marginPx - PDF_RENDER_SAFETY.bottomReservePx;
        function createPage() {
            const canvas = document.createElement('canvas');
            canvas.width = pageWidthPx;
            canvas.height = pageHeightPx;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
                throw new Error('2d canvas context unavailable');
            }
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pageWidthPx, pageHeightPx);
            ctx.textBaseline = 'top';
            return { canvas, ctx };
        }
        const pages = [];
        let page = createPage();
        let y = marginPx;
        function nextPage() {
            pages.push(page.canvas);
            page = createPage();
            y = marginPx;
        }
        function ensureSpace(heightPx) {
            if (y + heightPx + PDF_RENDER_SAFETY.lineDescentPadPx > maxY)
                nextPage();
        }
        function drawBlock(text, fontPx, color, lineHeightPx, paragraphGapPx, fontWeight = 'normal') {
            if (!text)
                return;
            const applyTextStyle = (lineFontPx, tableLine) => {
                const ctx = page.ctx;
                if (tableLine) {
                    ctx.font = fontWeight + ' ' + lineFontPx + 'px SFMono-Regular, Menlo, Monaco, Consolas, monospace';
                }
                else {
                    ctx.font = fontWeight + ' ' + lineFontPx + 'px "Microsoft YaHei", "PingFang SC", -apple-system, sans-serif';
                }
                ctx.fillStyle = color;
                return ctx;
            };
            const paragraphs = text.split(/\n{2,}/);
            paragraphs.forEach(paragraph => {
                if (!paragraph.trim()) {
                    y += lineHeightPx;
                    return;
                }
                const rawLines = paragraph.split('\n');
                rawLines.forEach(rawLine => {
                    const tableLine = /[┌┬┐├┼┤└┴┘│]/.test(rawLine);
                    const currentFontPx = tableLine ? Math.max(18, fontPx - 6) : fontPx;
                    const currentLineHeight = tableLine ? Math.max(28, lineHeightPx - 6) : lineHeightPx;
                    const measureCtx = applyTextStyle(currentFontPx, tableLine);
                    const wrappedLines = wrapTextByWidth(measureCtx, rawLine, maxTextWidthPx);
                    wrappedLines.forEach(line => {
                        const metrics = measureCtx.measureText(line || ' ');
                        const descent = Math.ceil((metrics.actualBoundingBoxDescent || 0) + PDF_RENDER_SAFETY.lineDescentPadPx);
                        const requiredHeight = Math.max(currentLineHeight, currentFontPx + descent);
                        ensureSpace(requiredHeight);
                        const drawCtx = applyTextStyle(currentFontPx, tableLine);
                        drawCtx.fillText(line, marginPx, y);
                        y += currentLineHeight;
                    });
                });
                y += paragraphGapPx;
            });
        }
        drawBlock(note.title || 'Untitled', 44, '#222222', 58, 18, 'bold');
        const date = formatDate(note.createdAt);
        if (date) {
            drawBlock(date + ' | ' + (note.type || 'text'), 22, '#888888', 34, 14);
        }
        if (mainText.trim()) {
            drawBlock(mainText, 28, '#222222', 42, 14);
        }
        if (note.audioUrl && settings.includeAudioLink !== false) {
            drawBlock('录音: ' + note.audioUrl, 24, '#444444', 36, 14);
        }
        if (transcriptText.trim()) {
            drawBlock('原始文字记录', 32, '#222222', 48, 10, 'bold');
            drawBlock(transcriptText, 28, '#222222', 42, 10);
        }
        pages.push(page.canvas);
        function canvasHasInk(canvas) {
            const ctx = canvas.getContext('2d');
            if (!ctx)
                return false;
            const stepX = Math.max(12, Math.floor(canvas.width / 80));
            const stepY = Math.max(12, Math.floor(canvas.height / 110));
            for (let y = 0; y < canvas.height; y += stepY) {
                for (let x = 0; x < canvas.width; x += stepX) {
                    const data = ctx.getImageData(x, y, 1, 1).data;
                    if (data[3] > 0 && (data[0] < 245 || data[1] < 245 || data[2] < 245)) {
                        return true;
                    }
                }
            }
            return false;
        }
        const hasInk = pages.some(canvasHasInk);
        if (!hasInk && (mainText.trim() || transcriptText.trim() || (note.title || '').trim())) {
            throw new Error('Canvas rendered blank pages for non-empty merged note');
        }
        const pdf = await _createA4PdfInstance();
        const pageWidthMm = pdf.internal.pageSize.getWidth();
        const pageHeightMm = pdf.internal.pageSize.getHeight();
        pages.forEach((canvas, index) => {
            if (index > 0 && typeof pdf.addPage === 'function') {
                pdf.addPage();
            }
            else if (index === 0 && typeof pdf.setPage === 'function') {
                pdf.setPage(1);
            }
            const dataUrl = canvas.toDataURL('image/jpeg', PDF_LIGHTWEIGHT.canvasJpegQuality);
            pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
        });
        const blob = pdf.output('blob');
        if (!blob || blob.size < 1024) {
            throw new Error('Canvas merged PDF appears empty (' + (blob ? blob.size : 0) + ' bytes)');
        }
        console.info('[Biji Ext] ' + logPrefix + ' generated via canvas pages:', pages.length, 'size:', blob.size);
        return blob;
    }
    function noteToHtml(note, settings) {
        let html = "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333;\">";
        if (note.title) {
            html +=
                '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
                    escapeHtml(note.title) + '</h1>';
        }
        const date = formatDate(note.createdAt);
        if (date) {
            html +=
                '<div style="font-size: 12px; color: #888; margin-bottom: 16px;">' +
                    escapeHtml(date) + ' | ' + escapeHtml(note.type || 'text') + '</div>';
        }
        const content = note.content || '';
        if (looksLikeHtmlFragment(content)) {
            const cleaned = htmlToText(content);
            const text = (cleaned || content).replace(/\r\n/g, '\n');
            const paragraphs = text.split(/\n\n+/);
            paragraphs.forEach(p => {
                if (p.trim()) {
                    html += '<p style="margin: 10px 0;">' +
                        escapeHtml(p.trim()).replace(/\n/g, '<br>') + '</p>';
                }
            });
        }
        else if (looksLikeMarkdown(content)) {
            html += '<div>' + mdToHtml(content) + '</div>';
        }
        else {
            let text = content.replace(/\r\n/g, '\n');
            const paragraphs = text.split(/\n\n+/);
            paragraphs.forEach(p => {
                if (p.trim()) {
                    html += '<p style="margin: 10px 0;">' +
                        escapeHtml(p.trim()).replace(/\n/g, '<br>') + '</p>';
                }
            });
        }
        if (note.audioUrl && settings.includeAudioLink !== false) {
            html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
            html += '<p><strong>录音</strong>: <a href="' + escapeHtml(note.audioUrl) + '">收听</a></p>';
        }
        if (settings.transcriptMode === 'merged' && note.rawTranscript) {
            html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
            html += '<h2 style="font-size: 16px; margin-bottom: 12px;">原始文字记录</h2>';
            const rawContent = normalizeTranscript(note.rawTranscript);
            html += '<p style="margin: 10px 0;">' +
                escapeHtml(rawContent).replace(/\n/g, '<br>') + '</p>';
        }
        html += '</div>';
        return html;
    }
    function _prepareImagesHtml(note, settings) {
        if (!note.images || note.images.length === 0 || settings.includeImages === false) {
            return Promise.resolve('');
        }
        const urls = note.images
            .map(img => typeof img === 'string' ? img : img.url || img.src || '')
            .filter(Boolean);
        if (urls.length === 0)
            return Promise.resolve('');
        return Promise.all(urls.map(url => fetchAsBase64(url).catch(() => null))).then(base64Results => {
            let html = '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
            html += '<h2 style="font-size: 16px; margin-bottom: 12px;">图片</h2>';
            base64Results.forEach(b64 => {
                if (b64) {
                    html += '<img src="' + b64 + '" style="max-width: 100%; margin: 8px 0; border-radius: 4px;">';
                }
            });
            return html;
        });
    }
    function _generateLocalPdf(htmlContent) {
        if (typeof html2pdf === 'undefined') {
            return Promise.reject(new Error('html2pdf library not loaded'));
        }
        const htmlWithBottomPad = '<div style="padding-bottom:' + PDF_RENDER_SAFETY.htmlBottomPadPx + 'px;">' +
            htmlContent +
            '</div>';
        const opt = {
            margin: [10, 10, 10, 10],
            filename: 'note.pdf',
            image: { type: 'jpeg', quality: PDF_LIGHTWEIGHT.html2pdfJpegQuality },
            html2canvas: {
                scale: PDF_LIGHTWEIGHT.html2canvasScale,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
            },
            jsPDF: {
                unit: 'mm',
                format: 'a4',
                orientation: 'portrait',
                compress: PDF_LIGHTWEIGHT.jsPdfCompress,
            },
        };
        function run(worker, sourceLabel) {
            const getBlob = (worker && typeof worker.toPdf === 'function')
                ? worker.toPdf().output('blob')
                : (worker && typeof worker.outputPdf === 'function')
                    ? worker.outputPdf('blob')
                    : (worker && typeof worker.output === 'function')
                        ? worker.output('blob')
                        : Promise.reject(new Error('html2pdf output API not available'));
            return Promise.resolve(getBlob).then((blob) => {
                if (!blob || blob.size < 1024) {
                    throw new Error('Generated PDF appears empty via ' + sourceLabel + ' (' + (blob ? blob.size : 0) + ' bytes)');
                }
                console.info('[Biji Ext] Transcript PDF generated via', sourceLabel, 'size:', blob.size);
                return blob;
            });
        }
        function renderFromString() {
            try {
                const worker = html2pdf().set(opt).from(htmlWithBottomPad, 'string');
                return run(worker, 'string');
            }
            catch (err) {
                return Promise.reject(err);
            }
        }
        function renderFromDomContainer() {
            const container = document.createElement('div');
            container.innerHTML = htmlWithBottomPad;
            container.setAttribute('data-pdf-render', '1');
            container.setAttribute('aria-hidden', 'true');
            container.style.position = 'fixed';
            container.style.left = '-100000px';
            container.style.top = '-100000px';
            container.style.width = '700px';
            container.style.zIndex = '-2147483648';
            container.style.pointerEvents = 'none';
            container.style.opacity = '0';
            container.style.background = '#ffffff';
            container.style.color = '#333';
            document.body.appendChild(container);
            const cleanup = () => {
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            };
            return new Promise(resolve => {
                requestAnimationFrame(() => { setTimeout(resolve, 50); });
            }).then(() => {
                const containerHeight = container.scrollHeight;
                if (containerHeight === 0) {
                    cleanup();
                    return Promise.reject(new Error('Container height is 0'));
                }
                const worker = html2pdf().set(opt).from(container);
                return run(worker, 'dom').finally(cleanup);
            }).catch((err) => {
                cleanup();
                throw err;
            });
        }
        return renderFromString().catch((firstErr) => {
            console.warn('[Biji Ext] html2pdf string source failed, fallback to DOM container:', firstErr.message);
            return renderFromDomContainer();
        });
    }
    function generatePdf(note, settings) {
        // In merged mode, server-side export may omit transcript content (especially link notes),
        // so always use local rendering for consistent merged output.
        const needLocalTranscript = settings.transcriptMode === 'merged';
        if (needLocalTranscript) {
            return _generateMergedPdfByCanvas(note, settings, { logPrefix: 'Merged PDF' }).catch((err) => {
                console.warn('[Biji Ext] Canvas merged PDF failed, fallback to html2pdf:', err.message);
                const mergedHtml = buildMergedPdfHtml(note, settings);
                return _generateLocalPdf(mergedHtml);
            });
        }
        return exportNote(note.id, 'pdf').catch((err) => {
            console.warn('[Biji Ext] Server PDF failed, using local generation:', err.message);
            const noteHtml = noteToHtml(note, settings);
            return _prepareImagesHtml(note, settings).then(imgHtml => {
                return _generateLocalPdf(noteHtml + imgHtml);
            });
        });
    }
    function generateTranscriptPdf(note, settings) {
        let content = normalizeTranscript(note.rawTranscript || '') || note.content || '';
        if (!content.trim()) {
            return Promise.reject(new Error('Transcript content is empty'));
        }
        const transcriptCanvasNote = {
            ...note,
            title: (note.title || 'Untitled') + ' — Transcript',
            content: content,
            rawTranscript: null,
            audioUrl: null,
            createdAt: '',
        };
        return _generateMergedPdfByCanvas(transcriptCanvasNote, settings, { logPrefix: 'Transcript PDF' }).catch((canvasErr) => {
            console.warn('[Biji Ext] Transcript canvas failed, fallback to html2pdf:', canvasErr.message);
            let html = "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333;\">";
            html +=
                '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
                    escapeHtml(note.title || 'Untitled') + ' — Transcript</h1>';
            // Avoid stripping normal text like "<音乐>" unless it really looks like HTML tags.
            if (looksLikeHtmlFragment(content)) {
                content = htmlToText(content) || stripHtml(content) || content;
            }
            if (looksLikeMarkdown(content)) {
                html += '<div>' + mdToHtml(content) + '</div>';
            }
            else {
                let text = content.replace(/\r\n/g, '\n');
                if (note.type === 'voice' && settings.voiceSentenceSplit !== false) {
                    text = text.replace(/([。！？.!?])\s*/g, '$1\n\n');
                }
                const paragraphs = text.split(/\n\n+/);
                paragraphs.forEach(p => {
                    if (p.trim()) {
                        html += '<p style="margin: 10px 0;">' +
                            escapeHtml(p.trim()).replace(/\n/g, '<br>') + '</p>';
                    }
                });
            }
            html += '</div>';
            return _generateLocalPdf(html);
        });
    }
    const PDFConverter = { noteToHtml, generatePdf, generateTranscriptPdf };

    // DOCX Converter — generate DOCX from notes
    // Extracted from shared.js DOCXConverter
    const FONT = 'Microsoft YaHei';
    const SIZE = 22; // 11pt
    function _htmlToDocxChildren(html) {
        const children = [];
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        function processNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (text && text.trim()) {
                    children.push(new docx.Paragraph({
                        children: [new docx.TextRun({ text: text, size: SIZE, font: FONT })],
                        spacing: { after: 120 },
                    }));
                }
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE)
                return;
            const tag = node.tagName.toLowerCase();
            if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
                const headingSize = tag === 'h1' ? 32 : tag === 'h2' ? 28 : 24;
                children.push(new docx.Paragraph({
                    children: [
                        new docx.TextRun({ text: node.textContent || '', bold: true, size: headingSize, font: FONT }),
                    ],
                    spacing: { before: 200, after: 120 },
                }));
            }
            else if (tag === 'p' || tag === 'div') {
                const runs = _inlineToRuns(node);
                if (runs.length > 0) {
                    children.push(new docx.Paragraph({ children: runs, spacing: { after: 120 } }));
                }
            }
            else if (tag === 'ul' || tag === 'ol') {
                const items = node.querySelectorAll('li');
                items.forEach(li => {
                    children.push(new docx.Paragraph({
                        children: [new docx.TextRun({ text: '\u2022  ' + li.textContent.trim(), size: SIZE, font: FONT })],
                        spacing: { after: 60 },
                    }));
                });
            }
            else if (tag === 'hr') {
                children.push(new docx.Paragraph({
                    children: [new docx.TextRun({ text: '\u2500'.repeat(50), color: 'CCCCCC', size: 16 })],
                    spacing: { before: 200, after: 100 },
                }));
            }
            else if (tag === 'br') {
                children.push(new docx.Paragraph({ children: [], spacing: { after: 60 } }));
            }
            else if (tag === 'a') {
                const href = node.getAttribute('href') || '';
                const linkText = node.textContent || href;
                if (href) {
                    children.push(new docx.Paragraph({
                        children: [
                            new docx.ExternalHyperlink({
                                children: [new docx.TextRun({ text: linkText, style: 'Hyperlink', size: SIZE, font: FONT })],
                                link: href,
                            }),
                        ],
                        spacing: { after: 120 },
                    }));
                }
            }
            else if (tag === 'strong' || tag === 'b') {
                children.push(new docx.Paragraph({
                    children: [new docx.TextRun({ text: node.textContent || '', bold: true, size: SIZE, font: FONT })],
                    spacing: { after: 120 },
                }));
            }
            else if (tag === 'img') {
                // Skip — handled separately
            }
            else {
                for (let i = 0; i < node.childNodes.length; i++) {
                    processNode(node.childNodes[i]);
                }
            }
        }
        for (let i = 0; i < tmp.childNodes.length; i++) {
            processNode(tmp.childNodes[i]);
        }
        return children;
    }
    function _inlineToRuns(parentEl) {
        const runs = [];
        function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent;
                if (t)
                    runs.push(new docx.TextRun({ text: t, size: SIZE, font: FONT }));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE)
                return;
            const tag = node.tagName.toLowerCase();
            if (tag === 'strong' || tag === 'b') {
                runs.push(new docx.TextRun({ text: node.textContent || '', bold: true, size: SIZE, font: FONT }));
            }
            else if (tag === 'em' || tag === 'i') {
                runs.push(new docx.TextRun({ text: node.textContent || '', italics: true, size: SIZE, font: FONT }));
            }
            else if (tag === 'a') {
                const href = node.getAttribute('href') || '';
                runs.push(new docx.ExternalHyperlink({
                    children: [new docx.TextRun({ text: node.textContent || href, style: 'Hyperlink', size: SIZE, font: FONT })],
                    link: href,
                }));
            }
            else if (tag === 'br') {
                runs.push(new docx.TextRun({ break: 1 }));
            }
            else {
                for (let i = 0; i < node.childNodes.length; i++) {
                    walk(node.childNodes[i]);
                }
            }
        }
        for (let i = 0; i < parentEl.childNodes.length; i++) {
            walk(parentEl.childNodes[i]);
        }
        return runs;
    }
    function _plainTextToChildren(text, note, settings) {
        const children = [];
        text = text.replace(/\r\n/g, '\n');
        if (note.type === 'voice' && settings.voiceSentenceSplit !== false) {
            text = text.replace(/([。！？.!?])\s*/g, '$1\n\n');
        }
        const paragraphs = text.split(/\n\n+/);
        paragraphs.forEach(p => {
            if (p.trim()) {
                children.push(new docx.Paragraph({
                    children: [new docx.TextRun({ text: p.trim(), size: SIZE, font: FONT })],
                    spacing: { after: 120 },
                }));
            }
        });
        return children;
    }
    function _buildNoteChildren(note, settings) {
        const children = [];
        if (note.title) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: note.title, bold: true, size: 36, font: FONT })],
                spacing: { after: 200 },
            }));
        }
        const date = formatDate(note.createdAt);
        if (date) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: date + ' | ' + (note.type || 'text'), size: 18, font: FONT, color: '888888' })],
                spacing: { after: 200 },
            }));
        }
        const content = note.content || '';
        if (content.includes('<') && content.includes('>')) {
            _htmlToDocxChildren(content).forEach(c => children.push(c));
        }
        else if (looksLikeMarkdown(content)) {
            _htmlToDocxChildren(mdToHtml(content)).forEach(c => children.push(c));
        }
        else {
            _plainTextToChildren(content, note, settings).forEach(c => children.push(c));
        }
        if (settings.transcriptMode === 'merged' && note.rawTranscript) {
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: '\u2500'.repeat(50), color: 'CCCCCC', size: 16 })],
                spacing: { before: 200, after: 100 },
            }));
            children.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: '原始文字记录', bold: true, size: 28, font: FONT })],
                spacing: { after: 120 },
            }));
            const rawContent = normalizeTranscript(note.rawTranscript);
            _plainTextToChildren(rawContent, note, settings).forEach(c => children.push(c));
        }
        return children;
    }
    function _buildTranscriptChildren(note, settings) {
        const children = [];
        children.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: (note.title || 'Untitled') + ' — Transcript', bold: true, size: 36, font: FONT })],
            spacing: { after: 200 },
        }));
        let content = normalizeTranscript(note.rawTranscript || '') || note.content || '';
        _plainTextToChildren(content, note, settings).forEach(c => children.push(c));
        return children;
    }
    function generateDocx(note, settings) {
        // In merged mode, server DOCX may not include transcript sections for some note types.
        if (settings.transcriptMode === 'merged') {
            if (typeof docx === 'undefined') {
                return Promise.reject(new Error('docx library not loaded'));
            }
            const children = _buildNoteChildren(note, settings);
            const doc = new docx.Document({ sections: [{ properties: {}, children }] });
            return docx.Packer.toBlob(doc);
        }
        return exportNote(note.id, 'docx').catch((err) => {
            console.warn('[Biji Ext] Server DOCX failed, using local generation:', err.message);
            if (typeof docx === 'undefined') {
                return Promise.reject(new Error('docx library not loaded'));
            }
            const children = _buildNoteChildren(note, settings);
            const doc = new docx.Document({ sections: [{ properties: {}, children }] });
            return docx.Packer.toBlob(doc);
        });
    }
    function generateTranscriptDocx(note, settings) {
        if (typeof docx === 'undefined') {
            return Promise.reject(new Error('docx library not loaded'));
        }
        const children = _buildTranscriptChildren(note, settings);
        const doc = new docx.Document({ sections: [{ properties: {}, children }] });
        return docx.Packer.toBlob(doc);
    }
    const DOCXConverter = { generateDocx, generateTranscriptDocx };

    // Runtime library loader — lazy-load heavy export libs only when needed
    const loadingPromises = {};
    function injectScriptOnce(key, filePath, isReady) {
        if (isReady())
            return Promise.resolve();
        if (loadingPromises[key])
            return loadingPromises[key];
        loadingPromises[key] = new Promise((resolve, reject) => {
            const dataAttr = 'data-biji-lib';
            const selector = 'script[' + dataAttr + '="' + key + '"]';
            const existing = document.querySelector(selector);
            const finish = () => {
                if (isReady())
                    resolve();
                else
                    reject(new Error('Library loaded but global not available: ' + key));
            };
            if (existing) {
                if (existing.getAttribute('data-loaded') === '1') {
                    finish();
                    return;
                }
                existing.addEventListener('load', finish, { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load library: ' + key)), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(filePath);
            script.async = true;
            script.setAttribute(dataAttr, key);
            script.addEventListener('load', () => {
                script.setAttribute('data-loaded', '1');
                finish();
            }, { once: true });
            script.addEventListener('error', () => reject(new Error('Failed to load library: ' + key)), { once: true });
            (document.head || document.documentElement).appendChild(script);
        }).catch((err) => {
            delete loadingPromises[key];
            throw err;
        });
        return loadingPromises[key];
    }
    function ensurePdfRuntimeLoaded() {
        return injectScriptOnce('pdf', 'lib/html2pdf.bundle.min.js', function () {
            return typeof html2pdf !== 'undefined';
        });
    }
    function ensureDocxRuntimeLoaded() {
        return injectScriptOnce('docx', 'lib/docx.min.js', function () {
            return typeof docx !== 'undefined';
        });
    }
    function ensureExportLibraries(formats) {
        const tasks = [];
        if (formats.indexOf('pdf') !== -1)
            tasks.push(ensurePdfRuntimeLoaded());
        if (formats.indexOf('docx') !== -1)
            tasks.push(ensureDocxRuntimeLoaded());
        if (tasks.length === 0)
            return Promise.resolve();
        return Promise.all(tasks).then(() => { });
    }

    // Export Engine — shared export logic for popup.js and notes.js
    // Extracted from shared.js ExportEngine
    const DEFAULT_CONTENT_FETCH_CONCURRENCY = 5;
    const DEFAULT_TRANSCRIPT_FETCH_CONCURRENCY = 5;
    const DEFAULT_ZIP_EXPORT_CONCURRENCY_LIGHT = 6;
    const DEFAULT_ZIP_EXPORT_CONCURRENCY_HEAVY = 2;
    const DEFAULT_VAULT_WRITE_CONCURRENCY$1 = 4;
    function clampInt(value, min, max, fallback) {
        const n = typeof value === 'number' ? value : parseInt(String(value), 10);
        if (!Number.isFinite(n))
            return fallback;
        return Math.max(min, Math.min(max, Math.floor(n)));
    }
    function runWithConcurrency$1(items, concurrency, worker) {
        if (items.length === 0)
            return Promise.resolve();
        const limit = Math.max(1, Math.min(concurrency, items.length));
        let cursor = 0;
        function runNext() {
            if (cursor >= items.length)
                return Promise.resolve();
            const index = cursor++;
            return worker(items[index], index).then(runNext);
        }
        const workers = Array.from({ length: limit }, () => runNext());
        return Promise.all(workers).then(() => { });
    }
    function resolveContentFetchConcurrency(settings) {
        return clampInt(settings && settings.contentFetchConcurrency, 1, 12, DEFAULT_CONTENT_FETCH_CONCURRENCY);
    }
    function resolveTranscriptFetchConcurrency(settings) {
        return clampInt(settings && settings.transcriptFetchConcurrency, 1, 12, DEFAULT_TRANSCRIPT_FETCH_CONCURRENCY);
    }
    function resolveZipConcurrency(formats, settings) {
        const hasHeavyFormat = formats.indexOf('pdf') !== -1 || formats.indexOf('docx') !== -1;
        if (hasHeavyFormat) {
            return clampInt(settings.zipExportConcurrencyHeavy, 1, 6, DEFAULT_ZIP_EXPORT_CONCURRENCY_HEAVY);
        }
        return clampInt(settings.zipExportConcurrencyLight, 1, 12, DEFAULT_ZIP_EXPORT_CONCURRENCY_LIGHT);
    }
    function resolveVaultWriteConcurrency(settings) {
        return clampInt(settings.vaultWriteConcurrency, 1, 12, DEFAULT_VAULT_WRITE_CONCURRENCY$1);
    }
    function buildMainMarkdown(note, settings) {
        if (settings.transcriptMode === 'merged' && note.rawTranscript) {
            const mainContent = convert(note, settings);
            const rawContent = normalizeTranscript(note.rawTranscript);
            return mainContent + '\n\n---\n\n## 原始文字记录\n\n' + rawContent;
        }
        return convert(note, settings);
    }
    function mergePendingTags(notes) {
        return new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'getPendingTags' }, (res) => {
                if (chrome.runtime.lastError || !res || !res.tags) {
                    resolve(notes);
                    return;
                }
                const pendingTags = res.tags;
                notes.forEach(note => {
                    const entry = pendingTags[note.id];
                    if (entry && entry.tags && entry.tags.length > 0) {
                        const existing = (note.tags || []).map((t) => typeof t === 'string' ? t : t.name || t.label || '');
                        entry.tags.forEach((tag) => {
                            if (tag && existing.indexOf(tag) === -1) {
                                existing.push(tag);
                            }
                        });
                        note.tags = existing;
                    }
                });
                resolve(notes);
            });
        });
    }
    function fetchMissingContent(notes, onProgress, settings) {
        const missing = notes.filter(n => !n.content || n.content.trim().length === 0);
        if (missing.length === 0)
            return Promise.resolve();
        let done = 0;
        const total = missing.length;
        return runWithConcurrency$1(missing, resolveContentFetchConcurrency(settings), (note) => {
            return new Promise(resolve => {
                chrome.runtime.sendMessage({ type: 'fetchContent', noteId: note.id, noteType: note.noteType || note.type || '' }, (res) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Biji Ext] Content fetch error for', note.id, chrome.runtime.lastError);
                        resolve();
                        return;
                    }
                    if (res && res.content) {
                        note.content = res.content;
                        chrome.runtime.sendMessage({ type: 'storeVueNotes', notes: [{ id: note.id, content: res.content }] });
                    }
                    resolve();
                });
            }).then(() => {
                done++;
                if (onProgress)
                    onProgress(done, total);
            });
        });
    }
    function fetchMissingTranscripts(notes, onProgress, settings) {
        const missing = notes.filter(n => !n.rawTranscript);
        if (missing.length === 0)
            return Promise.resolve();
        let done = 0;
        const total = missing.length;
        return runWithConcurrency$1(missing, resolveTranscriptFetchConcurrency(settings), (note) => {
            return new Promise(resolve => {
                chrome.runtime.sendMessage({ type: 'fetchTranscript', noteId: note.id, noteType: note.noteType || note.type || '' }, (res) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Biji Ext] Transcript fetch error for', note.id, chrome.runtime.lastError);
                        resolve();
                        return;
                    }
                    if (res && res.transcript) {
                        note.rawTranscript = res.transcript;
                        chrome.runtime.sendMessage({ type: 'storeVueNotes', notes: [{ id: note.id, rawTranscript: res.transcript }] });
                    }
                    resolve();
                });
            }).then(() => {
                done++;
                if (onProgress)
                    onProgress(done, total);
            });
        });
    }
    function getActiveFormats(activeFileFormats) {
        return Object.keys(activeFileFormats).filter(f => activeFileFormats[f]);
    }
    function processTranscript(note, formats, folder, used, settings) {
        if (settings.transcriptMode === 'none')
            return Promise.resolve();
        if (!note.rawTranscript && !note.content)
            return Promise.resolve();
        let chain = Promise.resolve();
        formats.forEach(format => {
            chain = chain.then(() => {
                if (format === 'md') {
                    if (settings.transcriptMode === 'separate') {
                        let tFn = fullPathWithFormat(note, settings, 'md').replace('.md', '-transcript.md');
                        tFn = deduplicateFilename(tFn, used, '.md');
                        used[tFn] = true;
                        folder.file(tFn, convertTranscript(note, settings));
                    }
                }
                else if (format === 'pdf') {
                    if (settings.transcriptMode !== 'separate')
                        return;
                    let tFn = fullPathWithFormat(note, settings, 'pdf').replace('.pdf', '-transcript.pdf');
                    tFn = deduplicateFilename(tFn, used, '.pdf');
                    used[tFn] = true;
                    return PDFConverter.generateTranscriptPdf(note, settings)
                        .then(blob => { folder.file(tFn, blob); })
                        .catch(err => {
                        console.warn('[Biji Ext] Transcript PDF failed, falling back to MD:', err.message);
                        const fallback = tFn.replace('.pdf', '.md');
                        folder.file(fallback, convertTranscript(note, settings));
                    });
                }
                else if (format === 'docx') {
                    if (settings.transcriptMode !== 'separate')
                        return;
                    let tFn = fullPathWithFormat(note, settings, 'docx').replace('.docx', '-transcript.docx');
                    tFn = deduplicateFilename(tFn, used, '.docx');
                    used[tFn] = true;
                    return DOCXConverter.generateTranscriptDocx(note, settings)
                        .then(blob => { folder.file(tFn, blob); })
                        .catch(() => {
                        const fallback = tFn.replace('.docx', '.md');
                        folder.file(fallback, convertTranscript(note, settings));
                    });
                }
            });
        });
        return chain;
    }
    function zipExport(notes, settings, formats, onProgress) {
        return ensureExportLibraries(formats).then(() => mergePendingTags(notes)).then(mergedNotes => {
            const zip = new JSZip();
            const folder = zip.folder('biji-export');
            const used = {};
            const total = mergedNotes.length;
            const concurrency = resolveZipConcurrency(formats, settings);
            let done = 0;
            function processOneNote(note) {
                let chain = Promise.resolve();
                formats.forEach(format => {
                    chain = chain.then(() => {
                        const ext = getFileExt(format);
                        let fn = fullPathWithFormat(note, settings, format);
                        fn = deduplicateFilename(fn, used, ext);
                        used[fn] = true;
                        let genPromise;
                        if (format === 'md') {
                            genPromise = Promise.resolve(buildMainMarkdown(note, settings));
                        }
                        else if (format === 'pdf') {
                            genPromise = PDFConverter.generatePdf(note, settings);
                        }
                        else {
                            genPromise = DOCXConverter.generateDocx(note, settings);
                        }
                        return genPromise
                            .then(data => { folder.file(fn, data); })
                            .catch(err => {
                            console.warn('[Biji Ext] Export error (' + format + ') for', note.id, err);
                            const mdFn = fn.replace(ext, '.md');
                            if (!used[mdFn]) {
                                folder.file(mdFn, convert(note, settings));
                                used[mdFn] = true;
                            }
                        });
                    });
                });
                return chain.then(() => {
                    return processTranscript(note, formats, folder, used, settings);
                }).then(() => {
                    done++;
                    if (onProgress)
                        onProgress(done, total);
                });
            }
            return runWithConcurrency$1(mergedNotes, concurrency, (note) => {
                return processOneNote(note);
            }).then(() => _finishZip(zip, mergedNotes));
        });
    }
    function _finishZip(zip, notes) {
        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then((content) => {
            const ts = new Date().toISOString().substring(0, 10);
            saveAs(content, 'biji-export-' + ts + '.zip');
            ExportTracker.markExported(notes.map(n => n.id));
            return { success: true };
        });
    }
    function vaultExport(notes, settings, onProgress) {
        return mergePendingTags(notes).then(mergedNotes => {
            const subfolder = settings.vaultSubfolder || 'biji-notes';
            const vaultWriteConcurrency = resolveVaultWriteConcurrency(settings);
            const converter = {
                filename: (note) => fullPath(note, settings),
                convert: (note) => {
                    if (settings.transcriptMode === 'merged' && note.rawTranscript) {
                        const mainContent = convert(note, settings);
                        const rawContent = normalizeTranscript(note.rawTranscript);
                        return mainContent + '\n\n---\n\n## 原始文字记录\n\n' + rawContent;
                    }
                    return convert(note, settings);
                },
            };
            return VaultWriter.writeAllNotes(mergedNotes, subfolder, converter, onProgress, vaultWriteConcurrency).then((result) => {
                if (settings.transcriptMode === 'separate') {
                    const notesWithContent = mergedNotes.filter(n => !!n.content);
                    if (notesWithContent.length > 0) {
                        const txConverter = {
                            filename: (note) => fullPath(note, settings).replace('.md', '-transcript.md'),
                            convert: (note) => convertTranscript(note, settings),
                        };
                        return VaultWriter.writeAllNotes(notesWithContent, subfolder, txConverter, (done, total) => {
                            if (onProgress)
                                onProgress(done, total, done, 0);
                        }, vaultWriteConcurrency).then((txResult) => ({
                            written: result.written + txResult.written,
                            errors: result.errors.concat(txResult.errors),
                        }));
                    }
                }
                return result;
            });
        });
    }
    const ExportEngine = {
        mergePendingTags,
        fetchMissingContent,
        fetchMissingTranscripts,
        getActiveFormats,
        processTranscript,
        zipExport,
        vaultExport,
    };

    // Vault Writer — Direct write to Obsidian vault via File System Access API
    // Rewritten from vault-writer.js
    const DB_NAME = 'biji-exporter';
    const STORE_NAME = 'handles';
    const HANDLE_KEY = 'vaultDir';
    const DEFAULT_VAULT_WRITE_CONCURRENCY = 4;
    let directoryHandle = null;
    let _pendingHandle = null;
    function runWithConcurrency(items, concurrency, worker) {
        if (items.length === 0)
            return Promise.resolve();
        const limit = Math.max(1, Math.min(concurrency, items.length));
        let cursor = 0;
        function runNext() {
            if (cursor >= items.length)
                return Promise.resolve();
            const index = cursor++;
            return worker(items[index], index).then(runNext);
        }
        const workers = Array.from({ length: limit }, () => runNext());
        return Promise.all(workers).then(() => { });
    }
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(STORE_NAME);
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
    function saveHandleToDB(handle) {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        });
    }
    function loadHandleFromDB() {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = (e) => reject(e.target.error);
            });
        });
    }
    function deleteHandleFromDB() {
        return openDB().then(db => {
            return new Promise(resolve => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        });
    }
    function isSupported() {
        return typeof window.showDirectoryPicker === 'function';
    }
    function pickDirectory() {
        return window.showDirectoryPicker({ mode: 'readwrite' })
            .then((handle) => {
            directoryHandle = handle;
            return saveHandleToDB(handle).then(() => handle);
        })
            .catch((e) => {
            if (e.name === 'AbortError')
                return null;
            throw e;
        });
    }
    function restoreHandle() {
        return loadHandleFromDB()
            .then(handle => {
            if (!handle)
                return null;
            return handle.queryPermission({ mode: 'readwrite' }).then((perm) => {
                if (perm === 'granted') {
                    directoryHandle = handle;
                    return handle;
                }
                _pendingHandle = handle;
                return null;
            });
        })
            .catch((e) => {
            console.warn('[Biji Ext] Could not restore vault handle:', e);
            return null;
        });
    }
    function requestPermission() {
        if (!_pendingHandle)
            return Promise.resolve(false);
        return _pendingHandle.requestPermission({ mode: 'readwrite' })
            .then((perm) => {
            if (perm === 'granted') {
                directoryHandle = _pendingHandle;
                _pendingHandle = null;
                return true;
            }
            return false;
        })
            .catch(() => false);
    }
    function writeFile(dirHandle, filename, content) {
        return dirHandle.getFileHandle(filename, { create: true })
            .then((fileHandle) => fileHandle.createWritable())
            .then((writable) => writable.write(content).then(() => writable.close()));
    }
    function writeAllNotes(notes, subfolder, markdownConverter, onProgress, concurrency) {
        if (!directoryHandle) {
            return Promise.reject(new Error('No vault directory selected'));
        }
        let targetDirPromise;
        if (subfolder) {
            targetDirPromise = directoryHandle.getDirectoryHandle(subfolder, { create: true });
        }
        else {
            targetDirPromise = Promise.resolve(directoryHandle);
        }
        return targetDirPromise.then(targetDir => {
            const used = {};
            const total = notes.length;
            let done = 0;
            let written = 0;
            const errors = [];
            const jobs = notes.map(note => {
                let fn = markdownConverter.filename(note);
                if (used[fn]) {
                    const base = fn.replace('.md', '');
                    let c = 2;
                    while (used[base + '-' + c + '.md'])
                        c++;
                    fn = base + '-' + c + '.md';
                }
                used[fn] = true;
                return { note, fn };
            });
            return runWithConcurrency(jobs, Math.max(1, Math.min(12, Math.floor(concurrency || DEFAULT_VAULT_WRITE_CONCURRENCY))), (job) => {
                return Promise.resolve()
                    .then(() => markdownConverter.convert(job.note))
                    .then(md => writeFile(targetDir, job.fn, md))
                    .then(() => {
                    written++;
                })
                    .catch(e => {
                    const message = e && e.message ? e.message : String(e);
                    errors.push({ filename: job.fn, error: message });
                })
                    .then(() => {
                    done++;
                    if (onProgress)
                        onProgress(done, total, written, errors.length);
                });
            }).then(() => ({ written, errors }));
        });
    }
    function clearHandle() {
        directoryHandle = null;
        _pendingHandle = null;
        return deleteHandleFromDB();
    }
    function getDirectoryName() {
        if (directoryHandle)
            return directoryHandle.name;
        if (_pendingHandle)
            return _pendingHandle.name + ' (needs permission)';
        return null;
    }
    function isReady() {
        return !!directoryHandle;
    }
    function needsPermission() {
        return !!_pendingHandle && !directoryHandle;
    }
    const VaultWriterModule = {
        isSupported, pickDirectory, restoreHandle, requestPermission,
        writeFile, writeAllNotes, clearHandle, getDirectoryName, isReady, needsPermission,
    };

    // notes.ts — Full-page note management
    // Converted from notes.js — window.* globals replaced with imports
    // --- DOM references ---
    const searchInput = document.getElementById('searchInput');
    const filterType = document.getElementById('filterType');
    const filterTypeTrigger = filterType.querySelector('.multi-select-trigger');
    const filterTypeDropdown = filterType.querySelector('.multi-select-dropdown');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    const filterExport = document.getElementById('filterExport');
    const filterSort = document.getElementById('filterSort');
    const selectAllEl = document.getElementById('selectAll');
    const selCountEl = document.getElementById('selCount');
    const totalCountEl = document.getElementById('totalCount');
    const btnExport = document.getElementById('btnExport');
    const progressEl = document.getElementById('progress');
    const pfillEl = document.getElementById('pfill');
    const ptxtEl = document.getElementById('ptxt');
    const noteTableBody = document.getElementById('noteTableBody');
    const emptyState = document.getElementById('emptyState');
    const noteTable = document.getElementById('noteTable');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');
    const pageInfo = document.getElementById('pageInfo');
    const methodZip = document.getElementById('methodZip');
    const methodVault = document.getElementById('methodVault');
    const fileFmtChecks = document.querySelectorAll('.fmt-check-sm');
    // --- State ---
    let allNotes = [];
    let filteredNotes = [];
    let selectedIds = {};
    let currentSettings = {};
    const activeFileFormats = { md: true, pdf: false, docx: false };
    let activeMethod = 'zip';
    let currentPage = 1;
    const pageSize = 50;
    const selectedTypes = new Set();
    // --- Type mappings ---
    const TYPE_LABEL_MAP = {
        audio: '音频',
        local_audio: '本地音频',
        recorder_audio: '录音',
        recorder_flash_audio: '闪念录音',
        meeting: '会议',
        internal_record: '内部记录',
        plain_text: '文字',
        link: '链接',
        text: '文字',
    };
    const TYPE_CSS_MAP = {
        audio: 'voice',
        local_audio: 'voice',
        recorder_audio: 'voice',
        recorder_flash_audio: 'voice',
        meeting: 'voice',
        internal_record: 'text',
        plain_text: 'text',
        link: 'link',
        text: 'text',
    };
    // --- Filter Engine ---
    const FilterEngine = {
        searchText: '',
        noteTypes: new Set(),
        dateFrom: null,
        dateTo: null,
        exportStatus: 'all',
        sortBy: 'date_desc',
        apply(notes) {
            let result = notes.slice();
            // Text search
            if (this.searchText) {
                const q = this.searchText.toLowerCase();
                result = result.filter(function (n) {
                    const title = (n.title || '').toLowerCase();
                    const tags = (n.tags || [])
                        .map(function (t) { return typeof t === 'string' ? t : t.name || t.label || ''; })
                        .join(' ')
                        .toLowerCase();
                    return title.indexOf(q) !== -1 || tags.indexOf(q) !== -1;
                });
            }
            // Type filter
            if (this.noteTypes.size > 0) {
                const nts = this.noteTypes;
                result = result.filter(function (n) { return nts.has(n.type || 'text'); });
            }
            // Date filter
            if (this.dateFrom) {
                const fromTs = new Date(this.dateFrom).getTime();
                result = result.filter(function (n) {
                    const ts = n.createdAt
                        ? new Date(typeof n.createdAt === 'number' ? n.createdAt * 1000 : n.createdAt).getTime()
                        : 0;
                    return ts >= fromTs;
                });
            }
            if (this.dateTo) {
                const toTs = new Date(this.dateTo).getTime() + 86400000;
                result = result.filter(function (n) {
                    const ts = n.createdAt
                        ? new Date(typeof n.createdAt === 'number' ? n.createdAt * 1000 : n.createdAt).getTime()
                        : 0;
                    return ts < toTs;
                });
            }
            // Export status
            if (this.exportStatus === 'exported') {
                result = result.filter(function (n) { return ExportTracker.isExported(n.id); });
            }
            else if (this.exportStatus === 'unexported') {
                result = result.filter(function (n) { return !ExportTracker.isExported(n.id); });
            }
            // Sort
            if (this.sortBy === 'date_desc') {
                result.sort(function (a, b) {
                    const tA = a.createdAt ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime() : 0;
                    const tB = b.createdAt ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime() : 0;
                    return tB - tA;
                });
            }
            else if (this.sortBy === 'date_asc') {
                result.sort(function (a, b) {
                    const tA = a.createdAt ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime() : 0;
                    const tB = b.createdAt ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime() : 0;
                    return tA - tB;
                });
            }
            else if (this.sortBy === 'title') {
                result.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
            }
            else if (this.sortBy === 'type') {
                result.sort(function (a, b) { return (a.type || 'text').localeCompare(b.type || 'text'); });
            }
            return result;
        },
    };
    // --- Render ---
    function renderPage() {
        const totalPages = Math.max(1, Math.ceil(filteredNotes.length / pageSize));
        if (currentPage > totalPages)
            currentPage = totalPages;
        if (currentPage < 1)
            currentPage = 1;
        const start = (currentPage - 1) * pageSize;
        const pageNotes = filteredNotes.slice(start, start + pageSize);
        totalCountEl.textContent = String(filteredNotes.length);
        if (filteredNotes.length === 0) {
            noteTable.style.display = 'none';
            emptyState.style.display = '';
        }
        else {
            noteTable.style.display = '';
            emptyState.style.display = 'none';
        }
        const html = pageNotes
            .map(function (n) {
            const t = n.title || 'Note ' + n.id;
            const d = MD.formatDate(n.createdAt);
            const ds = d ? d.substring(0, 10) : '';
            const checked = selectedIds[n.id] ? ' checked' : '';
            const type = n.type || 'text';
            const typeCls = TYPE_CSS_MAP[type] || 'other';
            const typeLabel = TYPE_LABEL_MAP[type] || type;
            const exported = ExportTracker.isExported(n.id);
            const statusHtml = exported
                ? '<span class="export-status exported">\u2713</span>'
                : '<span class="export-status new">\u25CF</span>';
            const tags = MD.formatTags(n.tags);
            const tagsHtml = tags.length > 0
                ? '<div class="tag-list">' +
                    tags.slice(0, 3).map(function (tag) { return '<span class="tag-chip">' + escapeHtml(tag) + '</span>'; }).join('') +
                    (tags.length > 3 ? '<span class="tag-chip">+' + (tags.length - 3) + '</span>' : '') +
                    '</div>'
                : '';
            return ('<tr>' +
                '<td><input type="checkbox" data-id="' + escapeHtml(String(n.id)) + '"' + checked + '></td>' +
                '<td>' + statusHtml + '</td>' +
                '<td class="note-title-cell">' +
                '<a href="https://www.biji.com/note/' + escapeHtml(String(n.id)) + '" target="_blank">' +
                escapeHtml(t) + '</a></td>' +
                '<td><span class="type-badge ' + typeCls + '">' + typeLabel + '</span></td>' +
                '<td style="font-size:12px;color:#888">' + ds + '</td>' +
                '<td>' + tagsHtml + '</td>' +
                '</tr>');
        })
            .join('');
        noteTableBody.innerHTML = html;
        // Bind checkboxes
        noteTableBody.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                const id = this.getAttribute('data-id');
                if (this.checked) {
                    selectedIds[id] = true;
                }
                else {
                    delete selectedIds[id];
                }
                updateSelectionUI();
            });
        });
        // Pagination
        btnPrev.disabled = currentPage <= 1;
        btnNext.disabled = currentPage >= totalPages;
        pageInfo.textContent = '\u7B2C ' + currentPage + '/' + totalPages + ' \u9875';
        updateSelectionUI();
    }
    function updateSelectionUI() {
        const count = Object.keys(selectedIds).length;
        selCountEl.textContent = String(count);
        if (filteredNotes.length > 0) {
            const allSelected = filteredNotes.every(function (n) { return selectedIds[n.id]; });
            const someSelected = filteredNotes.some(function (n) { return selectedIds[n.id]; });
            selectAllEl.checked = allSelected;
            selectAllEl.indeterminate = someSelected && !allSelected;
        }
        else {
            selectAllEl.checked = false;
            selectAllEl.indeterminate = false;
        }
        const formats = ExportEngine.getActiveFormats(activeFileFormats);
        const fmtLabel = formats.length > 0
            ? formats.map(function (f) { return f.toUpperCase(); }).join('+')
            : 'MD';
        if (count > 0) {
            btnExport.textContent = '\u5BFC\u51FA\u9009\u4E2D ' + count + ' \u6761 (' + fmtLabel + ')';
        }
        else {
            btnExport.textContent = '\u5BFC\u51FA\u7B5B\u9009\u7ED3\u679C (' + fmtLabel + ')';
        }
    }
    function applyFilters() {
        FilterEngine.searchText = searchInput.value.trim();
        FilterEngine.noteTypes = selectedTypes;
        FilterEngine.dateFrom = dateFrom.value || null;
        FilterEngine.dateTo = dateTo.value || null;
        FilterEngine.exportStatus = filterExport.value;
        FilterEngine.sortBy = filterSort.value;
        filteredNotes = FilterEngine.apply(allNotes);
        currentPage = 1;
        renderPage();
    }
    // --- Event: Filters ---
    let filterDebounce = null;
    searchInput.addEventListener('input', function () {
        if (filterDebounce)
            clearTimeout(filterDebounce);
        filterDebounce = setTimeout(applyFilters, 200);
    });
    // Multi-select: toggle dropdown
    filterTypeTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        filterType.classList.toggle('open');
    });
    // Multi-select: close on outside click
    document.addEventListener('click', function (e) {
        if (!filterType.contains(e.target)) {
            filterType.classList.remove('open');
        }
    });
    dateFrom.addEventListener('change', applyFilters);
    dateTo.addEventListener('change', applyFilters);
    filterExport.addEventListener('change', applyFilters);
    filterSort.addEventListener('change', applyFilters);
    // --- Event: Select all ---
    selectAllEl.addEventListener('change', function () {
        const checked = this.checked;
        if (checked) {
            filteredNotes.forEach(function (n) { selectedIds[n.id] = true; });
        }
        else {
            filteredNotes.forEach(function (n) { delete selectedIds[n.id]; });
        }
        noteTableBody.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            cb.checked = checked;
        });
        updateSelectionUI();
    });
    // --- Event: Pagination ---
    btnPrev.addEventListener('click', function () {
        if (currentPage > 1) {
            currentPage--;
            renderPage();
        }
    });
    btnNext.addEventListener('click', function () {
        const totalPages = Math.ceil(filteredNotes.length / pageSize);
        if (currentPage < totalPages) {
            currentPage++;
            renderPage();
        }
    });
    // --- Event: File format (multi-select) ---
    fileFmtChecks.forEach(function (label) {
        const cb = label.querySelector('input[type="checkbox"]');
        cb.addEventListener('change', function () {
            const fmt = this.getAttribute('data-format');
            activeFileFormats[fmt] = this.checked;
            const formats = ExportEngine.getActiveFormats(activeFileFormats);
            if (formats.length === 0) {
                activeFileFormats.md = true;
                const mdCb = document.querySelector('.fmt-check-sm input[data-format="md"]');
                if (mdCb)
                    mdCb.checked = true;
            }
            fileFmtChecks.forEach(function (lbl) {
                const input = lbl.querySelector('input[type="checkbox"]');
                lbl.classList.toggle('active', input.checked);
            });
            const hasNonMd = activeFileFormats.pdf || activeFileFormats.docx;
            if (hasNonMd) {
                if (activeMethod === 'vault') {
                    activeMethod = 'zip';
                    methodZip.classList.add('active');
                    methodVault.classList.remove('active');
                }
                methodVault.disabled = true;
            }
            else {
                methodVault.disabled = false;
            }
            updateSelectionUI();
        });
    });
    // --- Event: Export method ---
    methodZip.addEventListener('click', function () {
        activeMethod = 'zip';
        methodZip.classList.add('active');
        methodVault.classList.remove('active');
    });
    methodVault.addEventListener('click', function () {
        if (activeFileFormats.pdf || activeFileFormats.docx)
            return;
        activeMethod = 'vault';
        methodVault.classList.add('active');
        methodZip.classList.remove('active');
    });
    // --- Export ---
    btnExport.addEventListener('click', function () {
        if (activeMethod === 'vault') {
            doVaultExport();
        }
        else {
            doZipExport();
        }
    });
    function getNotesToExport() {
        const count = Object.keys(selectedIds).length;
        if (count === 0)
            return filteredNotes;
        return filteredNotes.filter(function (n) { return selectedIds[n.id]; });
    }
    function doZipExport() {
        loadSettingsCb(function (settings) {
            const notes = getNotesToExport();
            if (notes.length === 0) {
                alert('\u6682\u65E0\u7B14\u8BB0\u53EF\u5BFC\u51FA\u3002');
                return;
            }
            let formats = ExportEngine.getActiveFormats(activeFileFormats);
            if (formats.length === 0)
                formats = ['md'];
            progressEl.classList.add('active');
            btnExport.disabled = true;
            const needTranscripts = settings.transcriptMode !== 'none' &&
                notes.some(function (n) { return !n.rawTranscript; });
            let chain = Promise.resolve();
            if (needTranscripts) {
                ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55...';
                chain = ExportEngine.fetchMissingTranscripts(notes, function (done, total) {
                    ptxtEl.textContent = '\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55 ' + done + '/' + total + '...';
                }, settings);
            }
            chain
                .then(function () {
                const hasNonMd = formats.indexOf('pdf') !== -1 || formats.indexOf('docx') !== -1;
                if (hasNonMd && notes.length > 20) {
                    ptxtEl.textContent = 'PDF/DOCX \u751F\u6210\u8F83\u6162\uFF0C\u8BF7\u8010\u5FC3\u7B49\u5F85...';
                }
                return ExportEngine.zipExport(notes, settings, formats, function (done, total) {
                    const pct = Math.round((done / total) * 100);
                    pfillEl.style.width = pct + '%';
                    ptxtEl.textContent = done + ' / ' + total + ' \u7B14\u8BB0\u5DF2\u5904\u7406';
                });
            })
                .then(function () {
                ptxtEl.textContent = '\u5BFC\u51FA\u5B8C\u6210\uFF01\u8BF7\u67E5\u770B\u4E0B\u8F7D\u6587\u4EF6\u5939\u3002';
                btnExport.disabled = false;
                setTimeout(function () { progressEl.classList.remove('active'); applyFilters(); }, 3000);
            });
        });
    }
    function doVaultExport() {
        if (!VaultWriterModule.isReady()) {
            alert('Vault \u672A\u5C31\u7EEA\u3002\u8BF7\u5148\u5728\u8BBE\u7F6E\u9875\u9762\u9009\u62E9 Vault \u6587\u4EF6\u5939\u3002');
            return;
        }
        loadSettingsCb(function (settings) {
            const notes = getNotesToExport();
            if (notes.length === 0) {
                alert('\u6682\u65E0\u7B14\u8BB0\u53EF\u5BFC\u51FA\u3002');
                return;
            }
            progressEl.classList.add('active');
            btnExport.disabled = true;
            const needTranscripts = settings.transcriptMode !== 'none' &&
                notes.some(function (n) { return !n.rawTranscript; });
            let chain = Promise.resolve();
            if (needTranscripts) {
                ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55...';
                chain = ExportEngine.fetchMissingTranscripts(notes, function (done, total) {
                    ptxtEl.textContent = '\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55 ' + done + '/' + total + '...';
                }, settings);
            }
            chain
                .then(function () {
                return ExportEngine.vaultExport(notes, settings, function (done, total, written, errorCount) {
                    const pct = Math.round((done / total) * 100);
                    pfillEl.style.width = pct + '%';
                    ptxtEl.textContent = done + ' / ' + total + ' \u5DF2\u5904\u7406 (' + (written || 0) + ' \u5199\u5165, ' + (errorCount || 0) + ' \u9519\u8BEF)';
                });
            })
                .then(function (result) {
                ExportTracker.markExported(notes.map(function (n) { return n.id; }));
                ptxtEl.textContent = '\u5BFC\u51FA\u5B8C\u6210\uFF01' + result.written + ' \u7BC7\u7B14\u8BB0\u5DF2\u5199\u5165 Vault\u3002';
                if (result.errors.length > 0) {
                    ptxtEl.textContent += ' (' + result.errors.length + ' \u4E2A\u9519\u8BEF)';
                }
                btnExport.disabled = false;
                setTimeout(function () { progressEl.classList.remove('active'); applyFilters(); }, 4000);
            })
                .catch(function (err) {
                ptxtEl.textContent = '\u5BFC\u51FA\u5931\u8D25: ' + err.message;
                btnExport.disabled = false;
                setTimeout(function () { progressEl.classList.remove('active'); }, 4000);
            });
        });
    }
    // --- Load data ---
    function updateTriggerText() {
        if (selectedTypes.size === 0) {
            filterTypeTrigger.textContent = '全部';
        } else if (selectedTypes.size <= 2) {
            filterTypeTrigger.textContent = Array.from(selectedTypes)
                .map(function (t) { return TYPE_LABEL_MAP[t] || t; })
                .join(', ');
        } else {
            filterTypeTrigger.textContent = '已选' + selectedTypes.size + '项';
        }
    }
    function populateTypeFilter(notes) {
        // Remember previous selections
        var prevSelected = new Set(selectedTypes);
        filterTypeDropdown.innerHTML = '';
        // Collect unique types preserving TYPE_LABEL_MAP order
        var seen = {};
        var availableTypes = [];
        notes.forEach(function (n) { var t = n.type || 'text'; seen[t] = true; });
        Object.keys(TYPE_LABEL_MAP).forEach(function (key) {
            if (seen[key]) availableTypes.push(key);
        });
        // Remove stale selections
        selectedTypes.forEach(function (t) {
            if (!seen[t]) selectedTypes.delete(t);
        });
        // Build checkbox items
        availableTypes.forEach(function (key) {
            var label = document.createElement('label');
            label.className = 'multi-select-item';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = key;
            if (selectedTypes.has(key)) cb.checked = true;
            cb.addEventListener('change', function () {
                if (this.checked) {
                    selectedTypes.add(key);
                } else {
                    selectedTypes.delete(key);
                }
                updateTriggerText();
                applyFilters();
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(TYPE_LABEL_MAP[key]));
            filterTypeDropdown.appendChild(label);
        });
        updateTriggerText();
    }
    function loadNotes() {
        chrome.runtime.sendMessage({ type: 'getNotes' }, function (res) {
            const notes = res && res.notes ? res.notes : {};
            allNotes = Object.values(notes);
            sortNotesByDate(allNotes);
            populateTypeFilter(allNotes);
            applyFilters();
        });
    }
    // --- Init ---
    loadSettingsCb(function (settings) {
        currentSettings = settings;
        ExportTracker.load(function () { loadNotes(); });
    });

})();
