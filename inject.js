(function () {
    'use strict';

    // Shared helpers for inject modules (page context)
    const PREFIX = '[Biji Ext]';
    const DEBUG_SCAN = false;
    function log(...args) {
        if (!DEBUG_SCAN)
            return;
        console.log(PREFIX, ...args);
    }
    function postToExtension(type, payload) {
        window.dispatchEvent(new CustomEvent('biji-ext-data', {
            detail: JSON.stringify({ type, payload }),
        }));
    }

    // Canonical normalizeNote + findNotesArray
    // Previously duplicated in inject.js and background.js
    function normalizeNote(raw) {
        return {
            id: raw.id || raw.noteId || raw.note_id || raw._id || '',
            title: raw.title || raw.subject || '',
            content: raw.content || raw.text || raw.body || raw.html || raw.richText ||
                raw.rich_text || raw.result || raw.answer || raw.output || raw.summary ||
                raw.aiContent || raw.ai_content || raw.description || '',
            rawTranscript: raw.transcript ||
                raw.rawText ||
                raw.raw_text ||
                raw.voiceText ||
                raw.voice_text ||
                raw.asr ||
                raw.asrText ||
                raw.asr_text ||
                raw.originalText ||
                raw.original_text ||
                raw.speechText ||
                raw.speech_text ||
                raw.rawContent ||
                raw.raw_content ||
                null,
            createdAt: raw.createdAt ||
                raw.created_at ||
                raw.createTime ||
                raw.create_time ||
                raw.createdTime ||
                raw.created ||
                raw.ctime ||
                '',
            updatedAt: raw.updatedAt ||
                raw.updated_at ||
                raw.updateTime ||
                raw.update_time ||
                raw.modifiedAt ||
                raw.modified ||
                raw.mtime ||
                '',
            tags: raw.tags || raw.labels || raw.categories || [],
            noteType: raw.note_type || raw.noteType || raw.entry_type || null,
            type: raw.type || raw.note_type || raw.noteType || 'text',
            audioUrl: raw.audioUrl || raw.audio_url || raw.voiceUrl || raw.voice_url || null,
            images: raw.images || raw.imgs || raw.pictures || raw.attachments || [],
        };
    }
    const PRIORITY_KEYS = [
        'notes', 'list', 'data', 'items', 'results', 'records', 'c',
        'noteList', 'note_list', 'entries', 'rows', 'content', 'timeline',
        'feeds', 'posts',
    ];
    function findNotesArray(obj, depth = 0) {
        if (depth > 10 || !obj)
            return null;
        if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
            const f = obj[0];
            if ((f.id || f.noteId || f.note_id || f._id) &&
                (f.content || f.title || f.name || f.text || f.body || f.subject || f.html || f.richText)) {
                return obj;
            }
            if (obj.length >= 5 &&
                (f.id || f.noteId || f.note_id || f._id)) {
                return obj;
            }
        }
        if (typeof obj === 'object' && !Array.isArray(obj)) {
            const allKeys = Object.keys(obj);
            const sortedKeys = [];
            PRIORITY_KEYS.forEach(pk => {
                if (allKeys.indexOf(pk) !== -1)
                    sortedKeys.push(pk);
            });
            allKeys.forEach(k => {
                if (sortedKeys.indexOf(k) === -1)
                    sortedKeys.push(k);
            });
            for (let i = 0; i < sortedKeys.length; i++) {
                const key = sortedKeys[i];
                if (!obj.hasOwnProperty(key))
                    continue;
                const r = findNotesArray(obj[key], depth + 1);
                if (r)
                    return r;
            }
        }
        return null;
    }

    // XHR & Fetch hooks — intercept biji.com API responses in page context
    // Capture originals BEFORE hooking — exported for transcript-fetcher
    const origFetch = window.fetch;
    const OrigXHR = window.XMLHttpRequest;
    function isBijiDomain(url) {
        return url.indexOf('biji.com') !== -1 || url.indexOf('luojilab.com') !== -1;
    }
    function processResponse(url, text) {
        if (url.includes('/api') || url.includes('/v1') || url.includes('/v2')) {
            postToExtension('discovery', { url, preview: text.substring(0, 800) });
        }
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            return;
        }
        const notes = findNotesArray(data);
        if (notes && notes.length > 0) {
            const first = notes[0];
            const fieldInfo = {};
            Object.keys(first).forEach(k => {
                const v = first[k];
                const t = Array.isArray(v) ? 'Array(' + v.length + ')' : typeof v;
                let preview = '';
                if (typeof v === 'string')
                    preview = v.substring(0, 120);
                else if (v !== null && v !== undefined)
                    preview = String(v).substring(0, 120);
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
    function HookedXHR() {
        const xhr = new OrigXHR();
        let _url = '';
        let _method = 'GET';
        let _headers = {};
        const origOpen = xhr.open.bind(xhr);
        xhr.open = function (method, url) {
            _url = url;
            _method = (method || 'GET').toUpperCase();
            _headers = {};
            return origOpen.apply(this, arguments);
        };
        const origSetRequestHeader = xhr.setRequestHeader.bind(xhr);
        xhr.setRequestHeader = function (name, value) {
            _headers[name] = value;
            return origSetRequestHeader.apply(this, arguments);
        };
        const origSend = xhr.send.bind(xhr);
        xhr.send = function (body) {
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
            return origSend.apply(this, arguments);
        };
        return xhr;
    }
    HookedXHR.prototype = OrigXHR.prototype;
    HookedXHR.DONE = 4;
    HookedXHR.HEADERS_RECEIVED = 2;
    HookedXHR.LOADING = 3;
    HookedXHR.OPENED = 1;
    HookedXHR.UNSENT = 0;
    window.XMLHttpRequest = HookedXHR;
    // --- Hook fetch ---
    window.fetch = function (input, init) {
        const url = typeof input === 'string'
            ? input
            : input instanceof Request ? input.url : String(input);
        let capturedHeaders = {};
        if (url.indexOf('get-notes.luojilab.com') !== -1) {
            if (init && init.headers) {
                if (init.headers instanceof Headers) {
                    init.headers.forEach((v, k) => { capturedHeaders[k] = v; });
                }
                else if (typeof init.headers === 'object') {
                    Object.keys(init.headers).forEach(k => {
                        capturedHeaders[k] = init.headers[k];
                    });
                }
            }
            if (input instanceof Request) {
                input.headers.forEach((v, k) => {
                    if (!capturedHeaders[k])
                        capturedHeaders[k] = v;
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
                    .catch(() => { });
            }
        })
            .catch(() => { });
        return promise;
    };

    // Vue Store scanner — runs in PAGE context where __vue__ is accessible
    function logStateStructure(obj, depth, maxDepth) {
        if (depth > maxDepth || !obj || typeof obj !== 'object')
            return;
        const indent = '  '.repeat(depth);
        Object.keys(obj).forEach(key => {
            const val = obj[key];
            if (Array.isArray(val)) {
                log(indent + key + ': Array(' + val.length + ')');
                if (val.length > 0 && val[0] && typeof val[0] === 'object') {
                    log(indent + '  [0] keys:', Object.keys(val[0]));
                }
            }
            else if (typeof val === 'object' && val !== null) {
                log(indent + key + ': Object {' + Object.keys(val).join(', ') + '}');
                logStateStructure(val, depth + 1, maxDepth);
            }
            else {
                log(indent + key + ': ' + typeof val);
            }
        });
    }
    function scanVueStore() {
        let results = [];
        try {
            log('Starting Vue Store scan (page context)...');
            // Check for SSR hydration state first
            if (window.__INITIAL_STATE__) {
                log('Found window.__INITIAL_STATE__:', typeof window.__INITIAL_STATE__);
                const ssrArr = findNotesArray(window.__INITIAL_STATE__);
                if (ssrArr) {
                    log('Found notes in __INITIAL_STATE__:', ssrArr.length);
                    return ssrArr.map(normalizeNote);
                }
            }
            // Try multiple app element selectors
            const selectors = ['#app', '[data-v-app]', '#__nuxt', '#root', '[id*="app"]'];
            let appEl = null;
            for (let i = 0; i < selectors.length; i++) {
                appEl = document.querySelector(selectors[i]);
                if (appEl) {
                    log('Found app element via:', selectors[i]);
                    break;
                }
            }
            if (!appEl) {
                log('No app element found. Tried:', selectors.join(', '));
                return results;
            }
            let state = null;
            // Vue 2
            if (appEl.__vue__ && appEl.__vue__.$store) {
                log('Detected Vue 2 with Vuex store');
                state = appEl.__vue__.$store.state;
                log('Vue 2 state keys:', Object.keys(state));
            }
            // Vue 3 + Vuex/Pinia
            if (!state && appEl.__vue_app__) {
                log('Detected Vue 3 app');
                const gp = appEl.__vue_app__.config.globalProperties;
                if (gp.$store) {
                    log('Found Vue 3 Vuex $store');
                    state = gp.$store.state;
                    log('Vue 3 Vuex state keys:', Object.keys(state));
                }
                if (!state && gp.$pinia) {
                    log('Found Vue 3 Pinia store');
                    state = gp.$pinia.state.value;
                    log('Pinia state keys:', Object.keys(state));
                    Object.keys(state).forEach(storeName => {
                        if (state[storeName] && typeof state[storeName] === 'object') {
                            log('  Pinia store "' + storeName + '" keys:', Object.keys(state[storeName]));
                        }
                    });
                }
            }
            // Vue 2 fallback: root component data
            if (!state && appEl.__vue__) {
                log('Trying Vue 2 component tree walk...');
                const vm = appEl.__vue__;
                if (vm.$data && Object.keys(vm.$data).length > 0) {
                    log('Found root $data keys:', Object.keys(vm.$data));
                    const dataArr = findNotesArray(vm.$data);
                    if (dataArr) {
                        log('Found notes in root $data:', dataArr.length);
                        return dataArr.map(normalizeNote);
                    }
                }
            }
            if (!state) {
                log('No Vue store state found');
                if (appEl) {
                    const props = [];
                    if (appEl.__vue__)
                        props.push('__vue__');
                    if (appEl.__vue_app__)
                        props.push('__vue_app__');
                    if (appEl._vnode)
                        props.push('_vnode');
                    if (appEl.__vueParentComponent)
                        props.push('__vueParentComponent');
                    log('App element has properties:', props.length > 0 ? props.join(', ') : 'none of the expected Vue properties');
                }
                return results;
            }
            // Search state for notes array
            log('Searching state tree for notes array (depth limit: 10)...');
            const arr = findNotesArray(state);
            if (arr) {
                log('Found notes array with', arr.length, 'items');
                if (arr[0]) {
                    log('First item keys:', Object.keys(arr[0]));
                }
                results = arr.map(normalizeNote);
            }
            else {
                log('No notes array found in state tree. Structure:');
                logStateStructure(state, 0, 3);
            }
        }
        catch (err) {
            console.error('[Biji Ext]', 'Vue store scan error:', err);
        }
        return results;
    }
    // Auto-scan with progressive retry: 1s → 2s → 3s → 5s → 8s
    function autoScanVueStore() {
        const delays = [1000, 2000, 3000, 5000, 8000];
        let attempt = 0;
        function tryOnce() {
            if (attempt >= delays.length) {
                log('Auto-scan exhausted all', delays.length, 'attempts. Notes not found in Vue Store.');
                log('Try manually scanning via the popup button, or browse notes to trigger API capture.');
                return;
            }
            const currentAttempt = attempt + 1;
            log('Auto-scan attempt', currentAttempt, '/', delays.length);
            const notes = scanVueStore();
            if (notes.length > 0) {
                log('Auto-scan success! Found', notes.length, 'notes on attempt', currentAttempt);
                postToExtension('notes', { url: 'vue-store-scan', notes });
                return;
            }
            attempt++;
            if (attempt < delays.length) {
                log('No notes found yet. Retrying in', delays[attempt] / 1000, 'seconds...');
                setTimeout(tryOnce, delays[attempt]);
            }
            else {
                log('Auto-scan exhausted all attempts. Notes not found in Vue Store.');
            }
        }
        setTimeout(tryOnce, delays[0]);
    }

    // Fetch raw transcript from /note/{id}/web page
    function fetchRawTranscript(noteId) {
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
            .then((html) => {
            if (!html)
                return null;
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
            function findText(obj, depth) {
                if (depth > 6 || !obj || typeof obj !== 'object')
                    return null;
                for (let i = 0; i < candidates.length; i++) {
                    if (obj[candidates[i]] && typeof obj[candidates[i]] === 'string' &&
                        obj[candidates[i]].length > 50) {
                        return obj[candidates[i]];
                    }
                }
                const keys = Object.keys(obj);
                for (let j = 0; j < keys.length; j++) {
                    const r = findText(obj[keys[j]], depth + 1);
                    if (r)
                        return r;
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
                    }
                    catch (e) {
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
                            const texts = [];
                            let hasTimestamp = false;
                            paragraphs.forEach(p => {
                                const t = p.textContent.trim();
                                if (t) {
                                    texts.push(t);
                                    if (/^\[?\d{2}:\d{2}:\d{2}\]?/.test(t))
                                        hasTimestamp = true;
                                }
                            });
                            if (hasTimestamp && texts.length > 3) {
                                const result = texts.join('\n\n');
                                log('Found transcript via selector "' + selectors[i] + '", paragraphs:', texts.length, 'length:', result.length);
                                return result;
                            }
                        }
                        const fullText = el.textContent.trim();
                        if (fullText.length > 100) {
                            log('Found content via selector "' + selectors[i] + '", length:', fullText.length);
                            return fullText;
                        }
                    }
                }
                // Try 3: find any <p> tags with timestamp pattern anywhere
                const allP = doc.querySelectorAll('p');
                const timestampTexts = [];
                allP.forEach(p => {
                    const t = p.textContent.trim();
                    if (t && /^\[?\d{2}:\d{2}:\d{2}\]?/.test(t)) {
                        timestampTexts.push(t);
                    }
                });
                if (timestampTexts.length > 3) {
                    const result = timestampTexts.join('\n\n');
                    log('Found transcript via timestamp <p> scan, count:', timestampTexts.length, 'length:', result.length);
                    return result;
                }
                log('No transcript found in /web page DOM. Body length:', doc.body ? doc.body.textContent.length : 0);
            }
            catch (e) {
                console.warn('[Biji Ext] Failed to parse /web page HTML:', e);
            }
            return null;
        })
            .catch(e => {
            console.warn('[Biji Ext] Failed to fetch /note/' + noteId + '/web:', e);
            return null;
        });
    }

    // inject.js entry — page context: hooks + Vue scanner + transcript fetcher
    // Listen for transcript fetch requests from content.js
    window.addEventListener('biji-ext-fetch-transcript', ((e) => {
        try {
            const data = JSON.parse(e.detail);
            fetchRawTranscript(data.noteId).then(transcript => {
                window.dispatchEvent(new CustomEvent('biji-ext-transcript-result', {
                    detail: JSON.stringify({ noteId: data.noteId, transcript }),
                }));
            });
        }
        catch (err) {
            console.error('[Biji Ext] Transcript fetch event error:', err);
        }
    }));
    // Listen for manual scan requests from content.js
    window.addEventListener('biji-ext-scan-request', () => {
        log('Manual scan requested from popup');
        const notes = scanVueStore();
        window.dispatchEvent(new CustomEvent('biji-ext-scan-result', {
            detail: JSON.stringify({ notes }),
        }));
    });
    // Start auto-scan on biji.com
    if (location.hostname.indexOf('biji.com') !== -1) {
        log('Inject script loaded on biji.com, starting auto-scan...');
        autoScanVueStore();
    }
    console.log(PREFIX, 'Network interceptors + Vue scanner installed (page context)');

})();
