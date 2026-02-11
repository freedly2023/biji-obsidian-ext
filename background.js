// background.js — Service worker: stores captured notes, handles messages

var DEBUG = false;
function log() {
  if (!DEBUG) return;
  console.log.apply(console, ['[Biji Ext]'].concat(Array.prototype.slice.call(arguments)));
}

// ============================================================
// Active Fetcher — fetch all notes via API (runs in Service Worker, no CORS)
// ============================================================

var BIJI_API_BASE = 'https://get-notes.luojilab.com/voicenotes/web/notes';
var BIJI_EXPORT_API = 'https://get-notes.luojilab.com/voicenotes/web/export/tasks';
var fetchAbortController = null;
var capturedApiHeaders = null; // Auth headers captured from page's real API requests

// Restore cached headers from storage on SW startup
chrome.storage.local.get('apiHeaders', function (data) {
  if (data.apiHeaders) {
    capturedApiHeaders = data.apiHeaders;
    log('Restored API headers from storage:', Object.keys(capturedApiHeaders).join(', '));
  }
});

// CANONICAL — mirror in inject.js
function findNotesArray(obj, depth) {
  depth = depth || 0;
  if (depth > 10 || !obj) return null;
  if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
    var f = obj[0];
    if ((f.id || f.noteId || f.note_id || f._id) &&
        (f.content || f.title || f.text || f.body || f.name || f.subject || f.html || f.richText)) {
      return obj;
    }
    if (obj.length >= 5 && (f.id || f.noteId || f.note_id || f._id)) {
      return obj;
    }
  }
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    var priorityKeys = ['list', 'notes', 'data', 'items', 'results', 'records', 'c',
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
      if (r) return r;
    }
  }
  return null;
}

// CANONICAL — mirror in inject.js
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

function fetchAllNotes(fetchDelay) {
  fetchDelay = fetchDelay || 500;
  fetchAbortController = new AbortController();
  var signal = fetchAbortController.signal;
  var limit = 50;
  var sinceId = '';
  var totalFetched = 0;
  var pageNum = 0;
  var maxRetries = 3;
  var retries = 0;

  function postStatus(status, fetched, done) {
    chrome.runtime.sendMessage({
      type: 'fetchStatus',
      payload: {
        status: status,
        fetched: fetched || totalFetched,
        done: !!done
      }
    }).catch(function () {
      // Popup may be closed; ignore
    });
  }

  function fetchPage() {
    if (signal.aborted) {
      postStatus('已取消', totalFetched, true);
      return Promise.resolve();
    }

    if (!capturedApiHeaders) {
      postStatus('未捕获到认证信息，请先在 biji.com 页面上浏览笔记列表，然后再点击获取', 0, true);
      log('No captured API headers. User needs to browse biji.com first.');
      return Promise.resolve();
    }

    pageNum++;
    var url = BIJI_API_BASE + '?limit=' + limit + '&since_id=' + sinceId + '&sort=create_desc';
    postStatus('正在获取第 ' + pageNum + ' 批...', totalFetched, false);

    // Use captured auth headers from the page's real API requests
    var headers = Object.assign({}, capturedApiHeaders);
    log('Fetching with headers:', Object.keys(headers).join(', '));

    return fetch(url, {
      method: 'GET',
      headers: headers,
      signal: signal
    }).then(function (response) {
      log('Fetch page ' + pageNum + ': HTTP ' + response.status);
      if (!response.ok) {
        return response.text().then(function (body) {
          log('Error response body:', body.substring(0, 500));
          if (response.status === 429) {
            postStatus('请求限流，等待 5 秒...', totalFetched, false);
            return delay(5000).then(fetchPage);
          }
          if (response.status === 401 || response.status === 403) {
            postStatus('认证失败 (HTTP ' + response.status + ')，请先登录 biji.com', totalFetched, true);
            return Promise.resolve();
          }
          if (retries < maxRetries) {
            retries++;
            postStatus('请求失败 (HTTP ' + response.status + ')，重试中...', totalFetched, false);
            return delay(Math.pow(2, retries) * 500).then(fetchPage);
          }
          postStatus('请求失败 (HTTP ' + response.status + ')', totalFetched, true);
          return Promise.resolve();
        });
      }
      retries = 0;
      return response.json().then(function (data) {
        // Field discovery: log raw note structure on first page
        if (pageNum === 1) {
          var rawNotes = findNotesArray(data);
          if (rawNotes && rawNotes.length > 0) {
            var first = rawNotes[0];
            log('Raw note keys:', Object.keys(first));
            log('Raw note sample:', JSON.stringify(first).substring(0, 2000));
          }
        }

        var notes = findNotesArray(data);
        if (!notes || notes.length === 0) {
          postStatus('获取完成！共 ' + totalFetched + ' 条笔记', totalFetched, true);
          return Promise.resolve();
        }

        var normalized = notes.map(normalizeNote);
        totalFetched += normalized.length;
        storeNotes(normalized);
        postStatus('已获取 ' + totalFetched + ' 条笔记', totalFetched, false);

        var lastNote = notes[notes.length - 1];
        var lastId = lastNote.id || lastNote.noteId || lastNote.note_id || lastNote._id || '';
        if (!lastId || notes.length < limit) {
          postStatus('获取完成！共 ' + totalFetched + ' 条笔记', totalFetched, true);
          return Promise.resolve();
        }
        sinceId = String(lastId);
        return delay(fetchDelay).then(fetchPage);
      });
    }).catch(function (e) {
      if (e.name === 'AbortError') {
        postStatus('已取消', totalFetched, true);
        return Promise.resolve();
      }
      if (retries < maxRetries) {
        retries++;
        postStatus('网络错误，重试中...', totalFetched, false);
        return delay(Math.pow(2, retries) * 500).then(fetchPage);
      }
      postStatus('网络错误: ' + e.message, totalFetched, true);
      return Promise.resolve();
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  return fetchPage();
}

// ============================================================
// Transcript fetcher — fetch note detail to extract raw transcript
// ============================================================

function fetchNoteTranscript(noteId, noteType) {
  if (!capturedApiHeaders) {
    console.warn('[Biji Ext] No API headers captured yet. Browse biji.com first.');
    return Promise.resolve(null);
  }

  // Build detail URL based on note type
  // link → /notes/{id}/links/detail
  // voice → /notes/{id}/voices/detail  (guess, fallback to /detail)
  // other → /notes/{id}/detail
  var typeSegment = '';
  if (noteType === 'link') typeSegment = '/links';
  else if (noteType === 'voice') typeSegment = '/voices';

  var urls = [];
  if (typeSegment) {
    urls.push(BIJI_API_BASE + '/' + noteId + typeSegment + '/detail');
  }
  urls.push(BIJI_API_BASE + '/' + noteId + '/detail');

  var headers = Object.assign({}, capturedApiHeaders);

  function tryUrl(index) {
    if (index >= urls.length) return Promise.resolve(null);
    var url = urls[index];
    log('Fetching transcript from:', url);

    return fetch(url, { method: 'GET', headers: headers })
      .then(function (resp) {
        if (!resp.ok) {
          log('Detail API returned HTTP', resp.status, 'for', url);
          return tryUrl(index + 1);
        }
        return resp.json().then(function (data) {
          log('Detail API response keys:', JSON.stringify(Object.keys(data)));
          var transcript = extractTranscript(data);
          if (transcript) {
            log('Transcript found, length:', transcript.length);
            return transcript;
          }
          log('No transcript found in response from', url);
          return tryUrl(index + 1);
        });
      })
      .catch(function (e) {
        console.warn('[Biji Ext] Detail API error:', e.message);
        return tryUrl(index + 1);
      });
  }

  return tryUrl(0);
}

// Recursively search JSON for transcript content
function extractTranscript(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // Strategy 1: look for strings with timestamp pattern [00:00:00]
  var timestampTexts = [];
  findTimestampStrings(obj, timestampTexts, 0);
  if (timestampTexts.length > 0) {
    // Return the longest one (most likely the full transcript)
    timestampTexts.sort(function (a, b) { return b.length - a.length; });
    return timestampTexts[0];
  }

  // Strategy 2: look for arrays of paragraph-like objects with timestamps
  var paragraphs = findParagraphArray(obj, 0);
  if (paragraphs) return paragraphs;

  return null;
}

function findTimestampStrings(obj, results, depth) {
  if (depth > 8 || !obj) return;
  if (typeof obj === 'string') {
    if (/\[\d{2}:\d{2}:\d{2}\]/.test(obj) && obj.length > 100) {
      results.push(obj);
    }
    return;
  }
  if (Array.isArray(obj)) {
    // Check if it's an array of strings with timestamps (paragraph list)
    var tsLines = [];
    var hasTs = false;
    for (var i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        tsLines.push(obj[i]);
        if (/\[\d{2}:\d{2}:\d{2}\]/.test(obj[i])) hasTs = true;
      } else if (obj[i] && typeof obj[i] === 'object') {
        // Could be {text: "...", time: ...} objects
        var t = obj[i].text || obj[i].content || obj[i].body || obj[i].sentence || '';
        if (t) {
          tsLines.push(t);
          if (/\[\d{2}:\d{2}:\d{2}\]/.test(t)) hasTs = true;
        }
      }
    }
    if (hasTs && tsLines.length > 3) {
      results.push(tsLines.join('\n\n'));
    }
    // Continue recursion
    for (var j = 0; j < obj.length && j < 5; j++) {
      if (typeof obj[j] === 'object') findTimestampStrings(obj[j], results, depth + 1);
    }
    return;
  }
  if (typeof obj === 'object') {
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      findTimestampStrings(obj[keys[k]], results, depth + 1);
    }
  }
}

function findParagraphArray(obj, depth) {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj) && obj.length > 5) {
    // Check if items have text/content with timestamps
    var texts = [];
    var hasTs = false;
    for (var i = 0; i < obj.length; i++) {
      var item = obj[i];
      var t = '';
      if (typeof item === 'string') t = item;
      else if (item && typeof item === 'object') {
        t = item.text || item.content || item.body || item.sentence ||
            item.paragraph || item.value || '';
      }
      if (t) {
        texts.push(t);
        if (/\[\d{2}:\d{2}:\d{2}\]/.test(t)) hasTs = true;
      }
    }
    if (hasTs && texts.length > 3) {
      return texts.join('\n\n');
    }
  }
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      var r = findParagraphArray(obj[keys[k]], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// ============================================================
// Server-side PDF/DOCX Export API
// ============================================================

function createExportTask(noteId, type) {
  if (!capturedApiHeaders) {
    return Promise.reject(new Error('No API headers captured. Browse biji.com first.'));
  }
  var headers = Object.assign({}, capturedApiHeaders, {
    'content-type': 'application/json'
  });
  return fetch(BIJI_EXPORT_API, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ type: type, note_ids: [noteId] })
  }).then(function (resp) {
    if (!resp.ok) {
      return resp.text().then(function (body) {
        throw new Error('Export API error HTTP ' + resp.status + ': ' + body.substring(0, 200));
      });
    }
    return resp.json();
  }).then(function (data) {
    // Extract task ID from response — try common paths
    var taskId = null;
    if (data && data.c && data.c.id) {
      taskId = data.c.id;
    } else if (data && data.c && data.c.task_id) {
      taskId = data.c.task_id;
    } else if (data && data.data && data.data.id) {
      taskId = data.data.id;
    } else if (data && data.id) {
      taskId = data.id;
    } else if (data && data.c && typeof data.c === 'string') {
      taskId = data.c;
    }
    if (!taskId) {
      log('Export create response:', JSON.stringify(data).substring(0, 500));
      throw new Error('Could not find task ID in export response');
    }
    log('Export task created:', taskId);
    return taskId;
  });
}

function pollExportTask(taskId) {
  if (!capturedApiHeaders) {
    return Promise.reject(new Error('No API headers'));
  }
  var headers = Object.assign({}, capturedApiHeaders);
  var maxAttempts = 60;
  var attempt = 0;

  function poll() {
    attempt++;
    if (attempt > maxAttempts) {
      return Promise.reject(new Error('Export task timed out after ' + maxAttempts + ' attempts'));
    }
    return fetch(BIJI_EXPORT_API + '/' + taskId, {
      method: 'GET',
      headers: headers
    }).then(function (resp) {
      if (!resp.ok) throw new Error('Poll failed HTTP ' + resp.status);
      return resp.json();
    }).then(function (data) {
      var c = data.c || data.data || data;
      if (c.finished || c.status === 'finished' || c.status === 'done') {
        var accessUrl = c.access_url || c.download_url || c.url || '';
        var filename = c.filename || c.file_name || '';
        if (!accessUrl) {
          log('Export poll response:', JSON.stringify(data).substring(0, 500));
          throw new Error('Export finished but no download URL');
        }
        log('Export ready:', accessUrl);
        return { access_url: accessUrl, filename: filename };
      }
      // Not finished yet — wait 1s and retry
      return new Promise(function (resolve) {
        setTimeout(resolve, 1000);
      }).then(poll);
    });
  }

  return poll();
}

function exportNoteViaAPI(noteId, format) {
  return createExportTask(noteId, format).then(function (taskId) {
    return pollExportTask(taskId);
  });
}

// ============================================================
// Message handler
// ============================================================

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'notes') {
    // Store notes from intercepted API responses
    storeNotes(msg.payload.notes);
  } else if (msg.type === 'discovery') {
    // Store discovery logs
    storeDiscoveryLog(msg.payload);
  } else if (msg.type === 'getNotes') {
    // Popup requests all stored notes
    chrome.storage.local.get('notes', function (data) {
      sendResponse({ notes: data.notes || {} });
    });
    return true; // async sendResponse
  } else if (msg.type === 'getDiscovery') {
    chrome.storage.local.get('discoveryLogs', function (data) {
      sendResponse({ logs: data.discoveryLogs || [] });
    });
    return true;
  } else if (msg.type === 'clearNotes') {
    chrome.storage.local.remove('notes', function () {
      updateBadge(0);
      sendResponse({ ok: true });
    });
    return true;
  } else if (msg.type === 'clearDiscovery') {
    chrome.storage.local.remove('discoveryLogs', function () {
      sendResponse({ ok: true });
    });
    return true;
  } else if (msg.type === 'storeVueNotes') {
    // Notes from Vue store scan
    storeNotes(msg.notes);
  } else if (msg.type === 'apiHeaders') {
    // Auth headers captured from page's real API requests (from inject.js)
    capturedApiHeaders = msg.payload.headers;
    // Persist to storage so it survives SW restart
    chrome.storage.local.set({ apiHeaders: capturedApiHeaders });
    log('Captured API auth headers:', Object.keys(capturedApiHeaders).join(', '));
  } else if (msg.type === 'fetchTranscript') {
    // Fetch transcript for a single note via detail API
    fetchNoteTranscript(msg.noteId, msg.noteType).then(function (transcript) {
      sendResponse({ noteId: msg.noteId, transcript: transcript });
    });
    return true; // async sendResponse
  } else if (msg.type === 'exportNote') {
    exportNoteViaAPI(msg.noteId, msg.format).then(function (result) {
      sendResponse(result);
    }).catch(function (err) {
      sendResponse({ error: err.message });
    });
    return true; // async sendResponse
  } else if (msg.type === 'fetchAll') {
    // Active fetch: fetch all notes via API from Service Worker
    fetchAllNotes(msg.fetchDelay);
  } else if (msg.type === 'cancelFetch') {
    // Cancel active fetch
    if (fetchAbortController) {
      fetchAbortController.abort();
    }
  }
});

function storeNotes(newNotes) {
  if (!newNotes || !newNotes.length) return;
  chrome.storage.local.get('notes', function (data) {
    var notes = data.notes || {};
    newNotes.forEach(function (n) {
      if (!n.id) return;
      var existing = notes[n.id] || {};
      notes[n.id] = Object.assign({}, existing, n);
    });
    chrome.storage.local.set({ notes: notes }, function () {
      var count = Object.keys(notes).length;
      updateBadge(count);
      // Broadcast updated count to popup (after storage write is confirmed)
      chrome.runtime.sendMessage({ type: 'notesUpdated', count: count }).catch(function () { // Popup may be closed; ignore
      });
    });
  });
}

function storeDiscoveryLog(entry) {
  chrome.storage.local.get('discoveryLogs', function (data) {
    var logs = data.discoveryLogs || [];
    logs.unshift({
      url: entry.url,
      preview: entry.preview,
      time: new Date().toISOString()
    });
    // Keep last 100 logs
    if (logs.length > 100) logs = logs.slice(0, 100);
    chrome.storage.local.set({ discoveryLogs: logs });
  });
}

function updateBadge(count) {
  var text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: '#6C5CE7' });
}

// Initialize badge on startup
chrome.storage.local.get('notes', function (data) {
  var count = data.notes ? Object.keys(data.notes).length : 0;
  updateBadge(count);
});
