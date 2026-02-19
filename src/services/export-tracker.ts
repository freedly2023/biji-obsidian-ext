// Export Tracker — tracks which note IDs have been exported
// Extracted from shared.js ExportTracker

import type { Note } from '../core/types';

type NoteLike = Pick<Note, 'id'>;

let _exportedSet: Set<string> | null = null;
let _lastExportTime: string | null = null;

export function load(cb?: () => void): void {
  chrome.storage.local.get(['exportedIds', 'lastExportTime'], function (data: Record<string, any>) {
    _exportedSet = new Set(data.exportedIds || []);
    _lastExportTime = data.lastExportTime || null;
    if (cb) cb();
  });
}

export function markExported(ids: string[]): void {
  if (!_exportedSet) _exportedSet = new Set();
  ids.forEach(id => _exportedSet!.add(id));
  _lastExportTime = new Date().toISOString();
  chrome.storage.local.set({
    exportedIds: Array.from(_exportedSet),
    lastExportTime: _lastExportTime,
  });
}

export function isExported(id: string): boolean {
  return _exportedSet ? _exportedSet.has(id) : false;
}

export function getNewCount(notes: NoteLike[]): number {
  return notes.filter(n => !isExported(n.id)).length;
}

export function getNewNotes<T extends NoteLike>(notes: T[]): T[] {
  return notes.filter(n => !isExported(n.id));
}

export function clear(cb?: () => void): void {
  _exportedSet = new Set();
  _lastExportTime = null;
  chrome.storage.local.remove(['exportedIds', 'lastExportTime'], function () {
    if (cb) cb();
  });
}

export const ExportTracker = { load, markExported, isExported, getNewCount, getNewNotes, clear };
