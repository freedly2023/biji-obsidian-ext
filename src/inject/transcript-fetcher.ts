// Fetch raw transcript from /note/{id}/web page

import { origFetch } from './network-hooks';
import { log } from './helpers';

export function fetchRawTranscript(noteId: string): Promise<string | null> {
  const url = 'https://www.biji.com/note/' + noteId + '/web';
  log('Fetching transcript from:', url);

  return origFetch(url, { credentials: 'include' })
    .then(resp => {
      if (!resp.ok) {
        console.warn('[Biji Ext] /web page returned HTTP', resp.status);
        return null;
      }
      return resp.text();
    })
    .then((html: string | null) => {
      if (!html) return null;
      log('/web page HTML length:', html.length);

      // Try 1: extract from SSR state embedded in script tags
      const statePatterns = [
        /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
        /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
        /window\.__APP_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/,
      ];

      const candidates = [
        'transcript', 'rawText', 'raw_text', 'voiceText', 'voice_text',
        'asr', 'asrText', 'asr_text', 'originalText', 'original_text',
      ];

      function findText(obj: any, depth: number): string | null {
        if (depth > 6 || !obj || typeof obj !== 'object') return null;
        for (let i = 0; i < candidates.length; i++) {
          if (obj[candidates[i]] && typeof obj[candidates[i]] === 'string' &&
              obj[candidates[i]].length > 50) {
            return obj[candidates[i]];
          }
        }
        const keys = Object.keys(obj);
        for (let j = 0; j < keys.length; j++) {
          const r = findText(obj[keys[j]], depth + 1);
          if (r) return r;
        }
        return null;
      }

      for (let p = 0; p < statePatterns.length; p++) {
        const stateMatch = html.match(statePatterns[p]);
        if (stateMatch) {
          try {
            const state = JSON.parse(stateMatch[1]);
            const text = findText(state, 0);
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
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const selectors = [
          '.n-scrollbar-content', '.web-html', '.web-detail',
          '.note-web', '.note-content-wrap', '.note-content',
          '.transcript', '.voice-content', 'article', 'main',
        ];

        for (let i = 0; i < selectors.length; i++) {
          const el = doc.querySelector(selectors[i]);
          if (el) {
            const paragraphs = el.querySelectorAll('p');
            if (paragraphs.length > 0) {
              const texts: string[] = [];
              let hasTimestamp = false;
              paragraphs.forEach(p => {
                const t = p.textContent!.trim();
                if (t) {
                  texts.push(t);
                  if (/^\[?\d{2}:\d{2}:\d{2}\]?/.test(t)) hasTimestamp = true;
                }
              });
              if (hasTimestamp && texts.length > 3) {
                const result = texts.join('\n\n');
                log('Found transcript via selector "' + selectors[i] + '", paragraphs:',
                  texts.length, 'length:', result.length);
                return result;
              }
            }
            const fullText = el.textContent!.trim();
            if (fullText.length > 100) {
              log('Found content via selector "' + selectors[i] + '", length:', fullText.length);
              return fullText;
            }
          }
        }

        // Try 3: find any <p> tags with timestamp pattern anywhere
        const allP = doc.querySelectorAll('p');
        const timestampTexts: string[] = [];
        allP.forEach(p => {
          const t = p.textContent!.trim();
          if (t && /^\[?\d{2}:\d{2}:\d{2}\]?/.test(t)) {
            timestampTexts.push(t);
          }
        });
        if (timestampTexts.length > 3) {
          const result = timestampTexts.join('\n\n');
          log('Found transcript via timestamp <p> scan, count:',
            timestampTexts.length, 'length:', result.length);
          return result;
        }

        log('No transcript found in /web page DOM. Body length:',
          doc.body ? doc.body.textContent!.length : 0);
      } catch (e) {
        console.warn('[Biji Ext] Failed to parse /web page HTML:', e);
      }

      return null;
    })
    .catch(e => {
      console.warn('[Biji Ext] Failed to fetch /note/' + noteId + '/web:', e);
      return null;
    });
}
