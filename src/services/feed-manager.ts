// Feed Manager — RSS/Atom feed management
// Rewritten from feed-manager.js

import type { Feed, FeedItem, FeedItemFilter } from '../core/types';
import { parseFeedXml, parseOpml } from './feed-parser';
import { submitLink } from './link-submitter';
import { storePendingTags } from './tag-manager';

const FEEDS_KEY = 'feeds';
const FEED_ITEMS_KEY = 'feedItems';
const FEED_SUBMITTED_KEY = 'feedSubmittedItems';
const ALARM_NAME = 'biji-feed-check';
const SUBMIT_DELAY = 1000;
const MAX_ITEMS = 10000;

// --- Host permission helpers ---

function extractOriginPattern(url: string): string {
  const u = new URL(url);
  return u.origin + '/*';
}

/** Request host permission for a URL. Must be called from a user-gesture context. */
export function ensureHostPermission(url: string): Promise<void> {
  const pattern = extractOriginPattern(url);
  return new Promise((resolve, reject) => {
    (chrome as any).permissions.contains({ origins: [pattern] }, (has: boolean) => {
      if (has) return resolve();
      (chrome as any).permissions.request({ origins: [pattern] }, (granted: boolean) => {
        if (granted) resolve();
        else reject(new Error('用户拒绝了对 ' + new URL(url).hostname + ' 的访问权限'));
      });
    });
  });
}

/** Check host permission without requesting (safe for alarm/background context). */
export function hasHostPermission(url: string): Promise<boolean> {
  const pattern = extractOriginPattern(url);
  return new Promise(resolve => {
    (chrome as any).permissions.contains({ origins: [pattern] }, resolve);
  });
}

function detectFeedType(url: string): Feed['type'] {
  if (/youtube\.com/i.test(url)) return 'youtube';
  if (/bilibili\.com/i.test(url)) return 'bilibili';
  if (/xiaoyuzhoufm\.com|podcast|anchor\.fm|podcasts\.apple/i.test(url)) return 'podcast';
  return 'other';
}

// --- Feed CRUD ---

export function getFeeds(): Promise<Feed[]> {
  return new Promise(resolve => {
    chrome.storage.local.get(FEEDS_KEY, (data: Record<string, any>) => {
      resolve(data[FEEDS_KEY] || []);
    });
  });
}

function saveFeeds(feeds: Feed[]): Promise<void> {
  return new Promise(resolve => {
    const obj: Record<string, any> = {};
    obj[FEEDS_KEY] = feeds;
    chrome.storage.local.set(obj, resolve);
  });
}

export function addFeed(url: string, name?: string, type?: string, channelName?: string): Promise<Feed> {
  return getFeeds().then(feeds => {
    const exists = feeds.some(f => f.url === url);
    if (exists) throw new Error('该订阅源已存在');

    const feed: Feed = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      url,
      name: name || url,
      enabled: true,
      addedAt: new Date().toISOString(),
      lastChecked: null,
      type: (type as Feed['type']) || detectFeedType(url),
      channelName: channelName || name || url,
    };
    feeds.push(feed);
    return saveFeeds(feeds).then(() => {
      refreshFeedItems(feed.id).catch(err => {
        console.warn('[Biji Ext] Auto-refresh after addFeed failed:', err.message);
      });
      return feed;
    });
  });
}

export function removeFeed(feedId: string): Promise<void> {
  return getFeeds().then(feeds => {
    feeds = feeds.filter(f => f.id !== feedId);
    return saveFeeds(feeds);
  });
}

export function toggleFeed(feedId: string): Promise<Feed | null> {
  return getFeeds().then(feeds => {
    let target: Feed | null = null;
    feeds.forEach(f => {
      if (f.id === feedId) { f.enabled = !f.enabled; target = f; }
    });
    return saveFeeds(feeds).then(() => target);
  });
}

export function editFeed(feedId: string, updates: Partial<Feed>): Promise<Feed | null> {
  return getFeeds().then(feeds => {
    let target: Feed | null = null;
    feeds.forEach(f => {
      if (f.id === feedId) {
        if (updates.name !== undefined) f.name = updates.name;
        if (updates.url !== undefined) f.url = updates.url;
        if (updates.type !== undefined) f.type = updates.type;
        if (updates.channelName !== undefined) f.channelName = updates.channelName;
        target = f;
      }
    });
    return saveFeeds(feeds).then(() => target);
  });
}

// --- Feed Items ---

export function getFeedItems(filter?: FeedItemFilter): Promise<any[]> {
  return new Promise(resolve => {
    chrome.storage.local.get(FEED_ITEMS_KEY, (data: Record<string, any>) => {
      const items = data[FEED_ITEMS_KEY] || {};
      let arr = Object.values(items) as any[];

      if (filter) {
        if (filter.feedId) arr = arr.filter(i => i.feedId === filter.feedId);
        if (filter.status) arr = arr.filter(i => i.status === filter.status);
      }

      arr.sort((a, b) => {
        const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        return db - da;
      });

      resolve(arr);
    });
  });
}

function saveFeedItems(items: Record<string, any>): Promise<void> {
  return new Promise(resolve => {
    const obj: Record<string, any> = {};
    obj[FEED_ITEMS_KEY] = items;
    chrome.storage.local.set(obj, resolve);
  });
}

function pruneItems(items: Record<string, any>): Record<string, any> {
  const keys = Object.keys(items);
  if (keys.length <= MAX_ITEMS) return items;

  const removable = keys.filter(k => items[k].status === 'submitted' || items[k].status === 'noted');
  removable.sort((a, b) => {
    const da = items[a].pubDate ? new Date(items[a].pubDate).getTime() : 0;
    const db = items[b].pubDate ? new Date(items[b].pubDate).getTime() : 0;
    return da - db;
  });

  const toRemove = keys.length - MAX_ITEMS;
  for (let i = 0; i < toRemove && i < removable.length; i++) {
    delete items[removable[i]];
  }
  return items;
}

// --- Legacy submitted items ---

function getSubmittedItems(): Promise<Record<string, string>> {
  return new Promise(resolve => {
    chrome.storage.local.get(FEED_SUBMITTED_KEY, (data: Record<string, any>) => {
      resolve(data[FEED_SUBMITTED_KEY] || {});
    });
  });
}

function markItemSubmitted(guid: string): Promise<void> {
  return getSubmittedItems().then(items => {
    items[guid] = new Date().toISOString();
    const keys = Object.keys(items);
    if (keys.length > 5000) {
      const sorted = keys.sort((a, b) => items[b].localeCompare(items[a]));
      const pruned: Record<string, string> = {};
      sorted.slice(0, 5000).forEach(k => { pruned[k] = items[k]; });
      items = pruned;
    }
    return new Promise(resolve => {
      const obj: Record<string, any> = {};
      obj[FEED_SUBMITTED_KEY] = items;
      chrome.storage.local.set(obj, resolve);
    });
  });
}

// --- Refresh feeds ---

export function refreshFeedItems(feedId: string): Promise<any> {
  return getFeeds().then(feeds => {
    let feed: Feed | null = null;
    feeds.forEach(f => { if (f.id === feedId) feed = f; });
    if (!feed) throw new Error('Feed not found');
    return _fetchAndStoreFeedItems([feed]);
  });
}

export function refreshAllFeedItems(): Promise<any> {
  return getFeeds().then(feeds => {
    const enabled = feeds.filter(f => f.enabled);
    return _fetchAndStoreFeedItems(enabled);
  });
}

function _fetchAndStoreFeedItems(feedList: Feed[]): Promise<{ newItems: number; checked: number }> {
  return new Promise(resolve => {
    chrome.storage.local.get(FEED_ITEMS_KEY, (data: Record<string, any>) => {
      const allItems = data[FEED_ITEMS_KEY] || {};
      let totalNew = 0;
      const feedThumbnailUpdates: Record<string, string> = {};
      const feedNameUpdates: Record<string, string> = {};
      const feedErrorUpdates: Record<string, string> = {};

      function processFeed(index: number): void {
        if (index >= feedList.length) {
          const pruned = pruneItems(allItems);
          saveFeedItems(pruned).then(() => {
            getFeeds().then(feeds => {
              const now = new Date().toISOString();
              feedList.forEach(fl => {
                feeds.forEach((f: any) => {
                  if (f.id === fl.id) {
                    f.lastChecked = now;
                    if (feedThumbnailUpdates[f.id]) f.thumbnail = feedThumbnailUpdates[f.id];
                    if (feedNameUpdates[f.id]) {
                      f.channelName = feedNameUpdates[f.id];
                      if (f.name === f.url) f.name = feedNameUpdates[f.id];
                    }
                    f.lastError = feedErrorUpdates[f.id] || '';
                  }
                });
              });
              saveFeeds(feeds).then(() => {
                resolve({ newItems: totalNew, checked: feedList.length });
              });
            });
          });
          return;
        }

        const feed = feedList[index] as any;
        hasHostPermission(feed.url).then(hasPerm => {
          if (!hasPerm) {
            console.warn('[Biji Ext] Skipping feed (no host permission):', feed.url);
            feedErrorUpdates[feed.id] = '无访问权限，请在订阅管理页面手动刷新以授权';
            processFeed(index + 1);
            return;
          }
          fetchFeedContent(feed.url)
          .then(xmlText => {
            const result = parseFeedXml(xmlText);
            const parsed = result.items;
            const channelInfo = result.channel;

            if (channelInfo.thumbnail && !feed.thumbnail) {
              feed.thumbnail = channelInfo.thumbnail;
              feedThumbnailUpdates[feed.id] = channelInfo.thumbnail;
            }
            if (channelInfo.title && feed.channelName === feed.url) {
              feed.channelName = channelInfo.title;
              feedNameUpdates[feed.id] = channelInfo.title;
            }
            feedErrorUpdates[feed.id] = '';

            parsed.forEach(item => {
              const key = item.guid || item.url;
              if (!allItems[key]) {
                allItems[key] = {
                  guid: key,
                  feedId: feed.id,
                  title: item.title,
                  url: item.url,
                  pubDate: item.pubDate,
                  thumbnail: item.thumbnail,
                  description: item.description,
                  duration: item.duration || '',
                  enclosureUrl: item.enclosureUrl || '',
                  status: 'new',
                  submittedAt: null,
                  noteId: null,
                  tags: [feed.type || 'other', feed.channelName || feed.name],
                };
                totalNew++;
              }
            });
            processFeed(index + 1);
          })
          .catch(err => {
            console.warn('[Biji Ext] Feed refresh failed for', feed.url, err.message);
            feedErrorUpdates[feed.id] = err.message;
            processFeed(index + 1);
          });
        });
      }

      processFeed(0);
    });
  });
}

// --- Submit feed items ---

export function submitFeedItems(
  guids: string[],
  capturedHeaders: Record<string, string>,
): Promise<any[]> {
  if (!capturedHeaders) return Promise.reject(new Error('未捕获到认证信息'));

  const STAGGER_MS = 200;

  return new Promise(resolve => {
    chrome.storage.local.get(FEED_ITEMS_KEY, (data: Record<string, any>) => {
      const allItems = data[FEED_ITEMS_KEY] || {};
      const toSubmit = guids.map(g => allItems[g]).filter(Boolean);

      const promises = toSubmit.map((item, idx) => {
        return new Promise<void>(r => { setTimeout(r, idx * STAGGER_MS); })
          .then(() => {
            return submitLink(item.url, item.title, capturedHeaders)
              .then(result => {
                item.status = 'submitted';
                item.submittedAt = new Date().toISOString();
                item.noteId = (result && result.noteId) || null;
                markItemSubmitted(item.guid || item.url);
                if (item.noteId && item.tags && item.tags.length > 0) {
                  storePendingTags(item.noteId, item.tags);
                }
                return { guid: item.guid, noteId: item.noteId, error: null };
              })
              .catch(err => ({ guid: item.guid, noteId: null, error: err.message }));
          });
      });

      Promise.all(promises).then(results => {
        saveFeedItems(allItems).then(() => resolve(results));
      });
    });
  });
}

// --- Check all feeds ---

export function checkAllFeeds(capturedHeaders: Record<string, string>): Promise<any> {
  return new Promise(resolve => {
    chrome.storage.local.get('settings', (data: Record<string, any>) => {
      const settings = data.settings || {};
      const autoSubmit = settings.feedAutoSubmit !== false;

      if (autoSubmit) {
        _checkAllFeedsAutoSubmit(capturedHeaders).then(resolve);
      } else {
        refreshAllFeedItems().then(resolve);
      }
    });
  });
}

function _checkAllFeedsAutoSubmit(capturedHeaders: Record<string, string>): Promise<any> {
  if (!capturedHeaders) return Promise.reject(new Error('未捕获到认证信息'));

  return Promise.all([getFeeds(), getSubmittedItems()]).then(([feeds, submittedItems]) => {
    const enabledFeeds = feeds.filter(f => f.enabled);
    let totalNew = 0;

    function processFeed(index: number): Promise<{ checked: number; newItems: number }> {
      if (index >= enabledFeeds.length) {
        return Promise.resolve({ checked: enabledFeeds.length, newItems: totalNew });
      }

      const feed = enabledFeeds[index];
      return hasHostPermission(feed.url).then(hasPerm => {
        if (!hasPerm) {
          console.warn('[Biji Ext] Skipping feed (no host permission):', feed.url);
          return processFeed(index + 1);
        }
        return fetchFeedContent(feed.url)
          .then(xmlText => {
          const items = parseFeedXml(xmlText).items;
          const newItems = items.filter(item => !submittedItems[item.guid] && !submittedItems[item.url]);

          return getFeeds().then(allFeeds => {
            allFeeds.forEach((f: any) => {
              if (f.id === feed.id) f.lastChecked = new Date().toISOString();
            });
            return saveFeeds(allFeeds).then(() =>
              _submitItemsSequentially(newItems, capturedHeaders),
            );
          });
        })
        .then(submitted => {
          totalNew += submitted;
          return processFeed(index + 1);
        })
        .catch(err => {
          console.warn('[Biji Ext] Feed check failed for', feed.url, err.message);
          return processFeed(index + 1);
        });
      });
    }

    return processFeed(0);
  });
}

function fetchFeedContent(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  return fetch(url, {
    signal: controller.signal,
    headers: {
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; BijiFeedReader/1.0)',
    },
  }).then(resp => {
    clearTimeout(timeoutId);
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
    return resp.text();
  }).catch(err => {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('请求超时（15秒）');
    throw err;
  });
}

function _submitItemsSequentially(
  items: Array<{ url: string; title: string; guid: string }>,
  capturedHeaders: Record<string, string>,
): Promise<number> {
  let count = 0;
  function submitNext(index: number): Promise<number> {
    if (index >= items.length) return Promise.resolve(count);
    const item = items[index];
    return submitLink(item.url, item.title, capturedHeaders)
      .then(() => {
        count++;
        return markItemSubmitted(item.guid || item.url);
      })
      .catch(err => {
        console.warn('[Biji Ext] Feed item submit failed:', item.url, err.message);
      })
      .then(() => new Promise<void>(resolve => { setTimeout(resolve, SUBMIT_DELAY); }))
      .then(() => submitNext(index + 1));
  }
  return submitNext(0);
}

// --- OPML import ---

export function importFeedsOpml(opmlText: string): Promise<{ added: number; total: number }> {
  const parsed = parseOpml(opmlText);
  if (parsed.length === 0) return Promise.reject(new Error('未找到有效的订阅源'));

  return getFeeds().then(feeds => {
    let added = 0;
    const newFeedIds: string[] = [];
    parsed.forEach(p => {
      const exists = feeds.some(f => f.url === p.url);
      if (!exists) {
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 4) + added;
        feeds.push({
          id,
          url: p.url,
          name: p.name || p.url,
          enabled: true,
          addedAt: new Date().toISOString(),
          lastChecked: null,
          type: (p.type as Feed['type']) || detectFeedType(p.url),
          channelName: p.name || p.url,
        });
        newFeedIds.push(id);
        added++;
      }
    });
    return saveFeeds(feeds).then(() => {
      if (newFeedIds.length > 0) {
        getFeeds().then(allFeeds => {
          const newFeeds = allFeeds.filter(f => newFeedIds.indexOf(f.id) !== -1);
          _fetchAndStoreFeedItems(newFeeds).catch(err => {
            console.warn('[Biji Ext] Auto-refresh after OPML import failed:', err.message);
          });
        });
      }
      return { added, total: parsed.length };
    });
  });
}

// --- YouTube URL conversion ---

export function convertYoutubeUrl(url: string): Promise<string> {
  const channelMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
  if (channelMatch) {
    return Promise.resolve('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelMatch[1]);
  }

  const handleMatch = url.match(/youtube\.com\/@([^/?#]+)/);
  if (handleMatch) {
    return fetch('https://www.youtube.com/@' + handleMatch[1])
      .then(resp => resp.text())
      .then(html => {
        const cidMatch = html.match(/channel_id=([^"&]+)/) ||
          html.match(/"channelId":"([^"]+)"/) ||
          html.match(/externalId":"([^"]+)"/);
        if (cidMatch) return 'https://www.youtube.com/feeds/videos.xml?channel_id=' + cidMatch[1];
        throw new Error('无法从页面提取 channel_id');
      });
  }

  return Promise.reject(new Error('不支持的 YouTube URL 格式'));
}

// --- Data migration ---

function migrateFeeds(): Promise<void> {
  return getFeeds().then(feeds => {
    let changed = false;
    feeds.forEach((f: any) => {
      if (!f.type) { f.type = detectFeedType(f.url); changed = true; }
      if (!f.channelName) { f.channelName = f.name; changed = true; }
    });
    if (changed) return saveFeeds(feeds);
    return Promise.resolve();
  });
}

// --- Alarm management ---

export function setupAlarm(): void {
  chrome.storage.local.get('settings', (data: Record<string, any>) => {
    const s = data.settings || {};
    if (s.feedAutoCheck) {
      const interval = s.feedCheckInterval || 60;
      (chrome as any).alarms.create(ALARM_NAME, { periodInMinutes: interval });
    } else {
      (chrome as any).alarms.clear(ALARM_NAME);
    }
  });
}

// Initialize on load
setupAlarm();
migrateFeeds();

export { ALARM_NAME };

export const FeedManagerModule = {
  getFeeds, addFeed, removeFeed, toggleFeed, editFeed,
  checkAllFeeds, getFeedItems, refreshFeedItems, refreshAllFeedItems,
  submitFeedItems, importFeedsOpml, convertYoutubeUrl, setupAlarm, ALARM_NAME,
  ensureHostPermission, hasHostPermission,
};
