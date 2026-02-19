// api-fetcher.ts — Note fetching via biji API
// Extracted from background.js:131-509

import { BIJI_API_BASE } from '../core/constants';
import { findNotesArray, normalizeNote } from '../core/normalize-note';
import type { Note } from '../core/types';

const DEBUG = false;
function log(...args: any[]) {
  if (!DEBUG) return;
  console.log('[Biji Ext]', ...args);
}

let fetchAbortController: AbortController | null = null;

type StatusCallback = (status: string, fetched: number, done: boolean) => void;
type StoreCallback = (notes: Note[]) => void;

export function fetchAllNotes(
  headers: Record<string, string>,
  fetchDelay: number,
  onStatus: StatusCallback,
  storeNotes: StoreCallback,
): Promise<void> {
  fetchAbortController = new AbortController();
  const signal = fetchAbortController.signal;
  const limit = 50;
  let sinceId = '';
  let totalFetched = 0;
  let pageNum = 0;
  const maxRetries = 3;
  let retries = 0;

  function delay(ms: number): Promise<void> {
    return new Promise(resolve => { setTimeout(resolve, ms); });
  }

  function fetchPage(): Promise<void> {
    if (signal.aborted) {
      onStatus('已取消', totalFetched, true);
      return Promise.resolve();
    }

    if (!headers) {
      onStatus('未捕获到认证信息，请先在 biji.com 页面上浏览笔记列表，然后再点击获取', 0, true);
      return Promise.resolve();
    }

    pageNum++;
    const url = BIJI_API_BASE + '?limit=' + limit + '&since_id=' + sinceId + '&sort=create_desc';
    onStatus('正在获取第 ' + pageNum + ' 批...', totalFetched, false);

    const reqHeaders = Object.assign({}, headers);
    log('Fetching with headers:', Object.keys(reqHeaders).join(', '));

    return fetch(url, { method: 'GET', headers: reqHeaders, signal })
      .then(response => {
        log('Fetch page ' + pageNum + ': HTTP ' + response.status);
        if (!response.ok) {
          return response.text().then(body => {
            log('Error response body:', body.substring(0, 500));
            if (response.status === 429) {
              onStatus('请求限流，等待 5 秒...', totalFetched, false);
              return delay(5000).then(fetchPage);
            }
            if (response.status === 401 || response.status === 403) {
              onStatus('认证失败 (HTTP ' + response.status + ')，请先登录 biji.com', totalFetched, true);
              return Promise.resolve();
            }
            if (retries < maxRetries) {
              retries++;
              onStatus('请求失败 (HTTP ' + response.status + ')，重试中...', totalFetched, false);
              return delay(Math.pow(2, retries) * 500).then(fetchPage);
            }
            onStatus('请求失败 (HTTP ' + response.status + ')', totalFetched, true);
            return Promise.resolve();
          });
        }
        retries = 0;
        return response.json().then(data => {
          if (pageNum === 1) {
            const rawNotes = findNotesArray(data);
            if (rawNotes && rawNotes.length > 0) {
              log('Raw note keys:', Object.keys(rawNotes[0]));
              log('Raw note sample:', JSON.stringify(rawNotes[0]).substring(0, 2000));
            }
          }

          const notes = findNotesArray(data);
          if (!notes || notes.length === 0) {
            onStatus('获取完成！共 ' + totalFetched + ' 条笔记', totalFetched, true);
            return Promise.resolve();
          }

          const normalized = notes.map(normalizeNote);
          totalFetched += normalized.length;
          storeNotes(normalized);
          onStatus('已获取 ' + totalFetched + ' 条笔记', totalFetched, false);

          const lastNote = notes[notes.length - 1];
          const lastId = lastNote.id || lastNote.noteId || lastNote.note_id || lastNote._id || '';
          if (!lastId || notes.length < limit) {
            onStatus('获取完成！共 ' + totalFetched + ' 条笔记', totalFetched, true);
            return Promise.resolve();
          }
          sinceId = String(lastId);
          return delay(fetchDelay).then(fetchPage);
        });
      })
      .catch(e => {
        if (e.name === 'AbortError') {
          onStatus('已取消', totalFetched, true);
          return Promise.resolve();
        }
        if (retries < maxRetries) {
          retries++;
          onStatus('网络错误，重试中...', totalFetched, false);
          return delay(Math.pow(2, retries) * 500).then(fetchPage);
        }
        onStatus('网络错误: ' + e.message, totalFetched, true);
        return Promise.resolve();
      });
  }

  return fetchPage();
}

export function cancelFetch(): void {
  if (fetchAbortController) {
    fetchAbortController.abort();
  }
}

// --- Transcript fetcher ---

export function fetchNoteTranscript(
  headers: Record<string, string>,
  noteId: string,
  noteType: string | null,
): Promise<string | null> {
  if (!headers) {
    console.warn('[Biji Ext] No API headers captured yet. Browse biji.com first.');
    return Promise.resolve(null);
  }

  let typeSegment = '';
  if (noteType === 'link') typeSegment = '/links';
  else if (noteType === 'voice') typeSegment = '/voices';

  const urls: string[] = [];
  if (typeSegment) urls.push(BIJI_API_BASE + '/' + noteId + typeSegment + '/detail');
  urls.push(BIJI_API_BASE + '/' + noteId + '/original');
  urls.push(BIJI_API_BASE + '/' + noteId + '/detail');

  const reqHeaders = Object.assign({}, headers);

  function tryUrl(index: number): Promise<string | null> {
    if (index >= urls.length) return Promise.resolve(null);
    const url = urls[index];
    log('Fetching transcript from:', url);

    return fetch(url, { method: 'GET', headers: reqHeaders })
      .then(resp => {
        if (!resp.ok) {
          log('Detail API returned HTTP', resp.status, 'for', url);
          return tryUrl(index + 1);
        }
        return resp.json().then(data => {
          const transcript = extractTranscript(data);
          if (transcript) {
            log('Transcript found, length:', transcript.length);
            return transcript;
          }
          log('No transcript found in response from', url);
          return tryUrl(index + 1);
        });
      })
      .catch(e => {
        console.warn('[Biji Ext] Detail API error:', e.message);
        return tryUrl(index + 1);
      });
  }

  return tryUrl(0).then(transcript => {
    if (transcript) return transcript;
    return fetchTranscriptFromWebPage(noteId);
  });
}

// --- Content fetcher ---

export function fetchNoteContent(
  headers: Record<string, string>,
  noteId: string,
  noteType: string | null,
): Promise<string | null> {
  if (!headers) return Promise.resolve(null);

  let typeSegment = '';
  if (noteType === 'link') typeSegment = '/links';
  else if (noteType === 'voice') typeSegment = '/voices';
  else if (noteType === 'ai') typeSegment = '/ais';

  const urls: string[] = [];
  if (typeSegment) urls.push(BIJI_API_BASE + '/' + noteId + typeSegment + '/detail');
  urls.push(BIJI_API_BASE + '/' + noteId + '/detail');

  const reqHeaders = Object.assign({}, headers);

  function tryUrl(index: number): Promise<string | null> {
    if (index >= urls.length) return Promise.resolve(null);
    const url = urls[index];
    log('Fetching content from:', url);

    return fetch(url, { method: 'GET', headers: reqHeaders })
      .then(resp => {
        if (!resp.ok) {
          log('Detail API returned HTTP', resp.status, 'for', url);
          return tryUrl(index + 1);
        }
        return resp.json().then(data => {
          log('Detail response keys:', JSON.stringify(Object.keys(data)));
          const content = extractContent(data);
          if (content) {
            log('Content found, length:', content.length);
            return content;
          }
          log('No content found in response from', url);
          return tryUrl(index + 1);
        });
      })
      .catch(e => {
        console.warn('[Biji Ext] Detail API error:', e.message);
        return tryUrl(index + 1);
      });
  }

  return tryUrl(0);
}

// --- Internal helpers ---

function extractContent(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;

  const note = obj.c || obj.data || obj;

  const candidates = [
    note.content, note.text, note.body, note.html, note.richText,
    note.rich_text, note.result, note.answer, note.output, note.summary,
    note.aiContent, note.ai_content, note.aiResult, note.ai_result,
    note.generatedContent, note.generated_content, note.response,
    note.detail, note.description, note.note_content,
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (typeof candidates[i] === 'string' && candidates[i].trim().length > 0) {
      return candidates[i];
    }
  }

  if (note.note && typeof note.note === 'object') {
    return extractContent({ c: note.note });
  }

  return null;
}

function extractTranscript(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;

  const note = obj.c || obj.data || obj;

  // Strategy 0: direct transcript field names
  const transcriptFields = [
    'transcript', 'rawTranscript', 'raw_transcript',
    'originalText', 'original_text', 'originalContent', 'original_content',
    'rawContent', 'raw_content', 'rawText', 'raw_text',
    'voiceText', 'voice_text', 'speechText', 'speech_text',
  ];
  for (const field of transcriptFields) {
    if (typeof note[field] === 'string' && note[field].length > 50) {
      const parsed = _parseSentenceListJson(note[field]);
      if (parsed) return parsed;
      return note[field];
    }
  }

  // Strategy 1: strings with timestamp pattern [00:00:00]
  const timestampTexts: string[] = [];
  findTimestampStrings(obj, timestampTexts, 0);
  if (timestampTexts.length > 0) {
    timestampTexts.sort((a, b) => b.length - a.length);
    return timestampTexts[0];
  }

  // Strategy 2: arrays of paragraph-like objects with timestamps
  const paragraphs = findParagraphArray(obj, 0);
  if (paragraphs) return paragraphs;

  // Strategy 3: fall back to long content from detail API
  if (note && typeof note.content === 'string' && note.content.length > 200) {
    const parsed = _parseSentenceListJson(note.content);
    if (parsed) return parsed;
    return note.content;
  }

  return null;
}

function _parseSentenceListJson(raw: string): string | null {
  if (!raw || raw.charAt(0) !== '{') return null;
  try {
    const obj = JSON.parse(raw);
    const list = obj.sentence_list || obj.sentenceList || obj.sentences;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list
      .map((s: any) => s.text || s.content || s.sentence || '')
      .filter(Boolean)
      .join('\n\n');
  } catch (_) {
    return null;
  }
}

function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCharCode(parseInt(dec, 10)));
}

function fetchTranscriptFromWebPage(noteId: string): Promise<string | null> {
  const webUrl = 'https://www.biji.com/note/' + noteId + '/web';
  log('Transcript API fallback to /web:', webUrl);

  return fetch(webUrl, { method: 'GET', credentials: 'include' })
    .then(resp => {
      if (!resp.ok) {
        log('/web transcript fallback HTTP', resp.status, 'for', noteId);
        return null;
      }
      return resp.text();
    })
    .then((html: string | null) => {
      if (!html) return null;

      const scriptJsonPatterns = [
        /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
        /window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
        /window\.__APP_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/,
        /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>\s*([\s\S]*?)\s*<\/script>/,
      ];

      for (let i = 0; i < scriptJsonPatterns.length; i++) {
        const m = html.match(scriptJsonPatterns[i]);
        if (!m || !m[1]) continue;
        try {
          const obj = JSON.parse(m[1]);
          const transcript = extractTranscript(obj);
          if (transcript && transcript.trim().length > 0) {
            log('Transcript found via /web script JSON, length:', transcript.length);
            return transcript;
          }
        } catch (_) {
          // ignore and continue
        }
      }

      const pTexts: string[] = [];
      const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let match: RegExpExecArray | null = null;
      while ((match = pRe.exec(html)) !== null) {
        let t = match[1] || '';
        t = t.replace(/<br\s*\/?>/gi, '\n');
        t = t.replace(/<[^>]+>/g, '');
        t = decodeHtmlEntities(t).trim();
        if (t) pTexts.push(t);
      }
      if (pTexts.length > 0) {
        const tsOnly = pTexts.filter(t => /^\[?\d{2}:\d{2}:\d{2}\]?/.test(t));
        if (tsOnly.length > 3) {
          const out = tsOnly.join('\n\n');
          log('Transcript found via /web <p> timestamp scan, count:', tsOnly.length, 'length:', out.length);
          return out;
        }
      }

      return null;
    })
    .catch(e => {
      console.warn('[Biji Ext] /web transcript fallback failed for', noteId, e && e.message ? e.message : e);
      return null;
    });
}

function findTimestampStrings(obj: any, results: string[], depth: number): void {
  if (depth > 8 || !obj) return;
  if (typeof obj === 'string') {
    if (/\[\d{2}:\d{2}:\d{2}\]/.test(obj) && obj.length > 100) {
      results.push(obj);
    }
    return;
  }
  if (Array.isArray(obj)) {
    const tsLines: string[] = [];
    let hasTs = false;
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        tsLines.push(obj[i]);
        if (/\[\d{2}:\d{2}:\d{2}\]/.test(obj[i])) hasTs = true;
      } else if (obj[i] && typeof obj[i] === 'object') {
        const t = obj[i].text || obj[i].content || obj[i].body || obj[i].sentence || '';
        if (t) {
          tsLines.push(t);
          if (/\[\d{2}:\d{2}:\d{2}\]/.test(t)) hasTs = true;
        }
      }
    }
    if (hasTs && tsLines.length > 3) {
      results.push(tsLines.join('\n\n'));
    }
    for (let j = 0; j < obj.length && j < 5; j++) {
      if (typeof obj[j] === 'object') findTimestampStrings(obj[j], results, depth + 1);
    }
    return;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    for (let k = 0; k < keys.length; k++) {
      findTimestampStrings(obj[keys[k]], results, depth + 1);
    }
  }
}

function findParagraphArray(obj: any, depth: number): string | null {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj) && obj.length > 5) {
    const texts: string[] = [];
    let hasTs = false;
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      let t = '';
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
    const keys = Object.keys(obj);
    for (let k = 0; k < keys.length; k++) {
      const r = findParagraphArray(obj[keys[k]], depth + 1);
      if (r) return r;
    }
  }
  return null;
}
