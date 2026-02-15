// subscription-shared.js — Shared rendering utilities for popup and subscriptions page

(function () {
  'use strict';

  var SubShared = {};

  // --- Type badge rendering ---
  var TYPE_COLORS = {
    youtube: { bg: '#ff0000', text: '#fff' },
    podcast: { bg: '#8e44ad', text: '#fff' },
    bilibili: { bg: '#00a1d6', text: '#fff' },
    other: { bg: '#95a5a6', text: '#fff' },
  };

  var TYPE_LABELS = {
    youtube: 'YouTube',
    podcast: '播客',
    bilibili: 'B站',
    other: '其他',
  };

  SubShared.typeBadgeHtml = function (type) {
    var c = TYPE_COLORS[type] || TYPE_COLORS.other;
    var label = TYPE_LABELS[type] || type || '其他';
    return (
      '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;' +
      'font-weight:600;background:' + c.bg + ';color:' + c.text + '">' +
      SubShared.escHtml(label) + '</span>'
    );
  };

  // --- Status badge ---
  var STATUS_STYLES = {
    'new': { bg: '#e8f5e9', text: '#2e7d32', label: '未提交' },
    submitted: { bg: '#e3f2fd', text: '#1565c0', label: '已提交' },
    noted: { bg: '#f3e5f5', text: '#7b1fa2', label: '已记录' },
  };

  SubShared.statusBadgeHtml = function (status) {
    var s = STATUS_STYLES[status] || STATUS_STYLES['new'];
    return (
      '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;' +
      'background:' + s.bg + ';color:' + s.text + '">' + s.label + '</span>'
    );
  };

  // --- Format duration ---
  // Accepts ISO 8601 duration (PT134M20S), HH:MM:SS, MM:SS, or raw seconds
  SubShared.formatDuration = function (dur) {
    if (!dur) return '';
    var str = String(dur).trim();

    // ISO 8601: PT1H30M20S or PT134M20S
    var isoMatch = str.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (isoMatch) {
      var h = parseInt(isoMatch[1] || '0', 10);
      var m = parseInt(isoMatch[2] || '0', 10);
      var totalMin = h * 60 + m;
      if (totalMin > 0) return totalMin + '分钟';
      var s = parseInt(isoMatch[3] || '0', 10);
      if (s > 0) return s + '秒';
      return '';
    }

    // HH:MM:SS or MM:SS
    var timeMatch = str.match(/^(\d+):(\d{2}):(\d{2})$/);
    if (timeMatch) {
      var totalMin2 = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
      return totalMin2 + '分钟';
    }
    var shortMatch = str.match(/^(\d+):(\d{2})$/);
    if (shortMatch) {
      return parseInt(shortMatch[1], 10) + '分钟';
    }

    // Raw number (seconds)
    var num = parseInt(str, 10);
    if (!isNaN(num) && num > 0) {
      return Math.round(num / 60) + '分钟';
    }

    return str;
  };

  // --- Feed item card HTML (小宇宙 style) ---
  SubShared.feedItemCardHtml = function (item, opts) {
    opts = opts || {};
    var checked = opts.checked ? ' checked' : '';
    var showCheckbox = opts.showCheckbox !== false;
    var thumbSize = opts.thumbSize || 72;

    var thumb = item.thumbnail
      ? '<img src="' + SubShared.escHtml(item.thumbnail) + '" ' +
        'style="width:' + thumbSize + 'px;height:' + thumbSize + 'px;object-fit:cover;border-radius:8px;flex-shrink:0" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<div style="width:' + thumbSize + 'px;height:' + thumbSize + 'px;background:#f0f0f0;border-radius:8px;flex-shrink:0;' +
        'display:none;align-items:center;justify-content:center;color:#ccc;font-size:20px">&#9654;</div>'
      : '<div style="width:' + thumbSize + 'px;height:' + thumbSize + 'px;background:#f0f0f0;border-radius:8px;flex-shrink:0;' +
        'display:flex;align-items:center;justify-content:center;color:#ccc;font-size:20px">&#9654;</div>';

    var duration = SubShared.formatDuration(item.duration);
    var relDate = SubShared.formatRelativeDate(item.pubDate);

    // Meta info line: duration · relative date · status
    var metaParts = [];
    if (duration) metaParts.push(duration);
    if (relDate) metaParts.push(relDate);
    var metaText = metaParts.join(' · ');

    var html = '<div class="feed-item-card" data-guid="' + SubShared.escHtml(item.guid) + '" ' +
      'style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid #f0f0f0">';

    if (showCheckbox) {
      html += '<input type="checkbox" class="feed-item-check" data-guid="' +
        SubShared.escHtml(item.guid) + '"' + checked +
        ' style="flex-shrink:0;accent-color:#6c5ce7;cursor:pointer;margin-top:' + Math.round(thumbSize / 2 - 7) + 'px">';
    }

    html += thumb;

    html += '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">';

    // Title: 2 lines, clamp
    html += '<a href="' + SubShared.escHtml(item.url) + '" target="_blank" ' +
      'style="color:#333;text-decoration:none;font-size:14px;font-weight:500;' +
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4" ' +
      'title="' + SubShared.escHtml(item.title) + '">' +
      SubShared.escHtml(item.title || '无标题') + '</a>';

    // Description: 2 lines, clamp
    if (item.description) {
      html += '<div style="color:#999;font-size:12px;line-height:1.4;' +
        'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' +
        SubShared.escHtml(item.description) + '</div>';
    }

    // Meta line
    html += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#bbb;margin-top:2px">';
    if (metaText) {
      html += '<span>' + SubShared.escHtml(metaText) + '</span>';
    }
    html += SubShared.statusBadgeHtml(item.status);
    // AI总结 / 原文 links for submitted items with noteId
    if (item.status === 'submitted' && item.noteId) {
      html += '<a href="https://www.biji.com/note/' + SubShared.escHtml(item.noteId) + '" target="_blank" ' +
        'style="font-size:11px;color:#6c5ce7;text-decoration:none;font-weight:500">AI总结</a>';
      html += '<a href="https://www.biji.com/note/' + SubShared.escHtml(item.noteId) + '/web" target="_blank" ' +
        'style="font-size:11px;color:#6c5ce7;text-decoration:none;font-weight:500">原文</a>';
    }
    html += '</div>';

    html += '</div></div>';

    return html;
  };

  // --- Utility ---
  SubShared.escHtml = function (str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  SubShared.formatRelativeDate = function (isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      var now = new Date();
      var diff = now - d;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
      if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
      return d.toISOString().substring(0, 10);
    } catch (e) { return ''; }
  };

  window.SubShared = SubShared;
})();
