// feed-manager.js — IIFE module for RSS/Atom feed management
// Loaded via importScripts in background.js service worker

var FeedManager = (function () {
  'use strict';

  var FEEDS_KEY = 'feeds';
  var FEED_ITEMS_KEY = 'feedSubmittedItems';
  var ALARM_NAME = 'biji-feed-check';
  var SUBMIT_DELAY = 1000; // 1s between submissions to avoid rate limiting

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

  function addFeed(url, name) {
    return getFeeds().then(function (feeds) {
      // Check duplicate
      var exists = feeds.some(function (f) { return f.url === url; });
      if (exists) throw new Error('该订阅源已存在');

      var feed = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        url: url,
        name: name || url,
        enabled: true,
        addedAt: new Date().toISOString(),
        lastChecked: null,
      };
      feeds.push(feed);
      return saveFeeds(feeds).then(function () { return feed; });
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

  // --- RSS/Atom XML Parser ---

  function parseFeedXml(xmlText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlText, 'text/xml');
    var items = [];

    // Check for parse errors
    var parseError = doc.querySelector('parsererror');
    if (parseError) return items;

    // RSS 2.0: <rss><channel><item>
    var rssItems = doc.querySelectorAll('item');
    if (rssItems.length > 0) {
      rssItems.forEach(function (item) {
        var title = getTagText(item, 'title');
        var link = getTagText(item, 'link');
        var guid = getTagText(item, 'guid') || link;
        var pubDate = getTagText(item, 'pubDate');
        if (link) {
          items.push({ title: title, url: link, guid: guid, pubDate: pubDate });
        }
      });
      return items;
    }

    // Atom: <feed><entry>
    var entries = doc.querySelectorAll('entry');
    entries.forEach(function (entry) {
      var title = getTagText(entry, 'title');
      var linkEl = entry.querySelector('link[href]');
      var link = linkEl ? linkEl.getAttribute('href') : '';
      var id = getTagText(entry, 'id') || link;
      var updated = getTagText(entry, 'updated') || getTagText(entry, 'published');
      if (link) {
        items.push({ title: title, url: link, guid: id, pubDate: updated });
      }
    });

    return items;
  }

  function getTagText(parent, tagName) {
    var el = parent.querySelector(tagName);
    return el ? el.textContent.trim() : '';
  }

  // --- Submitted items tracking (dedup by guid/url) ---

  function getSubmittedItems() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(FEED_ITEMS_KEY, function (data) {
        resolve(data[FEED_ITEMS_KEY] || {});
      });
    });
  }

  function markItemSubmitted(guid) {
    return getSubmittedItems().then(function (items) {
      items[guid] = new Date().toISOString();
      // Prune old entries (keep last 5000)
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
        obj[FEED_ITEMS_KEY] = items;
        chrome.storage.local.set(obj, resolve);
      });
    });
  }

  // --- Check all enabled feeds and submit new items ---

  function checkAllFeeds(capturedHeaders) {
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
            var items = parseFeedXml(xmlText);
            var newItems = items.filter(function (item) {
              return !submittedItems[item.guid] && !submittedItems[item.url];
            });

            // Update lastChecked
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
    return fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.text();
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
          // Delay between submissions
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

  // --- Alarm management ---

  function setupAlarm() {
    chrome.storage.local.get('settings', function (data) {
      var s = data.settings || {};
      if (s.feedAutoCheck) {
        var interval = s.feedCheckInterval || 60; // minutes
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
      } else {
        chrome.alarms.clear(ALARM_NAME);
      }
    });
  }

  // Initialize alarm on module load
  setupAlarm();

  return {
    getFeeds: getFeeds,
    addFeed: addFeed,
    removeFeed: removeFeed,
    toggleFeed: toggleFeed,
    checkAllFeeds: checkAllFeeds,
    setupAlarm: setupAlarm,
    ALARM_NAME: ALARM_NAME,
  };
})();
