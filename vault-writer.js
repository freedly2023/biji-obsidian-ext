// vault-writer.js — Direct write to Obsidian vault via File System Access API

var VaultWriter = (function () {
  'use strict';

  var directoryHandle = null;
  var _pendingHandle = null;
  var DB_NAME = 'biji-exporter';
  var STORE_NAME = 'handles';
  var HANDLE_KEY = 'vaultDir';

  // --- IndexedDB helpers ---

  function openDB() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function (e) {
        e.target.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function (e) {
        resolve(e.target.result);
      };
      request.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  function saveHandleToDB(handle) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function (e) {
          reject(e.target.error);
        };
      });
    });
  }

  function loadHandleFromDB() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
        req.onsuccess = function () {
          resolve(req.result || null);
        };
        req.onerror = function (e) {
          reject(e.target.error);
        };
      });
    });
  }

  function deleteHandleFromDB() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          resolve();
        }; // ignore delete errors
      });
    });
  }

  // --- Public API ---

  function isSupported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  function pickDirectory() {
    return window
      .showDirectoryPicker({ mode: 'readwrite' })
      .then(function (handle) {
        directoryHandle = handle;
        return saveHandleToDB(handle).then(function () {
          return handle;
        });
      })
      .catch(function (e) {
        if (e.name === 'AbortError') return null;
        throw e;
      });
  }

  function restoreHandle() {
    return loadHandleFromDB()
      .then(function (handle) {
        if (!handle) return null;
        return handle.queryPermission({ mode: 'readwrite' }).then(function (perm) {
          if (perm === 'granted') {
            directoryHandle = handle;
            return handle;
          }
          _pendingHandle = handle;
          return null;
        });
      })
      .catch(function (e) {
        console.warn('[Biji Ext] Could not restore vault handle:', e);
        return null;
      });
  }

  function requestPermission() {
    if (!_pendingHandle) return Promise.resolve(false);
    return _pendingHandle
      .requestPermission({ mode: 'readwrite' })
      .then(function (perm) {
        if (perm === 'granted') {
          directoryHandle = _pendingHandle;
          _pendingHandle = null;
          return true;
        }
        return false;
      })
      .catch(function () {
        return false;
      });
  }

  function writeFile(dirHandle, filename, content) {
    return dirHandle
      .getFileHandle(filename, { create: true })
      .then(function (fileHandle) {
        return fileHandle.createWritable();
      })
      .then(function (writable) {
        return writable.write(content).then(function () {
          return writable.close();
        });
      });
  }

  function writeAllNotes(notes, subfolder, markdownConverter, onProgress) {
    if (!directoryHandle) {
      return Promise.reject(new Error('No vault directory selected'));
    }

    var targetDirPromise;
    if (subfolder) {
      targetDirPromise = directoryHandle.getDirectoryHandle(subfolder, { create: true });
    } else {
      targetDirPromise = Promise.resolve(directoryHandle);
    }

    return targetDirPromise.then(function (targetDir) {
      var used = {};
      var total = notes.length;
      var written = 0;
      var errors = [];

      // Process notes sequentially
      var chain = Promise.resolve();
      for (var i = 0; i < total; i++) {
        (function (index) {
          chain = chain.then(function () {
            var note = notes[index];
            var fn = markdownConverter.filename(note);

            // Deduplicate filenames
            if (used[fn]) {
              var base = fn.replace('.md', '');
              var c = 2;
              while (used[base + '-' + c + '.md']) c++;
              fn = base + '-' + c + '.md';
            }
            used[fn] = true;

            var md = markdownConverter.convert(note);
            return writeFile(targetDir, fn, md)
              .then(function () {
                written++;
                if (onProgress) onProgress(index + 1, total, written, errors.length);
              })
              .catch(function (e) {
                errors.push({ filename: fn, error: e.message });
                if (onProgress) onProgress(index + 1, total, written, errors.length);
              });
          });
        })(i);
      }

      return chain.then(function () {
        return { written: written, errors: errors };
      });
    });
  }

  function clearHandle() {
    directoryHandle = null;
    _pendingHandle = null;
    return deleteHandleFromDB();
  }

  function getDirectoryName() {
    if (directoryHandle) return directoryHandle.name;
    if (_pendingHandle) return _pendingHandle.name + ' (needs permission)';
    return null;
  }

  function isReady() {
    return !!directoryHandle;
  }

  function needsPermission() {
    return !!_pendingHandle && !directoryHandle;
  }

  return {
    isSupported: isSupported,
    pickDirectory: pickDirectory,
    restoreHandle: restoreHandle,
    requestPermission: requestPermission,
    writeFile: writeFile,
    writeAllNotes: writeAllNotes,
    clearHandle: clearHandle,
    getDirectoryName: getDirectoryName,
    isReady: isReady,
    needsPermission: needsPermission,
  };
})();
