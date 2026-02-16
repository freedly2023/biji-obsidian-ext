// inject.js entry — page context: hooks + Vue scanner + transcript fetcher

import { PREFIX, log } from './helpers';
import './network-hooks';  // installs XHR/Fetch hooks as side effect
import { scanVueStore, autoScanVueStore } from './vue-scanner';
import { fetchRawTranscript } from './transcript-fetcher';

// Listen for transcript fetch requests from content.js
window.addEventListener('biji-ext-fetch-transcript', ((e: CustomEvent) => {
  try {
    const data = JSON.parse(e.detail);
    fetchRawTranscript(data.noteId).then(transcript => {
      window.dispatchEvent(
        new CustomEvent('biji-ext-transcript-result', {
          detail: JSON.stringify({ noteId: data.noteId, transcript }),
        })
      );
    });
  } catch (err) {
    console.error('[Biji Ext] Transcript fetch event error:', err);
  }
}) as EventListener);

// Listen for manual scan requests from content.js
window.addEventListener('biji-ext-scan-request', () => {
  log('Manual scan requested from popup');
  const notes = scanVueStore();
  window.dispatchEvent(
    new CustomEvent('biji-ext-scan-result', {
      detail: JSON.stringify({ notes }),
    })
  );
});

// Start auto-scan on biji.com
if (location.hostname.indexOf('biji.com') !== -1) {
  log('Inject script loaded on biji.com, starting auto-scan...');
  autoScanVueStore();
}

console.log(PREFIX, 'Network interceptors + Vue scanner installed (page context)');
