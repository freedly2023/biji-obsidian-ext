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
        xiaoyuzhou: {
            host: 'www.xiaoyuzhoufm.com',
            platformType: 'podcast',
            titleSelectors: ['.episode-title', 'h1'],
            getPageUrl: () => location.href,
            getPageTitle: () => {
                const el = document.querySelector('.episode-title, h1');
                return el ? el.textContent.trim() : document.title;
            },
            getChannelName: () => {
                const el = document.querySelector('.podcast-title, .podcast-name a');
                return el ? el.textContent.trim() : '';
            },
        },
    };
    function detectPlatform() {
        const host = location.hostname;
        for (const key in PLATFORMS) {
            if (host === PLATFORMS[key].host)
                return PLATFORMS[key];
        }
        return null;
    }

    // content-inject-btn — Injects "Get笔记" button on YouTube, Bilibili, Xiaoyuzhou
    const BTN_ID = 'biji-ext-get-note-btn';
    const WRAP_ID = 'biji-ext-btn-wrap';
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
            const wrap = document.createElement('div');
            wrap.id = WRAP_ID;
            wrap.className = 'biji-ext-btn-wrap';
            const btn = document.createElement('button');
            btn.id = BTN_ID;
            btn.className = 'biji-ext-btn';
            btn.textContent = 'Get笔记';
            wrap.appendChild(btn);
            titleEl.parentNode.insertBefore(wrap, titleEl.nextSibling);
            // Check if already submitted
            chrome.runtime.sendMessage({ type: 'isLinkSubmitted', url: pageUrl }, resp => {
                if (chrome.runtime.lastError)
                    return;
                if (resp && resp.submitted) {
                    btn.textContent = '已提交 \u2713';
                    btn.classList.add('biji-ext-submitted');
                }
            });
            // Click handler
            btn.addEventListener('click', () => {
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
    function watchUrlChanges(platform) {
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

})();
