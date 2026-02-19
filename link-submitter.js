// link-submitter.js — IIFE module for submitting links to biji.com
// Loaded via importScripts in background.js service worker
// API: POST https://get-notes.luojilab.com/voicenotes/web/notes/stream (SSE)

var LinkSubmitter = (function () {
  'use strict';

  var STORAGE_KEY = 'submittedLinks';
  var MAX_HISTORY = 500;
  var API_URL = 'https://get-notes.luojilab.com/voicenotes/web/notes/stream';

  // Submit a link to biji.com "添加链接" API (SSE streaming endpoint)
  function submitLink(url, title, capturedHeaders) {
    if (!capturedHeaders) {
      return Promise.reject(new Error('未捕获到认证信息，请先在 biji.com 页面上浏览'));
    }

    var headers = Object.assign({}, capturedHeaders, {
      'content-type': 'application/json',
    });

    var body = JSON.stringify({
      attachments: [{ size: 100, type: 'link', title: title || '', url: url }],
      content: '',
      entry_type: 'ai',
      note_type: 'link',
      prompt_template_id: '',
      source: 'web',
    });

    return fetch(API_URL, {
      method: 'POST',
      headers: headers,
      body: body,
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (text) {
          throw new Error('HTTP ' + resp.status + ': ' + text.substring(0, 200));
        });
      }
      // Response is SSE stream — read it to extract note_id
      return readSSEResponse(resp).then(function (result) {
        return recordSubmission(url, title, result).then(function () {
          return result;
        });
      });
    });
  }

  // Parse SSE stream response to extract note_id and link_title
  function readSSEResponse(response) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var noteId = '';
    var linkTitle = '';
    var buffer = '';

    function processChunk() {
      return reader.read().then(function (result) {
        if (result.done) {
          return { noteId: noteId, linkTitle: linkTitle };
        }
        buffer += decoder.decode(result.value, { stream: true });
        // Parse SSE lines: "data: {...}"
        var lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line in buffer
        lines.forEach(function (line) {
          if (line.indexOf('data: ') !== 0) return;
          try {
            var json = JSON.parse(line.substring(6));
            if (json.data && json.data.note_id && !noteId) {
              noteId = json.data.note_id;
            }
            if (json.data && json.data.link_title) {
              linkTitle = json.data.link_title;
            }
          } catch (e) {
            // ignore parse errors for non-JSON lines
          }
        });
        return processChunk();
      });
    }

    return processChunk();
  }

  // Record a submitted link in storage
  function recordSubmission(url, title, result) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEY, function (data) {
        var links = data[STORAGE_KEY] || [];
        links.unshift({
          url: url,
          title: title || result.linkTitle || '',
          submittedAt: new Date().toISOString(),
          noteId: result.noteId || '',
        });
        if (links.length > MAX_HISTORY) {
          links = links.slice(0, MAX_HISTORY);
        }
        var obj = {};
        obj[STORAGE_KEY] = links;
        chrome.storage.local.set(obj, resolve);
      });
    });
  }

  // Check if a URL has already been submitted
  function isAlreadySubmitted(url) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEY, function (data) {
        var links = data[STORAGE_KEY] || [];
        var found = links.some(function (item) {
          return item.url === url;
        });
        resolve(found);
      });
    });
  }

  // Get submission history
  function getSubmissionHistory(limit) {
    limit = limit || 50;
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEY, function (data) {
        var links = data[STORAGE_KEY] || [];
        resolve(links.slice(0, limit));
      });
    });
  }

  return {
    submitLink: submitLink,
    isAlreadySubmitted: isAlreadySubmitted,
    getSubmissionHistory: getSubmissionHistory,
  };
})();
