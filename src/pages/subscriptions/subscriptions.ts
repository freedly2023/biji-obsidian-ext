// subscriptions.ts — Standalone subscription management page logic
// Converted from subscriptions.js — window.* globals replaced with imports

import {
  feedItemCardHtml, typeBadgeHtml, escHtml,
} from '../../shared-ui/subscription-shared';
import type { FeedItem, Feed } from '../../core/types';

// --- DOM refs ---
const channelStripEl = document.getElementById('channelStrip');
const managePanelEl = document.getElementById('managePanel');
const feedListEl = document.getElementById('feedList');
const feedUrlEl = document.getElementById('feedUrl') as HTMLInputElement | null;
const feedNameEl = document.getElementById('feedName') as HTMLInputElement | null;
const btnAddFeed = document.getElementById('btnAddFeed') as HTMLButtonElement | null;
const feedAddStatus = document.getElementById('feedAddStatus');
const opmlFile = document.getElementById('opmlFile') as HTMLInputElement | null;
const btnImportOpml = document.getElementById('btnImportOpml') as HTMLButtonElement | null;
const opmlStatus = document.getElementById('opmlStatus');

const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
const filterType = document.getElementById('filterType') as HTMLSelectElement | null;
const filterStatus = document.getElementById('filterStatus') as HTMLSelectElement | null;
const filterDate = document.getElementById('filterDate') as HTMLSelectElement | null;
const btnRefreshAll = document.getElementById('btnRefreshAll') as HTMLButtonElement | null;

const batchBar = document.getElementById('batchBar');
const pageSelectAll = document.getElementById('pageSelectAll') as HTMLInputElement | null;
const pageSelCount = document.getElementById('pageSelCount');
const btnBatchSubmit = document.getElementById('btnBatchSubmit') as HTMLButtonElement | null;

const contentList = document.getElementById('contentList')!;
const btnPrev = document.getElementById('btnPrev') as HTMLButtonElement | null;
const btnNext = document.getElementById('btnNext') as HTMLButtonElement | null;
const pageInfo = document.getElementById('pageInfo');

// --- State ---
let allItems: FeedItem[] = [];
let filteredItems: FeedItem[] = [];
let selectedGuids: Record<string, boolean> = {};
let currentPage = 1;
const pageSize = 50;
let feeds: any[] = [];
let activeChannelId = '';
let managePanelOpen = false;

// --- Feed list management ---
function loadFeeds(): void {
  chrome.runtime.sendMessage({ type: 'getFeeds' }, function (res: any) {
    if (chrome.runtime.lastError) return;
    feeds = (res && res.feeds) || [];
    renderFeedList();
    renderChannelStrip();
  });
}

// --- Channel strip ---
function renderChannelStrip(): void {
  if (!channelStripEl) return;
  let html = '';

  const allActive = activeChannelId === '' ? ' active' : '';
  html += '<div class="channel-item' + allActive + '" data-channel-id="">' +
    '<div class="ch-fallback">全</div>' +
    '<span class="ch-label">全部</span></div>';

  feeds.forEach(function (f: any) {
    const isActive = activeChannelId === f.id ? ' active' : '';
    let avatarHtml: string;
    if (f.thumbnail) {
      avatarHtml = '<img class="ch-avatar" src="' + escHtml(f.thumbnail) + '" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<div class="ch-fallback" style="display:none">' +
        escHtml((f.channelName || f.name || '?').charAt(0)) + '</div>';
    } else {
      avatarHtml = '<div class="ch-fallback">' +
        escHtml((f.channelName || f.name || '?').charAt(0)) + '</div>';
    }
    const label = f.channelName || f.name || f.url;
    html += '<div class="channel-item' + isActive + '" data-channel-id="' + escHtml(f.id) + '">' +
      avatarHtml +
      '<span class="ch-label" title="' + escHtml(label) + '">' + escHtml(label) + '</span></div>';
  });

  const manageActive = managePanelOpen ? ' active' : '';
  html += '<div class="channel-item manage-btn' + manageActive + '" data-channel-action="manage">' +
    '<div class="ch-fallback">&#9881;</div>' +
    '<span class="ch-label">管理</span></div>';

  channelStripEl.innerHTML = html;

  channelStripEl.querySelectorAll('.channel-item').forEach(function (el) {
    el.addEventListener('click', function (this: HTMLElement) {
      const action = this.getAttribute('data-channel-action');
      if (action === 'manage') {
        managePanelOpen = !managePanelOpen;
        if (managePanelEl) managePanelEl.classList.toggle('open', managePanelOpen);
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

function renderFeedList(): void {
  if (!feedListEl) return;
  if (feeds.length === 0) {
    feedListEl.innerHTML = '<div style="color:#999;font-size:13px;padding:8px 0">暂无订阅源</div>';
    return;
  }
  feedListEl.innerHTML = feeds.map(function (f: any) {
    const badge = typeBadgeHtml(f.type);
    const checked = f.enabled ? ' checked' : '';
    const errorHtml = f.lastError
      ? '<span class="feed-error" title="' + escHtml(f.lastError) + '">&#9888; ' + escHtml(f.lastError) + '</span>'
      : '<span class="feed-url">' + escHtml(f.url) + '</span>';
    return '<div class="feed-row">' +
      '<label class="toggle-switch">' +
      '<input type="checkbox" data-feed-toggle="' + escHtml(f.id) + '"' + checked + '>' +
      '<span class="toggle-slider"></span></label>' +
      badge +
      '<span class="feed-name" title="' + escHtml(f.url) + '">' + escHtml(f.channelName || f.name) + '</span>' +
      errorHtml +
      '<button class="btn-sm danger" data-feed-delete="' + escHtml(f.id) + '">删除</button>' +
      '</div>';
  }).join('');

  feedListEl.querySelectorAll('[data-feed-toggle]').forEach(function (cb) {
    cb.addEventListener('change', function (this: HTMLInputElement) {
      chrome.runtime.sendMessage({ type: 'toggleFeed', feedId: this.getAttribute('data-feed-toggle') }, function () {});
    });
  });
  feedListEl.querySelectorAll('[data-feed-delete]').forEach(function (btn) {
    btn.addEventListener('click', function (this: HTMLElement) {
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
    const url = feedUrlEl!.value.trim();
    const name = feedNameEl!.value.trim();
    if (!url) { if (feedAddStatus) feedAddStatus.textContent = '请输入 URL'; return; }

    btnAddFeed!.disabled = true;
    if (feedAddStatus) feedAddStatus.textContent = '添加中...';

    const isYoutube = /youtube\.com\/(channel\/|@)/.test(url);
    let addPromise: Promise<any>;

    if (isYoutube && !/feeds\/videos\.xml/.test(url)) {
      addPromise = new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({ type: 'convertYoutubeUrl', url }, function (res: any) {
          if (res && res.ok) resolve(res.rssUrl);
          else reject(new Error((res && res.error) || '转换失败'));
        });
      }).then(function (rssUrl) {
        return new Promise(function (resolve, reject) {
          chrome.runtime.sendMessage({ type: 'addFeed', url: rssUrl, name }, function (res: any) {
            if (res && res.ok) resolve(res.feed);
            else reject(new Error((res && res.error) || '添加失败'));
          });
        });
      });
    } else {
      addPromise = new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({ type: 'addFeed', url, name }, function (res: any) {
          if (res && res.ok) resolve(res.feed);
          else reject(new Error((res && res.error) || '添加失败'));
        });
      });
    }

    addPromise.then(function () {
      if (feedAddStatus) feedAddStatus.textContent = '添加成功，正在获取内容...';
      feedUrlEl!.value = '';
      feedNameEl!.value = '';
      loadFeeds();
      pollForNewItems(feedAddStatus);
    }).catch(function (err: Error) {
      if (feedAddStatus) feedAddStatus.textContent = '错误: ' + err.message;
      setTimeout(function () { if (feedAddStatus) feedAddStatus.textContent = ''; }, 3000);
    }).then(function () {
      btnAddFeed!.disabled = false;
    });
  });
}

// --- Poll for new items ---
function pollForNewItems(statusEl: HTMLElement | null): void {
  let attempts = 0;
  const maxAttempts = 7;
  const prevCount = allItems.length;

  function check(): void {
    attempts++;
    chrome.runtime.sendMessage({ type: 'getFeedItems', filter: {} }, function (res: any) {
      if (chrome.runtime.lastError) return;
      const items = (res && res.items) || [];
      if (items.length > prevCount || attempts >= maxAttempts) {
        allItems = items;
        applyFilters();
        loadFeeds();
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
      if (opmlStatus) opmlStatus.textContent = '请选择 OPML 文件';
      return;
    }

    btnImportOpml!.disabled = true;
    if (opmlStatus) opmlStatus.textContent = '导入中...';

    const reader = new FileReader();
    reader.onload = function (e) {
      chrome.runtime.sendMessage({ type: 'importFeedsOpml', opmlText: (e.target as FileReader).result }, function (res: any) {
        btnImportOpml!.disabled = false;
        if (res && res.ok) {
          if (opmlStatus) opmlStatus.textContent = '导入完成：新增 ' + res.result.added + ' / 共 ' + res.result.total + ' 条';
          opmlFile!.value = '';
          loadFeeds();
          pollForNewItems(opmlStatus);
        } else {
          if (opmlStatus) opmlStatus.textContent = '导入失败: ' + ((res && res.error) || '未知错误');
        }
        setTimeout(function () { if (opmlStatus) opmlStatus.textContent = ''; }, 4000);
      });
    };
    reader.onerror = function () {
      btnImportOpml!.disabled = false;
      if (opmlStatus) opmlStatus.textContent = '文件读取失败';
    };
    reader.readAsText(opmlFile.files[0]);
  });
}

// --- Load feed items ---
function loadItems(): void {
  chrome.runtime.sendMessage({ type: 'getFeedItems', filter: {} }, function (res: any) {
    if (chrome.runtime.lastError) return;
    allItems = (res && res.items) || [];
    applyFilters();
  });
}

function applyFilters(): void {
  const search = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const type = filterType ? filterType.value : '';
  const status = filterStatus ? filterStatus.value : '';
  const dateDays = filterDate ? filterDate.value : '';
  let dateCutoff = 0;
  if (dateDays) dateCutoff = Date.now() - parseInt(dateDays, 10) * 86400000;

  filteredItems = allItems.filter(function (item) {
    if (search && (item.title || '').toLowerCase().indexOf(search) === -1) return false;
    if (activeChannelId && item.feedId !== activeChannelId) return false;
    if (type) {
      const feedType = (item as any).tags && (item as any).tags[0] ? (item as any).tags[0] : '';
      if (feedType !== type) return false;
    }
    if (status && item.status !== status) return false;
    if (dateCutoff) {
      const pubTime = item.pubDate ? new Date(item.pubDate).getTime() : 0;
      if (pubTime < dateCutoff) return false;
    }
    return true;
  });

  currentPage = 1;
  renderPage();
}

function renderPage(): void {
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageItems = filteredItems.slice(start, end);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  if (pageItems.length === 0) {
    contentList.innerHTML = '<div class="empty-state">' +
      '暂无内容' + (allItems.length === 0 ? '，点击"刷新"获取' : '') + '</div>';
  } else {
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
    cb.addEventListener('change', function (this: HTMLInputElement) {
      const guid = this.getAttribute('data-guid')!;
      if (this.checked) selectedGuids[guid] = true;
      else delete selectedGuids[guid];
      updateSelectionUI();
    });
  });

  if (btnPrev) btnPrev.disabled = currentPage <= 1;
  if (btnNext) btnNext.disabled = currentPage >= totalPages;
  if (pageInfo) pageInfo.textContent = '第 ' + currentPage + ' / ' + totalPages + ' 页 (共 ' + filteredItems.length + ' 条)';

  updateSelectionUI();
}

function updateSelectionUI(): void {
  const count = Object.keys(selectedGuids).length;
  if (pageSelCount) pageSelCount.textContent = '已选 ' + count + ' 条';
  if (btnBatchSubmit) btnBatchSubmit.disabled = count === 0;
  if (batchBar) batchBar.classList.toggle('visible', count > 0);
}

function debounce(fn: () => void, delay: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return function () { clearTimeout(timer); timer = setTimeout(fn, delay); };
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
  const totalPages = Math.ceil(filteredItems.length / pageSize);
  if (currentPage < totalPages) { currentPage++; renderPage(); }
});

if (pageSelectAll) {
  pageSelectAll.addEventListener('change', function (this: HTMLInputElement) {
    const checked = this.checked;
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageItems = filteredItems.slice(start, end);

    if (checked) {
      pageItems.forEach(function (item) { selectedGuids[item.guid] = true; });
    } else {
      pageItems.forEach(function (item) { delete selectedGuids[item.guid]; });
    }
    contentList.querySelectorAll('.feed-item-check').forEach(function (cb) {
      (cb as HTMLInputElement).checked = checked;
    });
    updateSelectionUI();
  });
}

if (btnRefreshAll) {
  btnRefreshAll.addEventListener('click', function () {
    btnRefreshAll!.disabled = true;
    btnRefreshAll!.textContent = '刷新中...';
    chrome.runtime.sendMessage({ type: 'refreshAllFeedItems' }, function (res: any) {
      btnRefreshAll!.disabled = false;
      btnRefreshAll!.textContent = '刷新';
      if (res && res.ok) {
        const msg = '+' + (res.result.newItems || 0);
        btnRefreshAll!.textContent = '刷新 (' + msg + ')';
        setTimeout(function () { btnRefreshAll!.textContent = '刷新'; }, 2000);
      }
      loadItems();
      loadFeeds();
    });
  });
}

if (btnBatchSubmit) {
  btnBatchSubmit.addEventListener('click', function () {
    const guids = Object.keys(selectedGuids);
    if (guids.length === 0) return;

    btnBatchSubmit!.disabled = true;
    btnBatchSubmit!.textContent = '正在提交中...';

    // Immediately mark selected items as 'submitting' in local state
    const guidSet: Record<string, boolean> = {};
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
    chrome.runtime.sendMessage({ type: 'submitFeedItems', guids }, function () {
      btnBatchSubmit!.textContent = '提交选中';
      btnBatchSubmit!.disabled = false;
      loadItems();
    });
  });
}

// --- Init ---
loadFeeds();
loadItems();