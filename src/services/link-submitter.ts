// Link Submitter — submit links to biji.com API
// Rewritten from link-submitter.js

import { SUBMIT_API_URL } from '../core/constants';
import { storageGet, storageSet } from './storage-service';

const STORAGE_KEY = 'submittedLinks';
const MAX_HISTORY = 500;

export function submitLink(
  url: string,
  title: string,
  capturedHeaders: Record<string, string>,
): Promise<{ noteId: string; linkTitle: string }> {
  if (!capturedHeaders) {
    return Promise.reject(new Error('未捕获到认证信息，请先在 biji.com 页面上浏览'));
  }

  const headers = Object.assign({}, capturedHeaders, { 'content-type': 'application/json' });
  const body = JSON.stringify({
    attachments: [{ size: 100, type: 'link', title: title || '', url }],
    content: '',
    entry_type: 'ai',
    note_type: 'link',
    prompt_template_id: '',
    source: 'web',
  });

  return fetch(SUBMIT_API_URL, { method: 'POST', headers, body }).then(resp => {
    if (!resp.ok) {
      return resp.text().then(text => {
        throw new Error('HTTP ' + resp.status + ': ' + text.substring(0, 200));
      });
    }
    return _readSSEResponse(resp).then(result => {
      return _recordSubmission(url, title, result).then(() => result);
    });
  });
}

function _readSSEResponse(response: Response): Promise<{ noteId: string; linkTitle: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let noteId = '';
  let linkTitle = '';
  let buffer = '';

  function processChunk(): Promise<{ noteId: string; linkTitle: string }> {
    return reader.read().then(result => {
      if (result.done) return { noteId, linkTitle };
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(line => {
        if (line.indexOf('data: ') !== 0) return;
        try {
          const json = JSON.parse(line.substring(6));
          if (json.data && json.data.note_id && !noteId) noteId = json.data.note_id;
          if (json.data && json.data.link_title) linkTitle = json.data.link_title;
        } catch { /* ignore non-JSON lines */ }
      });
      return processChunk();
    });
  }

  return processChunk();
}

function _recordSubmission(
  url: string,
  title: string,
  result: { noteId: string; linkTitle: string },
): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, (data: Record<string, any>) => {
      let links = data[STORAGE_KEY] || [];
      links.unshift({
        url,
        title: title || result.linkTitle || '',
        submittedAt: new Date().toISOString(),
        noteId: result.noteId || '',
      });
      if (links.length > MAX_HISTORY) links = links.slice(0, MAX_HISTORY);
      const obj: Record<string, any> = {};
      obj[STORAGE_KEY] = links;
      chrome.storage.local.set(obj, resolve);
    });
  });
}

export function isAlreadySubmitted(url: string): Promise<boolean> {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, (data: Record<string, any>) => {
      const links = data[STORAGE_KEY] || [];
      resolve(links.some((item: any) => item.url === url));
    });
  });
}

export function getSubmissionHistory(limit = 50): Promise<any[]> {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, (data: Record<string, any>) => {
      const links = data[STORAGE_KEY] || [];
      resolve(links.slice(0, limit));
    });
  });
}

export const LinkSubmitterModule = { submitLink, isAlreadySubmitted, getSubmissionHistory };
