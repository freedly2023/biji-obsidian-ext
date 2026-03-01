(function () {
    'use strict';

    // Platform-specific config for button injection
    const PLATFORMS = {
        youtube: {
            host: 'www.youtube.com',
            platformType: 'youtube',
            titleSelectors: [
                'ytd-watch-metadata #title',
                '#above-the-fold #title',
                'ytd-video-primary-info-renderer #title',
                '#info-contents #title',
            ],
            getPageUrl: () => location.href,
            getPageTitle: () => {
                const el = document.querySelector('ytd-watch-metadata h1 yt-formatted-string, ' +
                    '#above-the-fold h1 yt-formatted-string, ' +
                    'ytd-video-primary-info-renderer h1 yt-formatted-string');
                return el ? el.textContent.trim() : document.title;
            },
            getChannelName: () => {
                const el = document.querySelector('#owner #channel-name a, ytd-channel-name a');
                return el ? el.textContent.trim() : '';
            },
            inlineBtn: true,
        },
        bilibili: {
            host: 'www.bilibili.com',
            platformType: 'bilibili',
            titleSelectors: [
                '#viewbox_report .video-title',
                '.video-title',
                '.media-title',
            ],
            getPageUrl: () => location.href,
            getPageTitle: () => {
                const el = document.querySelector('#viewbox_report .video-title, .video-title, .media-title');
                return el ? el.textContent.trim() : document.title;
            },
            getChannelName: () => {
                const el = document.querySelector('.up-name, #v_upinfo .name a');
                return el ? el.textContent.trim() : '';
            },
        },
        xiaoyuzhouEpisode: {
            host: 'www.xiaoyuzhoufm.com',
            pathPrefix: '/episode/',
            platformType: 'podcast',
            titleSelectors: ['h1'],
            inlineBtn: true,
            getPageUrl: () => location.href,
            getPageTitle: () => {
                const el = document.querySelector('h1');
                return el ? el.textContent.trim() : document.title;
            },
            getChannelName: () => {
                const el = document.querySelector('a[href*="/podcast/"]');
                return el ? el.textContent.trim() : '';
            },
        },
        xiaoyuzhouList: {
            host: 'www.xiaoyuzhoufm.com',
            pathPrefix: '/podcast/',
            platformType: 'podcast',
            listMode: true,
            getChannelName: () => {
                const el = document.querySelector('h1');
                return el ? el.textContent.trim() : '';
            },
        },
    };
    function detectPlatform() {
        const host = location.hostname;
        const path = location.pathname;
        for (const key in PLATFORMS) {
            const p = PLATFORMS[key];
            if (host !== p.host)
                continue;
            if (p.pathPrefix && !path.startsWith(p.pathPrefix))
                continue;
            return p;
        }
        return null;
    }

    // content-inject-btn — Injects "Get笔记" button on YouTube, Bilibili, Xiaoyuzhou
    const BTN_ID = 'biji-ext-get-note-btn';
    const WRAP_ID = 'biji-ext-btn-wrap';
    const LIST_BTN_CLASS = 'biji-ext-list-btn';
    const CHECK_INTERVAL = 2000;
    let lastUrl = location.href;
    function findTitleElement(platform) {
        for (let i = 0; i < platform.titleSelectors.length; i++) {
            const el = document.querySelector(platform.titleSelectors[i]);
            if (el)
                return el;
        }
        return null;
    }
    function removeExistingBtn() {
        const existing = document.getElementById(WRAP_ID);
        if (existing)
            existing.remove();
    }

    // --- Single-page button injection (YouTube, Bilibili, Xiaoyuzhou episode) ---
    function injectButton(platform) {
        chrome.storage.local.get('settings', data => {
            if (chrome.runtime.lastError)
                return;
            const s = data.settings || {};
            if (s.enableInjectBtn === false)
                return;
            const host = platform.host;
            if (host === 'www.youtube.com' && s.injectBtnYoutube === false)
                return;
            if (host === 'www.bilibili.com' && s.injectBtnBilibili === false)
                return;
            if (host === 'www.xiaoyuzhoufm.com' && s.injectBtnXiaoyuzhou === false)
                return;
            removeExistingBtn();
            const titleEl = findTitleElement(platform);
            if (!titleEl)
                return;
            const pageUrl = platform.getPageUrl();
            const wrap = document.createElement('span');
            wrap.id = WRAP_ID;
            wrap.className = 'biji-ext-btn-wrap';
            const btn = document.createElement('button');
            btn.id = BTN_ID;
            btn.className = 'biji-ext-btn';
            btn.textContent = 'Get笔记';
            wrap.appendChild(btn);
            // YouTube: inline with title, not on new line
            if (platform.inlineBtn) {
                wrap.classList.add('biji-ext-btn-wrap-inline');
                const h1 = titleEl.querySelector('h1') || titleEl;
                h1.appendChild(wrap);
            }
            else {
                titleEl.parentNode.insertBefore(wrap, titleEl.nextSibling);
            }
            // Check if already submitted
            chrome.runtime.sendMessage({ type: 'isLinkSubmitted', url: pageUrl }, resp => {
                if (chrome.runtime.lastError)
                    return;
                if (resp && resp.submitted) {
                    btn.textContent = '已提交 \u2713';
                    btn.classList.add('biji-ext-submitted');
                } else {
                    // Check auth status for unsubmitted links
                    chrome.runtime.sendMessage({ type: 'checkAuth' }, authResp => {
                        if (chrome.runtime.lastError) return;
                        if (!authResp || !authResp.authenticated) {
                            btn.textContent = '请先登录biji';
                            btn.classList.add('biji-ext-error');
                        }
                    });
                }
            });
            // Click handler
            btn.addEventListener('click', () => {
                if (btn.classList.contains('biji-ext-error')) {
                    window.open('https://biji.com', '_blank');
                    return;
                }
                if (btn.classList.contains('biji-ext-loading') ||
                    btn.classList.contains('biji-ext-submitted'))
                    return;
                const url = platform.getPageUrl();
                const title = platform.getPageTitle();
                const tags = [];
                if (platform.platformType)
                    tags.push(platform.platformType);
                const ch = platform.getChannelName();
                if (ch)
                    tags.push(ch);
                btn.classList.add('biji-ext-loading');
                btn.innerHTML = '<span class="biji-ext-spinner"></span> 提交中...';
                chrome.runtime.sendMessage({ type: 'submitLink', url, title, tags }, resp => {
                    if (chrome.runtime.lastError) {
                        btn.classList.remove('biji-ext-loading');
                        btn.classList.add('biji-ext-error');
                        btn.textContent = '连接失败';
                        setTimeout(() => {
                            btn.classList.remove('biji-ext-error');
                            btn.textContent = 'Get笔记';
                        }, 3000);
                        return;
                    }
                    btn.classList.remove('biji-ext-loading');
                    if (resp && resp.ok) {
                        btn.classList.add('biji-ext-success');
                        btn.textContent = '已提交 \u2713';
                        setTimeout(() => {
                            btn.classList.remove('biji-ext-success');
                            btn.classList.add('biji-ext-submitted');
                        }, 2000);
                    }
                    else {
                        btn.classList.add('biji-ext-error');
                        btn.textContent = '失败: ' + ((resp && resp.error) || '未知错误');
                        setTimeout(() => {
                            btn.classList.remove('biji-ext-error');
                            btn.textContent = 'Get笔记';
                        }, 4000);
                    }
                });
            });
        });
    }

    // --- List-page button injection (Xiaoyuzhou podcast list) ---
    function createListBtn(url, title, channelName, platformType) {
        const btn = document.createElement('button');
        btn.className = 'biji-ext-btn biji-ext-btn-sm ' + LIST_BTN_CLASS;
        btn.textContent = 'Get笔记';
        // Prevent card link navigation
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            if (btn.classList.contains('biji-ext-error')) {
                window.open('https://biji.com', '_blank');
                return;
            }
            if (btn.classList.contains('biji-ext-loading') ||
                btn.classList.contains('biji-ext-submitted'))
                return;
            const tags = [];
            if (platformType)
                tags.push(platformType);
            if (channelName)
                tags.push(channelName);
            btn.classList.add('biji-ext-loading');
            btn.innerHTML = '<span class="biji-ext-spinner"></span>';
            chrome.runtime.sendMessage({ type: 'submitLink', url, title, tags }, resp => {
                if (chrome.runtime.lastError) {
                    btn.classList.remove('biji-ext-loading');
                    btn.classList.add('biji-ext-error');
                    btn.textContent = '失败';
                    setTimeout(() => {
                        btn.classList.remove('biji-ext-error');
                        btn.textContent = 'Get笔记';
                    }, 3000);
                    return;
                }
                btn.classList.remove('biji-ext-loading');
                if (resp && resp.ok) {
                    btn.classList.add('biji-ext-success');
                    btn.textContent = '已提交 \u2713';
                    setTimeout(() => {
                        btn.classList.remove('biji-ext-success');
                        btn.classList.add('biji-ext-submitted');
                    }, 2000);
                }
                else {
                    btn.classList.add('biji-ext-error');
                    btn.textContent = '失败';
                    setTimeout(() => {
                        btn.classList.remove('biji-ext-error');
                        btn.textContent = 'Get笔记';
                    }, 4000);
                }
            });
        });
        // Check if already submitted
        chrome.runtime.sendMessage({ type: 'isLinkSubmitted', url }, resp => {
            if (chrome.runtime.lastError)
                return;
            if (resp && resp.submitted) {
                btn.textContent = '已提交 \u2713';
                btn.classList.add('biji-ext-submitted');
            } else {
                chrome.runtime.sendMessage({ type: 'checkAuth' }, authResp => {
                    if (chrome.runtime.lastError) return;
                    if (!authResp || !authResp.authenticated) {
                        btn.textContent = '请先登录';
                        btn.classList.add('biji-ext-error');
                    }
                });
            }
        });
        return btn;
    }

    let listDebounceTimer = null;
    function injectListButtons(platform) {
        if (listDebounceTimer)
            return;
        listDebounceTimer = setTimeout(() => {
            listDebounceTimer = null;
        }, 300);
        chrome.storage.local.get('settings', data => {
            if (chrome.runtime.lastError)
                return;
            const s = data.settings || {};
            if (s.enableInjectBtn === false)
                return;
            if (s.injectBtnXiaoyuzhou === false)
                return;
            const channelName = platform.getChannelName();
            const links = document.querySelectorAll('a[href*="/episode/"]');
            links.forEach(a => {
                // Skip if already processed
                if (a.querySelector('.' + LIST_BTN_CLASS))
                    return;
                const href = a.getAttribute('href');
                if (!href)
                    return;
                const url = new URL(href, location.origin).href;
                // Find the title element inside the card
                const titleEl = a.querySelector('h3') || a.querySelector('[class*="title"]:not([class*="podcast"])');
                if (!titleEl)
                    return;
                const title = titleEl.textContent.trim();
                if (!title)
                    return;
                const btn = createListBtn(url, title, channelName, platform.platformType);
                titleEl.appendChild(btn);
            });
        });
    }

    // --- URL change watching ---
    function watchUrlChanges(platform) {
        if (platform.listMode) {
            // For list pages, use MutationObserver to catch lazy-loaded content
            const observer = new MutationObserver(() => {
                injectListButtons(platform);
            });
            observer.observe(document.body, { childList: true, subtree: true });
            // Periodic fallback
            const intervalId = setInterval(() => {
                if (!chrome.runtime?.id) {
                    clearInterval(intervalId);
                    return;
                }
                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    setTimeout(() => injectListButtons(platform), 1000);
                }
            }, CHECK_INTERVAL);
            return;
        }
        // Single-page mode
        // Method 1: MutationObserver on <title>
        const titleObserver = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                setTimeout(() => injectButton(platform), 1000);
            }
        });
        const titleTag = document.querySelector('title');
        if (titleTag) {
            titleObserver.observe(titleTag, { childList: true });
        }
        // Method 2: Periodic check as fallback
        const intervalId = setInterval(() => {
            if (!chrome.runtime?.id) {
                clearInterval(intervalId);
                return;
            }
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                setTimeout(() => injectButton(platform), 1000);
            }
            if (!document.getElementById(WRAP_ID)) {
                injectButton(platform);
            }
        }, CHECK_INTERVAL);
        // Method 3: popstate/hashchange
        window.addEventListener('popstate', () => {
            lastUrl = location.href;
            setTimeout(() => injectButton(platform), 500);
        });
        // Method 4: YouTube-specific yt-navigate-finish event
        if (platform.host === 'www.youtube.com') {
            document.addEventListener('yt-navigate-finish', () => {
                lastUrl = location.href;
                setTimeout(() => injectButton(platform), 500);
            });
        }
    }

    // --- Init ---
    const platform = detectPlatform();
    if (platform) {
        if (platform.listMode) {
            function tryInjectList(attempts) {
                if (attempts <= 0)
                    return;
                const links = document.querySelectorAll('a[href*="/episode/"]');
                if (links.length > 0) {
                    injectListButtons(platform);
                }
                else {
                    setTimeout(() => tryInjectList(attempts - 1), 1000);
                }
            }
            tryInjectList(10);
            watchUrlChanges(platform);
        }
        else {
            function tryInject(attempts) {
                if (attempts <= 0)
                    return;
                const titleEl = findTitleElement(platform);
                if (titleEl) {
                    injectButton(platform);
                }
                else {
                    setTimeout(() => tryInject(attempts - 1), 1000);
                }
            }
            tryInject(10);
            watchUrlChanges(platform);
        }
    }

})();
