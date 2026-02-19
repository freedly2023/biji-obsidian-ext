// content-inject-btn.js — Injects "Get笔记" button on YouTube, Bilibili, Xiaoyuzhou
// Runs as content script on supported platforms

(function () {
  'use strict';

  var BTN_ID = 'biji-ext-get-note-btn';
  var WRAP_ID = 'biji-ext-btn-wrap';
  var CHECK_INTERVAL = 2000;
  var lastUrl = location.href;

  // Platform-specific config: selectors to find title area and insert button after
  var PLATFORMS = {
    youtube: {
      host: 'www.youtube.com',
      platformType: 'youtube',
      titleSelectors: [
        'ytd-watch-metadata #title',
        '#above-the-fold #title',
        'ytd-video-primary-info-renderer #title',
        '#info-contents #title',
      ],
      getPageUrl: function () { return location.href; },
      getPageTitle: function () {
        var el = document.querySelector(
          'ytd-watch-metadata h1 yt-formatted-string, ' +
          '#above-the-fold h1 yt-formatted-string, ' +
          'ytd-video-primary-info-renderer h1 yt-formatted-string'
        );
        return el ? el.textContent.trim() : document.title;
      },
      getChannelName: function () {
        var el = document.querySelector('#owner #channel-name a, ytd-channel-name a');
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
      getPageUrl: function () { return location.href; },
      getPageTitle: function () {
        var el = document.querySelector(
          '#viewbox_report .video-title, .video-title, .media-title'
        );
        return el ? el.textContent.trim() : document.title;
      },
      getChannelName: function () {
        var el = document.querySelector('.up-name, #v_upinfo .name a');
        return el ? el.textContent.trim() : '';
      },
    },
    xiaoyuzhou: {
      host: 'www.xiaoyuzhoufm.com',
      platformType: 'podcast',
      titleSelectors: [
        '.episode-title',
        'h1',
      ],
      getPageUrl: function () { return location.href; },
      getPageTitle: function () {
        var el = document.querySelector('.episode-title, h1');
        return el ? el.textContent.trim() : document.title;
      },
      getChannelName: function () {
        var el = document.querySelector('.podcast-title, .podcast-name a');
        return el ? el.textContent.trim() : '';
      },
    },
  };

  // Detect current platform
  function detectPlatform() {
    var host = location.hostname;
    for (var key in PLATFORMS) {
      if (host === PLATFORMS[key].host) return PLATFORMS[key];
    }
    return null;
  }

  // Find the title element using platform selectors
  function findTitleElement(platform) {
    for (var i = 0; i < platform.titleSelectors.length; i++) {
      var el = document.querySelector(platform.titleSelectors[i]);
      if (el) return el;
    }
    return null;
  }

  // Remove existing button
  function removeExistingBtn() {
    var existing = document.getElementById(WRAP_ID);
    if (existing) existing.remove();
  }

  // Create and inject the button
  function injectButton(platform) {
    // Check settings first — is button injection enabled?
    chrome.storage.local.get('settings', function (data) {
      if (chrome.runtime.lastError) return;  // context invalidated
      var s = data.settings || {};
      if (s.enableInjectBtn === false) return;

      // Check per-platform toggle
      var host = platform.host;
      if (host === 'www.youtube.com' && s.injectBtnYoutube === false) return;
      if (host === 'www.bilibili.com' && s.injectBtnBilibili === false) return;
      if (host === 'www.xiaoyuzhoufm.com' && s.injectBtnXiaoyuzhou === false) return;

      removeExistingBtn();

      var titleEl = findTitleElement(platform);
      if (!titleEl) return; // silently fail if DOM changed

      var pageUrl = platform.getPageUrl();

      // Create wrapper
      var wrap = document.createElement('div');
      wrap.id = WRAP_ID;
      wrap.className = 'biji-ext-btn-wrap';

      // Create button
      var btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.className = 'biji-ext-btn';
      btn.textContent = 'Get笔记';
      wrap.appendChild(btn);

      // Insert after title element
      titleEl.parentNode.insertBefore(wrap, titleEl.nextSibling);

      // Check if already submitted
      chrome.runtime.sendMessage({ type: 'isLinkSubmitted', url: pageUrl }, function (resp) {
        if (chrome.runtime.lastError) return;
        if (resp && resp.submitted) {
          btn.textContent = '已提交 \u2713';
          btn.classList.add('biji-ext-submitted');
        }
      });

      // Click handler
      btn.addEventListener('click', function () {
        if (btn.classList.contains('biji-ext-loading') ||
            btn.classList.contains('biji-ext-submitted')) return;

        var url = platform.getPageUrl();
        var title = platform.getPageTitle();

        // Collect tags: platform type + channel name
        var tags = [];
        if (platform.platformType) tags.push(platform.platformType);
        if (platform.getChannelName) {
          var ch = platform.getChannelName();
          if (ch) tags.push(ch);
        }

        // Set loading state
        btn.classList.add('biji-ext-loading');
        btn.innerHTML = '<span class="biji-ext-spinner"></span> 提交中...';

        chrome.runtime.sendMessage(
          { type: 'submitLink', url: url, title: title, tags: tags },
          function (resp) {
            if (chrome.runtime.lastError) {
              btn.classList.remove('biji-ext-loading');
              btn.classList.add('biji-ext-error');
              btn.textContent = '连接失败';
              setTimeout(function () {
                btn.classList.remove('biji-ext-error');
                btn.textContent = 'Get笔记';
              }, 3000);
              return;
            }
            btn.classList.remove('biji-ext-loading');
            if (resp && resp.ok) {
              btn.classList.add('biji-ext-success');
              btn.textContent = '已提交 \u2713';
              setTimeout(function () {
                btn.classList.remove('biji-ext-success');
                btn.classList.add('biji-ext-submitted');
              }, 2000);
            } else {
              btn.classList.add('biji-ext-error');
              btn.textContent = '失败: ' + ((resp && resp.error) || '未知错误');
              setTimeout(function () {
                btn.classList.remove('biji-ext-error');
                btn.textContent = 'Get笔记';
              }, 4000);
            }
          }
        );
      });
    });
  }

  // Monitor URL changes for SPA navigation (YouTube, Bilibili)
  function watchUrlChanges(platform) {
    // Method 1: MutationObserver on <title>
    var titleObserver = new MutationObserver(function () {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(function () { injectButton(platform); }, 1000);
      }
    });
    var titleTag = document.querySelector('title');
    if (titleTag) {
      titleObserver.observe(titleTag, { childList: true });
    }

    // Method 2: Periodic check as fallback
    var intervalId = setInterval(function () {
      if (!chrome.runtime?.id) { clearInterval(intervalId); return; }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(function () { injectButton(platform); }, 1000);
      }
      // Also re-inject if button was removed (DOM updates)
      if (!document.getElementById(WRAP_ID)) {
        injectButton(platform);
      }
    }, CHECK_INTERVAL);

    // Method 3: Listen for popstate/hashchange
    window.addEventListener('popstate', function () {
      lastUrl = location.href;
      setTimeout(function () { injectButton(platform); }, 500);
    });

    // Method 4: YouTube-specific yt-navigate-finish event
    if (platform.host === 'www.youtube.com') {
      document.addEventListener('yt-navigate-finish', function () {
        lastUrl = location.href;
        setTimeout(function () { injectButton(platform); }, 500);
      });
    }
  }

  // --- Init ---
  var platform = detectPlatform();
  if (platform) {
    // Initial injection with retry (DOM may not be ready)
    function tryInject(attempts) {
      if (attempts <= 0) return;
      var titleEl = findTitleElement(platform);
      if (titleEl) {
        injectButton(platform);
      } else {
        setTimeout(function () { tryInject(attempts - 1); }, 1000);
      }
    }
    tryInject(10);
    watchUrlChanges(platform);
  }
})();