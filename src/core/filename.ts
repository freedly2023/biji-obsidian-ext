// File naming utilities
// Previously window.* globals in shared.js

import type { Note, Settings, DateParts } from './types';
import { formatDateShort } from './date-utils';
import { formatTags } from './markdown-converter';

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

export function getDateParts(note: Note, settings?: Settings | null): DateParts {
  const raw = note.createdAt;
  if (!raw) return { date: 'undated', year: 'undated', month: '00' };
  try {
    const d = new Date(typeof raw === 'number' ? (raw as number) * 1000 : raw);
    if (isNaN(d.getTime())) return { date: 'undated', year: 'undated', month: '00' };
    const fmt = (settings && settings.dateFormat) || 'YYYY-MM-DD';
    const dateStr = formatDateShort(raw, fmt) || 'undated';
    return {
      date: dateStr,
      year: String(d.getFullYear()),
      month: String(d.getMonth() + 1).padStart(2, '0'),
    };
  } catch {
    return { date: 'undated', year: 'undated', month: '00' };
  }
}

export function filename(note: Note, settings?: Settings | null): string {
  const template = (settings && settings.filenameTemplate) || '{date}-{title}';
  const parts = getDateParts(note, settings);
  const title = note.title ? sanitizeFilename(note.title) : 'note-' + note.id;
  let result = template
    .replace(/\{date\}/g, parts.date)
    .replace(/\{title\}/g, title)
    .replace(/\{id\}/g, note.id || 'unknown')
    .replace(/\{type\}/g, note.type || 'text')
    .replace(/\{year\}/g, parts.year)
    .replace(/\{month\}/g, parts.month);
  const segments = result.split('/').map(seg => seg.replace(/[<>:"|?*]/g, '').trim());
  result = segments.join('/');
  if (!result.endsWith('.md')) result += '.md';
  return result;
}

export function getFolderPrefix(note: Note, settings?: Settings | null): string {
  const mode = (settings && settings.folderMode) || 'flat';
  const template = (settings && settings.filenameTemplate) || '{date}-{title}';
  if (template.indexOf('/') !== -1) return '';
  if (mode === 'flat') return '';
  if (mode === 'byType') return (note.type || 'text') + '/';
  if (mode === 'byTag') {
    const tags = formatTags(note.tags);
    return tags.length > 0 ? tags[0] + '/' : 'untagged/';
  }
  if (mode === 'byMonth') {
    const parts = getDateParts(note, settings);
    return parts.year + '-' + parts.month + '/';
  }
  return '';
}

export function fullPath(note: Note, settings?: Settings | null): string {
  return getFolderPrefix(note, settings) + filename(note, settings);
}

export function getFileExt(format: string): string {
  if (format === 'pdf') return '.pdf';
  if (format === 'docx') return '.docx';
  return '.md';
}

export function fullPathWithFormat(
  note: Note,
  settings: Settings | null | undefined,
  format: string,
): string {
  let path = fullPath(note, settings);
  if (format !== 'md') {
    path = path.replace(/\.md$/, getFileExt(format));
  }
  return path;
}

export function deduplicateFilename(
  fn: string,
  used: Record<string, boolean>,
  ext: string,
): string {
  if (!used[fn]) return fn;
  const base = fn.replace(ext, '');
  let c = 2;
  while (used[base + '-' + c + ext]) c++;
  return base + '-' + c + ext;
}
