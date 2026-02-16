// Markdown converter — extracted from shared.js MD object

import type { Note, Settings, Tag } from './types';
import { formatDate, formatDateShort } from './date-utils';

export function formatTags(tags: (string | Tag)[] | null | undefined): string[] {
  if (!tags || !Array.isArray(tags)) return [];
  return tags
    .map(t => {
      const name = typeof t === 'string' ? t : (t as Tag).name || (t as Tag).label || '';
      return name.replace(/\s+/g, '-');
    })
    .filter(Boolean);
}

export function frontmatter(note: Note, settings?: Settings | null): string {
  const fields = (settings && settings.frontmatterFields) || {
    title: true,
    created: true,
    modified: true,
    source: true,
    type: true,
    tags: true,
    biji_id: true,
    exported: true,
  };
  const lines: string[] = ['---'];
  if (fields.title) {
    const title = note.title || 'Untitled';
    lines.push('title: "' + title.replace(/"/g, '\\"') + '"');
  }
  if (fields.created) {
    const created = formatDate(note.createdAt);
    if (created) lines.push('created: ' + created);
  }
  if (fields.modified) {
    const modified = formatDate(note.updatedAt);
    if (modified) lines.push('modified: ' + modified);
  }
  if (fields.source) {
    lines.push('source: "biji.com (Get笔记)"');
  }
  if (fields.type && note.type) {
    lines.push('type: ' + note.type);
  }
  if (fields.tags) {
    const tags = formatTags(note.tags);
    if (tags.length > 0) {
      lines.push('tags:');
      tags.forEach(t => {
        lines.push('  - "' + t + '"');
      });
    }
  }
  if (fields.biji_id && note.id) {
    lines.push('biji_id: "' + note.id + '"');
  }
  if (fields.exported) {
    lines.push('exported: ' + formatDate(new Date().toISOString()));
  }
  lines.push('---');
  return lines.join('\n');
}

export function htmlToMd(html: string): string {
  let md = html;
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');
  md = md.replace(/<[^>]+>/g, '');
  md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

export function formatImage(
  img: string | { url?: string; src?: string },
  index: number,
  settings?: Settings | null,
): string {
  const url = typeof img === 'string' ? img : (img.url || img.src || '');
  if (!url) return '';
  if (settings && settings.imageFormat === 'obsidian') {
    const fname = url.split('/').pop()!.split('?')[0] || 'image-' + (index + 1) + '.png';
    return '![[' + fname + ']]';
  }
  return '![图片 ' + (index + 1) + '](' + url + ')';
}

export function convert(note: Note, settings?: Settings | null): string {
  const parts: string[] = [frontmatter(note, settings), ''];
  if (note.title) {
    parts.push('# ' + note.title);
    parts.push('');
  }
  let content = note.content || '';
  if (content.includes('<') && content.includes('>')) {
    content = htmlToMd(content);
  } else {
    content = content.replace(/\r\n/g, '\n');
    if (note.type === 'voice' && (!settings || settings.voiceSentenceSplit !== false)) {
      content = content.replace(/([。！？.!?])\s*/g, '$1\n\n');
    }
  }
  parts.push(content);
  if (note.audioUrl && (!settings || settings.includeAudioLink !== false)) {
    parts.push('', '---', '**录音**: [收听](' + note.audioUrl + ')');
  }
  if (note.images && note.images.length > 0 && (!settings || settings.includeImages !== false)) {
    parts.push('', '---', '## 图片', '');
    note.images.forEach((img, i) => {
      const line = formatImage(img, i, settings);
      if (line) parts.push(line);
    });
  }
  return parts.join('\n');
}

export function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/m.test(text) ||
    /\*\*[^*]+\*\*/m.test(text) ||
    /\*[^*]+\*/m.test(text) ||
    /\[.+?\]\(.+?\)/m.test(text) ||
    /^[-*+]\s/m.test(text) ||
    /^\d+\.\s/m.test(text) ||
    /^---$/m.test(text) ||
    /^>\s/m.test(text)
  );
}

export function mdToHtml(md: string): string {
  let html = md;
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/\n/g, '<br>');
  return html;
}

export function convertTranscript(note: Note, settings?: Settings | null): string {
  const parts: string[] = [frontmatter(note, settings), ''];
  parts.push('# ' + (note.title || 'Untitled') + ' — Transcript');
  parts.push('');
  let content = note.rawTranscript || note.content || '';
  if (content.includes('<') && content.includes('>')) {
    content = htmlToMd(content);
  }
  parts.push(content);
  return parts.join('\n');
}

// Re-export as MD namespace object for backward compatibility during migration
export const MD = {
  formatDate,
  formatDateShort,
  formatTags,
  frontmatter,
  htmlToMd,
  formatImage,
  convert,
  _looksLikeMarkdown: looksLikeMarkdown,
  mdToHtml,
  convertTranscript,
};
