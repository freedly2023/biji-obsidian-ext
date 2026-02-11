// content.js — Bridge between inject.js (page context) and extension
// Runs in content script context with access to chrome.runtime
//
// IMPORTANT: Content scripts run in an "isolated world" and CANNOT access
// page JavaScript properties like __vue__, __vue_app__, or __INITIAL_STATE__.
// All Vue Store scanning is done in inject.js (page context) and results
// are sent back here via CustomEvent.

(function () {
  'use strict';

  var PREFIX = '[Biji Ext]';
  var DEBUG = false;

  // 1. Inject the page-level interceptor + Vue scanner script
  var s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  s.onload = function () { s.remove(); };
  (document.head || document.documentElement).appendChild(s);

  // 2. Listen for data from inject.js via CustomEvent
  // This handles both network-captured notes and Vue store scan results
  window.addEventListener('biji-ext-data', function (e) {
    try {
      var msg = JSON.parse(e.detail);
      // Forward to background service worker
      chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.error(PREFIX, 'Failed to parse message:', err);
    }
  });

  // 3. Listen for commands from popup
  // For scanVueStore: delegate to inject.js via CustomEvent since we can't
  // access Vue internals from the content script isolated world
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'scanVueStore') {
      // Send request to inject.js (page context)
      window.dispatchEvent(new CustomEvent('biji-ext-scan-request'));

      // Wait for result from inject.js with a timeout
      var handled = false;
      var timeout = setTimeout(function () {
        if (!handled) {
          handled = true;
          if (DEBUG) console.log(PREFIX, 'Vue scan timeout — inject.js may not be loaded');
          sendResponse({ notes: [] });
        }
      }, 10000);

      window.addEventListener('biji-ext-scan-result', function onResult(e) {
        if (handled) return;
        handled = true;
        clearTimeout(timeout);
        window.removeEventListener('biji-ext-scan-result', onResult);
        try {
          var result = JSON.parse(e.detail);
          sendResponse({ notes: result.notes || [] });
        } catch (err) {
          console.error(PREFIX, 'Failed to parse scan result:', err);
          sendResponse({ notes: [] });
        }
      });

      return true; // Keep sendResponse channel open for async reply

    } else if (msg.type === 'fetchTranscript') {
      // Bridge popup → inject.js for raw transcript fetching
      var noteId = msg.noteId;
      window.dispatchEvent(new CustomEvent('biji-ext-fetch-transcript', {
        detail: JSON.stringify({ noteId: noteId })
      }));

      var txHandled = false;
      var txTimeout = setTimeout(function () {
        if (!txHandled) {
          txHandled = true;
          if (DEBUG) console.log(PREFIX, 'Transcript fetch timeout for note:', noteId);
          sendResponse({ noteId: noteId, transcript: null });
        }
      }, 15000);

      window.addEventListener('biji-ext-transcript-result', function onTxResult(e) {
        if (txHandled) return;
        try {
          var result = JSON.parse(e.detail);
          if (result.noteId !== noteId) return; // not our request
          txHandled = true;
          clearTimeout(txTimeout);
          window.removeEventListener('biji-ext-transcript-result', onTxResult);
          sendResponse({ noteId: result.noteId, transcript: result.transcript });
        } catch (err) {
          console.error(PREFIX, 'Failed to parse transcript result:', err);
          txHandled = true;
          clearTimeout(txTimeout);
          window.removeEventListener('biji-ext-transcript-result', onTxResult);
          sendResponse({ noteId: noteId, transcript: null });
        }
      });

      return true; // Keep sendResponse channel open for async reply
    }

  });

  console.log(PREFIX, 'Content script loaded (bridge mode — Vue scanning delegated to inject.js)');
})();
