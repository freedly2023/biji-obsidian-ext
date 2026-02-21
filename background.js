(function () {
    'use strict';

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
    function looksLikeHtmlFragment(text) {
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
        if (looksLikeHtmlFragment(raw)) {
            return htmlToText(raw) || stripHtml(raw) || raw;
        }
        return raw;
    }

    // Feed Parser — RSS/Atom XML parsing (regex-based, no DOMParser)
    // Extracted from feed-manager.js
    function xmlTagContent(xml, tagName) {
        const re = new RegExp('<(?:[a-zA-Z0-9]+:)?' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?' + tagName + '\\s*>', 'i');
        const m = re.exec(xml);
        return m ? m[1].trim() : '';
    }
    function xmlAttr(tagStr, attrName) {
        const re = new RegExp(attrName + '\\s*=\\s*["\']([^"\']*)["\']', 'i');
        const m = re.exec(tagStr);
        return m ? m[1] : '';
    }
    function xmlFindAll(xml, tagName) {
        const results = [];
        const re = new RegExp('<' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tagName + '\\s*>', 'gi');
        let m;
        while ((m = re.exec(xml)) !== null) {
            results.push(m[0]);
        }
        return results;
    }
    function getMediaThumbnailRegex(itemXml, link) {
        const mtMatch = /<(?:media:)?thumbnail[^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
        if (mtMatch)
            return mtMatch[1];
        let mcMatch = /<(?:media:)?content[^>]+url\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']image[^"']*["']/i.exec(itemXml);
        if (!mcMatch)
            mcMatch = /<(?:media:)?content[^>]*type\s*=\s*["']image[^"']*["'][^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
        if (mcMatch)
            return mcMatch[1];
        const iiMatch = /<(?:itunes:)?image[^>]+href\s*=\s*["']([^"']+)["']/i.exec(itemXml);
        if (iiMatch)
            return iiMatch[1];
        let vidMatch = (link || '').match(/[?&]v=([^&]+)/) || (link || '').match(/youtu\.be\/([^?]+)/);
        if (!vidMatch) {
            const idText = xmlTagContent(itemXml, 'id');
            const vm = idText.match(/video:([^:]+)$/);
            if (vm)
                vidMatch = [null, vm[1]];
        }
        if (vidMatch)
            return 'https://i.ytimg.com/vi/' + vidMatch[1] + '/mqdefault.jpg';
        return '';
    }
    function safeISODate(str) {
        try {
            return new Date(str).toISOString();
        }
        catch {
            return new Date().toISOString();
        }
    }
    function truncate(str, max) {
        if (!str || str.length <= max)
            return str || '';
        return str.substring(0, max) + '...';
    }
    function parseFeedXml(xmlText) {
        const items = [];
        const channel = { title: '', thumbnail: '' };
        // Channel-level info (RSS 2.0)
        let channelMatch = /<channel\b[^>]*>([\s\S]*?)<item\b/i.exec(xmlText);
        if (!channelMatch)
            channelMatch = /<channel\b[^>]*>([\s\S]*?)<\/channel>/i.exec(xmlText);
        if (channelMatch) {
            const chXml = channelMatch[1];
            channel.title = xmlTagContent(chXml, 'title');
            const chImgMatch = /<(?:itunes:)?image[^>]+href\s*=\s*["']([^"']+)["']/i.exec(chXml);
            if (chImgMatch)
                channel.thumbnail = chImgMatch[1];
            if (!channel.thumbnail) {
                const imgBlock = /<image\b[^>]*>([\s\S]*?)<\/image>/i.exec(chXml);
                if (imgBlock) {
                    const imgUrl = xmlTagContent(imgBlock[1], 'url');
                    if (imgUrl)
                        channel.thumbnail = imgUrl;
                }
            }
        }
        // Atom feed-level info
        if (!channel.title) {
            let feedMatch = /<feed\b[^>]*>([\s\S]*?)<entry\b/i.exec(xmlText);
            if (!feedMatch)
                feedMatch = /<feed\b[^>]*>([\s\S]*?)<\/feed>/i.exec(xmlText);
            if (feedMatch) {
                channel.title = xmlTagContent(feedMatch[1], 'title');
                channel.thumbnail = xmlTagContent(feedMatch[1], 'icon') || xmlTagContent(feedMatch[1], 'logo') || '';
            }
        }
        // RSS 2.0 items
        const rssItems = xmlFindAll(xmlText, 'item');
        if (rssItems.length > 0) {
            rssItems.forEach(itemXml => {
                const title = xmlTagContent(itemXml, 'title');
                const link = xmlTagContent(itemXml, 'link');
                const guid = xmlTagContent(itemXml, 'guid') || link;
                const pubDate = xmlTagContent(itemXml, 'pubDate');
                let description = xmlTagContent(itemXml, 'description');
                if (!description)
                    description = xmlTagContent(itemXml, 'summary');
                const duration = xmlTagContent(itemXml, 'duration');
                let thumbnail = getMediaThumbnailRegex(itemXml, link);
                if (!thumbnail && channel.thumbnail)
                    thumbnail = channel.thumbnail;
                let enclosureUrl = '';
                const encMatch = /<enclosure[^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
                if (encMatch)
                    enclosureUrl = encMatch[1];
                const itemUrl = link || enclosureUrl || guid;
                if (itemUrl) {
                    items.push({
                        title: decodeXmlEntities(title),
                        url: decodeXmlEntities(itemUrl),
                        guid: decodeXmlEntities(guid || itemUrl),
                        pubDate: pubDate ? safeISODate(pubDate) : new Date().toISOString(),
                        description: truncate(stripHtml(decodeXmlEntities(description)), 200),
                        thumbnail: decodeXmlEntities(thumbnail),
                        duration,
                        enclosureUrl: decodeXmlEntities(enclosureUrl),
                    });
                }
            });
            return { items, channel };
        }
        // Atom entries
        const atomEntries = xmlFindAll(xmlText, 'entry');
        atomEntries.forEach(entryXml => {
            const title = xmlTagContent(entryXml, 'title');
            const linkMatch = /<link[^>]+href\s*=\s*["']([^"']+)["']/i.exec(entryXml);
            const link = linkMatch ? linkMatch[1] : '';
            const id = xmlTagContent(entryXml, 'id') || link;
            const updated = xmlTagContent(entryXml, 'updated') || xmlTagContent(entryXml, 'published');
            const summary = xmlTagContent(entryXml, 'summary') || xmlTagContent(entryXml, 'content');
            const thumbnail = getMediaThumbnailRegex(entryXml, link);
            if (link) {
                items.push({
                    title: decodeXmlEntities(title),
                    url: decodeXmlEntities(link),
                    guid: decodeXmlEntities(id),
                    pubDate: updated ? safeISODate(updated) : new Date().toISOString(),
                    description: truncate(stripHtml(decodeXmlEntities(summary)), 200),
                    thumbnail: decodeXmlEntities(thumbnail),
                    duration: '',
                    enclosureUrl: '',
                });
            }
        });
        return { items, channel };
    }
    // OPML parser
    function parseOpml(opmlText) {
        const feeds = [];
        const outlineRe = /<outline\b[^>]*>/gi;
        let match;
        while ((match = outlineRe.exec(opmlText)) !== null) {
            const tag = match[0];
            const xmlUrl = xmlAttr(tag, 'xmlUrl');
            if (xmlUrl) {
                feeds.push({
                    url: xmlUrl,
                    name: xmlAttr(tag, 'text') || xmlAttr(tag, 'title') || xmlUrl,
                    type: xmlAttr(tag, 'type') === 'rss' ? null : (xmlAttr(tag, 'category') || null),
                });
            }
        }
        return feeds;
    }

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

    // Link Submitter — submit links to biji.com API
    // Rewritten from link-submitter.js
    const STORAGE_KEY = 'submittedLinks';
    const MAX_HISTORY = 500;
    function submitLink(url, title, capturedHeaders) {
        if (!capturedHeaders) {
            return Promise.reject(new Error('未捕获到认证信息，请先在 biji.com 页面上浏览'));
        }
        const headers = Object.assign({}, capturedHeaders, { 'content-type': 'application/json' });
        const body = JSON.stringify({
            attachments: [{ size: 100, type: 'link', title: title || '', url }],
            content: '',
            entry_type: 'ai',
            note_type: 'link',
            prompt_template_id: '',
            source: 'web',
        });
        return fetch(SUBMIT_API_URL, { method: 'POST', headers, body }).then(resp => {
            if (!resp.ok) {
                return resp.text().then(text => {
                    throw new Error('HTTP ' + resp.status + ': ' + text.substring(0, 200));
                });
            }
            return _readSSEResponse(resp).then(result => {
                return _recordSubmission(url, title, result).then(() => result);
            });
        });
    }
    function _readSSEResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let noteId = '';
        let linkTitle = '';
        let buffer = '';
        function processChunk() {
            return reader.read().then(result => {
                if (result.done)
                    return { noteId, linkTitle };
                buffer += decoder.decode(result.value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                lines.forEach(line => {
                    if (line.indexOf('data: ') !== 0)
                        return;
                    try {
                        const json = JSON.parse(line.substring(6));
                        if (json.data && json.data.note_id && !noteId)
                            noteId = json.data.note_id;
                        if (json.data && json.data.link_title)
                            linkTitle = json.data.link_title;
                    }
                    catch { /* ignore non-JSON lines */ }
                });
                return processChunk();
            });
        }
        return processChunk();
    }
    function _recordSubmission(url, title, result) {
        return new Promise(resolve => {
            chrome.storage.local.get(STORAGE_KEY, (data) => {
                let links = data[STORAGE_KEY] || [];
                links.unshift({
                    url,
                    title: title || result.linkTitle || '',
                    submittedAt: new Date().toISOString(),
                    noteId: result.noteId || '',
                });
                if (links.length > MAX_HISTORY)
                    links = links.slice(0, MAX_HISTORY);
                const obj = {};
                obj[STORAGE_KEY] = links;
                chrome.storage.local.set(obj, resolve);
            });
        });
    }
    function isAlreadySubmitted(url) {
        return new Promise(resolve => {
            chrome.storage.local.get(STORAGE_KEY, (data) => {
                const links = data[STORAGE_KEY] || [];
                resolve(links.some((item) => item.url === url));
            });
        });
    }
    function getSubmissionHistory(limit = 50) {
        return new Promise(resolve => {
            chrome.storage.local.get(STORAGE_KEY, (data) => {
                const links = data[STORAGE_KEY] || [];
                resolve(links.slice(0, limit));
            });
        });
    }
    const LinkSubmitterModule = { submitLink, isAlreadySubmitted, getSubmissionHistory };

    // Tag Manager — pending tag storage for subscription items
    // Rewritten from tag-manager.js
    const PENDING_TAGS_KEY = 'pendingTags';
    function getPendingTags() {
        return new Promise(resolve => {
            chrome.storage.local.get(PENDING_TAGS_KEY, (data) => {
                resolve(data[PENDING_TAGS_KEY] || {});
            });
        });
    }
    function savePendingTags(tags) {
        return new Promise(resolve => {
            const obj = {};
            obj[PENDING_TAGS_KEY] = tags;
            chrome.storage.local.set(obj, resolve);
        });
    }
    function storePendingTags(noteId, tags) {
        return getPendingTags().then(all => {
            all[noteId] = { tags, appliedAt: null };
            return savePendingTags(all);
        });
    }
    function getTagsForNote(noteId) {
        return getPendingTags().then(all => {
            const entry = all[noteId];
            return entry ? entry.tags : [];
        });
    }
    function markApplied(noteIds) {
        return getPendingTags().then(all => {
            const now = new Date().toISOString();
            noteIds.forEach(id => {
                if (all[id])
                    all[id].appliedAt = now;
            });
            return savePendingTags(all);
        });
    }
    function mergeTagsForNote(note) {
        return getTagsForNote(note.id).then(pendingTags => {
            if (!pendingTags || pendingTags.length === 0)
                return note;
            const existing = (note.tags || []).map((t) => typeof t === 'string' ? t : t.name || t.label || '');
            pendingTags.forEach(tag => {
                if (tag && existing.indexOf(tag) === -1)
                    existing.push(tag);
            });
            note.tags = existing;
            return note;
        });
    }
    const TagManagerModule = {
        getPendingTags, storePendingTags, getTagsForNote, markApplied, mergeTagsForNote,
    };

    // Feed Manager — RSS/Atom feed management
    // Rewritten from feed-manager.js
    const FEEDS_KEY = 'feeds';
    const FEED_ITEMS_KEY = 'feedItems';
    const FEED_SUBMITTED_KEY = 'feedSubmittedItems';
    const ALARM_NAME = 'biji-feed-check';
    const SUBMIT_DELAY = 1000;
    const MAX_ITEMS = 10000;
    // --- Host permission helpers ---
    function extractOriginPattern(url) {
        const u = new URL(url);
        return u.origin + '/*';
    }
    /** Request host permission for a URL. Must be called from a user-gesture context. */
    function ensureHostPermission(url) {
        const pattern = extractOriginPattern(url);
        return new Promise((resolve, reject) => {
            chrome.permissions.contains({ origins: [pattern] }, (has) => {
                if (has)
                    return resolve();
                chrome.permissions.request({ origins: [pattern] }, (granted) => {
                    if (granted)
                        resolve();
                    else
                        reject(new Error('用户拒绝了对 ' + new URL(url).hostname + ' 的访问权限'));
                });
            });
        });
    }
    /** Check host permission without requesting (safe for alarm/background context). */
    function hasHostPermission(url) {
        const pattern = extractOriginPattern(url);
        return new Promise(resolve => {
            chrome.permissions.contains({ origins: [pattern] }, resolve);
        });
    }
    function detectFeedType(url) {
        if (/youtube\.com/i.test(url))
            return 'youtube';
        if (/bilibili\.com/i.test(url))
            return 'bilibili';
        if (/xiaoyuzhoufm\.com|podcast|anchor\.fm|podcasts\.apple/i.test(url))
            return 'podcast';
        return 'other';
    }
    // --- Feed CRUD ---
    function getFeeds() {
        return new Promise(resolve => {
            chrome.storage.local.get(FEEDS_KEY, (data) => {
                resolve(data[FEEDS_KEY] || []);
            });
        });
    }
    function saveFeeds(feeds) {
        return new Promise(resolve => {
            const obj = {};
            obj[FEEDS_KEY] = feeds;
            chrome.storage.local.set(obj, resolve);
        });
    }
    function addFeed(url, name, type, channelName) {
        return getFeeds().then(feeds => {
            const exists = feeds.some(f => f.url === url);
            if (exists)
                throw new Error('该订阅源已存在');
            const feed = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
                url,
                name: name || url,
                enabled: true,
                addedAt: new Date().toISOString(),
                lastChecked: null,
                type: type || detectFeedType(url),
                channelName: channelName || name || url,
            };
            feeds.push(feed);
            return saveFeeds(feeds).then(() => {
                refreshFeedItems(feed.id).catch(err => {
                    console.warn('[Biji Ext] Auto-refresh after addFeed failed:', err.message);
                });
                return feed;
            });
        });
    }
    function removeFeed(feedId) {
        return getFeeds().then(feeds => {
            feeds = feeds.filter(f => f.id !== feedId);
            return saveFeeds(feeds);
        });
    }
    function toggleFeed(feedId) {
        return getFeeds().then(feeds => {
            let target = null;
            feeds.forEach(f => {
                if (f.id === feedId) {
                    f.enabled = !f.enabled;
                    target = f;
                }
            });
            return saveFeeds(feeds).then(() => target);
        });
    }
    function editFeed(feedId, updates) {
        return getFeeds().then(feeds => {
            let target = null;
            feeds.forEach(f => {
                if (f.id === feedId) {
                    if (updates.name !== undefined)
                        f.name = updates.name;
                    if (updates.url !== undefined)
                        f.url = updates.url;
                    if (updates.type !== undefined)
                        f.type = updates.type;
                    if (updates.channelName !== undefined)
                        f.channelName = updates.channelName;
                    target = f;
                }
            });
            return saveFeeds(feeds).then(() => target);
        });
    }
    // --- Feed Items ---
    function getFeedItems(filter) {
        return new Promise(resolve => {
            chrome.storage.local.get(FEED_ITEMS_KEY, (data) => {
                const items = data[FEED_ITEMS_KEY] || {};
                let arr = Object.values(items);
                if (filter) {
                    if (filter.feedId)
                        arr = arr.filter(i => i.feedId === filter.feedId);
                    if (filter.status)
                        arr = arr.filter(i => i.status === filter.status);
                }
                arr.sort((a, b) => {
                    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
                    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
                    return db - da;
                });
                resolve(arr);
            });
        });
    }
    function saveFeedItems(items) {
        return new Promise(resolve => {
            const obj = {};
            obj[FEED_ITEMS_KEY] = items;
            chrome.storage.local.set(obj, resolve);
        });
    }
    function pruneItems(items) {
        const keys = Object.keys(items);
        if (keys.length <= MAX_ITEMS)
            return items;
        const removable = keys.filter(k => items[k].status === 'submitted' || items[k].status === 'noted');
        removable.sort((a, b) => {
            const da = items[a].pubDate ? new Date(items[a].pubDate).getTime() : 0;
            const db = items[b].pubDate ? new Date(items[b].pubDate).getTime() : 0;
            return da - db;
        });
        const toRemove = keys.length - MAX_ITEMS;
        for (let i = 0; i < toRemove && i < removable.length; i++) {
            delete items[removable[i]];
        }
        return items;
    }
    // --- Legacy submitted items ---
    function getSubmittedItems() {
        return new Promise(resolve => {
            chrome.storage.local.get(FEED_SUBMITTED_KEY, (data) => {
                resolve(data[FEED_SUBMITTED_KEY] || {});
            });
        });
    }
    function markItemSubmitted(guid) {
        return getSubmittedItems().then(items => {
            items[guid] = new Date().toISOString();
            const keys = Object.keys(items);
            if (keys.length > 5000) {
                const sorted = keys.sort((a, b) => items[b].localeCompare(items[a]));
                const pruned = {};
                sorted.slice(0, 5000).forEach(k => { pruned[k] = items[k]; });
                items = pruned;
            }
            return new Promise(resolve => {
                const obj = {};
                obj[FEED_SUBMITTED_KEY] = items;
                chrome.storage.local.set(obj, resolve);
            });
        });
    }
    // --- Refresh feeds ---
    function refreshFeedItems(feedId) {
        return getFeeds().then(feeds => {
            let feed = null;
            feeds.forEach(f => { if (f.id === feedId)
                feed = f; });
            if (!feed)
                throw new Error('Feed not found');
            return _fetchAndStoreFeedItems([feed]);
        });
    }
    function refreshAllFeedItems() {
        return getFeeds().then(feeds => {
            const enabled = feeds.filter(f => f.enabled);
            return _fetchAndStoreFeedItems(enabled);
        });
    }
    function _fetchAndStoreFeedItems(feedList) {
        return new Promise(resolve => {
            chrome.storage.local.get(FEED_ITEMS_KEY, (data) => {
                const allItems = data[FEED_ITEMS_KEY] || {};
                let totalNew = 0;
                const feedThumbnailUpdates = {};
                const feedNameUpdates = {};
                const feedErrorUpdates = {};
                function processFeed(index) {
                    if (index >= feedList.length) {
                        const pruned = pruneItems(allItems);
                        saveFeedItems(pruned).then(() => {
                            getFeeds().then(feeds => {
                                const now = new Date().toISOString();
                                feedList.forEach(fl => {
                                    feeds.forEach((f) => {
                                        if (f.id === fl.id) {
                                            f.lastChecked = now;
                                            if (feedThumbnailUpdates[f.id])
                                                f.thumbnail = feedThumbnailUpdates[f.id];
                                            if (feedNameUpdates[f.id]) {
                                                f.channelName = feedNameUpdates[f.id];
                                                if (f.name === f.url)
                                                    f.name = feedNameUpdates[f.id];
                                            }
                                            f.lastError = feedErrorUpdates[f.id] || '';
                                        }
                                    });
                                });
                                saveFeeds(feeds).then(() => {
                                    resolve({ newItems: totalNew, checked: feedList.length });
                                });
                            });
                        });
                        return;
                    }
                    const feed = feedList[index];
                    hasHostPermission(feed.url).then(hasPerm => {
                        if (!hasPerm) {
                            console.warn('[Biji Ext] Skipping feed (no host permission):', feed.url);
                            feedErrorUpdates[feed.id] = '无访问权限，请在订阅管理页面手动刷新以授权';
                            processFeed(index + 1);
                            return;
                        }
                        fetchFeedContent(feed.url)
                            .then(xmlText => {
                            const result = parseFeedXml(xmlText);
                            const parsed = result.items;
                            const channelInfo = result.channel;
                            if (channelInfo.thumbnail && !feed.thumbnail) {
                                feed.thumbnail = channelInfo.thumbnail;
                                feedThumbnailUpdates[feed.id] = channelInfo.thumbnail;
                            }
                            if (channelInfo.title && feed.channelName === feed.url) {
                                feed.channelName = channelInfo.title;
                                feedNameUpdates[feed.id] = channelInfo.title;
                            }
                            feedErrorUpdates[feed.id] = '';
                            parsed.forEach(item => {
                                const key = item.guid || item.url;
                                if (!allItems[key]) {
                                    allItems[key] = {
                                        guid: key,
                                        feedId: feed.id,
                                        title: item.title,
                                        url: item.url,
                                        pubDate: item.pubDate,
                                        thumbnail: item.thumbnail,
                                        description: item.description,
                                        duration: item.duration || '',
                                        enclosureUrl: item.enclosureUrl || '',
                                        status: 'new',
                                        submittedAt: null,
                                        noteId: null,
                                        tags: [feed.type || 'other', feed.channelName || feed.name],
                                    };
                                    totalNew++;
                                }
                            });
                            processFeed(index + 1);
                        })
                            .catch(err => {
                            console.warn('[Biji Ext] Feed refresh failed for', feed.url, err.message);
                            feedErrorUpdates[feed.id] = err.message;
                            processFeed(index + 1);
                        });
                    });
                }
                processFeed(0);
            });
        });
    }
    // --- Submit feed items ---
    function submitFeedItems(guids, capturedHeaders) {
        if (!capturedHeaders)
            return Promise.reject(new Error('未捕获到认证信息'));
        const STAGGER_MS = 200;
        return new Promise(resolve => {
            chrome.storage.local.get(FEED_ITEMS_KEY, (data) => {
                const allItems = data[FEED_ITEMS_KEY] || {};
                const toSubmit = guids.map(g => allItems[g]).filter(Boolean);
                const prevStatusByGuid = {};
                toSubmit.forEach(item => {
                    const guid = item.guid || item.url;
                    prevStatusByGuid[guid] = item.status || 'new';
                    item.status = 'submitting';
                });
                saveFeedItems(allItems).then(() => {
                    const promises = toSubmit.map((item, idx) => {
                        return new Promise(r => { setTimeout(r, idx * STAGGER_MS); })
                            .then(() => {
                            return submitLink(item.url, item.title, capturedHeaders)
                                .then(result => {
                                item.status = 'submitted';
                                item.submittedAt = new Date().toISOString();
                                item.noteId = (result && result.noteId) || null;
                                markItemSubmitted(item.guid || item.url);
                                if (item.noteId && item.tags && item.tags.length > 0) {
                                    storePendingTags(item.noteId, item.tags);
                                }
                                return { guid: item.guid, noteId: item.noteId, error: null };
                            })
                                .catch(err => {
                                const guid = item.guid || item.url;
                                const prev = prevStatusByGuid[guid];
                                item.status = prev && prev !== 'submitting' ? prev : 'new';
                                return { guid: item.guid, noteId: null, error: err.message };
                            });
                        });
                    });
                    Promise.all(promises).then(results => {
                        saveFeedItems(allItems).then(() => resolve(results));
                    });
                });
            });
        });
    }
    // --- Check all feeds ---
    function checkAllFeeds(capturedHeaders) {
        return new Promise(resolve => {
            chrome.storage.local.get('settings', (data) => {
                const settings = data.settings || {};
                const autoSubmit = settings.feedAutoSubmit !== false;
                if (autoSubmit) {
                    _checkAllFeedsAutoSubmit(capturedHeaders).then(resolve);
                }
                else {
                    refreshAllFeedItems().then(resolve);
                }
            });
        });
    }
    function _checkAllFeedsAutoSubmit(capturedHeaders) {
        if (!capturedHeaders)
            return Promise.reject(new Error('未捕获到认证信息'));
        return Promise.all([getFeeds(), getSubmittedItems()]).then(([feeds, submittedItems]) => {
            const enabledFeeds = feeds.filter(f => f.enabled);
            let totalNew = 0;
            function processFeed(index) {
                if (index >= enabledFeeds.length) {
                    return Promise.resolve({ checked: enabledFeeds.length, newItems: totalNew });
                }
                const feed = enabledFeeds[index];
                return hasHostPermission(feed.url).then(hasPerm => {
                    if (!hasPerm) {
                        console.warn('[Biji Ext] Skipping feed (no host permission):', feed.url);
                        return processFeed(index + 1);
                    }
                    return fetchFeedContent(feed.url)
                        .then(xmlText => {
                        const items = parseFeedXml(xmlText).items;
                        const newItems = items.filter(item => !submittedItems[item.guid] && !submittedItems[item.url]);
                        return getFeeds().then(allFeeds => {
                            allFeeds.forEach((f) => {
                                if (f.id === feed.id)
                                    f.lastChecked = new Date().toISOString();
                            });
                            return saveFeeds(allFeeds).then(() => _submitItemsSequentially(newItems, capturedHeaders));
                        });
                    })
                        .then(submitted => {
                        totalNew += submitted;
                        return processFeed(index + 1);
                    })
                        .catch(err => {
                        console.warn('[Biji Ext] Feed check failed for', feed.url, err.message);
                        return processFeed(index + 1);
                    });
                });
            }
            return processFeed(0);
        });
    }
    function fetchFeedContent(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        return fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
                'User-Agent': 'Mozilla/5.0 (compatible; BijiFeedReader/1.0)',
            },
        }).then(resp => {
            clearTimeout(timeoutId);
            if (!resp.ok)
                throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
            return resp.text();
        }).catch(err => {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError')
                throw new Error('请求超时（15秒）');
            throw err;
        });
    }
    function _submitItemsSequentially(items, capturedHeaders) {
        let count = 0;
        function submitNext(index) {
            if (index >= items.length)
                return Promise.resolve(count);
            const item = items[index];
            return submitLink(item.url, item.title, capturedHeaders)
                .then(() => {
                count++;
                return markItemSubmitted(item.guid || item.url);
            })
                .catch(err => {
                console.warn('[Biji Ext] Feed item submit failed:', item.url, err.message);
            })
                .then(() => new Promise(resolve => { setTimeout(resolve, SUBMIT_DELAY); }))
                .then(() => submitNext(index + 1));
        }
        return submitNext(0);
    }
    // --- OPML import ---
    function importFeedsOpml(opmlText) {
        const parsed = parseOpml(opmlText);
        if (parsed.length === 0)
            return Promise.reject(new Error('未找到有效的订阅源'));
        return getFeeds().then(feeds => {
            let added = 0;
            const newFeedIds = [];
            parsed.forEach(p => {
                const exists = feeds.some(f => f.url === p.url);
                if (!exists) {
                    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 4) + added;
                    feeds.push({
                        id,
                        url: p.url,
                        name: p.name || p.url,
                        enabled: true,
                        addedAt: new Date().toISOString(),
                        lastChecked: null,
                        type: p.type || detectFeedType(p.url),
                        channelName: p.name || p.url,
                    });
                    newFeedIds.push(id);
                    added++;
                }
            });
            return saveFeeds(feeds).then(() => {
                if (newFeedIds.length > 0) {
                    getFeeds().then(allFeeds => {
                        const newFeeds = allFeeds.filter(f => newFeedIds.indexOf(f.id) !== -1);
                        _fetchAndStoreFeedItems(newFeeds).catch(err => {
                            console.warn('[Biji Ext] Auto-refresh after OPML import failed:', err.message);
                        });
                    });
                }
                return { added, total: parsed.length };
            });
        });
    }
    // --- YouTube URL conversion ---
    function convertYoutubeUrl(url) {
        const channelMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
        if (channelMatch) {
            return Promise.resolve('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelMatch[1]);
        }
        const handleMatch = url.match(/youtube\.com\/@([^/?#]+)/);
        if (handleMatch) {
            return fetch('https://www.youtube.com/@' + handleMatch[1])
                .then(resp => resp.text())
                .then(html => {
                const cidMatch = html.match(/channel_id=([^"&]+)/) ||
                    html.match(/"channelId":"([^"]+)"/) ||
                    html.match(/externalId":"([^"]+)"/);
                if (cidMatch)
                    return 'https://www.youtube.com/feeds/videos.xml?channel_id=' + cidMatch[1];
                throw new Error('无法从页面提取 channel_id');
            });
        }
        return Promise.reject(new Error('不支持的 YouTube URL 格式'));
    }
    // --- Data migration ---
    function migrateFeeds() {
        return getFeeds().then(feeds => {
            let changed = false;
            feeds.forEach((f) => {
                if (!f.type) {
                    f.type = detectFeedType(f.url);
                    changed = true;
                }
                if (!f.channelName) {
                    f.channelName = f.name;
                    changed = true;
                }
            });
            if (changed)
                return saveFeeds(feeds);
            return Promise.resolve();
        });
    }
    // --- Alarm management ---
    function setupAlarm() {
        chrome.storage.local.get('settings', (data) => {
            const s = data.settings || {};
            if (s.feedAutoCheck) {
                const interval = s.feedCheckInterval || 60;
                chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
            }
            else {
                chrome.alarms.clear(ALARM_NAME);
            }
        });
    }
    // Initialize on load
    setupAlarm();
    migrateFeeds();
    const FeedManagerModule = {
        getFeeds, addFeed, removeFeed, toggleFeed, editFeed,
        checkAllFeeds, getFeedItems, refreshFeedItems, refreshAllFeedItems,
        submitFeedItems, importFeedsOpml, convertYoutubeUrl, setupAlarm, ALARM_NAME,
        ensureHostPermission, hasHostPermission,
    };

    // Canonical normalizeNote + findNotesArray
    // Previously duplicated in inject.js and background.js
    function normalizeNote(raw) {
        return {
            id: raw.id || raw.noteId || raw.note_id || raw._id || '',
            title: raw.title || raw.subject || '',
            content: raw.content || raw.text || raw.body || raw.html || raw.richText ||
                raw.rich_text || raw.result || raw.answer || raw.output || raw.summary ||
                raw.aiContent || raw.ai_content || raw.description || '',
            rawTranscript: raw.transcript ||
                raw.rawText ||
                raw.raw_text ||
                raw.voiceText ||
                raw.voice_text ||
                raw.asr ||
                raw.asrText ||
                raw.asr_text ||
                raw.originalText ||
                raw.original_text ||
                raw.speechText ||
                raw.speech_text ||
                raw.rawContent ||
                raw.raw_content ||
                null,
            createdAt: raw.createdAt ||
                raw.created_at ||
                raw.createTime ||
                raw.create_time ||
                raw.createdTime ||
                raw.created ||
                raw.ctime ||
                '',
            updatedAt: raw.updatedAt ||
                raw.updated_at ||
                raw.updateTime ||
                raw.update_time ||
                raw.modifiedAt ||
                raw.modified ||
                raw.mtime ||
                '',
            tags: raw.tags || raw.labels || raw.categories || [],
            noteType: raw.note_type || raw.noteType || raw.entry_type || null,
            type: raw.type || raw.note_type || raw.noteType || 'text',
            audioUrl: raw.audioUrl || raw.audio_url || raw.voiceUrl || raw.voice_url || null,
            images: raw.images || raw.imgs || raw.pictures || raw.attachments || [],
        };
    }
    const PRIORITY_KEYS = [
        'notes', 'list', 'data', 'items', 'results', 'records', 'c',
        'noteList', 'note_list', 'entries', 'rows', 'content', 'timeline',
        'feeds', 'posts',
    ];
    function findNotesArray(obj, depth = 0) {
        if (depth > 10 || !obj)
            return null;
        if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
            const f = obj[0];
            if ((f.id || f.noteId || f.note_id || f._id) &&
                (f.content || f.title || f.name || f.text || f.body || f.subject || f.html || f.richText)) {
                return obj;
            }
            if (obj.length >= 5 &&
                (f.id || f.noteId || f.note_id || f._id)) {
                return obj;
            }
        }
        if (typeof obj === 'object' && !Array.isArray(obj)) {
            const allKeys = Object.keys(obj);
            const sortedKeys = [];
            PRIORITY_KEYS.forEach(pk => {
                if (allKeys.indexOf(pk) !== -1)
                    sortedKeys.push(pk);
            });
            allKeys.forEach(k => {
                if (sortedKeys.indexOf(k) === -1)
                    sortedKeys.push(k);
            });
            for (let i = 0; i < sortedKeys.length; i++) {
                const key = sortedKeys[i];
                if (!obj.hasOwnProperty(key))
                    continue;
                const r = findNotesArray(obj[key], depth + 1);
                if (r)
                    return r;
            }
        }
        return null;
    }

    // api-fetcher.ts — Note fetching via biji API
    // Extracted from background.js:131-509
    const DEBUG$1 = false;
    function log$1(...args) {
        if (!DEBUG$1)
            return;
        console.log('[Biji Ext]', ...args);
    }
    let fetchAbortController = null;
    function fetchAllNotes(headers, fetchDelay, onStatus, storeNotes) {
        fetchAbortController = new AbortController();
        const signal = fetchAbortController.signal;
        const limit = 50;
        let sinceId = '';
        let totalFetched = 0;
        let pageNum = 0;
        const maxRetries = 3;
        let retries = 0;
        function delay(ms) {
            return new Promise(resolve => { setTimeout(resolve, ms); });
        }
        function fetchPage() {
            if (signal.aborted) {
                onStatus('已取消', totalFetched, true);
                return Promise.resolve();
            }
            if (!headers) {
                onStatus('未捕获到认证信息，请先在 biji.com 页面上浏览笔记列表，然后再点击获取', 0, true);
                return Promise.resolve();
            }
            pageNum++;
            const url = BIJI_API_BASE + '?limit=' + limit + '&since_id=' + sinceId + '&sort=create_desc';
            onStatus('正在获取第 ' + pageNum + ' 批...', totalFetched, false);
            const reqHeaders = Object.assign({}, headers);
            log$1('Fetching with headers:', Object.keys(reqHeaders).join(', '));
            return fetch(url, { method: 'GET', headers: reqHeaders, signal })
                .then(response => {
                log$1('Fetch page ' + pageNum + ': HTTP ' + response.status);
                if (!response.ok) {
                    return response.text().then(body => {
                        log$1('Error response body:', body.substring(0, 500));
                        if (response.status === 429) {
                            onStatus('请求限流，等待 5 秒...', totalFetched, false);
                            return delay(5000).then(fetchPage);
                        }
                        if (response.status === 401 || response.status === 403) {
                            onStatus('认证失败 (HTTP ' + response.status + ')，请先登录 biji.com', totalFetched, true);
                            return Promise.resolve();
                        }
                        if (retries < maxRetries) {
                            retries++;
                            onStatus('请求失败 (HTTP ' + response.status + ')，重试中...', totalFetched, false);
                            return delay(Math.pow(2, retries) * 500).then(fetchPage);
                        }
                        onStatus('请求失败 (HTTP ' + response.status + ')', totalFetched, true);
                        return Promise.resolve();
                    });
                }
                retries = 0;
                return response.json().then(data => {
                    if (pageNum === 1) {
                        const rawNotes = findNotesArray(data);
                        if (rawNotes && rawNotes.length > 0) {
                            log$1('Raw note keys:', Object.keys(rawNotes[0]));
                            log$1('Raw note sample:', JSON.stringify(rawNotes[0]).substring(0, 2000));
                        }
                    }
                    const notes = findNotesArray(data);
                    if (!notes || notes.length === 0) {
                        onStatus('获取完成！共 ' + totalFetched + ' 条笔记', totalFetched, true);
                        return Promise.resolve();
                    }
                    const normalized = notes.map(normalizeNote);
                    totalFetched += normalized.length;
                    storeNotes(normalized);
                    onStatus('已获取 ' + totalFetched + ' 条笔记', totalFetched, false);
                    const lastNote = notes[notes.length - 1];
                    const lastId = lastNote.id || lastNote.noteId || lastNote.note_id || lastNote._id || '';
                    if (!lastId || notes.length < limit) {
                        onStatus('获取完成！共 ' + totalFetched + ' 条笔记', totalFetched, true);
                        return Promise.resolve();
                    }
                    sinceId = String(lastId);
                    return delay(fetchDelay).then(fetchPage);
                });
            })
                .catch(e => {
                if (e.name === 'AbortError') {
                    onStatus('已取消', totalFetched, true);
                    return Promise.resolve();
                }
                if (retries < maxRetries) {
                    retries++;
                    onStatus('网络错误，重试中...', totalFetched, false);
                    return delay(Math.pow(2, retries) * 500).then(fetchPage);
                }
                onStatus('网络错误: ' + e.message, totalFetched, true);
                return Promise.resolve();
            });
        }
        return fetchPage();
    }
    function cancelFetch() {
        if (fetchAbortController) {
            fetchAbortController.abort();
        }
    }
    // --- Transcript fetcher ---
    function fetchNoteTranscript(headers, noteId, noteType) {
        if (!headers) {
            console.warn('[Biji Ext] No API headers captured yet. Browse biji.com first.');
            return Promise.resolve(null);
        }
        let typeSegment = '';
        if (noteType === 'link')
            typeSegment = '/links';
        else if (noteType === 'voice')
            typeSegment = '/voices';
        const urls = [];
        if (typeSegment)
            urls.push(BIJI_API_BASE + '/' + noteId + typeSegment + '/detail');
        urls.push(BIJI_API_BASE + '/' + noteId + '/original');
        urls.push(BIJI_API_BASE + '/' + noteId + '/detail');
        const reqHeaders = Object.assign({}, headers);
        function tryUrl(index) {
            if (index >= urls.length)
                return Promise.resolve(null);
            const url = urls[index];
            log$1('Fetching transcript from:', url);
            return fetch(url, { method: 'GET', headers: reqHeaders })
                .then(resp => {
                if (!resp.ok) {
                    log$1('Detail API returned HTTP', resp.status, 'for', url);
                    return tryUrl(index + 1);
                }
                return resp.json().then(data => {
                    const transcript = extractTranscript(data);
                    if (transcript) {
                        log$1('Transcript found, length:', transcript.length);
                        return transcript;
                    }
                    log$1('No transcript found in response from', url);
                    return tryUrl(index + 1);
                });
            })
                .catch(e => {
                console.warn('[Biji Ext] Detail API error:', e.message);
                return tryUrl(index + 1);
            });
        }
        return tryUrl(0).then(transcript => {
            if (transcript)
                return transcript;
            return fetchTranscriptFromWebPage(noteId);
        });
    }
    // --- Content fetcher ---
    function fetchNoteContent(headers, noteId, noteType) {
        if (!headers)
            return Promise.resolve(null);
        let typeSegment = '';
        if (noteType === 'link')
            typeSegment = '/links';
        else if (noteType === 'voice')
            typeSegment = '/voices';
        else if (noteType === 'ai')
            typeSegment = '/ais';
        const urls = [];
        if (typeSegment)
            urls.push(BIJI_API_BASE + '/' + noteId + typeSegment + '/detail');
        urls.push(BIJI_API_BASE + '/' + noteId + '/detail');
        const reqHeaders = Object.assign({}, headers);
        function tryUrl(index) {
            if (index >= urls.length)
                return Promise.resolve(null);
            const url = urls[index];
            log$1('Fetching content from:', url);
            return fetch(url, { method: 'GET', headers: reqHeaders })
                .then(resp => {
                if (!resp.ok) {
                    log$1('Detail API returned HTTP', resp.status, 'for', url);
                    return tryUrl(index + 1);
                }
                return resp.json().then(data => {
                    log$1('Detail response keys:', JSON.stringify(Object.keys(data)));
                    const content = extractContent(data);
                    if (content) {
                        log$1('Content found, length:', content.length);
                        return content;
                    }
                    log$1('No content found in response from', url);
                    return tryUrl(index + 1);
                });
            })
                .catch(e => {
                console.warn('[Biji Ext] Detail API error:', e.message);
                return tryUrl(index + 1);
            });
        }
        return tryUrl(0);
    }
    // --- Internal helpers ---
    function extractContent(obj) {
        if (!obj || typeof obj !== 'object')
            return null;
        const note = obj.c || obj.data || obj;
        const candidates = [
            note.content, note.text, note.body, note.html, note.richText,
            note.rich_text, note.result, note.answer, note.output, note.summary,
            note.aiContent, note.ai_content, note.aiResult, note.ai_result,
            note.generatedContent, note.generated_content, note.response,
            note.detail, note.description, note.note_content,
        ];
        for (let i = 0; i < candidates.length; i++) {
            if (typeof candidates[i] === 'string' && candidates[i].trim().length > 0) {
                return candidates[i];
            }
        }
        if (note.note && typeof note.note === 'object') {
            return extractContent({ c: note.note });
        }
        return null;
    }
    function extractTranscript(obj) {
        if (!obj || typeof obj !== 'object')
            return null;
        const note = obj.c || obj.data || obj;
        // Strategy 0: direct transcript field names
        const transcriptFields = [
            'transcript', 'rawTranscript', 'raw_transcript',
            'originalText', 'original_text', 'originalContent', 'original_content',
            'rawContent', 'raw_content', 'rawText', 'raw_text',
            'voiceText', 'voice_text', 'speechText', 'speech_text',
        ];
        for (const field of transcriptFields) {
            if (typeof note[field] === 'string' && note[field].length > 50) {
                const parsed = _parseSentenceListJson(note[field]);
                if (parsed)
                    return parsed;
                return note[field];
            }
        }
        // Strategy 1: strings with timestamp pattern [00:00:00]
        const timestampTexts = [];
        findTimestampStrings(obj, timestampTexts, 0);
        if (timestampTexts.length > 0) {
            timestampTexts.sort((a, b) => b.length - a.length);
            return timestampTexts[0];
        }
        // Strategy 2: arrays of paragraph-like objects with timestamps
        const paragraphs = findParagraphArray(obj, 0);
        if (paragraphs)
            return paragraphs;
        // Strategy 3: fall back to long content from detail API
        if (note && typeof note.content === 'string' && note.content.length > 200) {
            const parsed = _parseSentenceListJson(note.content);
            if (parsed)
                return parsed;
            return note.content;
        }
        return null;
    }
    function _parseSentenceListJson(raw) {
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
    function decodeHtmlEntities(text) {
        if (!text)
            return '';
        return text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)));
    }
    function fetchTranscriptFromWebPage(noteId) {
        const webUrl = 'https://www.biji.com/note/' + noteId + '/web';
        log$1('Transcript API fallback to /web:', webUrl);
        return fetch(webUrl, { method: 'GET', credentials: 'include' })
            .then(resp => {
            if (!resp.ok) {
                log$1('/web transcript fallback HTTP', resp.status, 'for', noteId);
                return null;
            }
            return resp.text();
        })
            .then((html) => {
            if (!html)
                return null;
            const scriptJsonPatterns = [
                /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
                /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
                /window\.__APP_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
                /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>\s*([\s\S]*?)\s*<\/script>/,
            ];
            for (let i = 0; i < scriptJsonPatterns.length; i++) {
                const m = html.match(scriptJsonPatterns[i]);
                if (!m || !m[1])
                    continue;
                try {
                    const obj = JSON.parse(m[1]);
                    const transcript = extractTranscript(obj);
                    if (transcript && transcript.trim().length > 0) {
                        log$1('Transcript found via /web script JSON, length:', transcript.length);
                        return transcript;
                    }
                }
                catch (_) {
                    // ignore and continue
                }
            }
            const pTexts = [];
            const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
            let match = null;
            while ((match = pRe.exec(html)) !== null) {
                let t = match[1] || '';
                t = t.replace(/<br\s*\/?>/gi, '\n');
                t = t.replace(/<[^>]+>/g, '');
                t = decodeHtmlEntities(t).trim();
                if (t)
                    pTexts.push(t);
            }
            if (pTexts.length > 0) {
                const tsOnly = pTexts.filter(t => /^\[?\d{2}:\d{2}:\d{2}\]?/.test(t));
                if (tsOnly.length > 3) {
                    const out = tsOnly.join('\n\n');
                    log$1('Transcript found via /web <p> timestamp scan, count:', tsOnly.length, 'length:', out.length);
                    return out;
                }
            }
            return null;
        })
            .catch(e => {
            console.warn('[Biji Ext] /web transcript fallback failed for', noteId, e && e.message ? e.message : e);
            return null;
        });
    }
    function findTimestampStrings(obj, results, depth) {
        if (depth > 8 || !obj)
            return;
        if (typeof obj === 'string') {
            if (/\[\d{2}:\d{2}:\d{2}\]/.test(obj) && obj.length > 100) {
                results.push(obj);
            }
            return;
        }
        if (Array.isArray(obj)) {
            const tsLines = [];
            let hasTs = false;
            for (let i = 0; i < obj.length; i++) {
                if (typeof obj[i] === 'string') {
                    tsLines.push(obj[i]);
                    if (/\[\d{2}:\d{2}:\d{2}\]/.test(obj[i]))
                        hasTs = true;
                }
                else if (obj[i] && typeof obj[i] === 'object') {
                    const t = obj[i].text || obj[i].content || obj[i].body || obj[i].sentence || '';
                    if (t) {
                        tsLines.push(t);
                        if (/\[\d{2}:\d{2}:\d{2}\]/.test(t))
                            hasTs = true;
                    }
                }
            }
            if (hasTs && tsLines.length > 3) {
                results.push(tsLines.join('\n\n'));
            }
            for (let j = 0; j < obj.length && j < 5; j++) {
                if (typeof obj[j] === 'object')
                    findTimestampStrings(obj[j], results, depth + 1);
            }
            return;
        }
        if (typeof obj === 'object') {
            const keys = Object.keys(obj);
            for (let k = 0; k < keys.length; k++) {
                findTimestampStrings(obj[keys[k]], results, depth + 1);
            }
        }
    }
    function findParagraphArray(obj, depth) {
        if (depth > 6 || !obj || typeof obj !== 'object')
            return null;
        if (Array.isArray(obj) && obj.length > 5) {
            const texts = [];
            let hasTs = false;
            for (let i = 0; i < obj.length; i++) {
                const item = obj[i];
                let t = '';
                if (typeof item === 'string')
                    t = item;
                else if (item && typeof item === 'object') {
                    t = item.text || item.content || item.body || item.sentence ||
                        item.paragraph || item.value || '';
                }
                if (t) {
                    texts.push(t);
                    if (/\[\d{2}:\d{2}:\d{2}\]/.test(t))
                        hasTs = true;
                }
            }
            if (hasTs && texts.length > 3) {
                return texts.join('\n\n');
            }
        }
        if (typeof obj === 'object' && !Array.isArray(obj)) {
            const keys = Object.keys(obj);
            for (let k = 0; k < keys.length; k++) {
                const r = findParagraphArray(obj[keys[k]], depth + 1);
                if (r)
                    return r;
            }
        }
        return null;
    }

    // export-api.ts — Server-side PDF/DOCX export via biji API
    // Extracted from background.js:515-617
    const DEBUG = false;
    function log(...args) {
        if (!DEBUG)
            return;
        console.log('[Biji Ext]', ...args);
    }
    function createExportTask(headers, noteId, type) {
        const reqHeaders = Object.assign({}, headers, { 'content-type': 'application/json' });
        return fetch(BIJI_EXPORT_API, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify({ type, note_ids: [noteId] }),
        })
            .then(resp => {
            if (!resp.ok) {
                return resp.text().then(body => {
                    throw new Error('Export API error HTTP ' + resp.status + ': ' + body.substring(0, 200));
                });
            }
            return resp.json();
        })
            .then(data => {
            log('Export create response:', JSON.stringify(data).substring(0, 500));
            if (data && data.h && data.h.c !== 0) {
                const errMsg = (data.h && data.h.e) || 'Unknown API error';
                log('Export API error:', data.h.c, errMsg);
                throw new Error('Export API error: ' + errMsg + ' (code ' + data.h.c + ')');
            }
            let taskId = null;
            if (data && data.c && data.c.id)
                taskId = data.c.id;
            else if (data && data.c && data.c.task_id)
                taskId = data.c.task_id;
            else if (data && data.data && data.data.id)
                taskId = data.data.id;
            else if (data && data.id)
                taskId = data.id;
            else if (data && data.c && typeof data.c === 'string')
                taskId = data.c;
            if (!taskId)
                throw new Error('Could not find task ID in export response');
            log('Export task created:', taskId);
            return taskId;
        });
    }
    function pollExportTask(headers, taskId) {
        const reqHeaders = Object.assign({}, headers);
        const maxAttempts = 60;
        let attempt = 0;
        function poll() {
            attempt++;
            if (attempt > maxAttempts) {
                return Promise.reject(new Error('Export task timed out after ' + maxAttempts + ' attempts'));
            }
            return fetch(BIJI_EXPORT_API + '/' + taskId, { method: 'GET', headers: reqHeaders })
                .then(resp => {
                if (!resp.ok)
                    throw new Error('Poll failed HTTP ' + resp.status);
                return resp.json();
            })
                .then(data => {
                if (data && data.h && data.h.c !== 0) {
                    const errMsg = (data.h && data.h.e) || 'Unknown API error';
                    log('Export poll API error:', data.h.c, errMsg);
                    throw new Error('Export poll error: ' + errMsg + ' (code ' + data.h.c + ')');
                }
                const c = data.c || data.data || data;
                if (c.finished || c.status === 'finished' || c.status === 'done') {
                    const accessUrl = c.access_url || c.download_url || c.url || '';
                    const filename = c.filename || c.file_name || '';
                    if (!accessUrl) {
                        log('Export poll response:', JSON.stringify(data).substring(0, 500));
                        throw new Error('Export finished but no download URL');
                    }
                    log('Export ready:', accessUrl);
                    return { access_url: accessUrl, filename };
                }
                return new Promise(resolve => { setTimeout(resolve, 1000); }).then(poll);
            });
        }
        return poll();
    }
    function exportNoteViaAPI(headers, noteId, format) {
        return createExportTask(headers, noteId, format).then(taskId => {
            return pollExportTask(headers, taskId);
        });
    }

    // message-router.ts — Route-table based message dispatcher
    // Extracted from background.js:623-801
    function toNoteMeta(note) {
        if (!note || !note.id)
            return null;
        return {
            id: String(note.id),
            title: note.title || '',
            createdAt: note.createdAt || '',
            updatedAt: note.updatedAt || '',
            type: note.type || 'text',
            noteType: note.noteType || null,
        };
    }
    const routes = {
        notes(_msg, _sender, _sendResponse, ctx) {
            ctx.storeNotes(_msg.payload.notes);
        },
        discovery(_msg, _sender, _sendResponse, ctx) {
            ctx.storeDiscoveryLog(_msg.payload);
        },
        getNotes(_msg, _sender, sendResponse) {
            chrome.storage.local.get('notes', data => {
                const notes = data.notes || {};
                const filtered = {};
                Object.keys(notes).forEach(id => {
                    if (hasValidTitle(notes[id])) filtered[id] = notes[id];
                });
                sendResponse({ notes: filtered });
            });
            return true;
        },
        getNotesMeta(_msg, _sender, sendResponse) {
            chrome.storage.local.get('notes', data => {
                const notes = data.notes || {};
                const arr = Object.values(notes)
                    .map(toNoteMeta)
                    .filter(Boolean)
                    .filter(hasValidTitle);
                sendResponse({ notes: arr });
            });
            return true;
        },
        getNotesByIds(msg, _sender, sendResponse) {
            const ids = Array.isArray(msg.ids) ? msg.ids.map((id) => String(id)) : [];
            chrome.storage.local.get('notes', data => {
                const notes = data.notes || {};
                if (ids.length === 0) {
                    sendResponse({ notes: [] });
                    return;
                }
                const selected = ids
                    .map((id) => notes[id])
                    .filter(Boolean);
                sendResponse({ notes: selected });
            });
            return true;
        },
        getDiscovery(_msg, _sender, sendResponse) {
            chrome.storage.local.get('discoveryLogs', data => {
                sendResponse({ logs: data.discoveryLogs || [] });
            });
            return true;
        },
        clearNotes(_msg, _sender, sendResponse, ctx) {
            chrome.storage.local.remove('notes', () => {
                ctx.updateBadge(0);
                sendResponse({ ok: true });
            });
            return true;
        },
        clearDiscovery(_msg, _sender, sendResponse) {
            chrome.storage.local.remove('discoveryLogs', () => {
                sendResponse({ ok: true });
            });
            return true;
        },
        storeVueNotes(_msg, _sender, _sendResponse, ctx) {
            ctx.storeNotes(_msg.notes);
        },
        apiHeaders(_msg, _sender, _sendResponse, ctx) {
            ctx.setHeaders(_msg.payload.headers);
        },
        fetchTranscript(msg, _sender, sendResponse, ctx) {
            const headers = ctx.getHeaders();
            if (!headers) {
                sendResponse({ noteId: msg.noteId, transcript: null });
                return true;
            }
            fetchNoteTranscript(headers, msg.noteId, msg.noteType).then(transcript => {
                sendResponse({ noteId: msg.noteId, transcript });
            });
            return true;
        },
        fetchContent(msg, _sender, sendResponse, ctx) {
            const headers = ctx.getHeaders();
            if (!headers) {
                sendResponse({ noteId: msg.noteId, content: null });
                return true;
            }
            fetchNoteContent(headers, msg.noteId, msg.noteType).then(content => {
                sendResponse({ noteId: msg.noteId, content });
            });
            return true;
        },
        exportNote(msg, _sender, sendResponse, ctx) {
            const headers = ctx.getHeaders();
            if (!headers) {
                sendResponse({ error: 'No API headers captured. Browse biji.com first.' });
                return true;
            }
            exportNoteViaAPI(headers, msg.noteId, msg.format)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ error: err.message }));
            return true;
        },
        fetchAll(msg, _sender, _sendResponse, ctx) {
            const headers = ctx.getHeaders();
            if (!headers)
                return;
            const onStatus = (status, fetched, done) => {
                chrome.runtime.sendMessage({
                    type: 'fetchStatus',
                    payload: { status, fetched, done },
                }).catch(() => { });
            };
            fetchAllNotes(headers, msg.fetchDelay || 500, onStatus, notes => ctx.storeNotes(notes));
        },
        cancelFetch() {
            cancelFetch();
        },
        submitLink(msg, _sender, sendResponse, ctx) {
            const headers = ctx.getHeaders();
            if (!headers) {
                sendResponse({ ok: false, error: '未捕获到认证信息' });
                return true;
            }
            submitLink(msg.url, msg.title, headers)
                .then(result => {
                const noteId = result && result.noteId;
                if (noteId && msg.tags && msg.tags.length > 0) {
                    storePendingTags(noteId, msg.tags);
                }
                sendResponse({ ok: true, data: result });
            })
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        },
        isLinkSubmitted(msg, _sender, sendResponse) {
            isAlreadySubmitted(msg.url).then(submitted => {
                sendResponse({ submitted });
            });
            return true;
        },
        getSubmissionHistory(msg, _sender, sendResponse) {
            getSubmissionHistory(msg.limit).then(history => {
                sendResponse({ history });
            });
            return true;
        },
        getFeeds(_msg, _sender, sendResponse) {
            getFeeds().then(feeds => sendResponse({ feeds }));
            return true;
        },
        addFeed(msg, _sender, sendResponse) {
            ensureHostPermission(msg.url)
                .then(() => addFeed(msg.url, msg.name))
                .then(feed => sendResponse({ ok: true, feed }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        },
        removeFeed(msg, _sender, sendResponse) {
            removeFeed(msg.feedId).then(() => sendResponse({ ok: true }));
            return true;
        },
        toggleFeed(msg, _sender, sendResponse) {
            toggleFeed(msg.feedId).then(feed => sendResponse({ ok: true, feed }));
            return true;
        },
        checkFeedsNow(_msg, _sender, sendResponse, ctx) {
            const headers = ctx.getHeaders();
            if (!headers) {
                sendResponse({ ok: false, error: '未捕获到认证信息' });
                return true;
            }
            checkAllFeeds(headers)
                .then(result => sendResponse({ ok: true, result }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        },
        getFeedItems(msg, _sender, sendResponse) {
            getFeedItems(msg.filter).then(items => sendResponse({ items }));
            return true;
        },
        submitFeedItems(msg, _sender, sendResponse, ctx) {
            const headers = ctx.getHeaders();
            if (!headers) {
                sendResponse({ ok: false, error: '未捕获到认证信息' });
                return true;
            }
            submitFeedItems(msg.guids, headers)
                .then(results => sendResponse({ ok: true, results }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        },
        refreshAllFeedItems(_msg, _sender, sendResponse) {
            refreshAllFeedItems()
                .then(result => sendResponse({ ok: true, result }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        },
        refreshFeedItems(msg, _sender, sendResponse) {
            refreshFeedItems(msg.feedId)
                .then(result => sendResponse({ ok: true, result }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        },
        editFeed(msg, _sender, sendResponse) {
            editFeed(msg.feedId, msg.updates)
                .then(feed => sendResponse({ ok: true, feed }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        },
        importFeedsOpml(msg, _sender, sendResponse) {
            try {
                const parsed = parseOpml(msg.opmlText);
                const uniqueOrigins = [...new Set(parsed.map(p => {
                        try {
                            return new URL(p.url).origin + '/*';
                        }
                        catch {
                            return null;
                        }
                    }).filter(Boolean))];
                const requestPermissions = uniqueOrigins.length > 0
                    ? new Promise((resolve, reject) => {
                        chrome.permissions.request({ origins: uniqueOrigins }, (granted) => {
                            if (granted)
                                resolve();
                            else
                                reject(new Error('用户拒绝了访问权限'));
                        });
                    })
                    : Promise.resolve();
                requestPermissions
                    .then(() => importFeedsOpml(msg.opmlText))
                    .then(result => sendResponse({ ok: true, result }))
                    .catch(err => sendResponse({ ok: false, error: err.message }));
            }
            catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
            return true;
        },
        convertYoutubeUrl(msg, _sender, sendResponse) {
            ensureHostPermission(msg.url)
                .then(() => convertYoutubeUrl(msg.url))
                .then(rssUrl => sendResponse({ ok: true, rssUrl }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        },
        getPendingTags(_msg, _sender, sendResponse) {
            getPendingTags().then(tags => sendResponse({ tags }));
            return true;
        },
    };
    function createMessageListener(ctx) {
        return (msg, sender, sendResponse) => {
            const handler = routes[msg.type];
            if (handler)
                return handler(msg, sender, sendResponse, ctx);
        };
    }

    // background/index.ts — Main entry point for the service worker
    // Replaces src/background.js
    // --- Header filtering ---
    const ALLOWED_HEADER_KEYS = [
        'authorization',
        'x-auth-token',
        'cookie',
        'x-csrf-token',
        'x-request-id',
        'x-access-token',
        'token',
    ];
    function filterHeaders(h) {
        const filtered = {};
        for (const key of Object.keys(h)) {
            if (ALLOWED_HEADER_KEYS.includes(key.toLowerCase())) {
                filtered[key] = h[key];
            }
        }
        return filtered;
    }
    // --- Shared state ---
    let capturedApiHeaders = null;
    // Restore cached headers from storage on SW startup
    chrome.storage.local.get('apiHeaders', data => {
        if (data.apiHeaders) {
            capturedApiHeaders = data.apiHeaders;
        }
    });
    // --- Helper functions ---
    function hasValidTitle(n) {
        return typeof n.title === 'string' && n.title.trim() !== '';
    }
    function storeNotes(newNotes) {
        if (!newNotes || !newNotes.length)
            return;
        newNotes = newNotes.filter(hasValidTitle);
        if (!newNotes.length)
            return;
        chrome.storage.local.get('notes', data => {
            const notes = data.notes || {};
            newNotes.forEach(n => {
                if (!n.id)
                    return;
                const existing = notes[n.id] || {};
                notes[n.id] = Object.assign({}, existing, n);
            });
            chrome.storage.local.set({ notes }, () => {
                const count = Object.keys(notes).length;
                updateBadge(count);
                chrome.runtime.sendMessage({ type: 'notesUpdated', count }).catch(() => { });
            });
        });
    }
    function storeDiscoveryLog(entry) {
        chrome.storage.local.get('discoveryLogs', data => {
            let logs = data.discoveryLogs || [];
            logs.unshift({
                url: entry.url,
                preview: entry.preview,
                time: new Date().toISOString(),
            });
            if (logs.length > 100)
                logs = logs.slice(0, 100);
            chrome.storage.local.set({ discoveryLogs: logs });
        });
    }
    function updateBadge(count) {
        const text = count > 0 ? String(count) : '';
        chrome.action.setBadgeText({ text });
        chrome.action.setBadgeBackgroundColor({ color: '#6C5CE7' });
    }
    // --- Build RouterContext ---
    const ctx = {
        getHeaders() {
            return capturedApiHeaders;
        },
        setHeaders(h) {
            capturedApiHeaders = filterHeaders(h);
            chrome.storage.local.set({ apiHeaders: capturedApiHeaders });
        },
        storeNotes,
        storeDiscoveryLog,
        updateBadge,
    };
    // --- Register listeners ---
    chrome.runtime.onMessage.addListener(createMessageListener(ctx));
    chrome.runtime.onInstalled.addListener((details) => {
        if (!details || details.reason !== 'install')
            return;
        const url = chrome.runtime.getURL('welcome.html');
        if (chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url }, () => {
                // Ignore "No tab with id" class errors in edge cases.
                void chrome.runtime.lastError;
            });
        }
    });
    // Feed alarm handler
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === ALARM_NAME) {
            if (capturedApiHeaders) {
                checkAllFeeds(capturedApiHeaders).catch(err => {
                    console.warn('[Biji Ext] Scheduled feed check failed:', err.message);
                });
            }
        }
    });
    // Keep feed alarm in sync when settings are updated from options page.
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local')
            return;
        if (!changes.settings)
            return;
        setupAlarm();
    });
    // Initialize badge on startup & clean up untitled notes
    chrome.storage.local.get('notes', data => {
        const notes = data.notes || {};
        let dirty = false;
        Object.keys(notes).forEach(id => {
            if (!hasValidTitle(notes[id])) {
                delete notes[id];
                dirty = true;
            }
        });
        if (dirty) {
            chrome.storage.local.set({ notes }, () => {
                updateBadge(Object.keys(notes).length);
            });
        } else {
            updateBadge(Object.keys(notes).length);
        }
    });

})();
