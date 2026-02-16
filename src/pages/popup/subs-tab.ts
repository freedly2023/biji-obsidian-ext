// subs-tab.ts — Subscription tab logic for popup
// Extracted from popup.js lines 690-845

import { feedItemCardHtml } from '../../shared-ui/subscription-shared';
import type { FeedItem } from '../../core/types';

// --- DOM references ---
const subsList = document.getElementById('subsList')!;
const subsSelectAll = document.getElementById('subsSelectAll') as HTMLInputElement | null;
const subsSelCount = document.getElementById('subsSelCount');
const btnSubmitSelected = document.getElementById('btnSubmitSelected') as HTMLButtonElement | null;
const btnRefreshFeeds = document.getElementById('btnRefreshFeeds') as HTMLButtonElement | null;
const subsRefreshStatus = document.getElementById('subsRefreshStatus');
const subsStatusFilter = document.getElementById('subsStatusFilter') as HTMLSelectElement | null;
const btnOpenSubsPage = document.getElementById('btnOpenSubsPage');

// --- State ---
let subsItems: FeedItem[] = [];
let subsSelectedGuids: Record<string, boolean> = {};

// --- Open subscriptions page ---
if (btnOpenSubsPage) {
  btnOpenSubsPage.addEventListener('click', function (e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('subscriptions.html') });
  });
}

// --- Load subscription tab data ---
export function loadSubsTab(): void {
  const filter: Record<string, string> = {};
  const statusVal = subsStatusFilter ? subsStatusFilter.value : '';
  if (statusVal) filter.status = statusVal;

  chrome.runtime.sendMessage({ type: 'getFeedItems', filter }, function (res: any) {
    if (chrome.runtime.lastError) return;
    subsItems = (res && res.items) || [];
    renderSubsList();

    // Auto-refresh if no items but feeds exist
    if (subsItems.length === 0) {
      chrome.runtime.sendMessage({ type: 'getFeeds' }, function (feedRes: any) {
        if (chrome.runtime.lastError) return;
        const feeds = (feedRes && feedRes.feeds) || [];
        if (feeds.length > 0) {
          if (subsRefreshStatus) subsRefreshStatus.textContent = '正在获取内容...';
          chrome.runtime.sendMessage({ type: 'refreshAllFeedItems' }, function (refreshRes: any) {
            if (subsRefreshStatus) subsRefreshStatus.textContent = '';
            if (refreshRes && refreshRes.ok && refreshRes.result.newItems > 0) {
              loadSubsTab();
            }
          });
        }
      });
    }
  });
}

function renderSubsList(): void {
  if (!subsList) return;
  const display = subsItems.slice(0, 30);
  if (display.length === 0) {
    subsList.innerHTML = '';
    return;
  }
  let html = display.map(function (item) {
    return feedItemCardHtml(item, {
      checked: !!subsSelectedGuids[item.guid],
      showCheckbox: true,
    });
  }).join('');
  if (subsItems.length > 30) {
    html += '<div style="padding:8px;text-align:center;color:#999;font-size:11px">' +
      '...还有 ' + (subsItems.length - 30) + ' 条，打开管理页面查看全部</div>';
  }
  subsList.innerHTML = html;

  // Bind checkboxes
  subsList.querySelectorAll('.feed-item-check').forEach(function (cb) {
    cb.addEventListener('change', function (this: HTMLInputElement) {
      const guid = this.getAttribute('data-guid')!;
      if (this.checked) {
        subsSelectedGuids[guid] = true;
      } else {
        delete subsSelectedGuids[guid];
      }
      updateSubsSelectionUI();
    });
  });
  updateSubsSelectionUI();
}

function updateSubsSelectionUI(): void {
  const count = Object.keys(subsSelectedGuids).length;
  if (subsSelCount) subsSelCount.textContent = '已选 ' + count + ' 条';
  if (btnSubmitSelected) btnSubmitSelected.disabled = count === 0;
  if (subsSelectAll) {
    const displayed = subsItems.slice(0, 30);
    subsSelectAll.checked = displayed.length > 0 && count === displayed.length;
    subsSelectAll.indeterminate = count > 0 && count < displayed.length;
  }
}

if (subsSelectAll) {
  subsSelectAll.addEventListener('change', function (this: HTMLInputElement) {
    const checked = this.checked;
    subsSelectedGuids = {};
    if (checked) {
      subsItems.slice(0, 30).forEach(function (item) {
        subsSelectedGuids[item.guid] = true;
      });
    }
    subsList.querySelectorAll('.feed-item-check').forEach(function (cb) {
      (cb as HTMLInputElement).checked = checked;
    });
    updateSubsSelectionUI();
  });
}

if (subsStatusFilter) {
  subsStatusFilter.addEventListener('change', function () {
    subsSelectedGuids = {};
    loadSubsTab();
  });
}

if (btnRefreshFeeds) {
  btnRefreshFeeds.addEventListener('click', function () {
    btnRefreshFeeds!.disabled = true;
    if (subsRefreshStatus) subsRefreshStatus.textContent = '刷新中...';
    chrome.runtime.sendMessage({ type: 'refreshAllFeedItems' }, function (res: any) {
      btnRefreshFeeds!.disabled = false;
      if (res && res.ok) {
        if (subsRefreshStatus) subsRefreshStatus.textContent = '刷新完成，新增 ' + (res.result.newItems || 0) + ' 条';
      } else {
        if (subsRefreshStatus) subsRefreshStatus.textContent = '刷新失败: ' + ((res && res.error) || '未知错误');
      }
      loadSubsTab();
      setTimeout(function () { if (subsRefreshStatus) subsRefreshStatus.textContent = ''; }, 3000);
    });
  });
}

if (btnSubmitSelected) {
  btnSubmitSelected.addEventListener('click', function () {
    const guids = Object.keys(subsSelectedGuids);
    if (guids.length === 0) return;

    btnSubmitSelected!.disabled = true;
    btnSubmitSelected!.textContent = '正在提交中...';

    // Immediately mark selected items as 'submitting' in local state
    const guidSet: Record<string, boolean> = {};
    guids.forEach(function (g) { guidSet[g] = true; });
    subsItems.forEach(function (item) {
      if (guidSet[item.guid]) {
        item.status = 'submitting';
      }
    });

    // Clear selection before re-render so badge change is visible
    subsSelectedGuids = {};
    renderSubsList();

    // Wait for background to finish processing, then reload
    chrome.runtime.sendMessage({ type: 'submitFeedItems', guids }, function () {
      btnSubmitSelected!.textContent = '提交选中';
      btnSubmitSelected!.disabled = false;
      loadSubsTab();
    });
  });
}
