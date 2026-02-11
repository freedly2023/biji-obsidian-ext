// inject.js — Runs in the PAGE context (not extension sandbox)
// Hooks XHR & Fetch to capture biji.com API responses
// Also performs Vue Store scanning (since content scripts can't access __vue__)
// Sends captured data back to content.js via CustomEvent

(function () {
  'use strict';

  const PREFIX = '[Biji Ext]';
  const DEBUG_SCAN = false;

  function log() {
    if (!DEBUG_SCAN) return;
    console.log.apply(console, [PREFIX].concat(Array.prototype.slice.call(arguments)));
  }

  // Send captured note data to content.js
  function postToExtension(type, payload) {
    window.dispatchEvent(new CustomEvent('biji-ext-data', {
      detail: JSON.stringify({ type, payload })
    }));
  }

  // --- Normalize a raw note object ---
  // MIRROR of background.js — keep in sync
  function normalizeNote(raw) {
    return {
      id: raw.id || raw.noteId || raw.note_id || raw._id || '',
      title: raw.title || raw.name || raw.subject || '',
      content: raw.content || raw.text || raw.body || raw.html || raw.richText || '',
      rawTranscript: raw.transcript || raw.rawText || raw.raw_text ||
                     raw.voiceText || raw.voice_text || raw.asr || raw.asrText ||
                     raw.asr_text || raw.originalText || raw.original_text ||
                     raw.speechText || raw.speech_text || raw.rawContent || raw.raw_content ||
                     null,
      createdAt: raw.createdAt || raw.created_at || raw.createTime || raw.create_time ||
                 raw.createdTime || raw.created || raw.ctime || '',
      updatedAt: raw.updatedAt || raw.updated_at || raw.updateTime || raw.update_time ||
                 raw.modifiedAt || raw.modified || raw.mtime || '',
      tags: raw.tags || raw.labels || raw.categories || [],
      noteType: raw.note_type || raw.noteType || raw.entry_type || null,
      type: raw.type || raw.note_type || raw.noteType || 'text',
      audioUrl: raw.audioUrl || raw.audio_url || raw.voiceUrl || raw.voice_url || null,
      images: raw.images || raw.imgs || raw.pictures || raw.attachments || [],
    };
  }

  // --- Improved recursive notes array finder ---
  // MIRROR of background.js — keep in sync
  function findNotesArray(obj, depth) {
    depth = depth || 0;
    if (depth > 10 || !obj) return null;

    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      var f = obj[0];
      // Strict match: has ID + content/title
      if ((f.id || f.noteId || f.note_id || f._id) &&
          (f.content || f.title || f.text || f.body || f.name || f.subject || f.html || f.richText)) {
        return obj;
      }
      // Relaxed match: large array where items have IDs
      if (obj.length >= 5 && (f.id || f.noteId || f.note_id || f._id)) {
        log('Relaxed match: array of', obj.length, 'items with IDs at depth', depth);
        log('  First item keys:', Object.keys(f));
        return obj;
      }
    }

    if (typeof obj === 'object' && !Array.isArray(obj)) {
      var priorityKeys = ['notes', 'list', 'data', 'items', 'results', 'records',
                          'noteList', 'note_list', 'entries', 'rows', 'content',
                          'timeline', 'feeds', 'posts'];
      var allKeys = Object.keys(obj);
      var sortedKeys = [];
      priorityKeys.forEach(function (pk) {
        if (allKeys.indexOf(pk) !== -1) sortedKeys.push(pk);
      });
      allKeys.forEach(function (k) {
        if (sortedKeys.indexOf(k) === -1) sortedKeys.push(k);
      });

      for (var i = 0; i < sortedKeys.length; i++) {
        var key = sortedKeys[i];
        if (!obj.hasOwnProperty(key)) continue;
        var r = findNotesArray(obj[key], depth + 1);
        if (r) {
          log('Found notes at path depth', depth, 'key:', key);
          return r;
        }
      }
    }
    return null;
  }

  // --- Log state structure for debugging ---
  function logStateStructure(obj, depth, maxDepth) {
    if (depth > maxDepth || !obj || typeof obj !== 'object') return;
    var indent = '  '.repeat(depth);
    Object.keys(obj).forEach(function (key) {
      var val = obj[key];
      if (Array.isArray(val)) {
        log(indent + key + ': Array(' + val.length + ')');
        if (val.length > 0 && val[0] && typeof val[0] === 'object') {
          log(indent + '  [0] keys:', Object.keys(val[0]));
        }
      } else if (typeof val === 'object' && val !== null) {
        log(indent + key + ': Object {' + Object.keys(val).join(', ') + '}');
        logStateStructure(val, depth + 1, maxDepth);
      } else {
        log(indent + key + ': ' + typeof val);
      }
    });
  }

  // ============================================================
  // Vue Store Scanner — runs in PAGE context where __vue__ is accessible
  // ============================================================

  function scanVueStore() {
    var results = [];
    try {
      log('Starting Vue Store scan (page context)...');

      // Check for SSR hydration state first
      if (window.__INITIAL_STATE__) {
        log('Found window.__INITIAL_STATE__:', typeof window.__INITIAL_STATE__);
        var ssrArr = findNotesArray(window.__INITIAL_STATE__);
        if (ssrArr) {
          log('Found notes in __INITIAL_STATE__:', ssrArr.length);
          return ssrArr.map(normalizeNote);
        }
      }

      // Try multiple app element selectors
      var selectors = ['#app', '[data-v-app]', '#__nuxt', '#root', '[id*="app"]'];
      var appEl = null;
      for (var i = 0; i < selectors.length; i++) {
        appEl = document.querySelector(selectors[i]);
        if (appEl) {
          log('Found app element via:', selectors[i]);
          break;
        }
      }

      if (!appEl) {
        log('No app element found. Tried:', selectors.join(', '));
        return results;
      }

      var state = null;

      // Vue 2
      if (appEl.__vue__ && appEl.__vue__.$store) {
        log('Detected Vue 2 with Vuex store');
        state = appEl.__vue__.$store.state;
        log('Vue 2 state keys:', Object.keys(state));
      }

      // Vue 3 + Vuex/Pinia
      if (!state && appEl.__vue_app__) {
        log('Detected Vue 3 app');
        var gp = appEl.__vue_app__.config.globalProperties;
        if (gp.$store) {
          log('Found Vue 3 Vuex $store');
          state = gp.$store.state;
          log('Vue 3 Vuex state keys:', Object.keys(state));
        }
        if (!state && gp.$pinia) {
          log('Found Vue 3 Pinia store');
          state = gp.$pinia.state.value;
          log('Pinia state keys:', Object.keys(state));
          Object.keys(state).forEach(function (storeName) {
            if (state[storeName] && typeof state[storeName] === 'object') {
              log('  Pinia store "' + storeName + '" keys:', Object.keys(state[storeName]));
            }
          });
        }
      }

      // Vue 2 fallback: root component data
      if (!state && appEl.__vue__) {
        log('Trying Vue 2 component tree walk...');
        var vm = appEl.__vue__;
        if (vm.$data && Object.keys(vm.$data).length > 0) {
          log('Found root $data keys:', Object.keys(vm.$data));
          var dataArr = findNotesArray(vm.$data);
          if (dataArr) {
            log('Found notes in root $data:', dataArr.length);
            return dataArr.map(normalizeNote);
          }
        }
      }

      if (!state) {
        log('No Vue store state found');
        // Log what properties the app element does have
        if (appEl) {
          var props = [];
          if (appEl.__vue__) props.push('__vue__');
          if (appEl.__vue_app__) props.push('__vue_app__');
          if (appEl._vnode) props.push('_vnode');
          if (appEl.__vueParentComponent) props.push('__vueParentComponent');
          log('App element has properties:', props.length > 0 ? props.join(', ') : 'none of the expected Vue properties');
        }
        return results;
      }

      // Search state for notes array
      log('Searching state tree for notes array (depth limit: 10)...');
      var arr = findNotesArray(state);
      if (arr) {
        log('Found notes array with', arr.length, 'items');
        if (arr[0]) {
          log('First item keys:', Object.keys(arr[0]));
        }
        results = arr.map(normalizeNote);
      } else {
        log('No notes array found in state tree. Structure:');
        logStateStructure(state, 0, 3);
      }
    } catch (err) {
      console.error(PREFIX, 'Vue store scan error:', err);
    }
    return results;
  }

  // --- Auto-scan with retry logic ---
  // Progressive delays: 1s → 2s → 3s → 5s → 8s
  function autoScanVueStore() {
    var delays = [1000, 2000, 3000, 5000, 8000];
    var attempt = 0;

    function tryOnce() {
      if (attempt >= delays.length) {
        log('Auto-scan exhausted all', delays.length, 'attempts. Notes not found in Vue Store.');
        log('Try manually scanning via the popup button, or browse notes to trigger API capture.');
        return;
      }

      var currentAttempt = attempt + 1;
      log('Auto-scan attempt', currentAttempt, '/', delays.length);

      var notes = scanVueStore();
      if (notes.length > 0) {
        log('Auto-scan success! Found', notes.length, 'notes on attempt', currentAttempt);
        postToExtension('notes', { url: 'vue-store-scan', notes: notes });
        return;
      }

      attempt++;
      if (attempt < delays.length) {
        log('No notes found yet. Retrying in', delays[attempt] / 1000, 'seconds...');
        setTimeout(tryOnce, delays[attempt]);
      } else {
        log('Auto-scan exhausted all attempts. Notes not found in Vue Store.');
      }
    }

    setTimeout(tryOnce, delays[0]);
  }

  // --- Fetch raw transcript from /note/{id}/web page ---
  function fetchRawTranscript(noteId) {
    var url = 'https://www.biji.com/note/' + noteId + '/web';
    log('Fetching transcript from:', url);
    return origFetch(url, { credentials: 'include' }).then(function (resp) {
      if (!resp.ok) {
        console.warn('[Biji Ext] /web page returned HTTP', resp.status);
        return null;
      }
      return resp.text();
    }).then(function (html) {
      if (!html) return null;
      log('/web page HTML length:', html.length);

      // Try 1: extract from SSR state embedded in script tags
      var statePatterns = [
        /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
        /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
        /window\.__APP_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/
      ];
      for (var p = 0; p < statePatterns.length; p++) {
        var stateMatch = html.match(statePatterns[p]);
        if (stateMatch) {
          try {
            var state = JSON.parse(stateMatch[1]);
            var candidates = ['transcript', 'rawText', 'raw_text', 'voiceText',
                              'voice_text', 'asr', 'asrText', 'asr_text',
                              'originalText', 'original_text'];
            function findText(obj, depth) {
              if (depth > 6 || !obj || typeof obj !== 'object') return null;
              for (var i = 0; i < candidates.length; i++) {
                if (obj[candidates[i]] && typeof obj[candidates[i]] === 'string' &&
                    obj[candidates[i]].length > 50) {
                  return obj[candidates[i]];
                }
              }
              var keys = Object.keys(obj);
              for (var j = 0; j < keys.length; j++) {
                var r = findText(obj[keys[j]], depth + 1);
                if (r) return r;
              }
              return null;
            }
            var text = findText(state, 0);
            if (text) {
              log('Found transcript in SSR state, length:', text.length);
              return text;
            }
          } catch (e) {
            console.warn('[Biji Ext] Failed to parse SSR state:', e);
          }
        }
      }

      // Try 2: parse HTML and extract from actual DOM structure
      // /web page structure: .n-scrollbar-content > div > p[00:00:00]...
      try {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // Selectors matching biji.com /web page structure (from Elements inspection)
        var selectors = [
          '.n-scrollbar-content',   // Naive UI scrollbar content (actual container)
          '.web-html',              // web-html wrapper
          '.web-detail',            // web-detail main area
          '.note-web',              // note-web container
          '.note-content-wrap',     // outer content wrapper
          '.note-content',          // generic
          '.transcript',
          '.voice-content',
          'article',
          'main'
        ];
        for (var i = 0; i < selectors.length; i++) {
          var el = doc.querySelector(selectors[i]);
          if (el) {
            // Check for timestamp-patterned paragraphs [00:00:00]
            var paragraphs = el.querySelectorAll('p');
            if (paragraphs.length > 0) {
              var texts = [];
              var hasTimestamp = false;
              paragraphs.forEach(function (p) {
                var t = p.textContent.trim();
                if (t) {
                  texts.push(t);
                  if (/^\[?\d{2}:\d{2}:\d{2}\]?/.test(t)) hasTimestamp = true;
                }
              });
              if (hasTimestamp && texts.length > 3) {
                var result = texts.join('\n\n');
                log('Found transcript via selector "' + selectors[i] +
                    '", paragraphs:', texts.length, 'length:', result.length);
                return result;
              }
            }
            // Fallback: use full text content if substantial
            var fullText = el.textContent.trim();
            if (fullText.length > 100) {
              log('Found content via selector "' + selectors[i] +
                  '", length:', fullText.length);
              return fullText;
            }
          }
        }

        // Try 3: find any <p> tags with timestamp pattern anywhere in the page
        var allP = doc.querySelectorAll('p');
        var timestampTexts = [];
        allP.forEach(function (p) {
          var t = p.textContent.trim();
          if (t && /^\[?\d{2}:\d{2}:\d{2}\]?/.test(t)) {
            timestampTexts.push(t);
          }
        });
        if (timestampTexts.length > 3) {
          var result = timestampTexts.join('\n\n');
          log('Found transcript via timestamp <p> scan, count:',
              timestampTexts.length, 'length:', result.length);
          return result;
        }

        log('No transcript found in /web page DOM. Body length:',
            doc.body ? doc.body.textContent.length : 0);
      } catch (e) {
        console.warn('[Biji Ext] Failed to parse /web page HTML:', e);
      }

      return null;
    }).catch(function (e) {
      console.warn('[Biji Ext] Failed to fetch /note/' + noteId + '/web:', e);
      return null;
    });
  }

  // --- Listen for transcript fetch requests from content.js ---
  window.addEventListener('biji-ext-fetch-transcript', function (e) {
    try {
      var data = JSON.parse(e.detail);
      var noteId = data.noteId;
      fetchRawTranscript(noteId).then(function (transcript) {
        window.dispatchEvent(new CustomEvent('biji-ext-transcript-result', {
          detail: JSON.stringify({ noteId: noteId, transcript: transcript })
        }));
      });
    } catch (err) {
      console.error('[Biji Ext] Transcript fetch event error:', err);
    }
  });

  // --- Listen for manual scan requests from content.js ---
  window.addEventListener('biji-ext-scan-request', function () {
    log('Manual scan requested from popup');
    var notes = scanVueStore();
    window.dispatchEvent(new CustomEvent('biji-ext-scan-result', {
      detail: JSON.stringify({ notes: notes })
    }));
  });

  // ============================================================
  // Network Interception — XHR & Fetch hooks
  // ============================================================

  // --- Process an API response ---
  function processResponse(url, text) {
    // Discovery: log all API-like responses
    if (url.includes('/api') || url.includes('/v1') || url.includes('/v2')) {
      postToExtension('discovery', { url: url, preview: text.substring(0, 800) });
    }

    try {
      var data = JSON.parse(text);
    } catch (e) {
      return;
    }

    var notes = findNotesArray(data);
    if (notes && notes.length > 0) {
      // Field discovery: log raw note structure for the first note
      var first = notes[0];
      var fieldInfo = {};
      Object.keys(first).forEach(function (k) {
        var v = first[k];
        var t = Array.isArray(v) ? 'Array(' + v.length + ')' : typeof v;
        var preview = '';
        if (typeof v === 'string') preview = v.substring(0, 120);
        else if (v !== null && v !== undefined) preview = String(v).substring(0, 120);
        fieldInfo[k] = t + (preview ? ' | ' + preview : '');
      });
      log('Raw note fields:', JSON.stringify(fieldInfo, null, 2));
      postToExtension('discovery', {
        url: url + ' [field-discovery]',
        preview: 'Fields: ' + Object.keys(first).join(', ')
      });

      var normalized = notes.map(normalizeNote);
      log('Network interceptor captured', normalized.length, 'notes from', url);
      postToExtension('notes', { url: url, notes: normalized });
    }
  }

  // --- Hook XMLHttpRequest ---
  var OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    var xhr = new OrigXHR();
    var _url = '';
    var _headers = {};
    var origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url) {
      _url = url;
      _headers = {};
      return origOpen.apply(this, arguments);
    };
    var origSetRequestHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = function (name, value) {
      _headers[name] = value;
      return origSetRequestHeader.apply(this, arguments);
    };
    var origSend = xhr.send.bind(xhr);
    xhr.send = function () {
      // Capture auth headers from API requests
      if (_url.indexOf('get-notes.luojilab.com') !== -1) {
        log('XHR API request headers captured:', JSON.stringify(_headers));
        postToExtension('apiHeaders', { headers: _headers });
      }
      xhr.addEventListener('load', function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          processResponse(_url, xhr.responseText);
        }
      });
      return origSend.apply(this, arguments);
    };
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  HookedXHR.DONE = 4;
  HookedXHR.HEADERS_RECEIVED = 2;
  HookedXHR.LOADING = 3;
  HookedXHR.OPENED = 1;
  HookedXHR.UNSENT = 0;
  window.XMLHttpRequest = HookedXHR;

  // --- Hook fetch ---
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input
      : (input instanceof Request ? input.url : String(input));

    // Capture auth headers from real API requests to get-notes.luojilab.com
    if (url.indexOf('get-notes.luojilab.com') !== -1) {
      var capturedHeaders = {};
      if (init && init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach(function (v, k) { capturedHeaders[k] = v; });
        } else if (typeof init.headers === 'object') {
          Object.keys(init.headers).forEach(function (k) {
            capturedHeaders[k] = init.headers[k];
          });
        }
      }
      // Also try to capture headers from Request object
      if (input instanceof Request) {
        input.headers.forEach(function (v, k) {
          if (!capturedHeaders[k]) capturedHeaders[k] = v;
        });
      }
      log('API request headers captured:', JSON.stringify(capturedHeaders));
      // Send to extension for background.js to reuse
      postToExtension('apiHeaders', { headers: capturedHeaders });
    }

    var promise = origFetch.call(window, input, init);
    promise.then(function (response) {
      if (response.ok) {
        response.clone().text().then(function (text) {
          processResponse(url, text);
        }).catch(function () {}); // Ignore clone read failure (non-text response)
      }
    }).catch(function () {}); // Ignore network errors in interceptor (non-critical)
    return promise;
  };

  // --- Start auto-scan on biji.com ---
  if (location.hostname.indexOf('biji.com') !== -1) {
    log('Inject script loaded on biji.com, starting auto-scan...');
    autoScanVueStore();
  }

  console.log(PREFIX, 'Network interceptors + Vue scanner installed (page context)');
})();
