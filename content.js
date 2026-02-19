(function () {
    'use strict';

    "use strict";
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
    window.addEventListener('biji-ext-data', ((e) => {
        try {
            if (!chrome.runtime?.id)
                return; // extension context invalidated, silently ignore
            const msg = JSON.parse(e.detail);
            chrome.runtime.sendMessage(msg, () => {
                if (chrome.runtime.lastError) { /* context invalidated, ignore */ }
            });
        }
        catch (err) {
            if (err.message?.includes('Extension context invalidated'))
                return;
            console.error(PREFIX, 'Failed to parse message:', err);
        }
    }));
    // 3. Listen for commands from popup
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg.type === 'scanVueStore') {
            window.dispatchEvent(new CustomEvent('biji-ext-scan-request'));
            let handled = false;
            const timeout = setTimeout(() => {
                if (!handled) {
                    handled = true;
                    if (DEBUG)
                        console.log(PREFIX, 'Vue scan timeout — inject.js may not be loaded');
                    sendResponse({ notes: [] });
                }
            }, 10000);
            const onResult = ((e) => {
                if (handled)
                    return;
                handled = true;
                clearTimeout(timeout);
                window.removeEventListener('biji-ext-scan-result', onResult);
                try {
                    const result = JSON.parse(e.detail);
                    sendResponse({ notes: result.notes || [] });
                }
                catch (err) {
                    console.error(PREFIX, 'Failed to parse scan result:', err);
                    sendResponse({ notes: [] });
                }
            });
            window.addEventListener('biji-ext-scan-result', onResult);
            return true; // Keep sendResponse channel open for async reply
        }
        else if (msg.type === 'fetchTranscript') {
            const noteId = msg.noteId;
            window.dispatchEvent(new CustomEvent('biji-ext-fetch-transcript', {
                detail: JSON.stringify({ noteId }),
            }));
            let txHandled = false;
            const txTimeout = setTimeout(() => {
                if (!txHandled) {
                    txHandled = true;
                    if (DEBUG)
                        console.log(PREFIX, 'Transcript fetch timeout for note:', noteId);
                    sendResponse({ noteId, transcript: null });
                }
            }, 15000);
            const onTxResult = ((e) => {
                if (txHandled)
                    return;
                try {
                    const result = JSON.parse(e.detail);
                    if (result.noteId !== noteId)
                        return; // not our request
                    txHandled = true;
                    clearTimeout(txTimeout);
                    window.removeEventListener('biji-ext-transcript-result', onTxResult);
                    sendResponse({ noteId: result.noteId, transcript: result.transcript });
                }
                catch (err) {
                    console.error(PREFIX, 'Failed to parse transcript result:', err);
                    txHandled = true;
                    clearTimeout(txTimeout);
                    window.removeEventListener('biji-ext-transcript-result', onTxResult);
                    sendResponse({ noteId, transcript: null });
                }
            });
            window.addEventListener('biji-ext-transcript-result', onTxResult);
            return true; // Keep sendResponse channel open for async reply
        }
    });
    console.log(PREFIX, 'Content script loaded (bridge mode — Vue scanning delegated to inject.js)');

})();
