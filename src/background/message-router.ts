// message-router.ts — Route-table based message dispatcher
// Extracted from background.js:623-801

import { fetchAllNotes, cancelFetch, fetchNoteTranscript, fetchNoteContent } from './api-fetcher';
import { exportNoteViaAPI } from './export-api';
import { submitLink, isAlreadySubmitted, getSubmissionHistory } from '../services/link-submitter';
import { storePendingTags, getPendingTags } from '../services/tag-manager';
import {
  getFeeds, addFeed, removeFeed, toggleFeed, editFeed,
  checkAllFeeds, getFeedItems, refreshFeedItems, refreshAllFeedItems,
  submitFeedItems, importFeedsOpml, convertYoutubeUrl,
  ensureHostPermission,
} from '../services/feed-manager';
import { parseOpml } from '../services/feed-parser';
import type { Note } from '../core/types';

export interface RouterContext {
  getHeaders(): Record<string, string> | null;
  setHeaders(h: Record<string, string>): void;
  storeNotes(notes: Note[]): void;
  storeDiscoveryLog(entry: { url: string; preview: string }): void;
  updateBadge(count: number): void;
}

type MessageHandler = (
  msg: any,
  sender: any,
  sendResponse: (response?: any) => void,
  ctx: RouterContext,
) => boolean | void;

function toNoteMeta(note: any): Record<string, any> | null {
  if (!note || !note.id) return null;
  return {
    id: String(note.id),
    title: note.title || '',
    createdAt: note.createdAt || '',
    updatedAt: note.updatedAt || '',
    type: note.type || 'text',
    noteType: note.noteType || null,
  };
}

const routes: Record<string, MessageHandler> = {
  notes(_msg, _sender, _sendResponse, ctx) {
    ctx.storeNotes(_msg.payload.notes);
  },

  discovery(_msg, _sender, _sendResponse, ctx) {
    ctx.storeDiscoveryLog(_msg.payload);
  },

  getNotes(_msg, _sender, sendResponse) {
    chrome.storage.local.get('notes', data => {
      sendResponse({ notes: data.notes || {} });
    });
    return true;
  },

  getNotesMeta(_msg, _sender, sendResponse) {
    chrome.storage.local.get('notes', data => {
      const notes = data.notes || {};
      const arr = Object.values(notes)
        .map(toNoteMeta)
        .filter(Boolean);
      sendResponse({ notes: arr });
    });
    return true;
  },

  getNotesByIds(msg, _sender, sendResponse) {
    const ids = Array.isArray(msg.ids) ? msg.ids.map((id: any) => String(id)) : [];
    chrome.storage.local.get('notes', data => {
      const notes: Record<string, any> = data.notes || {};
      if (ids.length === 0) {
        sendResponse({ notes: [] });
        return;
      }
      const selected = ids
        .map((id: string) => notes[id])
        .filter(Boolean);
      sendResponse({ notes: selected });
    });
    return true;
  },

  getDiscovery(_msg, _sender, sendResponse) {
    chrome.storage.local.get('discoveryLogs', data => {
      sendResponse({ logs: data.discoveryLogs || [] });
    });
    return true;
  },

  clearNotes(_msg, _sender, sendResponse, ctx) {
    chrome.storage.local.remove('notes', () => {
      ctx.updateBadge(0);
      sendResponse({ ok: true });
    });
    return true;
  },

  clearDiscovery(_msg, _sender, sendResponse) {
    chrome.storage.local.remove('discoveryLogs', () => {
      sendResponse({ ok: true });
    });
    return true;
  },

  storeVueNotes(_msg, _sender, _sendResponse, ctx) {
    ctx.storeNotes(_msg.notes);
  },

  apiHeaders(_msg, _sender, _sendResponse, ctx) {
    ctx.setHeaders(_msg.payload.headers);
  },

  fetchTranscript(msg, _sender, sendResponse, ctx) {
    const headers = ctx.getHeaders();
    if (!headers) {
      sendResponse({ noteId: msg.noteId, transcript: null });
      return true;
    }
    fetchNoteTranscript(headers, msg.noteId, msg.noteType).then(transcript => {
      sendResponse({ noteId: msg.noteId, transcript });
    });
    return true;
  },

  fetchContent(msg, _sender, sendResponse, ctx) {
    const headers = ctx.getHeaders();
    if (!headers) {
      sendResponse({ noteId: msg.noteId, content: null });
      return true;
    }
    fetchNoteContent(headers, msg.noteId, msg.noteType).then(content => {
      sendResponse({ noteId: msg.noteId, content });
    });
    return true;
  },

  exportNote(msg, _sender, sendResponse, ctx) {
    const headers = ctx.getHeaders();
    if (!headers) {
      sendResponse({ error: 'No API headers captured. Browse biji.com first.' });
      return true;
    }
    exportNoteViaAPI(headers, msg.noteId, msg.format)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  },

  fetchAll(msg, _sender, _sendResponse, ctx) {
    const headers = ctx.getHeaders();
    if (!headers) return;
    const onStatus = (status: string, fetched: number, done: boolean) => {
      (chrome.runtime.sendMessage as Function)({
        type: 'fetchStatus',
        payload: { status, fetched, done },
      }).catch(() => {});
    };
    fetchAllNotes(headers, msg.fetchDelay || 500, onStatus, notes => ctx.storeNotes(notes));
  },

  cancelFetch() {
    cancelFetch();
  },

  submitLink(msg, _sender, sendResponse, ctx) {
    const headers = ctx.getHeaders();
    if (!headers) {
      sendResponse({ ok: false, error: '未捕获到认证信息' });
      return true;
    }
    submitLink(msg.url, msg.title, headers)
      .then(result => {
        const noteId = result && result.noteId;
        if (noteId && msg.tags && msg.tags.length > 0) {
          storePendingTags(noteId, msg.tags);
        }
        sendResponse({ ok: true, data: result });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  },

  isLinkSubmitted(msg, _sender, sendResponse) {
    isAlreadySubmitted(msg.url).then(submitted => {
      sendResponse({ submitted });
    });
    return true;
  },

  getSubmissionHistory(msg, _sender, sendResponse) {
    getSubmissionHistory(msg.limit).then(history => {
      sendResponse({ history });
    });
    return true;
  },

  getFeeds(_msg, _sender, sendResponse) {
    getFeeds().then(feeds => sendResponse({ feeds }));
    return true;
  },

  addFeed(msg, _sender, sendResponse) {
    ensureHostPermission(msg.url)
      .then(() => addFeed(msg.url, msg.name))
      .then(feed => sendResponse({ ok: true, feed }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  },

  removeFeed(msg, _sender, sendResponse) {
    removeFeed(msg.feedId).then(() => sendResponse({ ok: true }));
    return true;
  },

  toggleFeed(msg, _sender, sendResponse) {
    toggleFeed(msg.feedId).then(feed => sendResponse({ ok: true, feed }));
    return true;
  },

  checkFeedsNow(_msg, _sender, sendResponse, ctx) {
    const headers = ctx.getHeaders();
    if (!headers) {
      sendResponse({ ok: false, error: '未捕获到认证信息' });
      return true;
    }
    checkAllFeeds(headers)
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  },

  getFeedItems(msg, _sender, sendResponse) {
    getFeedItems(msg.filter).then(items => sendResponse({ items }));
    return true;
  },

  submitFeedItems(msg, _sender, sendResponse, ctx) {
    const headers = ctx.getHeaders();
    if (!headers) {
      sendResponse({ ok: false, error: '未捕获到认证信息' });
      return true;
    }
    submitFeedItems(msg.guids, headers)
      .then(results => sendResponse({ ok: true, results }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  },

  refreshAllFeedItems(_msg, _sender, sendResponse) {
    refreshAllFeedItems()
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  },

  refreshFeedItems(msg, _sender, sendResponse) {
    refreshFeedItems(msg.feedId)
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  },

  editFeed(msg, _sender, sendResponse) {
    editFeed(msg.feedId, msg.updates)
      .then(feed => sendResponse({ ok: true, feed }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  },

  importFeedsOpml(msg, _sender, sendResponse) {
    try {
      const parsed = parseOpml(msg.opmlText);
      const uniqueOrigins = [...new Set(parsed.map(p => {
        try { return new URL(p.url).origin + '/*'; } catch { return null; }
      }).filter(Boolean))] as string[];

      const requestPermissions = uniqueOrigins.length > 0
        ? new Promise<void>((resolve, reject) => {
            (chrome as any).permissions.request({ origins: uniqueOrigins }, (granted: boolean) => {
              if (granted) resolve();
              else reject(new Error('用户拒绝了访问权限'));
            });
          })
        : Promise.resolve();

      requestPermissions
        .then(() => importFeedsOpml(msg.opmlText))
        .then(result => sendResponse({ ok: true, result }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
    } catch (err: any) {
      sendResponse({ ok: false, error: err.message });
    }
    return true;
  },

  convertYoutubeUrl(msg, _sender, sendResponse) {
    ensureHostPermission(msg.url)
      .then(() => convertYoutubeUrl(msg.url))
      .then(rssUrl => sendResponse({ ok: true, rssUrl }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  },

  getPendingTags(_msg, _sender, sendResponse) {
    getPendingTags().then(tags => sendResponse({ tags }));
    return true;
  },
};

export function createMessageListener(
  ctx: RouterContext,
): (msg: any, sender: any, sendResponse: (r?: any) => void) => boolean | void {
  return (msg, sender, sendResponse) => {
    const handler = routes[msg.type];
    if (handler) return handler(msg, sender, sendResponse, ctx);
  };
}
