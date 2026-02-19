// Runtime library loader — lazy-load heavy export libs only when needed

type LibKey = 'pdf' | 'docx';

const loadingPromises: Partial<Record<LibKey, Promise<void>>> = {};

function injectScriptOnce(
  key: LibKey,
  filePath: string,
  isReady: () => boolean,
): Promise<void> {
  if (isReady()) return Promise.resolve();
  if (loadingPromises[key]) return loadingPromises[key] as Promise<void>;

  loadingPromises[key] = new Promise<void>((resolve, reject) => {
    const dataAttr = 'data-biji-lib';
    const selector = 'script[' + dataAttr + '="' + key + '"]';
    const existing = document.querySelector(selector) as HTMLScriptElement | null;

    const finish = () => {
      if (isReady()) resolve();
      else reject(new Error('Library loaded but global not available: ' + key));
    };

    if (existing) {
      if (existing.getAttribute('data-loaded') === '1') {
        finish();
        return;
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load library: ' + key)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(filePath);
    script.async = true;
    script.setAttribute(dataAttr, key);
    script.addEventListener('load', () => {
      script.setAttribute('data-loaded', '1');
      finish();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load library: ' + key)), { once: true });
    (document.head || document.documentElement).appendChild(script);
  }).catch((err: Error) => {
    delete loadingPromises[key];
    throw err;
  });

  return loadingPromises[key] as Promise<void>;
}

export function ensurePdfRuntimeLoaded(): Promise<void> {
  return injectScriptOnce('pdf', 'lib/html2pdf.bundle.min.js', function () {
    return typeof html2pdf !== 'undefined';
  });
}

export function ensureDocxRuntimeLoaded(): Promise<void> {
  return injectScriptOnce('docx', 'lib/docx.min.js', function () {
    return typeof docx !== 'undefined';
  });
}

export function ensureExportLibraries(formats: string[]): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (formats.indexOf('pdf') !== -1) tasks.push(ensurePdfRuntimeLoaded());
  if (formats.indexOf('docx') !== -1) tasks.push(ensureDocxRuntimeLoaded());
  if (tasks.length === 0) return Promise.resolve();
  return Promise.all(tasks).then(() => {});
}

