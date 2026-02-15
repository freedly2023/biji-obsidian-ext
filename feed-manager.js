// feed-manager.js — IIFE module for RSS/Atom feed management
// Loaded via importScripts in background.js service worker

var FeedManager = (function () {
  'use strict';

  var FEEDS_KEY = 'feeds';
  var FEED_ITEMS_KEY = 'feedItems';
  var FEED_SUBMITTED_KEY = 'feedSubmittedItems';
  var ALARM_NAME = 'biji-feed-check';
  var SUBMIT_DELAY = 1000;
  var MAX_ITEMS = 10000;

  // --- Feed type detection ---

  function detectFeedType(url) {
    if (/youtube\.com/i.test(url)) return 'youtube';
    if (/bilibili\.com/i.test(url)) return 'bilibili';
    if (/xiaoyuzhoufm\.com|podcast|anchor\.fm|podcasts\.apple/i.test(url)) return 'podcast';
    return 'other';
  }

  // --- Feed CRUD ---

  function getFeeds() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(FEEDS_KEY, function (data) {
        resolve(data[FEEDS_KEY] || []);
      });
    });
  }

  function saveFeeds(feeds) {
    return new Promise(function (resolve) {
      var obj = {};
      obj[FEEDS_KEY] = feeds;
      chrome.storage.local.set(obj, resolve);
    });
  }

  function addFeed(url, name, type, channelName) {
    return getFeeds().then(function (feeds) {
      var exists = feeds.some(function (f) { return f.url === url; });
      if (exists) throw new Error('该订阅源已存在');

      var feed = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        url: url,
        name: name || url,
        enabled: true,
        addedAt: new Date().toISOString(),
        lastChecked: null,
        type: type || detectFeedType(url),
        channelName: channelName || name || url,
      };
      feeds.push(feed);
      return saveFeeds(feeds).then(function () {
        // Fire-and-forget: fetch content for the new feed
        refreshFeedItems(feed.id).catch(function (err) {
          console.warn('[Biji Ext] Auto-refresh after addFeed failed:', err.message);
        });
        return feed;
      });
    });
  }

  function removeFeed(feedId) {
    return getFeeds().then(function (feeds) {
      feeds = feeds.filter(function (f) { return f.id !== feedId; });
      return saveFeeds(feeds);
    });
  }

  function toggleFeed(feedId) {
    return getFeeds().then(function (feeds) {
      var target = null;
      feeds.forEach(function (f) {
        if (f.id === feedId) {
          f.enabled = !f.enabled;
          target = f;
        }
      });
      return saveFeeds(feeds).then(function () { return target; });
    });
  }

  function editFeed(feedId, updates) {
    return getFeeds().then(function (feeds) {
      var target = null;
      feeds.forEach(function (f) {
        if (f.id === feedId) {
          if (updates.name !== undefined) f.name = updates.name;
          if (updates.url !== undefined) f.url = updates.url;
          if (updates.type !== undefined) f.type = updates.type;
          if (updates.channelName !== undefined) f.channelName = updates.channelName;
          target = f;
        }
      });
      return saveFeeds(feeds).then(function () { return target; });
    });
  }

  // --- Feed Items storage ---

  function getFeedItems(filter) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(FEED_ITEMS_KEY, function (data) {
        var items = data[FEED_ITEMS_KEY] || {};
        var arr = Object.values(items);

        if (filter) {
          if (filter.feedId) {
            arr = arr.filter(function (i) { return i.feedId === filter.feedId; });
          }
          if (filter.status) {
            arr = arr.filter(function (i) { return i.status === filter.status; });
          }
        }

        // Sort by pubDate descending
        arr.sort(function (a, b) {
          var da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
          var db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
          return db - da;
        });

        resolve(arr);
      });
    });
  }

  function saveFeedItems(items) {
    return new Promise(function (resolve) {
      var obj = {};
      obj[FEED_ITEMS_KEY] = items;
      chrome.storage.local.set(obj, resolve);
    });
  }

  function pruneItems(items) {
    var keys = Object.keys(items);
    if (keys.length <= MAX_ITEMS) return items;

    // Sort by pubDate, remove oldest submitted/noted items first
    var removable = keys.filter(function (k) {
      return items[k].status === 'submitted' || items[k].status === 'noted';
    });
    removable.sort(function (a, b) {
      var da = items[a].pubDate ? new Date(items[a].pubDate).getTime() : 0;
      var db = items[b].pubDate ? new Date(items[b].pubDate).getTime() : 0;
      return da - db;
    });

    var toRemove = keys.length - MAX_ITEMS;
    for (var i = 0; i < toRemove && i < removable.length; i++) {
      delete items[removable[i]];
    }
    return items;
  }

  // --- RSS/Atom XML Parser (regex-based, no DOMParser — runs in Service Worker) ---

  // Extract text content of a tag (handles namespaced tags like itunes:duration)
  function xmlTagContent(xml, tagName) {
    // Match <tagName>...</tagName> or <ns:tagName>...</ns:tagName>
    var re = new RegExp('<(?:[a-zA-Z0-9]+:)?' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?' + tagName + '\\s*>', 'i');
    var m = re.exec(xml);
    return m ? m[1].trim() : '';
  }

  // Extract attribute value from a tag fragment
  function xmlAttr(tagStr, attrName) {
    var re = new RegExp(attrName + '\\s*=\\s*["\']([^"\']*)["\']', 'i');
    var m = re.exec(tagStr);
    return m ? m[1] : '';
  }

  // Find all occurrences of a block element (e.g. <item>...</item>)
  function xmlFindAll(xml, tagName) {
    var results = [];
    var re = new RegExp('<' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tagName + '\\s*>', 'gi');
    var m;
    while ((m = re.exec(xml)) !== null) {
      results.push(m[0]);
    }
    return results;
  }

  // Extract thumbnail from an item block (regex-based)
  function getMediaThumbnailRegex(itemXml, link) {
    // media:thumbnail url="..."
    var mtMatch = /<(?:media:)?thumbnail[^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
    if (mtMatch) return mtMatch[1];
    // media:content url="..." type="image/..."
    var mcMatch = /<(?:media:)?content[^>]+url\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']image[^"']*["']/i.exec(itemXml);
    if (!mcMatch) mcMatch = /<(?:media:)?content[^>]*type\s*=\s*["']image[^"']*["'][^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
    if (mcMatch) return mcMatch[1];
    // itunes:image href="..."
    var iiMatch = /<(?:itunes:)?image[^>]+href\s*=\s*["']([^"']+)["']/i.exec(itemXml);
    if (iiMatch) return iiMatch[1];
    // YouTube: extract from link or id
    var vidMatch = (link || '').match(/[?&]v=([^&]+)/) || (link || '').match(/youtu\.be\/([^?]+)/);
    if (!vidMatch) {
      var idText = xmlTagContent(itemXml, 'id');
      var vm = idText.match(/video:([^:]+)$/);
      if (vm) vidMatch = [null, vm[1]];
    }
    if (vidMatch) return 'https://i.ytimg.com/vi/' + vidMatch[1] + '/mqdefault.jpg';
    return '';
  }

  function parseFeedXml(xmlText) {
    var items = [];
    var channel = { title: '', thumbnail: '' };

    // --- Channel-level info (RSS 2.0) ---
    var channelMatch = /<channel\b[^>]*>([\s\S]*?)<item\b/i.exec(xmlText);
    // Fallback: entire channel block if no items
    if (!channelMatch) channelMatch = /<channel\b[^>]*>([\s\S]*?)<\/channel>/i.exec(xmlText);
    if (channelMatch) {
      var chXml = channelMatch[1];
      channel.title = xmlTagContent(chXml, 'title');
      // itunes:image at channel level
      var chImgMatch = /<(?:itunes:)?image[^>]+href\s*=\s*["']([^"']+)["']/i.exec(chXml);
      if (chImgMatch) channel.thumbnail = chImgMatch[1];
      // Fallback: <image><url>...</url></image>
      if (!channel.thumbnail) {
        var imgBlock = /<image\b[^>]*>([\s\S]*?)<\/image>/i.exec(chXml);
        if (imgBlock) {
          var imgUrl = xmlTagContent(imgBlock[1], 'url');
          if (imgUrl) channel.thumbnail = imgUrl;
        }
      }
    }

    // --- Atom feed-level info ---
    if (!channel.title) {
      var feedMatch = /<feed\b[^>]*>([\s\S]*?)<entry\b/i.exec(xmlText);
      if (!feedMatch) feedMatch = /<feed\b[^>]*>([\s\S]*?)<\/feed>/i.exec(xmlText);
      if (feedMatch) {
        channel.title = xmlTagContent(feedMatch[1], 'title');
        channel.thumbnail = xmlTagContent(feedMatch[1], 'icon') || xmlTagContent(feedMatch[1], 'logo') || '';
      }
    }

    // --- RSS 2.0 items ---
    var rssItems = xmlFindAll(xmlText, 'item');
    if (rssItems.length > 0) {
      rssItems.forEach(function (itemXml) {
        var title = xmlTagContent(itemXml, 'title');
        var link = xmlTagContent(itemXml, 'link');
        var guid = xmlTagContent(itemXml, 'guid') || link;
        var pubDate = xmlTagContent(itemXml, 'pubDate');
        var description = xmlTagContent(itemXml, 'description');

        // Podcast: itunes:summary as fallback description
        if (!description) {
          description = xmlTagContent(itemXml, 'summary');
        }

        // Podcast: itunes:duration
        var duration = xmlTagContent(itemXml, 'duration');

        var thumbnail = getMediaThumbnailRegex(itemXml, link);
        // Fallback thumbnail from channel
        if (!thumbnail && channel.thumbnail) thumbnail = channel.thumbnail;

        // Podcast: enclosure URL (audio file)
        var enclosureUrl = '';
        var encMatch = /<enclosure[^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
        if (encMatch) enclosureUrl = encMatch[1];

        // For podcast items without link, use enclosure URL or guid
        var itemUrl = link || enclosureUrl || guid;

        if (itemUrl) {
          items.push({
            title: decodeXmlEntities(title),
            url: decodeXmlEntities(itemUrl),
            guid: decodeXmlEntities(guid || itemUrl),
            pubDate: pubDate ? safeISODate(pubDate) : new Date().toISOString(),
            description: truncate(stripHtml(decodeXmlEntities(description)), 200),
            thumbnail: decodeXmlEntities(thumbnail),
            duration: duration,
            enclosureUrl: decodeXmlEntities(enclosureUrl),
          });
        }
      });
      return { items: items, channel: channel };
    }

    // --- Atom entries ---
    var atomEntries = xmlFindAll(xmlText, 'entry');
    atomEntries.forEach(function (entryXml) {
      var title = xmlTagContent(entryXml, 'title');
      // Atom link: <link href="..." />
      var linkMatch = /<link[^>]+href\s*=\s*["']([^"']+)["']/i.exec(entryXml);
      var link = linkMatch ? linkMatch[1] : '';
      var id = xmlTagContent(entryXml, 'id') || link;
      var updated = xmlTagContent(entryXml, 'updated') || xmlTagContent(entryXml, 'published');
      var summary = xmlTagContent(entryXml, 'summary') || xmlTagContent(entryXml, 'content');
      var thumbnail = getMediaThumbnailRegex(entryXml, link);
      if (link) {
        items.push({
          title: decodeXmlEntities(title),
          url: decodeXmlEntities(link),
          guid: decodeXmlEntities(id),
          pubDate: updated ? safeISODate(updated) : new Date().toISOString(),
          description: truncate(stripHtml(decodeXmlEntities(summary)), 200),
          thumbnail: decodeXmlEntities(thumbnail),
          duration: '',
          enclosureUrl: '',
        });
      }
    });

    return { items: items, channel: channel };
  }

  function safeISODate(str) {
    try { return new Date(str).toISOString(); } catch (e) { return new Date().toISOString(); }
  }

  function decodeXmlEntities(str) {
    if (!str) return '';
    return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, n) {
        return String.fromCharCode(parseInt(n, 10));
      }).replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
        return String.fromCharCode(parseInt(h, 16));
      });
  }

  function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
  }

  function truncate(str, max) {
    if (!str || str.length <= max) return str || '';
    return str.substring(0, max) + '...';
  }

  // --- Legacy submitted items (for backward compat) ---

  function getSubmittedItems() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(FEED_SUBMITTED_KEY, function (data) {
        resolve(data[FEED_SUBMITTED_KEY] || {});
      });
    });
  }

  function markItemSubmitted(guid) {
    return getSubmittedItems().then(function (items) {
      items[guid] = new Date().toISOString();
      var keys = Object.keys(items);
      if (keys.length > 5000) {
        var sorted = keys.sort(function (a, b) {
          return items[b].localeCompare(items[a]);
        });
        var pruned = {};
        sorted.slice(0, 5000).forEach(function (k) { pruned[k] = items[k]; });
        items = pruned;
      }
      return new Promise(function (resolve) {
        var obj = {};
        obj[FEED_SUBMITTED_KEY] = items;
        chrome.storage.local.set(obj, resolve);
      });
    });
  }

  // --- Refresh feeds: fetch RSS and store items ---

  function refreshFeedItems(feedId) {
    return getFeeds().then(function (feeds) {
      var feed = null;
      feeds.forEach(function (f) { if (f.id === feedId) feed = f; });
      if (!feed) throw new Error('Feed not found');
      return _fetchAndStoreFeedItems([feed]);
    });
  }

  function refreshAllFeedItems() {
    return getFeeds().then(function (feeds) {
      var enabled = feeds.filter(function (f) { return f.enabled; });
      return _fetchAndStoreFeedItems(enabled);
    });
  }

  function _fetchAndStoreFeedItems(feedList) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(FEED_ITEMS_KEY, function (data) {
        var allItems = data[FEED_ITEMS_KEY] || {};
        var totalNew = 0;
        var feedThumbnailUpdates = {};
        var feedNameUpdates = {};
        var feedErrorUpdates = {};

        function processFeed(index) {
          if (index >= feedList.length) {
            allItems = pruneItems(allItems);
            saveFeedItems(allItems).then(function () {
              // Update lastChecked + thumbnail/name/error
              getFeeds().then(function (feeds) {
                var now = new Date().toISOString();
                feedList.forEach(function (fl) {
                  feeds.forEach(function (f) {
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
                saveFeeds(feeds).then(function () {
                  resolve({ newItems: totalNew, checked: feedList.length });
                });
              });
            });
            return;
          }

          var feed = feedList[index];
          fetchFeedContent(feed.url)
            .then(function (xmlText) {
              var result = parseFeedXml(xmlText);
              var parsed = result.items;
              var channelInfo = result.channel;

              // Store channel thumbnail to feed object if available
              if (channelInfo.thumbnail && !feed.thumbnail) {
                feed.thumbnail = channelInfo.thumbnail;
                feedThumbnailUpdates[feed.id] = channelInfo.thumbnail;
              }
              // Update channel name from feed if not set
              if (channelInfo.title && feed.channelName === feed.url) {
                feed.channelName = channelInfo.title;
                feedNameUpdates[feed.id] = channelInfo.title;
              }

              // Clear lastError on success
              feedErrorUpdates[feed.id] = '';

              parsed.forEach(function (item) {
                var key = item.guid || item.url;
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
            .catch(function (err) {
              console.warn('[Biji Ext] Feed refresh failed for', feed.url, err.message);
              feedErrorUpdates[feed.id] = err.message;
              processFeed(index + 1);
            });
        }

        processFeed(0);
      });
    });
  }

  // --- Submit selected feed items ---

  function submitFeedItems(guids, capturedHeaders) {
    if (!capturedHeaders) {
      return Promise.reject(new Error('未捕获到认证信息'));
    }

    var STAGGER_MS = 200; // stagger start of each request to avoid hammering API

    return new Promise(function (resolve) {
      chrome.storage.local.get(FEED_ITEMS_KEY, function (data) {
        var allItems = data[FEED_ITEMS_KEY] || {};
        var toSubmit = guids.map(function (g) { return allItems[g]; }).filter(Boolean);

        // Launch all submissions in parallel with staggered start
        var promises = toSubmit.map(function (item, idx) {
          return new Promise(function (r) { setTimeout(r, idx * STAGGER_MS); })
            .then(function () {
              return LinkSubmitter.submitLink(item.url, item.title, capturedHeaders)
                .then(function (result) {
                  item.status = 'submitted';
                  item.submittedAt = new Date().toISOString();
                  item.noteId = (result && result.noteId) || null;
                  markItemSubmitted(item.guid || item.url);

                  // Store pending tags if we got a noteId
                  if (item.noteId && item.tags && item.tags.length > 0 && typeof TagManager !== 'undefined') {
                    TagManager.storePendingTags(item.noteId, item.tags);
                  }

                  return { guid: item.guid, noteId: item.noteId, error: null };
                })
                .catch(function (err) {
                  return { guid: item.guid, noteId: null, error: err.message };
                });
            });
        });

        Promise.all(promises).then(function (results) {
          saveFeedItems(allItems).then(function () {
            resolve(results);
          });
        });
      });
    });
  }

  // --- Check all feeds (legacy auto-submit flow) ---

  function checkAllFeeds(capturedHeaders) {
    return new Promise(function (resolve) {
      chrome.storage.local.get('settings', function (data) {
        var settings = data.settings || {};
        var autoSubmit = settings.feedAutoSubmit !== false; // default true for backward compat

        if (autoSubmit) {
          _checkAllFeedsAutoSubmit(capturedHeaders).then(resolve);
        } else {
          refreshAllFeedItems().then(resolve);
        }
      });
    });
  }

  function _checkAllFeedsAutoSubmit(capturedHeaders) {
    if (!capturedHeaders) {
      return Promise.reject(new Error('未捕获到认证信息'));
    }

    return Promise.all([getFeeds(), getSubmittedItems()]).then(function (results) {
      var feeds = results[0];
      var submittedItems = results[1];
      var enabledFeeds = feeds.filter(function (f) { return f.enabled; });
      var totalNew = 0;

      function processFeed(index) {
        if (index >= enabledFeeds.length) {
          return Promise.resolve({ checked: enabledFeeds.length, newItems: totalNew });
        }

        var feed = enabledFeeds[index];
        return fetchFeedContent(feed.url)
          .then(function (xmlText) {
            var items = parseFeedXml(xmlText).items;
            var newItems = items.filter(function (item) {
              return !submittedItems[item.guid] && !submittedItems[item.url];
            });

            return getFeeds().then(function (allFeeds) {
              allFeeds.forEach(function (f) {
                if (f.id === feed.id) f.lastChecked = new Date().toISOString();
              });
              return saveFeeds(allFeeds).then(function () {
                return submitItemsSequentially(newItems, capturedHeaders);
              });
            });
          })
          .then(function (submitted) {
            totalNew += submitted;
            return processFeed(index + 1);
          })
          .catch(function (err) {
            console.warn('[Biji Ext] Feed check failed for', feed.url, err.message);
            return processFeed(index + 1);
          });
      }

      return processFeed(0);
    });
  }

  function fetchFeedContent(url) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 15000);

    return fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; BijiFeedReader/1.0)',
      },
    }).then(function (resp) {
      clearTimeout(timeoutId);
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + resp.statusText);
      return resp.text();
    }).catch(function (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error('请求超时（15秒）');
      throw err;
    });
  }

  function submitItemsSequentially(items, capturedHeaders) {
    var count = 0;
    function submitNext(index) {
      if (index >= items.length) return Promise.resolve(count);
      var item = items[index];
      return LinkSubmitter.submitLink(item.url, item.title, capturedHeaders)
        .then(function () {
          count++;
          return markItemSubmitted(item.guid || item.url);
        })
        .catch(function (err) {
          console.warn('[Biji Ext] Feed item submit failed:', item.url, err.message);
        })
        .then(function () {
          return new Promise(function (resolve) {
            setTimeout(resolve, SUBMIT_DELAY);
          });
        })
        .then(function () {
          return submitNext(index + 1);
        });
    }
    return submitNext(0);
  }

  // --- OPML import ---

  function getAttr(tag, name) {
    var re = new RegExp(name + '=["\']([^"\']*)["\']', 'i');
    var m = re.exec(tag);
    return m ? m[1] : '';
  }

  function parseOpml(opmlText) {
    var feeds = [];
    // Match all <outline ...> tags (self-closing or not)
    var outlineRe = /<outline\b[^>]*>/gi;
    var match;
    while ((match = outlineRe.exec(opmlText)) !== null) {
      var tag = match[0];
      var xmlUrl = getAttr(tag, 'xmlUrl');
      if (xmlUrl) {
        feeds.push({
          url: xmlUrl,
          name: getAttr(tag, 'text') || getAttr(tag, 'title') || xmlUrl,
          type: getAttr(tag, 'type') === 'rss' ? null : (getAttr(tag, 'category') || null),
        });
      }
    }
    return feeds;
  }

  function importFeedsOpml(opmlText) {
    var parsed = parseOpml(opmlText);
    if (parsed.length === 0) {
      return Promise.reject(new Error('未找到有效的订阅源'));
    }

    return getFeeds().then(function (feeds) {
      var added = 0;
      var newFeedIds = [];
      parsed.forEach(function (p) {
        var exists = feeds.some(function (f) { return f.url === p.url; });
        if (!exists) {
          var id = Date.now().toString(36) + Math.random().toString(36).substr(2, 4) + added;
          feeds.push({
            id: id,
            url: p.url,
            name: p.name || p.url,
            enabled: true,
            addedAt: new Date().toISOString(),
            lastChecked: null,
            type: p.type || detectFeedType(p.url),
            channelName: p.name || p.url,
          });
          newFeedIds.push(id);
          added++;
        }
      });
      return saveFeeds(feeds).then(function () {
        // Fire-and-forget: fetch content for all newly added feeds
        if (newFeedIds.length > 0) {
          getFeeds().then(function (allFeeds) {
            var newFeeds = allFeeds.filter(function (f) {
              return newFeedIds.indexOf(f.id) !== -1;
            });
            _fetchAndStoreFeedItems(newFeeds).catch(function (err) {
              console.warn('[Biji Ext] Auto-refresh after OPML import failed:', err.message);
            });
          });
        }
        return { added: added, total: parsed.length };
      });
    });
  }

  // --- YouTube URL conversion ---

  function convertYoutubeUrl(url) {
    // Direct channel ID
    var channelMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channelMatch) {
      return Promise.resolve(
        'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelMatch[1]
      );
    }

    // Handle URL
    var handleMatch = url.match(/youtube\.com\/@([^/?#]+)/);
    if (handleMatch) {
      return fetch('https://www.youtube.com/@' + handleMatch[1])
        .then(function (resp) { return resp.text(); })
        .then(function (html) {
          var cidMatch = html.match(/channel_id=([^"&]+)/) ||
                         html.match(/"channelId":"([^"]+)"/) ||
                         html.match(/externalId":"([^"]+)"/);
          if (cidMatch) {
            return 'https://www.youtube.com/feeds/videos.xml?channel_id=' + cidMatch[1];
          }
          throw new Error('无法从页面提取 channel_id');
        });
    }

    return Promise.reject(new Error('不支持的 YouTube URL 格式'));
  }

  // --- Data migration ---

  function migrateFeeds() {
    return getFeeds().then(function (feeds) {
      var changed = false;
      feeds.forEach(function (f) {
        if (!f.type) {
          f.type = detectFeedType(f.url);
          changed = true;
        }
        if (!f.channelName) {
          f.channelName = f.name;
          changed = true;
        }
      });
      if (changed) return saveFeeds(feeds);
      return Promise.resolve();
    });
  }

  // --- Alarm management ---

  function setupAlarm() {
    chrome.storage.local.get('settings', function (data) {
      var s = data.settings || {};
      if (s.feedAutoCheck) {
        var interval = s.feedCheckInterval || 60;
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
      } else {
        chrome.alarms.clear(ALARM_NAME);
      }
    });
  }

  // Initialize
  setupAlarm();
  migrateFeeds();

  return {
    getFeeds: getFeeds,
    addFeed: addFeed,
    removeFeed: removeFeed,
    toggleFeed: toggleFeed,
    editFeed: editFeed,
    checkAllFeeds: checkAllFeeds,
    getFeedItems: getFeedItems,
    refreshFeedItems: refreshFeedItems,
    refreshAllFeedItems: refreshAllFeedItems,
    submitFeedItems: submitFeedItems,
    importFeedsOpml: importFeedsOpml,
    convertYoutubeUrl: convertYoutubeUrl,
    setupAlarm: setupAlarm,
    ALARM_NAME: ALARM_NAME,
  };
})();
