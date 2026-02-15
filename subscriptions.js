// subscriptions.js — Standalone subscription management page logic

(function () {
  'use strict';

  // --- DOM refs ---
  var channelStripEl = document.getElementById('channelStrip');
  var managePanelEl = document.getElementById('managePanel');
  var feedListEl = document.getElementById('feedList');
  var feedUrlEl = document.getElementById('feedUrl');
  var feedNameEl = document.getElementById('feedName');
  var btnAddFeed = document.getElementById('btnAddFeed');
  var feedAddStatus = document.getElementById('feedAddStatus');
  var opmlFile = document.getElementById('opmlFile');
  var btnImportOpml = document.getElementById('btnImportOpml');
  var opmlStatus = document.getElementById('opmlStatus');

  var searchInput = document.getElementById('searchInput');
  var filterType = document.getElementById('filterType');
  var filterStatus = document.getElementById('filterStatus');
  var filterDate = document.getElementById('filterDate');
  var btnRefreshAll = document.getElementById('btnRefreshAll');

  var batchBar = document.getElementById('batchBar');
  var pageSelectAll = document.getElementById('pageSelectAll');
  var pageSelCount = document.getElementById('pageSelCount');
  var btnBatchSubmit = document.getElementById('btnBatchSubmit');
  var batchProgress = document.getElementById('batchProgress');
  var batchPfill = document.getElementById('batchPfill');
  var batchPtxt = document.getElementById('batchPtxt');

  var contentList = document.getElementById('contentList');
  var btnPrev = document.getElementById('btnPrev');
  var btnNext = document.getElementById('btnNext');
  var pageInfo = document.getElementById('pageInfo');

  // --- State ---
  var allItems = [];
  var filteredItems = [];
  var selectedGuids = {};
  var currentPage = 1;
  var pageSize = 50;
  var feeds = [];
  var activeChannelId = ''; // '' means "all"
  var managePanelOpen = false;

  // --- Feed list management ---
  function loadFeeds() {
    chrome.runtime.sendMessage({ type: 'getFeeds' }, function (res) {
      if (chrome.runtime.lastError) return;
      feeds = (res && res.feeds) || [];
      renderFeedList();
      renderChannelStrip();
    });
  }

  // --- Channel strip ---
  function renderChannelStrip() {
    if (!channelStripEl) return;
    var html = '';

    // "All" item
    var allActive = activeChannelId === '' ? ' active' : '';
    html += '<div class="channel-item' + allActive + '" data-channel-id="">' +
      '<div class="ch-fallback">全</div>' +
      '<span class="ch-label">全部</span></div>';

    // Each feed
    feeds.forEach(function (f) {
      var isActive = activeChannelId === f.id ? ' active' : '';
      var avatarHtml;
      if (f.thumbnail) {
        avatarHtml = '<img class="ch-avatar" src="' + SubShared.escHtml(f.thumbnail) + '" ' +
          'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="ch-fallback" style="display:none">' +
          SubShared.escHtml((f.channelName || f.name || '?').charAt(0)) + '</div>';
      } else {
        avatarHtml = '<div class="ch-fallback">' +
          SubShared.escHtml((f.channelName || f.name || '?').charAt(0)) + '</div>';
      }
      var label = f.channelName || f.name || f.url;
      html += '<div class="channel-item' + isActive + '" data-channel-id="' + SubShared.escHtml(f.id) + '">' +
        avatarHtml +
        '<span class="ch-label" title="' + SubShared.escHtml(label) + '">' + SubShared.escHtml(label) + '</span></div>';
    });

    // "Manage" button
    var manageActive = managePanelOpen ? ' active' : '';
    html += '<div class="channel-item manage-btn' + manageActive + '" data-channel-action="manage">' +
      '<div class="ch-fallback">&#9881;</div>' +
      '<span class="ch-label">管理</span></div>';

    channelStripEl.innerHTML = html;

    // Bind clicks
    channelStripEl.querySelectorAll('.channel-item').forEach(function (el) {
      el.addEventListener('click', function () {
        var action = this.getAttribute('data-channel-action');
        if (action === 'manage') {
          managePanelOpen = !managePanelOpen;
          if (managePanelEl) {
            managePanelEl.classList.toggle('open', managePanelOpen);
          }
          renderChannelStrip();
          return;
        }
        var chId = this.getAttribute('data-channel-id');
        activeChannelId = chId || '';
        currentPage = 1;
        applyFilters();
        renderChannelStrip();
      });
    });
  }

  function renderFeedList() {
    if (!feedListEl) return;
    if (feeds.length === 0) {
      feedListEl.innerHTML = '<div style="color:#999;font-size:13px;padding:8px 0">暂无订阅源</div>';
      return;
    }
    feedListEl.innerHTML = feeds.map(function (f) {
      var typeBadge = SubShared.typeBadgeHtml(f.type);
      var checked = f.enabled ? ' checked' : '';
      var errorHtml = f.lastError
        ? '<span class="feed-error" title="' + SubShared.escHtml(f.lastError) + '">&#9888; ' + SubShared.escHtml(f.lastError) + '</span>'
        : '<span class="feed-url">' + SubShared.escHtml(f.url) + '</span>';
      return '<div class="feed-row">' +
        '<label class="toggle-switch">' +
        '<input type="checkbox" data-feed-toggle="' + SubShared.escHtml(f.id) + '"' + checked + '>' +
        '<span class="toggle-slider"></span></label>' +
        typeBadge +
        '<span class="feed-name" title="' + SubShared.escHtml(f.url) + '">' + SubShared.escHtml(f.channelName || f.name) + '</span>' +
        errorHtml +
        '<button class="btn-sm danger" data-feed-delete="' + SubShared.escHtml(f.id) + '">删除</button>' +
        '</div>';
    }).join('');

    // Bind toggle
    feedListEl.querySelectorAll('[data-feed-toggle]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        chrome.runtime.sendMessage({ type: 'toggleFeed', feedId: this.getAttribute('data-feed-toggle') });
      });
    });
    // Bind delete
    feedListEl.querySelectorAll('[data-feed-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('确定删除此订阅源？')) return;
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
      var url = feedUrlEl.value.trim();
      var name = feedNameEl.value.trim();
      if (!url) { feedAddStatus.textContent = '请输入 URL'; return; }

      btnAddFeed.disabled = true;
      feedAddStatus.textContent = '添加中...';

      // Check if YouTube URL needs conversion
      var isYoutube = /youtube\.com\/(channel\/|@)/.test(url);
      var addPromise;

      if (isYoutube && !/feeds\/videos\.xml/.test(url)) {
        addPromise = new Promise(function (resolve, reject) {
          chrome.runtime.sendMessage({ type: 'convertYoutubeUrl', url: url }, function (res) {
            if (res && res.ok) resolve(res.rssUrl);
            else reject(new Error((res && res.error) || '转换失败'));
          });
        }).then(function (rssUrl) {
          return new Promise(function (resolve, reject) {
            chrome.runtime.sendMessage({ type: 'addFeed', url: rssUrl, name: name }, function (res) {
              if (res && res.ok) resolve(res.feed);
              else reject(new Error((res && res.error) || '添加失败'));
            });
          });
        });
      } else {
        addPromise = new Promise(function (resolve, reject) {
          chrome.runtime.sendMessage({ type: 'addFeed', url: url, name: name }, function (res) {
            if (res && res.ok) resolve(res.feed);
            else reject(new Error((res && res.error) || '添加失败'));
          });
        });
      }

      addPromise.then(function () {
        feedAddStatus.textContent = '添加成功，正在获取内容...';
        feedUrlEl.value = '';
        feedNameEl.value = '';
        loadFeeds();
        // Poll for new content instead of fixed timeout
        pollForNewItems(feedAddStatus);
      }).catch(function (err) {
        feedAddStatus.textContent = '错误: ' + err.message;
        setTimeout(function () { feedAddStatus.textContent = ''; }, 3000);
      }).then(function () {
        btnAddFeed.disabled = false;
      });
    });
  }

  // --- Poll for new items (replaces fixed 3s timeout) ---
  function pollForNewItems(statusEl) {
    var attempts = 0;
    var maxAttempts = 7; // ~14 seconds max
    var prevCount = allItems.length;

    function check() {
      attempts++;
      chrome.runtime.sendMessage({ type: 'getFeedItems', filter: {} }, function (res) {
        if (chrome.runtime.lastError) return;
        var items = (res && res.items) || [];
        if (items.length > prevCount || attempts >= maxAttempts) {
          allItems = items;
          applyFilters();
          loadFeeds(); // refresh channel strip with new thumbnails
          if (statusEl) statusEl.textContent = items.length > prevCount
            ? '获取到 ' + (items.length - prevCount) + ' 条新内容'
            : '';
          setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 2000);
          return;
        }
        if (statusEl) statusEl.textContent = '正在获取内容...';
        setTimeout(check, 2000);
      });
    }

    setTimeout(check, 2000);
  }

  // --- OPML import ---
  if (btnImportOpml) {
    btnImportOpml.addEventListener('click', function () {
      if (!opmlFile || !opmlFile.files || !opmlFile.files[0]) {
        opmlStatus.textContent = '请选择 OPML 文件';
        return;
      }

      btnImportOpml.disabled = true;
      opmlStatus.textContent = '导入中...';

      var reader = new FileReader();
      reader.onload = function (e) {
        chrome.runtime.sendMessage({ type: 'importFeedsOpml', opmlText: e.target.result }, function (res) {
          btnImportOpml.disabled = false;
          if (res && res.ok) {
            opmlStatus.textContent = '导入完成：新增 ' + res.result.added + ' / 共 ' + res.result.total + ' 条';
            opmlFile.value = '';
            loadFeeds();
            pollForNewItems(opmlStatus);
          } else {
            opmlStatus.textContent = '导入失败: ' + ((res && res.error) || '未知错误');
          }
          setTimeout(function () { opmlStatus.textContent = ''; }, 4000);
        });
      };
      reader.onerror = function () {
        btnImportOpml.disabled = false;
        opmlStatus.textContent = '文件读取失败';
      };
      reader.readAsText(opmlFile.files[0]);
    });
  }

  // --- Load feed items ---
  function loadItems() {
    chrome.runtime.sendMessage({ type: 'getFeedItems', filter: {} }, function (res) {
      if (chrome.runtime.lastError) return;
      allItems = (res && res.items) || [];
      applyFilters();
    });
  }

  function applyFilters() {
    var search = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var type = filterType ? filterType.value : '';
    var status = filterStatus ? filterStatus.value : '';
    var dateDays = filterDate ? filterDate.value : '';
    var dateCutoff = 0;
    if (dateDays) {
      dateCutoff = Date.now() - parseInt(dateDays, 10) * 86400000;
    }

    filteredItems = allItems.filter(function (item) {
      if (search && (item.title || '').toLowerCase().indexOf(search) === -1) return false;
      // Channel filter via channel strip
      if (activeChannelId && item.feedId !== activeChannelId) return false;
      if (type) {
        var feedType = item.tags && item.tags[0] ? item.tags[0] : '';
        if (feedType !== type) return false;
      }
      if (status && item.status !== status) return false;
      if (dateCutoff) {
        var pubTime = item.pubDate ? new Date(item.pubDate).getTime() : 0;
        if (pubTime < dateCutoff) return false;
      }
      return true;
    });

    currentPage = 1;
    renderPage();
  }

  function renderPage() {
    var start = (currentPage - 1) * pageSize;
    var end = start + pageSize;
    var pageItems = filteredItems.slice(start, end);
    var totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

    if (pageItems.length === 0) {
      contentList.innerHTML = '<div class="empty-state">' +
        '暂无内容' + (allItems.length === 0 ? '，点击"刷新"获取' : '') + '</div>';
    } else {
      // Flat list (no grouping), sorted by pubDate desc
      var html = '';
      pageItems.forEach(function (item) {
        html += SubShared.feedItemCardHtml(item, {
          checked: !!selectedGuids[item.guid],
          showCheckbox: true,
          thumbSize: 72,
        });
      });
      contentList.innerHTML = html;
    }

    // Bind checkboxes
    contentList.querySelectorAll('.feed-item-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var guid = this.getAttribute('data-guid');
        if (this.checked) selectedGuids[guid] = true;
        else delete selectedGuids[guid];
        updateSelectionUI();
      });
    });

    // Pagination
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
    if (pageInfo) pageInfo.textContent = '第 ' + currentPage + ' / ' + totalPages + ' 页 (共 ' + filteredItems.length + ' 条)';

    updateSelectionUI();
  }

  function updateSelectionUI() {
    var count = Object.keys(selectedGuids).length;
    if (pageSelCount) pageSelCount.textContent = '已选 ' + count + ' 条';
    if (btnBatchSubmit) {
      btnBatchSubmit.disabled = count === 0;
    }
    // Show/hide batch bar
    if (batchBar) {
      batchBar.classList.toggle('visible', count > 0);
    }
  }

  // --- Event bindings ---
  if (searchInput) searchInput.addEventListener('input', debounce(applyFilters, 300));
  if (filterType) filterType.addEventListener('change', applyFilters);
  if (filterStatus) filterStatus.addEventListener('change', applyFilters);
  if (filterDate) filterDate.addEventListener('change', applyFilters);

  if (btnPrev) btnPrev.addEventListener('click', function () {
    if (currentPage > 1) { currentPage--; renderPage(); }
  });
  if (btnNext) btnNext.addEventListener('click', function () {
    var totalPages = Math.ceil(filteredItems.length / pageSize);
    if (currentPage < totalPages) { currentPage++; renderPage(); }
  });

  if (pageSelectAll) {
    pageSelectAll.addEventListener('change', function () {
      var checked = this.checked;
      var start = (currentPage - 1) * pageSize;
      var end = start + pageSize;
      var pageItems = filteredItems.slice(start, end);

      if (checked) {
        pageItems.forEach(function (item) { selectedGuids[item.guid] = true; });
      } else {
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
          var msg = '+' + (res.result.newItems || 0);
          btnRefreshAll.textContent = '刷新 (' + msg + ')';
          setTimeout(function () { btnRefreshAll.textContent = '刷新'; }, 2000);
        }
        loadItems();
        loadFeeds(); // refresh channel thumbnails
      });
    });
  }

  if (btnBatchSubmit) {
    btnBatchSubmit.addEventListener('click', function () {
      var guids = Object.keys(selectedGuids);
      if (guids.length === 0) return;

      btnBatchSubmit.disabled = true;
      btnBatchSubmit.textContent = '正在提交中...';

      // Fire-and-forget
      chrome.runtime.sendMessage({ type: 'submitFeedItems', guids: guids }, function () {});
      selectedGuids = {};

      setTimeout(function () {
        btnBatchSubmit.textContent = '提交选中';
        btnBatchSubmit.disabled = false;
        loadItems();
      }, 1500);
    });
  }

  function debounce(fn, delay) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  // --- Init ---
  loadFeeds();
  loadItems();
})();
