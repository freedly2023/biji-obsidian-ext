// subscription-shared.ts — Shared UI utilities for subscription pages
// Provides feed item card rendering, type/status badges, and formatting

import { escapeHtmlAttr } from '../core/sanitize';
import { formatRelativeDate } from '../core/date-utils';
import type { FeedItem } from '../core/types';

// --- Type badge rendering ---
const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  youtube: { bg: '#ff0000', text: '#fff' },
  podcast: { bg: '#8e44ad', text: '#fff' },
  bilibili: { bg: '#00a1d6', text: '#fff' },
  other: { bg: '#95a5a6', text: '#fff' },
};

const TYPE_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  podcast: '播客',
  bilibili: 'B站',
  other: '其他',
};

export function typeBadgeHtml(type: string): string {
  const c = TYPE_COLORS[type] || TYPE_COLORS.other;
  const label = TYPE_LABELS[type] || type || '其他';
  return (
    '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;' +
    'font-weight:600;background:' + c.bg + ';color:' + c.text + '">' +
    escapeHtmlAttr(label) + '</span>'
  );
}

// --- Status badge ---
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  'new': { bg: '#e8f5e9', text: '#2e7d32', label: '未提交' },
  submitted: { bg: '#e3f2fd', text: '#1565c0', label: '已提交' },
  noted: { bg: '#f3e5f5', text: '#7b1fa2', label: '已记录' },
  submitting: { bg: '#fff3e0', text: '#e65100', label: '正在提交' },
};

export function statusBadgeHtml(status: string): string {
  const s = STATUS_STYLES[status] || STATUS_STYLES['new'];
  return (
    '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;' +
    'background:' + s.bg + ';color:' + s.text + '">' + s.label + '</span>'
  );
}

// --- Format duration ---
export function formatDuration(dur: string | number | null | undefined): string {
  if (!dur) return '';
  const str = String(dur).trim();

  const isoMatch = str.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (isoMatch) {
    const h = parseInt(isoMatch[1] || '0', 10);
    const m = parseInt(isoMatch[2] || '0', 10);
    const totalMin = h * 60 + m;
    if (totalMin > 0) return totalMin + '分钟';
    const s = parseInt(isoMatch[3] || '0', 10);
    if (s > 0) return s + '秒';
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

// --- Feed item card HTML ---
export interface FeedItemCardOpts {
  checked?: boolean;
  showCheckbox?: boolean;
  thumbSize?: number;
}

export function feedItemCardHtml(item: FeedItem, opts?: FeedItemCardOpts): string {
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

  const metaParts: string[] = [];
  if (duration) metaParts.push(duration);
  if (relDate) metaParts.push(relDate);
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

// Re-export utility aliases used by pages
export { escapeHtmlAttr as escHtml } from '../core/sanitize';
export { formatRelativeDate } from '../core/date-utils';
