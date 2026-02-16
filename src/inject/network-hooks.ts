// XHR & Fetch hooks — intercept biji.com API responses in page context

import { normalizeNote, findNotesArray } from '../core/normalize-note';
import { log, postToExtension } from './helpers';

// Capture originals BEFORE hooking — exported for transcript-fetcher
export const origFetch = window.fetch;
const OrigXHR = window.XMLHttpRequest;

function isBijiDomain(url: string): boolean {
  return url.indexOf('biji.com') !== -1 || url.indexOf('luojilab.com') !== -1;
}

function processResponse(url: string, text: string): void {
  if (url.includes('/api') || url.includes('/v1') || url.includes('/v2')) {
    postToExtension('discovery', { url, preview: text.substring(0, 800) });
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return;
  }

  const notes = findNotesArray(data);
  if (notes && notes.length > 0) {
    const first = notes[0];
    const fieldInfo: Record<string, string> = {};
    Object.keys(first).forEach(k => {
      const v = first[k];
      const t = Array.isArray(v) ? 'Array(' + v.length + ')' : typeof v;
      let preview = '';
      if (typeof v === 'string') preview = v.substring(0, 120);
      else if (v !== null && v !== undefined) preview = String(v).substring(0, 120);
      fieldInfo[k] = t + (preview ? ' | ' + preview : '');
    });
    log('Raw note fields:', JSON.stringify(fieldInfo, null, 2));
    postToExtension('discovery', {
      url: url + ' [field-discovery]',
      preview: 'Fields: ' + Object.keys(first).join(', '),
    });

    const normalized = notes.map(normalizeNote);
    log('Network interceptor captured', normalized.length, 'notes from', url);
    postToExtension('notes', { url, notes: normalized });
  }
}

// --- Hook XMLHttpRequest ---
function HookedXHR(this: XMLHttpRequest) {
  const xhr = new OrigXHR();
  let _url = '';
  let _method = 'GET';
  let _headers: Record<string, string> = {};

  const origOpen = xhr.open.bind(xhr);
  xhr.open = function (this: any, method: string, url: string) {
    _url = url;
    _method = (method || 'GET').toUpperCase();
    _headers = {};
    return origOpen.apply(this, arguments as any);
  } as any;

  const origSetRequestHeader = xhr.setRequestHeader.bind(xhr);
  xhr.setRequestHeader = function (this: any, name: string, value: string) {
    _headers[name] = value;
    return origSetRequestHeader.apply(this, arguments as any);
  } as any;

  const origSend = xhr.send.bind(xhr);
  xhr.send = function (this: any, body?: any) {
    if (_url.indexOf('get-notes.luojilab.com') !== -1) {
      log('XHR API request headers captured:', JSON.stringify(_headers));
      postToExtension('apiHeaders', { headers: _headers });
    }
    if (_method === 'POST' && isBijiDomain(_url) && body) {
      const bodyPreview = typeof body === 'string'
        ? body.substring(0, 2000)
        : String(body).substring(0, 2000);
      postToExtension('discovery', {
        url: _url + ' [XHR-POST-REQUEST]',
        preview: 'Method: POST\nHeaders: ' + JSON.stringify(_headers) + '\nBody: ' + bodyPreview,
      });
    }
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        processResponse(_url, xhr.responseText);
      }
    });
    return origSend.apply(this, arguments as any);
  } as any;

  return xhr;
}
(HookedXHR as any).prototype = OrigXHR.prototype;
(HookedXHR as any).DONE = 4;
(HookedXHR as any).HEADERS_RECEIVED = 2;
(HookedXHR as any).LOADING = 3;
(HookedXHR as any).OPENED = 1;
(HookedXHR as any).UNSENT = 0;
(window as any).XMLHttpRequest = HookedXHR;

// --- Hook fetch ---
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string'
    ? input
    : input instanceof Request ? input.url : String(input);

  let capturedHeaders: Record<string, string> = {};
  if (url.indexOf('get-notes.luojilab.com') !== -1) {
    if (init && init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { capturedHeaders[k] = v; });
      } else if (typeof init.headers === 'object') {
        Object.keys(init.headers).forEach(k => {
          capturedHeaders[k] = (init!.headers as Record<string, string>)[k];
        });
      }
    }
    if (input instanceof Request) {
      input.headers.forEach((v, k) => {
        if (!capturedHeaders[k]) capturedHeaders[k] = v;
      });
    }
    log('API request headers captured:', JSON.stringify(capturedHeaders));
    postToExtension('apiHeaders', { headers: capturedHeaders });
  }

  const method = ((init && init.method) || 'GET').toUpperCase();
  if (method === 'POST' && isBijiDomain(url)) {
    const reqBody = init && init.body;
    if (reqBody) {
      const bodyPreview = typeof reqBody === 'string'
        ? reqBody.substring(0, 2000)
        : String(reqBody).substring(0, 2000);
      postToExtension('discovery', {
        url: url + ' [FETCH-POST-REQUEST]',
        preview: 'Method: POST\nHeaders: ' + JSON.stringify(capturedHeaders) + '\nBody: ' + bodyPreview,
      });
    }
  }

  const promise = origFetch.call(window, input, init);
  promise
    .then(response => {
      if (response.ok) {
        response.clone().text()
          .then(text => processResponse(url, text))
          .catch(() => {});
      }
    })
    .catch(() => {});
  return promise;
};
