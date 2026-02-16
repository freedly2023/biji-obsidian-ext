// Vault Writer — Direct write to Obsidian vault via File System Access API
// Rewritten from vault-writer.js

const DB_NAME = 'biji-exporter';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'vaultDir';

let directoryHandle: FileSystemDirectoryHandle | null = null;
let _pendingHandle: FileSystemDirectoryHandle | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e: any) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (e: any) => resolve(e.target.result);
    request.onerror = (e: any) => reject(e.target.error);
  });
}

function saveHandleToDB(handle: FileSystemDirectoryHandle): Promise<void> {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = (e: any) => reject(e.target.error);
    });
  });
}

function loadHandleFromDB(): Promise<FileSystemDirectoryHandle | null> {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e: any) => reject(e.target.error);
    });
  });
}

function deleteHandleFromDB(): Promise<void> {
  return openDB().then(db => {
    return new Promise(resolve => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  });
}

export function isSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

export function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  return (window as any).showDirectoryPicker({ mode: 'readwrite' })
    .then((handle: FileSystemDirectoryHandle) => {
      directoryHandle = handle;
      return saveHandleToDB(handle).then(() => handle);
    })
    .catch((e: Error) => {
      if (e.name === 'AbortError') return null;
      throw e;
    });
}

export function restoreHandle(): Promise<FileSystemDirectoryHandle | null> {
  return loadHandleFromDB()
    .then(handle => {
      if (!handle) return null;
      return (handle as any).queryPermission({ mode: 'readwrite' }).then((perm: string) => {
        if (perm === 'granted') {
          directoryHandle = handle;
          return handle;
        }
        _pendingHandle = handle;
        return null;
      });
    })
    .catch((e: Error) => {
      console.warn('[Biji Ext] Could not restore vault handle:', e);
      return null;
    });
}

export function requestPermission(): Promise<boolean> {
  if (!_pendingHandle) return Promise.resolve(false);
  return (_pendingHandle as any).requestPermission({ mode: 'readwrite' })
    .then((perm: string) => {
      if (perm === 'granted') {
        directoryHandle = _pendingHandle;
        _pendingHandle = null;
        return true;
      }
      return false;
    })
    .catch(() => false);
}

export function writeFile(dirHandle: FileSystemDirectoryHandle, filename: string, content: string): Promise<void> {
  return (dirHandle as any).getFileHandle(filename, { create: true })
    .then((fileHandle: any) => fileHandle.createWritable())
    .then((writable: any) => writable.write(content).then(() => writable.close()));
}

export function writeAllNotes(
  notes: any[],
  subfolder: string,
  markdownConverter: { filename: (note: any) => string; convert: (note: any) => string },
  onProgress?: (done: number, total: number, written?: number, errors?: number) => void,
): Promise<{ written: number; errors: any[] }> {
  if (!directoryHandle) {
    return Promise.reject(new Error('No vault directory selected'));
  }

  let targetDirPromise: Promise<FileSystemDirectoryHandle>;
  if (subfolder) {
    targetDirPromise = (directoryHandle as any).getDirectoryHandle(subfolder, { create: true });
  } else {
    targetDirPromise = Promise.resolve(directoryHandle);
  }

  return targetDirPromise.then(targetDir => {
    const used: Record<string, boolean> = {};
    const total = notes.length;
    let written = 0;
    const errors: any[] = [];

    let chain = Promise.resolve();
    for (let i = 0; i < total; i++) {
      ((index: number) => {
        chain = chain.then(() => {
          const note = notes[index];
          let fn = markdownConverter.filename(note);

          if (used[fn]) {
            const base = fn.replace('.md', '');
            let c = 2;
            while (used[base + '-' + c + '.md']) c++;
            fn = base + '-' + c + '.md';
          }
          used[fn] = true;

          const md = markdownConverter.convert(note);
          return writeFile(targetDir, fn, md)
            .then(() => {
              written++;
              if (onProgress) onProgress(index + 1, total, written, errors.length);
            })
            .catch(e => {
              errors.push({ filename: fn, error: e.message });
              if (onProgress) onProgress(index + 1, total, written, errors.length);
            });
        });
      })(i);
    }

    return chain.then(() => ({ written, errors }));
  });
}

export function clearHandle(): Promise<void> {
  directoryHandle = null;
  _pendingHandle = null;
  return deleteHandleFromDB();
}

export function getDirectoryName(): string | null {
  if (directoryHandle) return directoryHandle.name;
  if (_pendingHandle) return _pendingHandle.name + ' (needs permission)';
  return null;
}

export function isReady(): boolean {
  return !!directoryHandle;
}

export function needsPermission(): boolean {
  return !!_pendingHandle && !directoryHandle;
}

export const VaultWriterModule = {
  isSupported, pickDirectory, restoreHandle, requestPermission,
  writeFile, writeAllNotes, clearHandle, getDirectoryName, isReady, needsPermission,
};
