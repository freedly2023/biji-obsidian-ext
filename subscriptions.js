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

    // subscription-shared.ts — Shared UI utilities for subscription pages
    // Provides feed item card rendering, type/status badges, and formatting
    // --- Type badge rendering ---
    const TYPE_COLORS = {
        youtube: { bg: '#ff0000', text: '#fff' },
        podcast: { bg: '#8e44ad', text: '#fff' },
        bilibili: { bg: '#00a1d6', text: '#fff' },
        other: { bg: '#95a5a6', text: '#fff' },
    };
    const TYPE_LABELS = {
        youtube: 'YouTube',
        podcast: '播客',
        bilibili: 'B站',
        other: '其他',
    };
    function typeBadgeHtml(type) {
        const c = TYPE_COLORS[type] || TYPE_COLORS.other;
        const label = TYPE_LABELS[type] || type || '其他';
        return ('<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;' +
            'font-weight:600;background:' + c.bg + ';color:' + c.text + '">' +
            escapeHtmlAttr(label) + '</span>');
    }
    // --- Status badge ---
    const STATUS_STYLES = {
        'new': { bg: '#e8f5e9', text: '#2e7d32', label: '未提交' },
        submitted: { bg: '#e3f2fd', text: '#1565c0', label: '已提交' },
        noted: { bg: '#f3e5f5', text: '#7b1fa2', label: '已记录' },
        submitting: { bg: '#fff3e0', text: '#e65100', label: '正在提交' },
    };
    function statusBadgeHtml(status) {
        const s = STATUS_STYLES[status] || STATUS_STYLES['new'];
        return ('<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;' +
            'background:' + s.bg + ';color:' + s.text + '">' + s.label + '</span>');
    }
    // --- Format duration ---
    function formatDuration(dur) {
        if (!dur)
            return '';
        const str = String(dur).trim();
        const isoMatch = str.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
        if (isoMatch) {
            const h = parseInt(isoMatch[1] || '0', 10);
            const m = parseInt(isoMatch[2] || '0', 10);
            const totalMin = h * 60 + m;
            if (totalMin > 0)
                return totalMin + '分钟';
            const s = parseInt(isoMatch[3] || '0', 10);
            if (s > 0)
                return s + '秒';
            return '';
        }
        const timeMatch = str.match(/^(\d+):(\d{2}):(\d{2})$/);
        if (timeMatch) {
            const totalMin2 = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
            return totalMin2 + '分钟';
        }
        const shortMatch = str.match(/^(\d+):(\d{2})$/);
        if (shortMatch) {
            return parseInt(shortMatch[1], 10) + '分钟';
        }
        const num = parseInt(str, 10);
        if (!isNaN(num) && num > 0) {
            return Math.round(num / 60) + '分钟';
        }
        return str;
    }
    function feedItemCardHtml(item, opts) {
        opts = opts || {};
        const checked = opts.checked ? ' checked' : '';
        const showCheckbox = opts.showCheckbox !== false;
        const thumbSize = opts.thumbSize || 72;
        const thumb = item.thumbnail
            ? '<img src="' + escapeHtmlAttr(item.thumbnail) + '" ' +
                'style="width:' + thumbSize + 'px;height:' + thumbSize + 'px;object-fit:cover;border-radius:8px;flex-shrink:0" ' +
                'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                '<div style="width:' + thumbSize + 'px;height:' + thumbSize + 'px;background:#f0f0f0;border-radius:8px;flex-shrink:0;' +
                'display:none;align-items:center;justify-content:center;color:#ccc;font-size:20px">&#9654;</div>'
            : '<div style="width:' + thumbSize + 'px;height:' + thumbSize + 'px;background:#f0f0f0;border-radius:8px;flex-shrink:0;' +
                'display:flex;align-items:center;justify-content:center;color:#ccc;font-size:20px">&#9654;</div>';
        const duration = formatDuration(item.duration);
        const relDate = formatRelativeDate(item.pubDate);
        const metaParts = [];
        if (duration)
            metaParts.push(duration);
        if (relDate)
            metaParts.push(relDate);
        const metaText = metaParts.join(' · ');
        let html = '<div class="feed-item-card" data-guid="' + escapeHtmlAttr(item.guid) + '" ' +
            'style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid #f0f0f0">';
        if (showCheckbox) {
            html += '<input type="checkbox" class="feed-item-check" data-guid="' +
                escapeHtmlAttr(item.guid) + '"' + checked +
                ' style="flex-shrink:0;accent-color:#6c5ce7;cursor:pointer;margin-top:' + Math.round(thumbSize / 2 - 7) + 'px">';
        }
        html += thumb;
        html += '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">';
        html += '<a href="' + escapeHtmlAttr(item.url) + '" target="_blank" ' +
            'style="color:#333;text-decoration:none;font-size:14px;font-weight:500;' +
            'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4" ' +
            'title="' + escapeHtmlAttr(item.title) + '">' +
            escapeHtmlAttr(item.title || '无标题') + '</a>';
        if (item.description) {
            html += '<div style="color:#999;font-size:12px;line-height:1.4;' +
                'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' +
                escapeHtmlAttr(item.description) + '</div>';
        }
        html += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#bbb;margin-top:2px">';
        if (metaText) {
            html += '<span>' + escapeHtmlAttr(metaText) + '</span>';
        }
        html += statusBadgeHtml(item.status);
        if (item.status === 'submitted' && item.noteId) {
            html += '<a href="https://www.biji.com/note/' + escapeHtmlAttr(item.noteId) + '" target="_blank" ' +
                'style="font-size:11px;color:#6c5ce7;text-decoration:none;font-weight:500">AI总结</a>';
            html += '<a href="https://www.biji.com/note/' + escapeHtmlAttr(item.noteId) + '/web" target="_blank" ' +
                'style="font-size:11px;color:#6c5ce7;text-decoration:none;font-weight:500">原文</a>';
        }
        html += '</div>';
        html += '</div></div>';
        return html;
    }

    // subscriptions.ts — Standalone subscription management page logic
    // Converted from subscriptions.js — window.* globals replaced with imports
    // --- DOM refs ---
    const channelStripEl = document.getElementById('channelStrip');
    const managePanelEl = document.getElementById('managePanel');
    const feedListEl = document.getElementById('feedList');
    const feedUrlEl = document.getElementById('feedUrl');
    const feedNameEl = document.getElementById('feedName');
    const btnAddFeed = document.getElementById('btnAddFeed');
    const feedAddStatus = document.getElementById('feedAddStatus');
    const opmlFile = document.getElementById('opmlFile');
    const btnImportOpml = document.getElementById('btnImportOpml');
    const opmlStatus = document.getElementById('opmlStatus');
    const searchInput = document.getElementById('searchInput');
    const filterType = document.getElementById('filterType');
    const filterStatus = document.getElementById('filterStatus');
    const filterDate = document.getElementById('filterDate');
    const sortOrder = document.getElementById('sortOrder');
    const btnRefreshAll = document.getElementById('btnRefreshAll');
    const batchBar = document.getElementById('batchBar');
    const pageSelectAll = document.getElementById('pageSelectAll');
    const pageSelCount = document.getElementById('pageSelCount');
    const btnBatchSubmit = document.getElementById('btnBatchSubmit');
    const contentList = document.getElementById('contentList');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');
    const pageInfo = document.getElementById('pageInfo');
    // --- State ---
    let allItems = [];
    let filteredItems = [];
    let selectedGuids = {};
    let currentPage = 1;
    const pageSize = 50;
    let feeds = [];
    let activeChannelId = '';
    let managePanelOpen = false;
    // --- Feed list management ---
    function loadFeeds() {
        chrome.runtime.sendMessage({ type: 'getFeeds' }, function (res) {
            if (chrome.runtime.lastError)
                return;
            feeds = (res && res.feeds) || [];
            renderFeedList();
            renderChannelStrip();
        });
    }
    // --- Channel strip ---
    function renderChannelStrip() {
        if (!channelStripEl)
            return;
        let html = '';
        const allActive = activeChannelId === '' ? ' active' : '';
        html += '<div class="channel-item' + allActive + '" data-channel-id="">' +
            '<div class="ch-fallback">全</div>' +
            '<span class="ch-label">全部</span></div>';
        feeds.forEach(function (f) {
            const isActive = activeChannelId === f.id ? ' active' : '';
            let avatarHtml;
            if (f.thumbnail) {
                avatarHtml = '<img class="ch-avatar" src="' + escapeHtmlAttr(f.thumbnail) + '" ' +
                    'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                    '<div class="ch-fallback" style="display:none">' +
                    escapeHtmlAttr((f.channelName || f.name || '?').charAt(0)) + '</div>';
            }
            else {
                avatarHtml = '<div class="ch-fallback">' +
                    escapeHtmlAttr((f.channelName || f.name || '?').charAt(0)) + '</div>';
            }
            const label = f.channelName || f.name || f.url;
            html += '<div class="channel-item' + isActive + '" data-channel-id="' + escapeHtmlAttr(f.id) + '">' +
                avatarHtml +
                '<span class="ch-label" title="' + escapeHtmlAttr(label) + '">' + escapeHtmlAttr(label) + '</span></div>';
        });
        const manageActive = managePanelOpen ? ' active' : '';
        html += '<div class="channel-item manage-btn' + manageActive + '" data-channel-action="manage">' +
            '<div class="ch-fallback">&#9881;</div>' +
            '<span class="ch-label">管理</span></div>';
        channelStripEl.innerHTML = html;
        channelStripEl.querySelectorAll('.channel-item').forEach(function (el) {
            el.addEventListener('click', function () {
                const action = this.getAttribute('data-channel-action');
                if (action === 'manage') {
                    managePanelOpen = !managePanelOpen;
                    if (managePanelEl)
                        managePanelEl.classList.toggle('open', managePanelOpen);
                    renderChannelStrip();
                    return;
                }
                const chId = this.getAttribute('data-channel-id');
                activeChannelId = chId || '';
                currentPage = 1;
                applyFilters();
                renderChannelStrip();
            });
        });
    }
    function renderFeedList() {
        if (!feedListEl)
            return;
        if (feeds.length === 0) {
            feedListEl.innerHTML = '<div style="color:#999;font-size:13px;padding:8px 0">暂无订阅源</div>';
            return;
        }
        feedListEl.innerHTML = feeds.map(function (f) {
            const badge = typeBadgeHtml(f.type);
            const checked = f.enabled ? ' checked' : '';
            const errorHtml = f.lastError
                ? '<span class="feed-error" title="' + escapeHtmlAttr(f.lastError) + '">&#9888; ' + escapeHtmlAttr(f.lastError) + '</span>'
                : '<span class="feed-url">' + escapeHtmlAttr(f.url) + '</span>';
            return '<div class="feed-row">' +
                '<label class="toggle-switch">' +
                '<input type="checkbox" data-feed-toggle="' + escapeHtmlAttr(f.id) + '"' + checked + '>' +
                '<span class="toggle-slider"></span></label>' +
                badge +
                '<span class="feed-name" title="' + escapeHtmlAttr(f.url) + '">' + escapeHtmlAttr(f.channelName || f.name) + '</span>' +
                errorHtml +
                '<button class="btn-sm danger" data-feed-delete="' + escapeHtmlAttr(f.id) + '">删除</button>' +
                '</div>';
        }).join('');
        feedListEl.querySelectorAll('[data-feed-toggle]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                chrome.runtime.sendMessage({ type: 'toggleFeed', feedId: this.getAttribute('data-feed-toggle') }, function () { });
            });
        });
        feedListEl.querySelectorAll('[data-feed-delete]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (!confirm('确定删除此订阅源？'))
                    return;
                chrome.runtime.sendMessage({ type: 'removeFeed', feedId: this.getAttribute('data-feed-delete') }, function () {
                    loadFeeds();
                    loadItems();
                });
            });
        });
    }
    // --- Add feed ---
    if (btnAddFeed) {
        btnAddFeed.addEventListener('click', function () {
            const url = feedUrlEl.value.trim();
            const name = feedNameEl.value.trim();
            if (!url) {
                if (feedAddStatus)
                    feedAddStatus.textContent = '请输入 URL';
                return;
            }
            btnAddFeed.disabled = true;
            if (feedAddStatus)
                feedAddStatus.textContent = '添加中...';
            const isYoutube = /youtube\.com\/(channel\/|@)/.test(url);
            let addPromise;
            if (isYoutube && !/feeds\/videos\.xml/.test(url)) {
                addPromise = new Promise(function (resolve, reject) {
                    chrome.runtime.sendMessage({ type: 'convertYoutubeUrl', url }, function (res) {
                        if (res && res.ok)
                            resolve(res);
                        else
                            reject(new Error((res && res.error) || '转换失败'));
                    });
                }).then(function (result) {
                    return new Promise(function (resolve, reject) {
                        chrome.runtime.sendMessage({ type: 'addFeed', url: result.rssUrl, name, thumbnail: result.avatar }, function (res) {
                            if (res && res.ok)
                                resolve(res.feed);
                            else
                                reject(new Error((res && res.error) || '添加失败'));
                        });
                    });
                });
            }
            else {
                addPromise = new Promise(function (resolve, reject) {
                    chrome.runtime.sendMessage({ type: 'addFeed', url, name }, function (res) {
                        if (res && res.ok)
                            resolve(res.feed);
                        else
                            reject(new Error((res && res.error) || '添加失败'));
                    });
                });
            }
            addPromise.then(function () {
                if (feedAddStatus)
                    feedAddStatus.textContent = '添加成功，正在获取内容...';
                feedUrlEl.value = '';
                feedNameEl.value = '';
                loadFeeds();
                pollForNewItems(feedAddStatus);
            }).catch(function (err) {
                if (feedAddStatus)
                    feedAddStatus.textContent = '错误: ' + err.message;
                setTimeout(function () { if (feedAddStatus)
                    feedAddStatus.textContent = ''; }, 3000);
            }).then(function () {
                btnAddFeed.disabled = false;
            });
        });
    }
    // --- Poll for new items ---
    function pollForNewItems(statusEl) {
        let attempts = 0;
        const maxAttempts = 7;
        const prevCount = allItems.length;
        function check() {
            attempts++;
            chrome.runtime.sendMessage({ type: 'getFeedItems', filter: {} }, function (res) {
                if (chrome.runtime.lastError)
                    return;
                const items = (res && res.items) || [];
                if (items.length > prevCount || attempts >= maxAttempts) {
                    allItems = items;
                    applyFilters();
                    loadFeeds();
                    if (statusEl)
                        statusEl.textContent = items.length > prevCount
                            ? '获取到 ' + (items.length - prevCount) + ' 条新内容'
                            : '';
                    setTimeout(function () { if (statusEl)
                        statusEl.textContent = ''; }, 2000);
                    return;
                }
                if (statusEl)
                    statusEl.textContent = '正在获取内容...';
                setTimeout(check, 2000);
            });
        }
        setTimeout(check, 2000);
    }
    // --- OPML import ---
    if (btnImportOpml) {
        btnImportOpml.addEventListener('click', function () {
            if (!opmlFile || !opmlFile.files || !opmlFile.files[0]) {
                if (opmlStatus)
                    opmlStatus.textContent = '请选择 OPML 文件';
                return;
            }
            btnImportOpml.disabled = true;
            if (opmlStatus)
                opmlStatus.textContent = '导入中...';
            const reader = new FileReader();
            reader.onload = function (e) {
                chrome.runtime.sendMessage({ type: 'importFeedsOpml', opmlText: e.target.result }, function (res) {
                    btnImportOpml.disabled = false;
                    if (res && res.ok) {
                        if (opmlStatus)
                            opmlStatus.textContent = '导入完成：新增 ' + res.result.added + ' / 共 ' + res.result.total + ' 条';
                        opmlFile.value = '';
                        loadFeeds();
                        pollForNewItems(opmlStatus);
                    }
                    else {
                        if (opmlStatus)
                            opmlStatus.textContent = '导入失败: ' + ((res && res.error) || '未知错误');
                    }
                    setTimeout(function () { if (opmlStatus)
                        opmlStatus.textContent = ''; }, 4000);
                });
            };
            reader.onerror = function () {
                btnImportOpml.disabled = false;
                if (opmlStatus)
                    opmlStatus.textContent = '文件读取失败';
            };
            reader.readAsText(opmlFile.files[0]);
        });
    }
    // --- Toast notification ---
    function showToast(message) {
        var existing = document.getElementById('biji-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = 'biji-toast';
        toast.textContent = message;
        toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
            'background:#e74c3c;color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;' +
            'z-index:99999;box-shadow:0 2px 12px rgba(0,0,0,0.2);transition:opacity 0.3s';
        document.body.appendChild(toast);
        setTimeout(function () {
            toast.style.opacity = '0';
            setTimeout(function () { toast.remove(); }, 300);
        }, 3000);
    }
    // --- Load feed items ---
    function loadItems() {
        chrome.runtime.sendMessage({ type: 'getFeedItems', filter: {} }, function (res) {
            if (chrome.runtime.lastError)
                return;
            allItems = (res && res.items) || [];
            applyFilters();
        });
    }
    function applyFilters() {
        const search = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const type = filterType ? filterType.value : '';
        const status = filterStatus ? filterStatus.value : '';
        const dateDays = filterDate ? filterDate.value : '';
        let dateCutoff = 0;
        if (dateDays)
            dateCutoff = Date.now() - parseInt(dateDays, 10) * 86400000;
        filteredItems = allItems.filter(function (item) {
            if (search && (item.title || '').toLowerCase().indexOf(search) === -1)
                return false;
            if (activeChannelId && item.feedId !== activeChannelId)
                return false;
            if (type) {
                const feedType = item.tags && item.tags[0] ? item.tags[0] : '';
                if (feedType !== type)
                    return false;
            }
            if (status && item.status !== status)
                return false;
            if (dateCutoff) {
                const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : 0;
                if (pubTime < dateCutoff)
                    return false;
            }
            return true;
        });
        var sort = sortOrder ? sortOrder.value : 'pubDate';
        if (sort === 'submittedAt') {
            filteredItems.sort(function (a, b) {
                if (!a.submittedAt && !b.submittedAt) return 0;
                if (!a.submittedAt) return 1;
                if (!b.submittedAt) return -1;
                return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
            });
        } else {
            filteredItems.sort(function (a, b) {
                var ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
                var tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
                return tb - ta;
            });
        }
        currentPage = 1;
        renderPage();
    }
    function renderPage() {
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        const pageItems = filteredItems.slice(start, end);
        const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
        if (pageItems.length === 0) {
            contentList.innerHTML = '<div class="empty-state">' +
                '暂无内容' + (allItems.length === 0 ? '，点击"刷新"获取' : '') + '</div>';
        }
        else {
            let html = '';
            pageItems.forEach(function (item) {
                html += feedItemCardHtml(item, {
                    checked: !!selectedGuids[item.guid],
                    showCheckbox: true,
                    thumbSize: 72,
                });
            });
            contentList.innerHTML = html;
        }
        contentList.querySelectorAll('.feed-item-check').forEach(function (cb) {
            cb.addEventListener('change', function () {
                const guid = this.getAttribute('data-guid');
                if (this.checked)
                    selectedGuids[guid] = true;
                else
                    delete selectedGuids[guid];
                updateSelectionUI();
            });
        });
        if (btnPrev)
            btnPrev.disabled = currentPage <= 1;
        if (btnNext)
            btnNext.disabled = currentPage >= totalPages;
        if (pageInfo)
            pageInfo.textContent = '第 ' + currentPage + ' / ' + totalPages + ' 页 (共 ' + filteredItems.length + ' 条)';
        updateSelectionUI();
    }
    function updateSelectionUI() {
        const count = Object.keys(selectedGuids).length;
        if (pageSelCount)
            pageSelCount.textContent = '已选 ' + count + ' 条';
        if (btnBatchSubmit)
            btnBatchSubmit.disabled = count === 0;
        if (batchBar)
            batchBar.classList.toggle('visible', count > 0);
    }
    function debounce(fn, delay) {
        let timer;
        return function () { clearTimeout(timer); timer = setTimeout(fn, delay); };
    }
    // --- Event bindings ---
    if (searchInput)
        searchInput.addEventListener('input', debounce(applyFilters, 300));
    if (filterType)
        filterType.addEventListener('change', applyFilters);
    if (filterStatus)
        filterStatus.addEventListener('change', applyFilters);
    if (filterDate)
        filterDate.addEventListener('change', applyFilters);
    if (sortOrder)
        sortOrder.addEventListener('change', applyFilters);
    if (btnPrev)
        btnPrev.addEventListener('click', function () {
            if (currentPage > 1) {
                currentPage--;
                renderPage();
            }
        });
    if (btnNext)
        btnNext.addEventListener('click', function () {
            const totalPages = Math.ceil(filteredItems.length / pageSize);
            if (currentPage < totalPages) {
                currentPage++;
                renderPage();
            }
        });
    if (pageSelectAll) {
        pageSelectAll.addEventListener('change', function () {
            const checked = this.checked;
            const start = (currentPage - 1) * pageSize;
            const end = start + pageSize;
            const pageItems = filteredItems.slice(start, end);
            if (checked) {
                pageItems.forEach(function (item) { selectedGuids[item.guid] = true; });
            }
            else {
                pageItems.forEach(function (item) { delete selectedGuids[item.guid]; });
            }
            contentList.querySelectorAll('.feed-item-check').forEach(function (cb) {
                cb.checked = checked;
            });
            updateSelectionUI();
        });
    }
    if (btnRefreshAll) {
        btnRefreshAll.addEventListener('click', function () {
            btnRefreshAll.disabled = true;
            btnRefreshAll.textContent = '刷新中...';
            chrome.runtime.sendMessage({ type: 'refreshAllFeedItems' }, function (res) {
                btnRefreshAll.disabled = false;
                btnRefreshAll.textContent = '刷新';
                if (res && res.ok) {
                    let msg = '+' + (res.result.newItems || 0);
                    if (res.result.corrected > 0) {
                        msg += ' 校正' + res.result.corrected + '条';
                    }
                    btnRefreshAll.textContent = '刷新 (' + msg + ')';
                    setTimeout(function () { btnRefreshAll.textContent = '刷新'; }, 2000);
                }
                loadItems();
                loadFeeds();
            });
        });
    }
    if (btnBatchSubmit) {
        btnBatchSubmit.addEventListener('click', function () {
            const guids = Object.keys(selectedGuids);
            if (guids.length === 0)
                return;
            btnBatchSubmit.disabled = true;
            btnBatchSubmit.textContent = '检查登录状态...';
            chrome.runtime.sendMessage({ type: 'checkAuth' }, function (authResp) {
                if (!authResp || !authResp.authenticated) {
                    showToast('请先登录 biji.com 后再提交');
                    btnBatchSubmit.textContent = '提交选中';
                    btnBatchSubmit.disabled = false;
                    return;
                }
                btnBatchSubmit.textContent = '正在提交中...';
                // Immediately mark selected items as 'submitting' in local state
                const guidSet = {};
                guids.forEach(function (g) { guidSet[g] = true; });
                allItems.forEach(function (item) {
                    if (guidSet[item.guid]) {
                        item.status = 'submitting';
                    }
                });
                // Clear selection before re-render so badge change is visible
                selectedGuids = {};
                renderPage();
                // Wait for background to finish processing, then reload
                chrome.runtime.sendMessage({ type: 'submitFeedItems', guids }, function (resp) {
                    btnBatchSubmit.textContent = '提交选中';
                    btnBatchSubmit.disabled = false;
                    if (resp && !resp.ok) {
                        showToast('提交失败: ' + (resp.error || '未知错误'));
                    }
                    loadItems();
                });
            });
        });
    }
    // --- Init ---
    loadFeeds();
    try {
        chrome.runtime.sendMessage({ type: 'syncFeedItemStatuses' }, function () {
            void chrome.runtime.lastError;
            loadItems();
        });
    } catch (_) {
        loadItems();
    }

})();
