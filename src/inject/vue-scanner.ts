// Vue Store scanner — runs in PAGE context where __vue__ is accessible

import { normalizeNote, findNotesArray } from '../core/normalize-note';
import { log, postToExtension } from './helpers';

// Augment Window for Vue SSR state
declare global {
  interface Window {
    __INITIAL_STATE__?: any;
  }
}

function logStateStructure(obj: any, depth: number, maxDepth: number): void {
  if (depth > maxDepth || !obj || typeof obj !== 'object') return;
  const indent = '  '.repeat(depth);
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    if (Array.isArray(val)) {
      log(indent + key + ': Array(' + val.length + ')');
      if (val.length > 0 && val[0] && typeof val[0] === 'object') {
        log(indent + '  [0] keys:', Object.keys(val[0]));
      }
    } else if (typeof val === 'object' && val !== null) {
      log(indent + key + ': Object {' + Object.keys(val).join(', ') + '}');
      logStateStructure(val, depth + 1, maxDepth);
    } else {
      log(indent + key + ': ' + typeof val);
    }
  });
}

export function scanVueStore(): ReturnType<typeof normalizeNote>[] {
  let results: ReturnType<typeof normalizeNote>[] = [];
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
    let appEl: any = null;
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

    let state: any = null;

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
        const props: string[] = [];
        if (appEl.__vue__) props.push('__vue__');
        if (appEl.__vue_app__) props.push('__vue_app__');
        if (appEl._vnode) props.push('_vnode');
        if (appEl.__vueParentComponent) props.push('__vueParentComponent');
        log(
          'App element has properties:',
          props.length > 0 ? props.join(', ') : 'none of the expected Vue properties'
        );
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
    } else {
      log('No notes array found in state tree. Structure:');
      logStateStructure(state, 0, 3);
    }
  } catch (err) {
    console.error('[Biji Ext]', 'Vue store scan error:', err);
  }
  return results;
}

// Auto-scan with progressive retry: 1s → 2s → 3s → 5s → 8s
export function autoScanVueStore(): void {
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
    } else {
      log('Auto-scan exhausted all attempts. Notes not found in Vue Store.');
    }
  }

  setTimeout(tryOnce, delays[0]);
}
