// export-api.ts — Server-side PDF/DOCX export via biji API
// Extracted from background.js:515-617

import { BIJI_EXPORT_API } from '../core/constants';

const DEBUG = false;
function log(...args: any[]) {
  if (!DEBUG) return;
  console.log('[Biji Ext]', ...args);
}

export function createExportTask(
  headers: Record<string, string>,
  noteId: string,
  type: string,
): Promise<string> {
  const reqHeaders = Object.assign({}, headers, { 'content-type': 'application/json' });
  return fetch(BIJI_EXPORT_API, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({ type, note_ids: [noteId] }),
  })
    .then(resp => {
      if (!resp.ok) {
        return resp.text().then(body => {
          throw new Error('Export API error HTTP ' + resp.status + ': ' + body.substring(0, 200));
        });
      }
      return resp.json();
    })
    .then(data => {
      log('Export create response:', JSON.stringify(data).substring(0, 500));
      if (data && data.h && data.h.c !== 0) {
        const errMsg = (data.h && data.h.e) || 'Unknown API error';
        log('Export API error:', data.h.c, errMsg);
        throw new Error('Export API error: ' + errMsg + ' (code ' + data.h.c + ')');
      }
      let taskId: string | null = null;
      if (data && data.c && data.c.id) taskId = data.c.id;
      else if (data && data.c && data.c.task_id) taskId = data.c.task_id;
      else if (data && data.data && data.data.id) taskId = data.data.id;
      else if (data && data.id) taskId = data.id;
      else if (data && data.c && typeof data.c === 'string') taskId = data.c;
      if (!taskId) throw new Error('Could not find task ID in export response');
      log('Export task created:', taskId);
      return taskId;
    });
}

export function pollExportTask(
  headers: Record<string, string>,
  taskId: string,
): Promise<{ access_url: string; filename: string }> {
  const reqHeaders = Object.assign({}, headers);
  const maxAttempts = 60;
  let attempt = 0;

  function poll(): Promise<{ access_url: string; filename: string }> {
    attempt++;
    if (attempt > maxAttempts) {
      return Promise.reject(new Error('Export task timed out after ' + maxAttempts + ' attempts'));
    }
    return fetch(BIJI_EXPORT_API + '/' + taskId, { method: 'GET', headers: reqHeaders })
      .then(resp => {
        if (!resp.ok) throw new Error('Poll failed HTTP ' + resp.status);
        return resp.json();
      })
      .then(data => {
        if (data && data.h && data.h.c !== 0) {
          const errMsg = (data.h && data.h.e) || 'Unknown API error';
          log('Export poll API error:', data.h.c, errMsg);
          throw new Error('Export poll error: ' + errMsg + ' (code ' + data.h.c + ')');
        }
        const c = data.c || data.data || data;
        if (c.finished || c.status === 'finished' || c.status === 'done') {
          const accessUrl = c.access_url || c.download_url || c.url || '';
          const filename = c.filename || c.file_name || '';
          if (!accessUrl) {
            log('Export poll response:', JSON.stringify(data).substring(0, 500));
            throw new Error('Export finished but no download URL');
          }
          log('Export ready:', accessUrl);
          return { access_url: accessUrl, filename };
        }
        return new Promise<void>(resolve => { setTimeout(resolve, 1000); }).then(poll);
      });
  }

  return poll();
}

export function exportNoteViaAPI(
  headers: Record<string, string>,
  noteId: string,
  format: string,
): Promise<{ access_url: string; filename: string }> {
  return createExportTask(headers, noteId, format).then(taskId => {
    return pollExportTask(headers, taskId);
  });
}
