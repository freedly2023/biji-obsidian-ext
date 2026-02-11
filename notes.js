// notes.js — Full-page note management (uses shared.js globals)

(function () {
  'use strict';

  // --- DOM references ---
  var searchInput = document.getElementById('searchInput');
  var filterType = document.getElementById('filterType');
  var dateFrom = document.getElementById('dateFrom');
  var dateTo = document.getElementById('dateTo');
  var filterExport = document.getElementById('filterExport');
  var filterSort = document.getElementById('filterSort');
  var selectAllEl = document.getElementById('selectAll');
  var selCountEl = document.getElementById('selCount');
  var totalCountEl = document.getElementById('totalCount');
  var btnExport = document.getElementById('btnExport');
  var progressEl = document.getElementById('progress');
  var pfillEl = document.getElementById('pfill');
  var ptxtEl = document.getElementById('ptxt');
  var noteTableBody = document.getElementById('noteTableBody');
  var emptyState = document.getElementById('emptyState');
  var noteTable = document.getElementById('noteTable');
  var btnPrev = document.getElementById('btnPrev');
  var btnNext = document.getElementById('btnNext');
  var pageInfo = document.getElementById('pageInfo');
  var methodZip = document.getElementById('methodZip');
  var methodVault = document.getElementById('methodVault');
  var fileFmtChecks = document.querySelectorAll('.fmt-check-sm');

  // --- State ---
  var allNotes = [];
  var filteredNotes = [];
  var selectedIds = {};
  var currentSettings = {};
  var activeFileFormats = { md: true, pdf: false, docx: false };
  var activeMethod = 'zip';
  var currentPage = 1;
  var pageSize = 50;

  // --- Filter Engine ---
  var FilterEngine = {
    searchText: '',
    noteType: 'all',
    dateFrom: null,
    dateTo: null,
    exportStatus: 'all',
    sortBy: 'date_desc',

    apply: function (notes) {
      var self = this;
      var result = notes.slice();

      // Text search
      if (self.searchText) {
        var q = self.searchText.toLowerCase();
        result = result.filter(function (n) {
          var title = (n.title || '').toLowerCase();
          var tags = (n.tags || []).map(function (t) {
            return typeof t === 'string' ? t : (t.name || t.label || '');
          }).join(' ').toLowerCase();
          return title.indexOf(q) !== -1 || tags.indexOf(q) !== -1;
        });
      }

      // Type filter
      if (self.noteType !== 'all') {
        result = result.filter(function (n) {
          return (n.type || 'text') === self.noteType;
        });
      }

      // Date filter
      if (self.dateFrom) {
        var fromTs = new Date(self.dateFrom).getTime();
        result = result.filter(function (n) {
          var ts = n.createdAt ? new Date(typeof n.createdAt === 'number' ? n.createdAt * 1000 : n.createdAt).getTime() : 0;
          return ts >= fromTs;
        });
      }
      if (self.dateTo) {
        var toTs = new Date(self.dateTo).getTime() + 86400000; // end of day
        result = result.filter(function (n) {
          var ts = n.createdAt ? new Date(typeof n.createdAt === 'number' ? n.createdAt * 1000 : n.createdAt).getTime() : 0;
          return ts < toTs;
        });
      }

      // Export status
      if (self.exportStatus === 'exported') {
        result = result.filter(function (n) { return ExportTracker.isExported(n.id); });
      } else if (self.exportStatus === 'unexported') {
        result = result.filter(function (n) { return !ExportTracker.isExported(n.id); });
      }

      // Sort
      if (self.sortBy === 'date_desc') {
        result.sort(function (a, b) {
          var tA = a.createdAt ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime() : 0;
          var tB = b.createdAt ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime() : 0;
          return tB - tA;
        });
      } else if (self.sortBy === 'date_asc') {
        result.sort(function (a, b) {
          var tA = a.createdAt ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime() : 0;
          var tB = b.createdAt ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime() : 0;
          return tA - tB;
        });
      } else if (self.sortBy === 'title') {
        result.sort(function (a, b) {
          return (a.title || '').localeCompare(b.title || '');
        });
      } else if (self.sortBy === 'type') {
        result.sort(function (a, b) {
          return (a.type || 'text').localeCompare(b.type || 'text');
        });
      }

      return result;
    }
  };

  // --- Render ---
  function renderPage() {
    var totalPages = Math.max(1, Math.ceil(filteredNotes.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var start = (currentPage - 1) * pageSize;
    var pageNotes = filteredNotes.slice(start, start + pageSize);

    totalCountEl.textContent = filteredNotes.length;

    if (filteredNotes.length === 0) {
      noteTable.style.display = 'none';
      emptyState.style.display = '';
    } else {
      noteTable.style.display = '';
      emptyState.style.display = 'none';
    }

    var html = pageNotes.map(function (n) {
      var t = n.title || ('Note ' + n.id);
      var d = MD.formatDate(n.createdAt);
      var ds = d ? d.substring(0, 10) : '';
      var checked = selectedIds[n.id] ? ' checked' : '';
      var type = n.type || 'text';
      var typeCls = type === 'voice' ? 'voice' : (type === 'link' ? 'link' : (type === 'text' ? 'text' : 'other'));
      var typeLabel = type === 'voice' ? '语音' : (type === 'link' ? '链接' : (type === 'text' ? '文字' : type));
      var exported = ExportTracker.isExported(n.id);
      var statusHtml = exported
        ? '<span class="export-status exported">\u2713</span>'
        : '<span class="export-status new">\u25CF</span>';
      var tags = MD.formatTags(n.tags);
      var tagsHtml = tags.length > 0
        ? '<div class="tag-list">' + tags.slice(0, 3).map(function (tag) {
            return '<span class="tag-chip">' + escapeHtml(tag) + '</span>';
          }).join('') + (tags.length > 3 ? '<span class="tag-chip">+' + (tags.length - 3) + '</span>' : '') + '</div>'
        : '';

      return '<tr>' +
        '<td><input type="checkbox" data-id="' + escapeHtml(String(n.id)) + '"' + checked + '></td>' +
        '<td>' + statusHtml + '</td>' +
        '<td class="note-title-cell">' + escapeHtml(t) + '</td>' +
        '<td><span class="type-badge ' + typeCls + '">' + typeLabel + '</span></td>' +
        '<td style="font-size:12px;color:#888">' + ds + '</td>' +
        '<td>' + tagsHtml + '</td>' +
        '</tr>';
    }).join('');

    noteTableBody.innerHTML = html;

    // Bind checkboxes
    noteTableBody.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
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

    // Pagination
    btnPrev.disabled = currentPage <= 1;
    btnNext.disabled = currentPage >= totalPages;
    pageInfo.textContent = '\u7B2C ' + currentPage + '/' + totalPages + ' \u9875';

    updateSelectionUI();
  }

  function updateSelectionUI() {
    var count = Object.keys(selectedIds).length;
    selCountEl.textContent = count;

    // Select all checkbox state
    if (filteredNotes.length > 0) {
      var allSelected = filteredNotes.every(function (n) { return selectedIds[n.id]; });
      var someSelected = filteredNotes.some(function (n) { return selectedIds[n.id]; });
      selectAllEl.checked = allSelected;
      selectAllEl.indeterminate = someSelected && !allSelected;
    } else {
      selectAllEl.checked = false;
      selectAllEl.indeterminate = false;
    }

    // Export button text
    var formats = ExportEngine.getActiveFormats(activeFileFormats);
    var fmtLabel = formats.length > 0 ? formats.map(function (f) { return f.toUpperCase(); }).join('+') : 'MD';
    if (count > 0) {
      btnExport.textContent = '\u5BFC\u51FA\u9009\u4E2D ' + count + ' \u6761 (' + fmtLabel + ')';
    } else {
      btnExport.textContent = '\u5BFC\u51FA\u7B5B\u9009\u7ED3\u679C (' + fmtLabel + ')';
    }
  }

  function applyFilters() {
    FilterEngine.searchText = searchInput.value.trim();
    FilterEngine.noteType = filterType.value;
    FilterEngine.dateFrom = dateFrom.value || null;
    FilterEngine.dateTo = dateTo.value || null;
    FilterEngine.exportStatus = filterExport.value;
    FilterEngine.sortBy = filterSort.value;
    filteredNotes = FilterEngine.apply(allNotes);
    currentPage = 1;
    renderPage();
  }

  // --- Event: Filters ---
  var filterDebounce = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(applyFilters, 200);
  });
  filterType.addEventListener('change', applyFilters);
  dateFrom.addEventListener('change', applyFilters);
  dateTo.addEventListener('change', applyFilters);
  filterExport.addEventListener('change', applyFilters);
  filterSort.addEventListener('change', applyFilters);

  // --- Event: Select all ---
  selectAllEl.addEventListener('change', function () {
    var checked = this.checked;
    if (checked) {
      filteredNotes.forEach(function (n) { selectedIds[n.id] = true; });
    } else {
      filteredNotes.forEach(function (n) { delete selectedIds[n.id]; });
    }
    // Update checkboxes on current page
    noteTableBody.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.checked = checked;
    });
    updateSelectionUI();
  });

  // --- Event: Pagination ---
  btnPrev.addEventListener('click', function () {
    if (currentPage > 1) { currentPage--; renderPage(); }
  });
  btnNext.addEventListener('click', function () {
    var totalPages = Math.ceil(filteredNotes.length / pageSize);
    if (currentPage < totalPages) { currentPage++; renderPage(); }
  });

  // --- Event: File format (multi-select) ---
  fileFmtChecks.forEach(function (label) {
    var cb = label.querySelector('input[type="checkbox"]');
    cb.addEventListener('change', function () {
      var fmt = this.getAttribute('data-format');
      activeFileFormats[fmt] = this.checked;

      // Ensure at least one format is selected
      var formats = ExportEngine.getActiveFormats(activeFileFormats);
      if (formats.length === 0) {
        activeFileFormats.md = true;
        var mdCb = document.querySelector('.fmt-check-sm input[data-format="md"]');
        if (mdCb) mdCb.checked = true;
      }

      // Update active class on labels
      fileFmtChecks.forEach(function (lbl) {
        var input = lbl.querySelector('input[type="checkbox"]');
        lbl.classList.toggle('active', input.checked);
      });

      // Disable vault for non-MD
      var hasNonMd = activeFileFormats.pdf || activeFileFormats.docx;
      if (hasNonMd) {
        if (activeMethod === 'vault') {
          activeMethod = 'zip';
          methodZip.classList.add('active');
          methodVault.classList.remove('active');
        }
        methodVault.disabled = true;
      } else {
        methodVault.disabled = false;
      }
      updateSelectionUI();
    });
  });

  // --- Event: Export method ---
  methodZip.addEventListener('click', function () {
    activeMethod = 'zip';
    methodZip.classList.add('active');
    methodVault.classList.remove('active');
  });
  methodVault.addEventListener('click', function () {
    if (activeFileFormats.pdf || activeFileFormats.docx) return;
    activeMethod = 'vault';
    methodVault.classList.add('active');
    methodZip.classList.remove('active');
  });

  // --- Export ---
  btnExport.addEventListener('click', function () {
    if (activeMethod === 'vault') {
      doVaultExport();
    } else {
      doZipExport();
    }
  });

  function getNotesToExport() {
    var count = Object.keys(selectedIds).length;
    if (count === 0) return filteredNotes;
    return filteredNotes.filter(function (n) { return selectedIds[n.id]; });
  }

  function doZipExport() {
    window.loadSettings(function (settings) {
      var notes = getNotesToExport();
      if (notes.length === 0) {
        alert('\u6682\u65E0\u7B14\u8BB0\u53EF\u5BFC\u51FA\u3002');
        return;
      }

      var formats = ExportEngine.getActiveFormats(activeFileFormats);
      if (formats.length === 0) formats = ['md'];

      progressEl.classList.add('active');
      btnExport.disabled = true;

      var needTranscripts = settings.transcriptMode !== 'none' &&
        notes.some(function (n) { return !n.rawTranscript; });
      var chain = Promise.resolve();
      if (needTranscripts) {
        ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55...';
        chain = ExportEngine.fetchMissingTranscripts(notes, function (done, total) {
          ptxtEl.textContent = '\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55 ' + done + '/' + total + '...';
        });
      }

      chain.then(function () {
        var hasNonMd = formats.indexOf('pdf') !== -1 || formats.indexOf('docx') !== -1;
        if (hasNonMd && notes.length > 20) {
          ptxtEl.textContent = 'PDF/DOCX \u751F\u6210\u8F83\u6162\uFF0C\u8BF7\u8010\u5FC3\u7B49\u5F85...';
        }

        return ExportEngine.zipExport(notes, settings, formats, function (done, total) {
          var pct = Math.round((done / total) * 100);
          pfillEl.style.width = pct + '%';
          ptxtEl.textContent = done + ' / ' + total + ' \u7B14\u8BB0\u5DF2\u5904\u7406';
        });
      }).then(function () {
        ptxtEl.textContent = '\u5BFC\u51FA\u5B8C\u6210\uFF01\u8BF7\u67E5\u770B\u4E0B\u8F7D\u6587\u4EF6\u5939\u3002';
        btnExport.disabled = false;
        setTimeout(function () {
          progressEl.classList.remove('active');
          applyFilters();
        }, 3000);
      });
    });
  }

  function doVaultExport() {
    if (typeof VaultWriter === 'undefined' || !VaultWriter.isReady()) {
      alert('Vault \u672A\u5C31\u7EEA\u3002\u8BF7\u5148\u5728\u8BBE\u7F6E\u9875\u9762\u9009\u62E9 Vault \u6587\u4EF6\u5939\u3002');
      return;
    }

    window.loadSettings(function (settings) {
      var notes = getNotesToExport();
      if (notes.length === 0) {
        alert('\u6682\u65E0\u7B14\u8BB0\u53EF\u5BFC\u51FA\u3002');
        return;
      }

      progressEl.classList.add('active');
      btnExport.disabled = true;

      var needTranscripts = settings.transcriptMode !== 'none' &&
        notes.some(function (n) { return !n.rawTranscript; });
      var chain = Promise.resolve();
      if (needTranscripts) {
        ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55...';
        chain = ExportEngine.fetchMissingTranscripts(notes, function (done, total) {
          ptxtEl.textContent = '\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55 ' + done + '/' + total + '...';
        });
      }

      chain.then(function () {
        return ExportEngine.vaultExport(notes, settings, function (done, total, written, errorCount) {
          var pct = Math.round((done / total) * 100);
          pfillEl.style.width = pct + '%';
          ptxtEl.textContent = done + ' / ' + total + ' \u5DF2\u5904\u7406 (' + written + ' \u5199\u5165, ' + errorCount + ' \u9519\u8BEF)';
        });
      }).then(function (result) {
        ExportTracker.markExported(notes.map(function (n) { return n.id; }));
        ptxtEl.textContent = '\u5BFC\u51FA\u5B8C\u6210\uFF01' + result.written + ' \u7BC7\u7B14\u8BB0\u5DF2\u5199\u5165 Vault\u3002';
        if (result.errors.length > 0) {
          ptxtEl.textContent += ' (' + result.errors.length + ' \u4E2A\u9519\u8BEF)';
        }
        btnExport.disabled = false;
        setTimeout(function () {
          progressEl.classList.remove('active');
          applyFilters();
        }, 4000);
      }).catch(function (err) {
        ptxtEl.textContent = '\u5BFC\u51FA\u5931\u8D25: ' + err.message;
        btnExport.disabled = false;
        setTimeout(function () { progressEl.classList.remove('active'); }, 4000);
      });
    });
  }

  // --- Load data ---
  function loadNotes() {
    chrome.runtime.sendMessage({ type: 'getNotes' }, function (res) {
      var notes = res && res.notes ? res.notes : {};
      allNotes = Object.values(notes);
      window.sortNotesByDate(allNotes);
      applyFilters();
    });
  }

  // --- Init ---
  window.loadSettings(function (settings) {
    currentSettings = settings;
    ExportTracker.load(function () {
      loadNotes();
    });
  });
})();
