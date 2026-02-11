// popup.js — Export panel logic (uses shared.js globals)

(function () {
  'use strict';

  // --- DOM references ---
  var noteCountEl = document.getElementById('noteCount');
  var noteCountBar = document.getElementById('noteCountBar');
  var noteListEl = document.getElementById('noteList');
  var btnExport = document.getElementById('btnExport');
  var btnScan = document.getElementById('btnScan');
  var btnClear = document.getElementById('btnClear');
  var progressEl = document.getElementById('progress');
  var pfillEl = document.getElementById('pfill');
  var ptxtEl = document.getElementById('ptxt');
  var discoveryToggle = document.getElementById('discoveryToggle');
  var btnSettings = document.getElementById('btnSettings');
  var selectAllEl = document.getElementById('selectAll');

  // Export method toggle
  var fmtZipBtn = document.getElementById('fmtZipBtn');
  var fmtVaultBtn = document.getElementById('fmtVaultBtn');

  // File format toggle (multi-select checkboxes)
  var fileFmtChecks = document.querySelectorAll('.file-fmt-check');

  // Vault inline
  var vaultInline = document.getElementById('vaultInline');
  var vaultDot = document.getElementById('vaultDot');
  var vaultLabel = document.getElementById('vaultLabel');
  var openSettings = document.getElementById('openSettings');

  // Incremental export
  var newBadge = document.getElementById('newBadge');
  var btnExportNew = document.getElementById('btnExportNew');
  var btnClearExport = document.getElementById('btnClearExport');
  var btnManageAll = document.getElementById('btnManageAll');

  // Advanced
  var advancedToggle = document.getElementById('advancedToggle');
  var advancedContent = document.getElementById('advancedContent');

  // Fetch
  var btnFetchAll = document.getElementById('btnFetchAll');
  var btnCancelFetch = document.getElementById('btnCancelFetch');
  var fetchStatusEl = document.getElementById('fetchStatus');

  // Tracked state
  var allNotes = [];
  var selectedIds = {};
  var currentSettings = {};
  var activeExportFormat = 'zip'; // 'zip' | 'vault'
  var activeFileFormats = { md: true, pdf: false, docx: false };

  // --- Settings gear button ---
  if (btnSettings) {
    btnSettings.addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
    });
  }

  // --- Open settings link ---
  if (openSettings) {
    openSettings.addEventListener('click', function (e) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  // --- Load settings (local wrapper using shared.js) ---
  function loadSettingsLocal(cb) {
    window.loadSettings(function (settings) {
      currentSettings = settings;
      if (cb) cb(settings);
    });
  }

  // --- Selection helpers ---
  function getSelectedCount() {
    return Object.keys(selectedIds).length;
  }

  function updateSelectionUI() {
    var count = getSelectedCount();
    updateExportButtonText();
    if (allNotes.length > 0) {
      selectAllEl.checked = count === allNotes.length;
      selectAllEl.indeterminate = count > 0 && count < allNotes.length;
    }
  }

  function getActiveFormats() {
    return Object.keys(activeFileFormats).filter(function (f) { return activeFileFormats[f]; });
  }

  function updateExportButtonText() {
    var count = getSelectedCount();
    var methodLabel = activeExportFormat === 'vault' ? 'Vault' : 'ZIP';
    var formats = getActiveFormats();
    var fmtLabel = formats.length > 0 ? formats.map(function (f) { return f.toUpperCase(); }).join('+') : 'MD';
    var suffix = fmtLabel + ' / ' + methodLabel;
    if (count > 0) {
      btnExport.textContent = '\u5BFC\u51FA ' + count + ' \u6761\u7B14\u8BB0 (' + suffix + ')';
    } else {
      btnExport.textContent = '\u5BFC\u51FA\u5168\u90E8\u7B14\u8BB0 (' + suffix + ')';
    }
  }

  function getNotesToExport() {
    var count = getSelectedCount();
    if (count === 0) return allNotes;
    return allNotes.filter(function (n) { return selectedIds[n.id]; });
  }

  // --- File format toggle (MD / PDF / DOCX) — multi-select ---
  function initFileFormatToggle() {
    fileFmtChecks.forEach(function (label) {
      var cb = label.querySelector('input[type="checkbox"]');
      cb.addEventListener('change', function () {
        var fmt = this.getAttribute('data-format');
        activeFileFormats[fmt] = this.checked;

        // Ensure at least one format is selected
        var formats = getActiveFormats();
        if (formats.length === 0) {
          activeFileFormats.md = true;
          var mdCb = document.querySelector('.file-fmt-check input[data-format="md"]');
          if (mdCb) mdCb.checked = true;
        }

        // Update active class on labels
        fileFmtChecks.forEach(function (lbl) {
          var input = lbl.querySelector('input[type="checkbox"]');
          lbl.classList.toggle('active', input.checked);
        });

        // Vault only supports MD — disable if non-MD formats selected
        var hasNonMd = activeFileFormats.pdf || activeFileFormats.docx;
        if (hasNonMd) {
          if (activeExportFormat === 'vault') {
            activeExportFormat = 'zip';
          }
          fmtVaultBtn.disabled = true;
          fmtVaultBtn.style.opacity = '0.4';
        } else {
          fmtVaultBtn.disabled = false;
          fmtVaultBtn.style.opacity = '';
        }
        updateFormatToggleUI();
        updateExportButtonText();
      });
    });
  }

  // --- Export method toggle (ZIP / Vault) ---
  function initFormatToggle() {
    fmtZipBtn.addEventListener('click', function () {
      activeExportFormat = 'zip';
      updateFormatToggleUI();
    });
    fmtVaultBtn.addEventListener('click', function () {
      if (activeFileFormats.pdf || activeFileFormats.docx) return; // blocked for non-MD
      activeExportFormat = 'vault';
      updateFormatToggleUI();
    });
  }

  function updateFormatToggleUI() {
    fmtZipBtn.classList.toggle('active', activeExportFormat === 'zip');
    fmtVaultBtn.classList.toggle('active', activeExportFormat === 'vault');
    if (activeExportFormat === 'vault') {
      vaultInline.classList.add('visible');
      refreshVaultStatus();
    } else {
      vaultInline.classList.remove('visible');
    }
    updateExportButtonText();
  }

  // --- Vault status ---
  function refreshVaultStatus() {
    if (typeof VaultWriter === 'undefined' || !VaultWriter.isSupported()) {
      vaultDot.style.background = '#999';
      vaultLabel.textContent = 'Vault: \u6D4F\u89C8\u5668\u4E0D\u652F\u6301';
      return;
    }

    VaultWriter.restoreHandle().then(function (handle) {
      if (handle) {
        vaultDot.style.background = '#28a745';
        vaultLabel.textContent = 'Vault: ' + VaultWriter.getDirectoryName();
      } else if (VaultWriter.needsPermission()) {
        vaultDot.style.background = '#ffc107';
        vaultLabel.textContent = 'Vault: \u9700\u8981\u6388\u6743 (' + VaultWriter.getDirectoryName() + ')';
      } else {
        vaultDot.style.background = '#dc3545';
        vaultLabel.textContent = 'Vault: \u672A\u914D\u7F6E\uFF0C\u8BF7\u6253\u5F00\u8BBE\u7F6E';
      }
    }).catch(function () {
      vaultDot.style.background = '#dc3545';
      vaultLabel.textContent = 'Vault: \u672A\u914D\u7F6E';
    });
  }

  // --- Advanced toggle ---
  if (advancedToggle) {
    advancedToggle.addEventListener('click', function () {
      advancedToggle.classList.toggle('open');
      advancedContent.classList.toggle('visible');
    });
  }

  // --- Async transcript fetching ---
  function fetchMissingTranscripts(notes, onProgress) {
    var missing = notes.filter(function (n) { return !n.rawTranscript; });
    if (missing.length === 0) return Promise.resolve();

    var done = 0;
    var total = missing.length;

    function fetchNext(index) {
      if (index >= missing.length) return Promise.resolve();
      var note = missing[index];
      done++;
      if (onProgress) onProgress(done, total);

      return new Promise(function (resolve) {
        chrome.runtime.sendMessage({
          type: 'fetchTranscript',
          noteId: note.id,
          noteType: note.noteType || note.type || ''
        }, function (res) {
          if (chrome.runtime.lastError) {
            console.warn('[Biji Ext] Transcript fetch error for', note.id, chrome.runtime.lastError);
            resolve();
            return;
          }
          if (res && res.transcript) {
            note.rawTranscript = res.transcript;
            chrome.runtime.sendMessage({
              type: 'storeVueNotes',
              notes: [{ id: note.id, rawTranscript: res.transcript }]
            });
          }
          resolve();
        });
      }).then(function () {
        return fetchNext(index + 1);
      });
    }

    return fetchNext(0);
  }

  // --- Load data and refresh UI ---
  function refresh() {
    chrome.runtime.sendMessage({ type: 'getNotes' }, function (res) {
      var notes = res && res.notes ? res.notes : {};
      var arr = Object.values(notes);
      window.sortNotesByDate(arr);
      allNotes = arr;
      noteCountEl.textContent = arr.length;

      // Incremental export badge
      var newCount = ExportTracker.getNewCount(arr);
      if (newBadge) {
        if (newCount > 0 && arr.length > 0) {
          newBadge.textContent = '\u65B0\u589E ' + newCount + ' \u6761';
          newBadge.style.display = 'inline';
        } else {
          newBadge.style.display = 'none';
        }
      }
      if (btnExportNew) {
        btnExportNew.style.display = newCount > 0 ? '' : 'none';
      }

      if (arr.length === 0) {
        noteCountBar.style.display = 'none';
        if (btnManageAll) btnManageAll.style.display = 'none';
        noteListEl.innerHTML = '<div style="padding:14px;text-align:center;color:#999">' +
          '\u6682\u65E0\u6355\u83B7\u7684\u7B14\u8BB0<br>\u8BF7\u5148\u6253\u5F00 biji.com \u6D4F\u89C8\u7B14\u8BB0</div>';
      } else {
        noteCountBar.style.display = 'flex';
        if (btnManageAll) btnManageAll.style.display = '';
        var html = arr.slice(0, 50).map(function (n) {
          var t = n.title || ('Note ' + n.id);
          var d = MD.formatDate(n.createdAt);
          var ds = d ? d.substring(0, 10) : '';
          var checked = selectedIds[n.id] ? ' checked' : '';
          var dot = ExportTracker.isExported(n.id) ? '' : '<span class="new-dot">\u25CF</span>';
          return '<div class="note-item">' +
            '<input type="checkbox" data-id="' + escapeHtml(String(n.id)) + '"' + checked + '>' +
            dot +
            '<span class="title">' + escapeHtml(t) +
            '</span><span class="date">' + ds + '</span></div>';
        }).join('');
        if (arr.length > 50) {
          html += '<div style="padding:8px;text-align:center;color:#999;font-size:11px">' +
            '...\u8FD8\u6709 ' + (arr.length - 50) + ' \u6761</div>';
        }
        noteListEl.innerHTML = html;

        noteListEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var id = this.getAttribute('data-id');
            if (this.checked) {
              selectedIds[id] = true;
            } else {
              delete selectedIds[id];
            }
            updateSelectionUI();
          });
        });
      }
      updateSelectionUI();
    });
  }

  // --- Select all / deselect all ---
  if (selectAllEl) {
    selectAllEl.addEventListener('change', function () {
      var checked = this.checked;
      selectedIds = {};
      if (checked) {
        allNotes.forEach(function (n) { selectedIds[n.id] = true; });
      }
      noteListEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.checked = checked;
      });
      updateSelectionUI();
    });
  }

  // --- Export new only ---
  if (btnExportNew) {
    btnExportNew.addEventListener('click', function () {
      var newNotes = ExportTracker.getNewNotes(allNotes);
      if (newNotes.length === 0) { alert('\u6CA1\u6709\u65B0\u589E\u7B14\u8BB0\u3002'); return; }
      selectedIds = {};
      newNotes.forEach(function (n) { selectedIds[n.id] = true; });
      noteListEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.checked = !!selectedIds[cb.getAttribute('data-id')];
      });
      updateSelectionUI();
      if (activeExportFormat === 'vault') {
        exportToVault();
      } else {
        exportToZip();
      }
    });
  }

  // --- Clear export record ---
  if (btnClearExport) {
    btnClearExport.addEventListener('click', function () {
      if (!confirm('\u786E\u5B9A\u8981\u6E05\u9664\u5BFC\u51FA\u8BB0\u5F55\u5417\uFF1F\u6240\u6709\u7B14\u8BB0\u5C06\u663E\u793A\u4E3A\u201C\u672A\u5BFC\u51FA\u201D\u3002')) return;
      ExportTracker.clear(function () { refresh(); });
    });
  }

  // --- Manage all notes ---
  if (btnManageAll) {
    btnManageAll.addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('notes.html') });
    });
  }

  // --- Unified export button ---
  btnExport.addEventListener('click', function () {
    if (activeExportFormat === 'vault') {
      exportToVault();
    } else {
      exportToZip();
    }
  });

  // --- Export to ZIP (multi-format) ---
  function exportToZip() {
    loadSettingsLocal(function (settings) {
      var notes = getNotesToExport();
      if (notes.length === 0) {
        alert('\u6682\u65E0\u7B14\u8BB0\u53EF\u5BFC\u51FA\u3002\u8BF7\u5148\u6253\u5F00 biji.com \u6D4F\u89C8\u7B14\u8BB0\u3002');
        return;
      }

      var formats = getActiveFormats();
      if (formats.length === 0) formats = ['md'];

      progressEl.classList.add('active');
      btnExport.disabled = true;

      var needTranscripts = settings.transcriptMode !== 'none' &&
        notes.some(function (n) { return !n.rawTranscript; });

      var chain = Promise.resolve();
      if (needTranscripts) {
        ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u539F\u59CB\u6587\u5B57\u8BB0\u5F55...';
        chain = fetchMissingTranscripts(notes, function (done, total) {
          ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55 ' + done + '/' + total + '...';
        });
      }

      chain.then(function () {
        var zip = new JSZip();
        var folder = zip.folder('biji-export');
        var used = {};
        var total = notes.length;

        var hasNonMd = formats.indexOf('pdf') !== -1 || formats.indexOf('docx') !== -1;
        if (hasNonMd && total > 20) {
          ptxtEl.textContent = 'PDF/DOCX \u751F\u6210\u8F83\u6162\uFF0C\u8BF7\u8010\u5FC3\u7B49\u5F85...';
        }

        function processNote(index) {
          if (index >= total) return finishZip(zip, notes);
          var note = notes[index];

          function processFormat(fmtIndex) {
            if (fmtIndex >= formats.length) {
              // All formats done for this note — process transcripts
              return processTranscript(note, formats, folder, used, settings).then(function () {
                var pct = Math.round(((index + 1) / total) * 100);
                pfillEl.style.width = pct + '%';
                ptxtEl.textContent = (index + 1) + ' / ' + total + ' \u7B14\u8BB0\u5DF2\u5904\u7406';
                return processNote(index + 1);
              });
            }

            var format = formats[fmtIndex];
            var ext = window.getFileExt(format);
            var fn = window.fullPathWithFormat(note, settings, format);
            fn = window.deduplicateFilename(fn, used, ext);
            used[fn] = true;

            var genPromise;
            if (format === 'md') {
              var mdContent;
              if (settings.transcriptMode === 'merged' && note.rawTranscript) {
                mdContent = MD.convert(note, settings);
                var rawContent = note.rawTranscript;
                if (rawContent.includes('<') && rawContent.includes('>')) {
                  rawContent = MD.htmlToMd(rawContent);
                }
                mdContent += '\n\n---\n\n## \u539F\u59CB\u6587\u5B57\u8BB0\u5F55\n\n' + rawContent;
              } else {
                mdContent = MD.convert(note, settings);
              }
              genPromise = Promise.resolve(mdContent);
            } else if (format === 'pdf') {
              genPromise = ServerExporter.exportNote(note.id, 'pdf');
            } else {
              genPromise = ServerExporter.exportNote(note.id, 'docx');
            }

            return genPromise.then(function (data) {
              folder.file(fn, data);
            }).catch(function (err) {
              console.warn('[Biji Ext] Export error (' + format + ') for', note.id, err);
              // Fallback to MD
              var mdFn = fn.replace(ext, '.md');
              if (!used[mdFn]) {
                folder.file(mdFn, MD.convert(note, settings));
                used[mdFn] = true;
              }
            }).then(function () {
              return processFormat(fmtIndex + 1);
            });
          }

          return processFormat(0);
        }

        function processTranscript(note, formats, folder, used, settings) {
          if (settings.transcriptMode === 'none') return Promise.resolve();
          if (!note.rawTranscript && !note.content) return Promise.resolve();

          var chain = Promise.resolve();

          formats.forEach(function (format) {
            chain = chain.then(function () {
              if (format === 'md') {
                if (settings.transcriptMode === 'separate') {
                  var tFn = window.fullPathWithFormat(note, settings, 'md').replace('.md', '-transcript.md');
                  tFn = window.deduplicateFilename(tFn, used, '.md');
                  used[tFn] = true;
                  folder.file(tFn, MD.convertTranscript(note, settings));
                }
                // merged mode: already appended to main MD content
              } else if (format === 'pdf') {
                // For PDF/DOCX: separate mode → standalone transcript file
                // merged mode → server API already includes transcript in main file
                if (settings.transcriptMode !== 'separate') return;
                var tFn = window.fullPathWithFormat(note, settings, 'pdf').replace('.pdf', '-transcript.pdf');
                tFn = window.deduplicateFilename(tFn, used, '.pdf');
                used[tFn] = true;
                return PDFConverter.generateTranscriptPdf(note, settings).then(function (blob) {
                  folder.file(tFn, blob);
                }).catch(function () {
                  var fallback = tFn.replace('.pdf', '.md');
                  folder.file(fallback, MD.convertTranscript(note, settings));
                });
              } else if (format === 'docx') {
                if (settings.transcriptMode !== 'separate') return;
                var tFn = window.fullPathWithFormat(note, settings, 'docx').replace('.docx', '-transcript.docx');
                tFn = window.deduplicateFilename(tFn, used, '.docx');
                used[tFn] = true;
                return DOCXConverter.generateTranscriptDocx(note, settings).then(function (blob) {
                  folder.file(tFn, blob);
                }).catch(function () {
                  var fallback = tFn.replace('.docx', '.md');
                  folder.file(fallback, MD.convertTranscript(note, settings));
                });
              }
            });
          });

          return chain;
        }

        return processNote(0);
      });
    });
  }

  function finishZip(zip, notes) {
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function (content) {
      var ts = new Date().toISOString().substring(0, 10);
      saveAs(content, 'biji-export-' + ts + '.zip');
      ExportTracker.markExported(notes.map(function (n) { return n.id; }));
      ptxtEl.textContent = '\u5BFC\u51FA\u5B8C\u6210\uFF01\u8BF7\u67E5\u770B\u4E0B\u8F7D\u6587\u4EF6\u5939\u3002';
      btnExport.disabled = false;
      setTimeout(function () { progressEl.classList.remove('active'); refresh(); }, 3000);
    });
  }

  // --- Export to Vault (MD only) ---
  function exportToVault() {
    if (typeof VaultWriter === 'undefined' || !VaultWriter.isReady()) {
      alert('Vault \u672A\u5C31\u7EEA\u3002\u8BF7\u5148\u5728\u8BBE\u7F6E\u9875\u9762\u9009\u62E9 Vault \u6587\u4EF6\u5939\u3002');
      return;
    }

    loadSettingsLocal(function (settings) {
      var notes = getNotesToExport();
      if (notes.length === 0) {
        alert('\u6682\u65E0\u7B14\u8BB0\u53EF\u5BFC\u51FA\u3002\u8BF7\u5148\u6253\u5F00 biji.com \u6D4F\u89C8\u7B14\u8BB0\u3002');
        return;
      }

      var subfolder = settings.vaultSubfolder || 'biji-notes';

      progressEl.classList.add('active');
      btnExport.disabled = true;
      btnExport.textContent = '\u5BFC\u51FA\u4E2D...';

      var needTranscripts = settings.transcriptMode !== 'none' &&
        notes.some(function (n) { return !n.rawTranscript; });

      var chain = Promise.resolve();
      if (needTranscripts) {
        ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u539F\u59CB\u6587\u5B57\u8BB0\u5F55...';
        chain = fetchMissingTranscripts(notes, function (done, total) {
          ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55 ' + done + '/' + total + '...';
        });
      }

      chain.then(function () {
        var converter = {
          filename: function (note) { return window.fullPath(note, settings); },
          convert: function (note) {
            if (settings.transcriptMode === 'merged' && note.rawTranscript) {
              var mainContent = MD.convert(note, settings);
              var rawContent = note.rawTranscript;
              if (rawContent.includes('<') && rawContent.includes('>')) {
                rawContent = MD.htmlToMd(rawContent);
              }
              return mainContent + '\n\n---\n\n## \u539F\u59CB\u6587\u5B57\u8BB0\u5F55\n\n' + rawContent;
            }
            return MD.convert(note, settings);
          }
        };

        VaultWriter.writeAllNotes(notes, subfolder, converter, function (done, total, written, errorCount) {
          var pct = Math.round((done / total) * 100);
          pfillEl.style.width = pct + '%';
          ptxtEl.textContent = done + ' / ' + total + ' \u5DF2\u5904\u7406 (' + written + ' \u5199\u5165, ' + errorCount + ' \u9519\u8BEF)';
        }).then(function (result) {
          if (settings.transcriptMode === 'separate') {
            var notesWithContent = notes.filter(function (n) { return !!n.content; });
            if (notesWithContent.length > 0) {
              var txConverter = {
                filename: function (note) {
                  return window.fullPath(note, settings).replace('.md', '-transcript.md');
                },
                convert: function (note) {
                  return MD.convertTranscript(note, settings);
                }
              };
              return VaultWriter.writeAllNotes(notesWithContent, subfolder, txConverter, function (done, total) {
                ptxtEl.textContent = '\u5199\u5165 transcript ' + done + '/' + total + '...';
              }).then(function (txResult) {
                return {
                  written: result.written + txResult.written,
                  errors: result.errors.concat(txResult.errors)
                };
              });
            }
          }
          return result;
        }).then(function (result) {
          ExportTracker.markExported(notes.map(function (n) { return n.id; }));
          ptxtEl.textContent = '\u5BFC\u51FA\u5B8C\u6210\uFF01' + result.written + ' \u7BC7\u7B14\u8BB0\u5DF2\u5199\u5165 Vault\u3002';
          if (result.errors.length > 0) {
            ptxtEl.textContent += ' (' + result.errors.length + ' \u4E2A\u9519\u8BEF)';
            console.warn('[Biji Ext] Vault write errors:', result.errors);
          }
          btnExport.disabled = false;
          updateExportButtonText();
          setTimeout(function () { progressEl.classList.remove('active'); refresh(); }, 4000);
        }).catch(function (err) {
          ptxtEl.textContent = '\u5BFC\u51FA\u5931\u8D25: ' + err.message;
          btnExport.disabled = false;
          updateExportButtonText();
          setTimeout(function () { progressEl.classList.remove('active'); }, 4000);
        });
      });
    });
  }

  // --- Scan Vue Store ---
  btnScan.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'scanVueStore' }, function (res) {
        if (chrome.runtime.lastError) {
          alert('\u65E0\u6CD5\u8FDE\u63A5\u5230 biji.com \u9875\u9762\u3002\u8BF7\u786E\u4FDD\u5F53\u524D\u6807\u7B7E\u9875\u662F biji.com\u3002');
          return;
        }
        var notes = res && res.notes ? res.notes : [];
        if (notes.length > 0) {
          chrome.runtime.sendMessage({ type: 'storeVueNotes', notes: notes });
          setTimeout(refresh, 500);
        }
        alert('Vue Store \u626B\u63CF\u5B8C\u6210\uFF0C\u53D1\u73B0 ' + notes.length + ' \u6761\u7B14\u8BB0\u3002');
      });
    });
  });

  // --- Clear data ---
  btnClear.addEventListener('click', function () {
    if (!confirm('\u786E\u5B9A\u8981\u6E05\u7A7A\u6240\u6709\u5DF2\u6355\u83B7\u7684\u7B14\u8BB0\u6570\u636E\u5417\uFF1F')) return;
    chrome.runtime.sendMessage({ type: 'clearNotes' }, function () {
      chrome.runtime.sendMessage({ type: 'clearDiscovery' }, function () {
        selectedIds = {};
        refresh();
      });
    });
  });

  // --- Discovery toggle ---
  chrome.storage.local.get('discoveryMode', function (data) {
    discoveryToggle.checked = data.discoveryMode !== false;
  });
  discoveryToggle.addEventListener('change', function () {
    chrome.storage.local.set({ discoveryMode: this.checked });
  });

  // --- Active Fetcher ---
  if (btnFetchAll) {
    btnFetchAll.addEventListener('click', function () {
      chrome.storage.local.get('settings', function (data) {
        var settings = data.settings || {};
        var fetchDelay = settings.fetchDelay || 500;

        btnFetchAll.disabled = true;
        btnCancelFetch.style.display = '';
        fetchStatusEl.style.display = 'block';
        progressEl.classList.add('active');

        chrome.runtime.sendMessage({
          type: 'fetchAll',
          fetchDelay: fetchDelay
        });
      });
    });
  }

  if (btnCancelFetch) {
    btnCancelFetch.addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: 'cancelFetch' });
      fetchStatusEl.textContent = '\u5DF2\u53D6\u6D88';
      btnFetchAll.disabled = false;
      btnCancelFetch.style.display = 'none';
      setTimeout(function () {
        progressEl.classList.remove('active');
        fetchStatusEl.style.display = 'none';
      }, 2000);
    });
  }

  // Listen for messages from background.js
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === 'fetchStatus') {
      var payload = msg.payload || {};
      fetchStatusEl.style.display = 'block';
      fetchStatusEl.textContent = payload.status || '';
      ptxtEl.textContent = payload.status || '';

      if (payload.done) {
        pfillEl.style.width = '100%';
        btnFetchAll.disabled = false;
        btnCancelFetch.style.display = 'none';
        setTimeout(function () {
          progressEl.classList.remove('active');
          fetchStatusEl.style.display = 'none';
        }, 4000);
        refresh();
      }
    } else if (msg.type === 'notesUpdated') {
      noteCountEl.textContent = msg.count;
      btnFetchAll.textContent = '\u83B7\u53D6\u5168\u90E8\u7B14\u8BB0 (' + msg.count + '\u6761)';
    }
  });

  // Init
  loadSettingsLocal(function () {
    initFileFormatToggle();
    initFormatToggle();
    if (currentSettings.exportMode === 'vault') {
      activeExportFormat = 'vault';
    }
    updateFormatToggleUI();
    ExportTracker.load(function () {
      refresh();
    });
  });
})();
