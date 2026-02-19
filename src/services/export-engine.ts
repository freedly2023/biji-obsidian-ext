// Export Engine — shared export logic for popup.js and notes.js
// Extracted from shared.js ExportEngine

import type { Note, Settings } from '../core/types';
import { MD, htmlToMd, convert as mdConvert, convertTranscript as mdConvertTranscript } from '../core/markdown-converter';
import { normalizeTranscript } from '../core/sanitize';
import { fullPath, fullPathWithFormat, getFileExt, deduplicateFilename } from '../core/filename';
import { ExportTracker } from './export-tracker';
import { PDFConverter } from './pdf-converter';
import { DOCXConverter } from './docx-converter';
import { ensureExportLibraries } from './runtime-lib-loader';

const DEFAULT_CONTENT_FETCH_CONCURRENCY = 5;
const DEFAULT_TRANSCRIPT_FETCH_CONCURRENCY = 5;
const DEFAULT_ZIP_EXPORT_CONCURRENCY_LIGHT = 6;
const DEFAULT_ZIP_EXPORT_CONCURRENCY_HEAVY = 2;
const DEFAULT_VAULT_WRITE_CONCURRENCY = 4;

function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return Promise.resolve();

  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  function runNext(): Promise<void> {
    if (cursor >= items.length) return Promise.resolve();
    const index = cursor++;
    return worker(items[index], index).then(runNext);
  }

  const workers = Array.from({ length: limit }, () => runNext());
  return Promise.all(workers).then(() => {});
}

function resolveContentFetchConcurrency(settings?: Settings): number {
  return clampInt(
    settings && settings.contentFetchConcurrency,
    1,
    12,
    DEFAULT_CONTENT_FETCH_CONCURRENCY,
  );
}

function resolveTranscriptFetchConcurrency(settings?: Settings): number {
  return clampInt(
    settings && settings.transcriptFetchConcurrency,
    1,
    12,
    DEFAULT_TRANSCRIPT_FETCH_CONCURRENCY,
  );
}

function resolveZipConcurrency(formats: string[], settings: Settings): number {
  const hasHeavyFormat = formats.indexOf('pdf') !== -1 || formats.indexOf('docx') !== -1;
  if (hasHeavyFormat) {
    return clampInt(
      settings.zipExportConcurrencyHeavy,
      1,
      6,
      DEFAULT_ZIP_EXPORT_CONCURRENCY_HEAVY,
    );
  }
  return clampInt(
    settings.zipExportConcurrencyLight,
    1,
    12,
    DEFAULT_ZIP_EXPORT_CONCURRENCY_LIGHT,
  );
}

function resolveVaultWriteConcurrency(settings: Settings): number {
  return clampInt(
    settings.vaultWriteConcurrency,
    1,
    12,
    DEFAULT_VAULT_WRITE_CONCURRENCY,
  );
}

function buildMainMarkdown(note: Note, settings: Settings): string {
  if (settings.transcriptMode === 'merged' && note.rawTranscript) {
    const mainContent = mdConvert(note, settings);
    const rawContent = normalizeTranscript(note.rawTranscript);
    return mainContent + '\n\n---\n\n## 原始文字记录\n\n' + rawContent;
  }
  return mdConvert(note, settings);
}

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
  settings?: Settings,
): Promise<void> {
  const missing = notes.filter(n => !n.content || n.content.trim().length === 0);
  if (missing.length === 0) return Promise.resolve();

  let done = 0;
  const total = missing.length;

  return runWithConcurrency(
    missing,
    resolveContentFetchConcurrency(settings),
    (note): Promise<void> => {
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
      }).then(() => {
        done++;
        if (onProgress) onProgress(done, total);
      });
    },
  );
}

export function fetchMissingTranscripts(
  notes: Note[],
  onProgress?: (done: number, total: number) => void,
  settings?: Settings,
): Promise<void> {
  const missing = notes.filter(n => !n.rawTranscript);
  if (missing.length === 0) return Promise.resolve();

  let done = 0;
  const total = missing.length;

  return runWithConcurrency(
    missing,
    resolveTranscriptFetchConcurrency(settings),
    (note): Promise<void> => {
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
      });
    },
  );
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
  return ensureExportLibraries(formats).then(() => mergePendingTags(notes)).then(mergedNotes => {
    const zip = new JSZip();
    const folder = zip.folder('biji-export');
    const used: Record<string, boolean> = {};
    const total = mergedNotes.length;
    const concurrency = resolveZipConcurrency(formats, settings);
    let done = 0;

    function processOneNote(note: Note): Promise<void> {
      let chain = Promise.resolve();

      formats.forEach(format => {
        chain = chain.then(() => {
          const ext = getFileExt(format);
          let fn = fullPathWithFormat(note, settings, format);
          fn = deduplicateFilename(fn, used, ext);
          used[fn] = true;

          let genPromise: Promise<string | Blob>;
          if (format === 'md') {
            genPromise = Promise.resolve(buildMainMarkdown(note, settings));
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
            });
        });
      });

      return chain.then(() => {
        return processTranscript(note, formats, folder, used, settings);
      }).then(() => {
        done++;
        if (onProgress) onProgress(done, total);
      });
    }

    return runWithConcurrency(mergedNotes, concurrency, (note): Promise<void> => {
      return processOneNote(note);
    }).then(() => _finishZip(zip, mergedNotes));
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
    const vaultWriteConcurrency = resolveVaultWriteConcurrency(settings);
    const converter = {
      filename: (note: Note) => fullPath(note, settings),
      convert: (note: Note) => {
        if (settings.transcriptMode === 'merged' && note.rawTranscript) {
          const mainContent = mdConvert(note, settings);
          const rawContent = normalizeTranscript(note.rawTranscript);
          return mainContent + '\n\n---\n\n## 原始文字记录\n\n' + rawContent;
        }
        return mdConvert(note, settings);
      },
    };

    return VaultWriter.writeAllNotes(
      mergedNotes,
      subfolder,
      converter,
      onProgress as any,
      vaultWriteConcurrency,
    ).then(
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
              vaultWriteConcurrency,
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
