// content.js — Bridge between inject.js (page context) and extension
// Runs in content script context with access to chrome.runtime

const PREFIX = '[Biji Ext]';
const DEBUG = false;

// 1. Inject the page-level interceptor + Vue scanner script
const s = document.createElement('script');
s.src = chrome.runtime.getURL('inject.js');
s.onload = () => s.remove();
(document.head || document.documentElement).appendChild(s);

// 2. Listen for data from inject.js via CustomEvent
window.addEventListener('biji-ext-data', ((e: CustomEvent) => {
  try {
    if (!chrome.runtime?.id) return; // extension context invalidated, silently ignore
    const msg = JSON.parse(e.detail);
    chrome.runtime.sendMessage(msg, () => {
      if (chrome.runtime.lastError) { /* context invalidated, ignore */ }
    });
  } catch (err: any) {
    if (err.message?.includes('Extension context invalidated')) return;
    console.error(PREFIX, 'Failed to parse message:', err);
  }
}) as EventListener);

// 3. Listen for commands from popup
chrome.runtime.onMessage.addListener((msg: any, _sender: any, sendResponse: (response?: any) => void) => {
  if (msg.type === 'scanVueStore') {
    window.dispatchEvent(new CustomEvent('biji-ext-scan-request'));

    let handled = false;
    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        if (DEBUG) console.log(PREFIX, 'Vue scan timeout — inject.js may not be loaded');
        sendResponse({ notes: [] });
      }
    }, 10000);

    const onResult = ((e: CustomEvent) => {
      if (handled) return;
      handled = true;
      clearTimeout(timeout);
      window.removeEventListener('biji-ext-scan-result', onResult as EventListener);
      try {
        const result = JSON.parse(e.detail);
        sendResponse({ notes: result.notes || [] });
      } catch (err) {
        console.error(PREFIX, 'Failed to parse scan result:', err);
        sendResponse({ notes: [] });
      }
    }) as EventListener;
    window.addEventListener('biji-ext-scan-result', onResult);

    return true; // Keep sendResponse channel open for async reply
  } else if (msg.type === 'fetchTranscript') {
    const noteId = msg.noteId;
    window.dispatchEvent(
      new CustomEvent('biji-ext-fetch-transcript', {
        detail: JSON.stringify({ noteId }),
      })
    );

    let txHandled = false;
    const txTimeout = setTimeout(() => {
      if (!txHandled) {
        txHandled = true;
        if (DEBUG) console.log(PREFIX, 'Transcript fetch timeout for note:', noteId);
        sendResponse({ noteId, transcript: null });
      }
    }, 15000);

    const onTxResult = ((e: CustomEvent) => {
      if (txHandled) return;
      try {
        const result = JSON.parse(e.detail);
        if (result.noteId !== noteId) return; // not our request
        txHandled = true;
        clearTimeout(txTimeout);
        window.removeEventListener('biji-ext-transcript-result', onTxResult as EventListener);
        sendResponse({ noteId: result.noteId, transcript: result.transcript });
      } catch (err) {
        console.error(PREFIX, 'Failed to parse transcript result:', err);
        txHandled = true;
        clearTimeout(txTimeout);
        window.removeEventListener('biji-ext-transcript-result', onTxResult as EventListener);
        sendResponse({ noteId, transcript: null });
      }
    }) as EventListener;
    window.addEventListener('biji-ext-transcript-result', onTxResult);

    return true; // Keep sendResponse channel open for async reply
  }
});

console.log(PREFIX, 'Content script loaded (bridge mode — Vue scanning delegated to inject.js)');
