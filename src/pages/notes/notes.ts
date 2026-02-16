// notes.ts — Full-page note management
// Converted from notes.js — window.* globals replaced with imports

import { loadSettingsCb } from '../../services/settings-service';
import { sortNotesByDate } from '../../core/sort-utils';
import { MD } from '../../core/markdown-converter';
import { escapeHtml } from '../../core/sanitize';
import { ExportTracker } from '../../services/export-tracker';
import { ExportEngine } from '../../services/export-engine';
import { VaultWriterModule as VaultWriter } from '../../services/vault-writer';
import type { Settings, Note } from '../../core/types';

// --- DOM references ---
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const filterType = document.getElementById('filterType') as HTMLSelectElement;
const dateFrom = document.getElementById('dateFrom') as HTMLInputElement;
const dateTo = document.getElementById('dateTo') as HTMLInputElement;
const filterExport = document.getElementById('filterExport') as HTMLSelectElement;
const filterSort = document.getElementById('filterSort') as HTMLSelectElement;
const selectAllEl = document.getElementById('selectAll') as HTMLInputElement;
const selCountEl = document.getElementById('selCount')!;
const totalCountEl = document.getElementById('totalCount')!;
const btnExport = document.getElementById('btnExport') as HTMLButtonElement;
const progressEl = document.getElementById('progress')!;
const pfillEl = document.getElementById('pfill')!;
const ptxtEl = document.getElementById('ptxt')!;
const noteTableBody = document.getElementById('noteTableBody')!;
const emptyState = document.getElementById('emptyState')!;
const noteTable = document.getElementById('noteTable')!;
const btnPrev = document.getElementById('btnPrev') as HTMLButtonElement;
const btnNext = document.getElementById('btnNext') as HTMLButtonElement;
const pageInfo = document.getElementById('pageInfo')!;
const methodZip = document.getElementById('methodZip') as HTMLButtonElement;
const methodVault = document.getElementById('methodVault') as HTMLButtonElement;
const fileFmtChecks = document.querySelectorAll('.fmt-check-sm');

// --- State ---
let allNotes: Note[] = [];
let filteredNotes: Note[] = [];
let selectedIds: Record<string, boolean> = {};
let currentSettings: Settings = {} as Settings;
const activeFileFormats: Record<string, boolean> = { md: true, pdf: false, docx: false };
let activeMethod: 'zip' | 'vault' = 'zip';
let currentPage = 1;
const pageSize = 50;

// --- Filter Engine ---
const FilterEngine = {
  searchText: '',
  noteType: 'all',
  dateFrom: null as string | null,
  dateTo: null as string | null,
  exportStatus: 'all',
  sortBy: 'date_desc',

  apply(notes: Note[]): Note[] {
    let result = notes.slice();

    // Text search
    if (this.searchText) {
      const q = this.searchText.toLowerCase();
      result = result.filter(function (n) {
        const title = (n.title || '').toLowerCase();
        const tags = (n.tags || [])
          .map(function (t) { return typeof t === 'string' ? t : (t as any).name || (t as any).label || ''; })
          .join(' ')
          .toLowerCase();
        return title.indexOf(q) !== -1 || tags.indexOf(q) !== -1;
      });
    }

    // Type filter
    if (this.noteType !== 'all') {
      const nt = this.noteType;
      result = result.filter(function (n) { return (n.type || 'text') === nt; });
    }

    // Date filter
    if (this.dateFrom) {
      const fromTs = new Date(this.dateFrom).getTime();
      result = result.filter(function (n) {
        const ts = n.createdAt
          ? new Date(typeof n.createdAt === 'number' ? n.createdAt * 1000 : n.createdAt).getTime()
          : 0;
        return ts >= fromTs;
      });
    }
    if (this.dateTo) {
      const toTs = new Date(this.dateTo).getTime() + 86400000;
      result = result.filter(function (n) {
        const ts = n.createdAt
          ? new Date(typeof n.createdAt === 'number' ? n.createdAt * 1000 : n.createdAt).getTime()
          : 0;
        return ts < toTs;
      });
    }

    // Export status
    if (this.exportStatus === 'exported') {
      result = result.filter(function (n) { return ExportTracker.isExported(n.id); });
    } else if (this.exportStatus === 'unexported') {
      result = result.filter(function (n) { return !ExportTracker.isExported(n.id); });
    }

    // Sort
    if (this.sortBy === 'date_desc') {
      result.sort(function (a, b) {
        const tA = a.createdAt ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime() : 0;
        return tB - tA;
      });
    } else if (this.sortBy === 'date_asc') {
      result.sort(function (a, b) {
        const tA = a.createdAt ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime() : 0;
        return tA - tB;
      });
    } else if (this.sortBy === 'title') {
      result.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
    } else if (this.sortBy === 'type') {
      result.sort(function (a, b) { return (a.type || 'text').localeCompare(b.type || 'text'); });
    }

    return result;
  },
};

// --- Render ---
function renderPage(): void {
  const totalPages = Math.max(1, Math.ceil(filteredNotes.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * pageSize;
  const pageNotes = filteredNotes.slice(start, start + pageSize);

  totalCountEl.textContent = String(filteredNotes.length);

  if (filteredNotes.length === 0) {
    noteTable.style.display = 'none';
    emptyState.style.display = '';
  } else {
    noteTable.style.display = '';
    emptyState.style.display = 'none';
  }

  const html = pageNotes
    .map(function (n) {
      const t = n.title || 'Note ' + n.id;
      const d = MD.formatDate(n.createdAt);
      const ds = d ? d.substring(0, 10) : '';
      const checked = selectedIds[n.id] ? ' checked' : '';
      const type = n.type || 'text';
      const typeCls = type === 'voice' ? 'voice' : type === 'link' ? 'link' : type === 'text' ? 'text' : 'other';
      const typeLabel = type === 'voice' ? '语音' : type === 'link' ? '链接' : type === 'text' ? '文字' : type;
      const exported = ExportTracker.isExported(n.id);
      const statusHtml = exported
        ? '<span class="export-status exported">\u2713</span>'
        : '<span class="export-status new">\u25CF</span>';
      const tags = MD.formatTags(n.tags);
      const tagsHtml = tags.length > 0
        ? '<div class="tag-list">' +
          tags.slice(0, 3).map(function (tag: string) { return '<span class="tag-chip">' + escapeHtml(tag) + '</span>'; }).join('') +
          (tags.length > 3 ? '<span class="tag-chip">+' + (tags.length - 3) + '</span>' : '') +
          '</div>'
        : '';

      return (
        '<tr>' +
        '<td><input type="checkbox" data-id="' + escapeHtml(String(n.id)) + '"' + checked + '></td>' +
        '<td>' + statusHtml + '</td>' +
        '<td class="note-title-cell">' +
        '<a href="https://www.biji.com/note/' + escapeHtml(String(n.id)) + '" target="_blank">' +
        escapeHtml(t) + '</a></td>' +
        '<td><span class="type-badge ' + typeCls + '">' + typeLabel + '</span></td>' +
        '<td style="font-size:12px;color:#888">' + ds + '</td>' +
        '<td>' + tagsHtml + '</td>' +
        '</tr>'
      );
    })
    .join('');

  noteTableBody.innerHTML = html;

  // Bind checkboxes
  noteTableBody.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener('change', function (this: HTMLInputElement) {
      const id = this.getAttribute('data-id')!;
      if (this.checked) { selectedIds[id] = true; } else { delete selectedIds[id]; }
      updateSelectionUI();
    });
  });

  // Pagination
  btnPrev.disabled = currentPage <= 1;
  btnNext.disabled = currentPage >= totalPages;
  pageInfo.textContent = '\u7B2C ' + currentPage + '/' + totalPages + ' \u9875';

  updateSelectionUI();
}

function updateSelectionUI(): void {
  const count = Object.keys(selectedIds).length;
  selCountEl.textContent = String(count);

  if (filteredNotes.length > 0) {
    const allSelected = filteredNotes.every(function (n) { return selectedIds[n.id]; });
    const someSelected = filteredNotes.some(function (n) { return selectedIds[n.id]; });
    selectAllEl.checked = allSelected;
    selectAllEl.indeterminate = someSelected && !allSelected;
  } else {
    selectAllEl.checked = false;
    selectAllEl.indeterminate = false;
  }

  const formats = ExportEngine.getActiveFormats(activeFileFormats);
  const fmtLabel = formats.length > 0
    ? formats.map(function (f: string) { return f.toUpperCase(); }).join('+')
    : 'MD';
  if (count > 0) {
    btnExport.textContent = '\u5BFC\u51FA\u9009\u4E2D ' + count + ' \u6761 (' + fmtLabel + ')';
  } else {
    btnExport.textContent = '\u5BFC\u51FA\u7B5B\u9009\u7ED3\u679C (' + fmtLabel + ')';
  }
}

function applyFilters(): void {
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
let filterDebounce: ReturnType<typeof setTimeout> | null = null;
searchInput.addEventListener('input', function () {
  if (filterDebounce) clearTimeout(filterDebounce);
  filterDebounce = setTimeout(applyFilters, 200);
});
filterType.addEventListener('change', applyFilters);
dateFrom.addEventListener('change', applyFilters);
dateTo.addEventListener('change', applyFilters);
filterExport.addEventListener('change', applyFilters);
filterSort.addEventListener('change', applyFilters);

// --- Event: Select all ---
selectAllEl.addEventListener('change', function (this: HTMLInputElement) {
  const checked = this.checked;
  if (checked) {
    filteredNotes.forEach(function (n) { selectedIds[n.id] = true; });
  } else {
    filteredNotes.forEach(function (n) { delete selectedIds[n.id]; });
  }
  noteTableBody.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
    (cb as HTMLInputElement).checked = checked;
  });
  updateSelectionUI();
});

// --- Event: Pagination ---
btnPrev.addEventListener('click', function () {
  if (currentPage > 1) { currentPage--; renderPage(); }
});
btnNext.addEventListener('click', function () {
  const totalPages = Math.ceil(filteredNotes.length / pageSize);
  if (currentPage < totalPages) { currentPage++; renderPage(); }
});

// --- Event: File format (multi-select) ---
fileFmtChecks.forEach(function (label) {
  const cb = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
  cb.addEventListener('change', function (this: HTMLInputElement) {
    const fmt = this.getAttribute('data-format')!;
    activeFileFormats[fmt] = this.checked;

    const formats = ExportEngine.getActiveFormats(activeFileFormats);
    if (formats.length === 0) {
      activeFileFormats.md = true;
      const mdCb = document.querySelector('.fmt-check-sm input[data-format="md"]') as HTMLInputElement | null;
      if (mdCb) mdCb.checked = true;
    }

    fileFmtChecks.forEach(function (lbl) {
      const input = lbl.querySelector('input[type="checkbox"]') as HTMLInputElement;
      lbl.classList.toggle('active', input.checked);
    });

    const hasNonMd = activeFileFormats.pdf || activeFileFormats.docx;
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
  if (activeMethod === 'vault') { doVaultExport(); } else { doZipExport(); }
});

function getNotesToExport(): Note[] {
  const count = Object.keys(selectedIds).length;
  if (count === 0) return filteredNotes;
  return filteredNotes.filter(function (n) { return selectedIds[n.id]; });
}

function doZipExport(): void {
  loadSettingsCb(function (settings) {
    const notes = getNotesToExport();
    if (notes.length === 0) { alert('\u6682\u65E0\u7B14\u8BB0\u53EF\u5BFC\u51FA\u3002'); return; }

    let formats = ExportEngine.getActiveFormats(activeFileFormats);
    if (formats.length === 0) formats = ['md'];

    progressEl.classList.add('active');
    btnExport.disabled = true;

    const needTranscripts = settings.transcriptMode !== 'none' &&
      notes.some(function (n) { return !n.rawTranscript; });
    let chain = Promise.resolve();
    if (needTranscripts) {
      ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55...';
      chain = ExportEngine.fetchMissingTranscripts(notes, function (done: number, total: number) {
        ptxtEl.textContent = '\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55 ' + done + '/' + total + '...';
      });
    }

    chain
      .then(function () {
        const hasNonMd = formats.indexOf('pdf') !== -1 || formats.indexOf('docx') !== -1;
        if (hasNonMd && notes.length > 20) {
          ptxtEl.textContent = 'PDF/DOCX \u751F\u6210\u8F83\u6162\uFF0C\u8BF7\u8010\u5FC3\u7B49\u5F85...';
        }
        return ExportEngine.zipExport(notes, settings, formats, function (done: number, total: number) {
          const pct = Math.round((done / total) * 100);
          pfillEl.style.width = pct + '%';
          ptxtEl.textContent = done + ' / ' + total + ' \u7B14\u8BB0\u5DF2\u5904\u7406';
        });
      })
      .then(function () {
        ptxtEl.textContent = '\u5BFC\u51FA\u5B8C\u6210\uFF01\u8BF7\u67E5\u770B\u4E0B\u8F7D\u6587\u4EF6\u5939\u3002';
        btnExport.disabled = false;
        setTimeout(function () { progressEl.classList.remove('active'); applyFilters(); }, 3000);
      });
  });
}

function doVaultExport(): void {
  if (!VaultWriter.isReady()) {
    alert('Vault \u672A\u5C31\u7EEA\u3002\u8BF7\u5148\u5728\u8BBE\u7F6E\u9875\u9762\u9009\u62E9 Vault \u6587\u4EF6\u5939\u3002');
    return;
  }

  loadSettingsCb(function (settings) {
    const notes = getNotesToExport();
    if (notes.length === 0) { alert('\u6682\u65E0\u7B14\u8BB0\u53EF\u5BFC\u51FA\u3002'); return; }

    progressEl.classList.add('active');
    btnExport.disabled = true;

    const needTranscripts = settings.transcriptMode !== 'none' &&
      notes.some(function (n) { return !n.rawTranscript; });
    let chain = Promise.resolve();
    if (needTranscripts) {
      ptxtEl.textContent = '\u6B63\u5728\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55...';
      chain = ExportEngine.fetchMissingTranscripts(notes, function (done: number, total: number) {
        ptxtEl.textContent = '\u83B7\u53D6\u6587\u5B57\u8BB0\u5F55 ' + done + '/' + total + '...';
      });
    }

    chain
      .then(function () {
        return ExportEngine.vaultExport(notes, settings, function (done: number, total: number, written?: number, errorCount?: number) {
          const pct = Math.round((done / total) * 100);
          pfillEl.style.width = pct + '%';
          ptxtEl.textContent = done + ' / ' + total + ' \u5DF2\u5904\u7406 (' + (written || 0) + ' \u5199\u5165, ' + (errorCount || 0) + ' \u9519\u8BEF)';
        });
      })
      .then(function (result: any) {
        ExportTracker.markExported(notes.map(function (n) { return n.id; }));
        ptxtEl.textContent = '\u5BFC\u51FA\u5B8C\u6210\uFF01' + result.written + ' \u7BC7\u7B14\u8BB0\u5DF2\u5199\u5165 Vault\u3002';
        if (result.errors.length > 0) {
          ptxtEl.textContent += ' (' + result.errors.length + ' \u4E2A\u9519\u8BEF)';
        }
        btnExport.disabled = false;
        setTimeout(function () { progressEl.classList.remove('active'); applyFilters(); }, 4000);
      })
      .catch(function (err: Error) {
        ptxtEl.textContent = '\u5BFC\u51FA\u5931\u8D25: ' + err.message;
        btnExport.disabled = false;
        setTimeout(function () { progressEl.classList.remove('active'); }, 4000);
      });
  });
}

// --- Load data ---
function loadNotes(): void {
  chrome.runtime.sendMessage({ type: 'getNotes' }, function (res: any) {
    const notes = res && res.notes ? res.notes : {};
    allNotes = Object.values(notes) as Note[];
    sortNotesByDate(allNotes);
    applyFilters();
  });
}

// --- Init ---
loadSettingsCb(function (settings) {
  currentSettings = settings;
  ExportTracker.load(function () { loadNotes(); });
});
