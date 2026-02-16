// background/index.ts — Main entry point for the service worker
// Replaces src/background.js

import type { Note } from '../core/types';
import { ALARM_NAME } from '../services/feed-manager';
import { checkAllFeeds } from '../services/feed-manager';
import { createMessageListener } from './message-router';
import type { RouterContext } from './message-router';

// --- Header filtering ---

const ALLOWED_HEADER_KEYS = [
  'authorization',
  'x-auth-token',
  'cookie',
  'x-csrf-token',
  'x-request-id',
  'x-access-token',
  'token',
];

function filterHeaders(h: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of Object.keys(h)) {
    if (ALLOWED_HEADER_KEYS.includes(key.toLowerCase())) {
      filtered[key] = h[key];
    }
  }
  return filtered;
}

// --- Shared state ---

let capturedApiHeaders: Record<string, string> | null = null;

// Restore cached headers from storage on SW startup
chrome.storage.local.get('apiHeaders', data => {
  if (data.apiHeaders) {
    capturedApiHeaders = data.apiHeaders;
  }
});

// --- Helper functions ---

function storeNotes(newNotes: Note[]): void {
  if (!newNotes || !newNotes.length) return;
  chrome.storage.local.get('notes', data => {
    const notes: Record<string, any> = data.notes || {};
    newNotes.forEach(n => {
      if (!n.id) return;
      const existing = notes[n.id] || {};
      notes[n.id] = Object.assign({}, existing, n);
    });
    chrome.storage.local.set({ notes }, () => {
      const count = Object.keys(notes).length;
      updateBadge(count);
      (chrome.runtime.sendMessage as Function)({ type: 'notesUpdated', count }).catch(() => {});
    });
  });
}

function storeDiscoveryLog(entry: { url: string; preview: string }): void {
  chrome.storage.local.get('discoveryLogs', data => {
    let logs: any[] = data.discoveryLogs || [];
    logs.unshift({
      url: entry.url,
      preview: entry.preview,
      time: new Date().toISOString(),
    });
    if (logs.length > 100) logs = logs.slice(0, 100);
    chrome.storage.local.set({ discoveryLogs: logs });
  });
}

function updateBadge(count: number): void {
  const text = count > 0 ? String(count) : '';
  (chrome as any).action.setBadgeText({ text });
  (chrome as any).action.setBadgeBackgroundColor({ color: '#6C5CE7' });
}

// --- Build RouterContext ---

const ctx: RouterContext = {
  getHeaders() {
    return capturedApiHeaders;
  },
  setHeaders(h) {
    capturedApiHeaders = filterHeaders(h);
    chrome.storage.local.set({ apiHeaders: capturedApiHeaders });
  },
  storeNotes,
  storeDiscoveryLog,
  updateBadge,
};

// --- Register listeners ---

(chrome.runtime as any).onMessage.addListener(createMessageListener(ctx));

// Feed alarm handler
(chrome as any).alarms.onAlarm.addListener((alarm: any) => {
  if (alarm.name === ALARM_NAME) {
    if (capturedApiHeaders) {
      checkAllFeeds(capturedApiHeaders).catch(err => {
        console.warn('[Biji Ext] Scheduled feed check failed:', err.message);
      });
    }
  }
});

// Initialize badge on startup
chrome.storage.local.get('notes', data => {
  const count = data.notes ? Object.keys(data.notes).length : 0;
  updateBadge(count);
});
