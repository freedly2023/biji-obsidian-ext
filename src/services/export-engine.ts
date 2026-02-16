// Export Engine — shared export logic for popup.js and notes.js
// Extracted from shared.js ExportEngine

import type { Note, Settings } from '../core/types';
import { MD, htmlToMd, convert as mdConvert, convertTranscript as mdConvertTranscript } from '../core/markdown-converter';
import { fullPath, fullPathWithFormat, getFileExt, deduplicateFilename } from '../core/filename';
import { ExportTracker } from './export-tracker';
import { PDFConverter } from './pdf-converter';
import { DOCXConverter } from './docx-converter';

export function mergePendingTags(notes: Note[]): Promise<Note[]> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'getPendingTags' }, (res: any) => {
      if (chrome.runtime.lastError || !res || !res.tags) {
        resolve(notes);
        return;
      }
      const pendingTags = res.tags;
      notes.forEach(note => {
        const entry = pendingTags[note.id];
        if (entry && entry.tags && entry.tags.length > 0) {
          const existing = (note.tags || []).map((t: any) =>
            typeof t === 'string' ? t : t.name || t.label || '',
          );
          entry.tags.forEach((tag: string) => {
            if (tag && existing.indexOf(tag) === -1) {
              existing.push(tag);
            }
          });
          note.tags = existing;
        }
      });
      resolve(notes);
    });
  });
}

export function fetchMissingContent(
  notes: Note[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const missing = notes.filter(n => !n.content || n.content.trim().length === 0);
  if (missing.length === 0) return Promise.resolve();

  let done = 0;
  const total = missing.length;

  function fetchNext(index: number): Promise<void> {
    if (index >= missing.length) return Promise.resolve();
    const note = missing[index];
    done++;
    if (onProgress) onProgress(done, total);

    return new Promise<void>(resolve => {
      chrome.runtime.sendMessage(
        { type: 'fetchContent', noteId: note.id, noteType: (note as any).noteType || note.type || '' },
        (res: any) => {
          if (chrome.runtime.lastError) {
            console.warn('[Biji Ext] Content fetch error for', note.id, chrome.runtime.lastError);
            resolve();
            return;
          }
          if (res && res.content) {
            note.content = res.content;
            chrome.runtime.sendMessage({ type: 'storeVueNotes', notes: [{ id: note.id, content: res.content }] });
          }
          resolve();
        },
      );
    }).then(() => fetchNext(index + 1));
  }

  return fetchNext(0);
}

export function fetchMissingTranscripts(
  notes: Note[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const missing = notes.filter(n => !n.rawTranscript);
  if (missing.length === 0) return Promise.resolve();

  const CONCURRENCY = 5;
  let index = 0;
  let done = 0;
  const total = missing.length;

  function fetchOne(): Promise<void> {
    if (index >= missing.length) return Promise.resolve();
    const note = missing[index++];

    return new Promise<void>(resolve => {
      chrome.runtime.sendMessage(
        { type: 'fetchTranscript', noteId: note.id, noteType: (note as any).noteType || note.type || '' },
        (res: any) => {
          if (chrome.runtime.lastError) {
            console.warn('[Biji Ext] Transcript fetch error for', note.id, chrome.runtime.lastError);
            resolve();
            return;
          }
          if (res && res.transcript) {
            note.rawTranscript = res.transcript;
            chrome.runtime.sendMessage({ type: 'storeVueNotes', notes: [{ id: note.id, rawTranscript: res.transcript }] });
          }
          resolve();
        },
      );
    }).then(() => {
      done++;
      if (onProgress) onProgress(done, total);
      return fetchOne();
    });
  }

  const workers = Array(Math.min(CONCURRENCY, missing.length)).fill(null).map(() => fetchOne());
  return Promise.all(workers).then(() => {});
}

export function getActiveFormats(activeFileFormats: Record<string, boolean>): string[] {
  return Object.keys(activeFileFormats).filter(f => activeFileFormats[f]);
}

export function processTranscript(
  note: Note,
  formats: string[],
  folder: any,
  used: Record<string, boolean>,
  settings: Settings,
): Promise<void> {
  if (settings.transcriptMode === 'none') return Promise.resolve();
  if (!note.rawTranscript && !note.content) return Promise.resolve();

  let chain = Promise.resolve();

  formats.forEach(format => {
    chain = chain.then(() => {
      if (format === 'md') {
        if (settings.transcriptMode === 'separate') {
          let tFn = fullPathWithFormat(note, settings, 'md').replace('.md', '-transcript.md');
          tFn = deduplicateFilename(tFn, used, '.md');
          used[tFn] = true;
          folder.file(tFn, mdConvertTranscript(note, settings));
        }
      } else if (format === 'pdf') {
        if (settings.transcriptMode !== 'separate') return;
        let tFn = fullPathWithFormat(note, settings, 'pdf').replace('.pdf', '-transcript.pdf');
        tFn = deduplicateFilename(tFn, used, '.pdf');
        used[tFn] = true;
        return PDFConverter.generateTranscriptPdf(note, settings)
          .then(blob => { folder.file(tFn, blob); })
          .catch(err => {
            console.warn('[Biji Ext] Transcript PDF failed, falling back to MD:', err.message);
            const fallback = tFn.replace('.pdf', '.md');
            folder.file(fallback, mdConvertTranscript(note, settings));
          });
      } else if (format === 'docx') {
        if (settings.transcriptMode !== 'separate') return;
        let tFn = fullPathWithFormat(note, settings, 'docx').replace('.docx', '-transcript.docx');
        tFn = deduplicateFilename(tFn, used, '.docx');
        used[tFn] = true;
        return DOCXConverter.generateTranscriptDocx(note, settings)
          .then(blob => { folder.file(tFn, blob); })
          .catch(() => {
            const fallback = tFn.replace('.docx', '.md');
            folder.file(fallback, mdConvertTranscript(note, settings));
          });
      }
    });
  });

  return chain;
}

export function zipExport(
  notes: Note[],
  settings: Settings,
  formats: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ success: boolean }> {
  return mergePendingTags(notes).then(mergedNotes => {
    const zip = new JSZip();
    const folder = zip.folder('biji-export');
    const used: Record<string, boolean> = {};
    const total = mergedNotes.length;

    function processNote(index: number): Promise<{ success: boolean }> {
      if (index >= total) return _finishZip(zip, mergedNotes);
      const note = mergedNotes[index];

      function processFormat(fmtIndex: number): Promise<{ success: boolean }> {
        if (fmtIndex >= formats.length) {
          return processTranscript(note, formats, folder, used, settings).then(() => {
            if (onProgress) onProgress(index + 1, total);
            return processNote(index + 1);
          });
        }

        const format = formats[fmtIndex];
        const ext = getFileExt(format);
        let fn = fullPathWithFormat(note, settings, format);
        fn = deduplicateFilename(fn, used, ext);
        used[fn] = true;

        let genPromise: Promise<string | Blob>;
        if (format === 'md') {
          let mdContent: string;
          if (settings.transcriptMode === 'merged' && note.rawTranscript) {
            mdContent = mdConvert(note, settings);
            let rawContent = note.rawTranscript;
            if (rawContent.includes('<') && rawContent.includes('>')) {
              rawContent = htmlToMd(rawContent);
            }
            mdContent += '\n\n---\n\n## 原始文字记录\n\n' + rawContent;
          } else {
            mdContent = mdConvert(note, settings);
          }
          genPromise = Promise.resolve(mdContent);
        } else if (format === 'pdf') {
          genPromise = PDFConverter.generatePdf(note, settings);
        } else {
          genPromise = DOCXConverter.generateDocx(note, settings);
        }

        return genPromise
          .then(data => { folder.file(fn, data); })
          .catch(err => {
            console.warn('[Biji Ext] Export error (' + format + ') for', note.id, err);
            const mdFn = fn.replace(ext, '.md');
            if (!used[mdFn]) {
              folder.file(mdFn, mdConvert(note, settings));
              used[mdFn] = true;
            }
          })
          .then(() => processFormat(fmtIndex + 1));
      }

      return processFormat(0);
    }

    return processNote(0);
  });
}

function _finishZip(zip: any, notes: Note[]): Promise<{ success: boolean }> {
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then((content: Blob) => {
    const ts = new Date().toISOString().substring(0, 10);
    saveAs(content, 'biji-export-' + ts + '.zip');
    ExportTracker.markExported(notes.map(n => n.id));
    return { success: true };
  });
}

export function vaultExport(
  notes: Note[],
  settings: Settings,
  onProgress?: (done: number, total: number, written?: number, errors?: number) => void,
): Promise<{ written: number; errors: any[] }> {
  return mergePendingTags(notes).then(mergedNotes => {
    const subfolder = settings.vaultSubfolder || 'biji-notes';
    const converter = {
      filename: (note: Note) => fullPath(note, settings),
      convert: (note: Note) => {
        if (settings.transcriptMode === 'merged' && note.rawTranscript) {
          const mainContent = mdConvert(note, settings);
          let rawContent = note.rawTranscript;
          if (rawContent.includes('<') && rawContent.includes('>')) {
            rawContent = htmlToMd(rawContent);
          }
          return mainContent + '\n\n---\n\n## 原始文字记录\n\n' + rawContent;
        }
        return mdConvert(note, settings);
      },
    };

    return VaultWriter.writeAllNotes(mergedNotes, subfolder, converter, onProgress as any).then(
      (result: { written: number; errors: any[] }) => {
        if (settings.transcriptMode === 'separate') {
          const notesWithContent = mergedNotes.filter(n => !!n.content);
          if (notesWithContent.length > 0) {
            const txConverter = {
              filename: (note: Note) => fullPath(note, settings).replace('.md', '-transcript.md'),
              convert: (note: Note) => mdConvertTranscript(note, settings),
            };
            return VaultWriter.writeAllNotes(
              notesWithContent, subfolder, txConverter,
              (done: number, total: number) => {
                if (onProgress) onProgress(done, total, done, 0);
              },
            ).then((txResult: { written: number; errors: any[] }) => ({
              written: result.written + txResult.written,
              errors: result.errors.concat(txResult.errors),
            }));
          }
        }
        return result;
      },
    );
  });
}

export const ExportEngine = {
  mergePendingTags,
  fetchMissingContent,
  fetchMissingTranscripts,
  getActiveFormats,
  processTranscript,
  zipExport,
  vaultExport,
};
