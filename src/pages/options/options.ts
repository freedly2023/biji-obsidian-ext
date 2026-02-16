// options.ts — Settings page logic
// Converted from options.js — window.* globals replaced with imports

import { DEFAULT_SETTINGS } from '../../core/constants';
import { VaultWriterModule as VaultWriter } from '../../services/vault-writer';
import type { Settings, FrontmatterFields } from '../../core/types';

// DOM references — export mode
const radioZip = document.getElementById('radioZip')!;
const radioVault = document.getElementById('radioVault')!;
const radioInputs = document.querySelectorAll('input[name="exportMode"]');
const vaultSection = document.getElementById('vaultSection')!;
const vaultStatus = document.getElementById('vaultStatus')!;
const vaultStatusText = document.getElementById('vaultStatusText')!;
const btnPickVault = document.getElementById('btnPickVault') as HTMLButtonElement;
const btnGrantPerm = document.getElementById('btnGrantPerm') as HTMLButtonElement;
const btnClearVault = document.getElementById('btnClearVault') as HTMLButtonElement;
const vaultSubfolder = document.getElementById('vaultSubfolder') as HTMLInputElement;
const includeAudioLink = document.getElementById('includeAudioLink') as HTMLInputElement;
const includeImages = document.getElementById('includeImages') as HTMLInputElement;
const voiceSentenceSplit = document.getElementById('voiceSentenceSplit') as HTMLInputElement;
const tagPrefix = document.getElementById('tagPrefix') as HTMLInputElement;
const discoveryMode = document.getElementById('discoveryMode') as HTMLInputElement;
const fetchDelay = document.getElementById('fetchDelay') as HTMLInputElement;
const scanDepth = document.getElementById('scanDepth') as HTMLInputElement;
const btnSave = document.getElementById('btnSave') as HTMLButtonElement;
const btnReset = document.getElementById('btnReset') as HTMLButtonElement;
const statusMsg = document.getElementById('statusMsg')!;

// DOM references — new
const dateFormat = document.getElementById('dateFormat') as HTMLSelectElement;
const customTemplateRow = document.getElementById('customTemplateRow')!;
const customTemplate = document.getElementById('customTemplate') as HTMLInputElement;
const folderHint = document.getElementById('folderHint')!;

// DOM references — link submission
const enableInjectBtn = document.getElementById('enableInjectBtn') as HTMLInputElement;
const injectBtnYoutube = document.getElementById('injectBtnYoutube') as HTMLInputElement;
const injectBtnBilibili = document.getElementById('injectBtnBilibili') as HTMLInputElement;
const injectBtnXiaoyuzhou = document.getElementById('injectBtnXiaoyuzhou') as HTMLInputElement;

// DOM references — feed management
const feedUrlInput = document.getElementById('feedUrlInput') as HTMLInputElement;
const btnAddFeed = document.getElementById('btnAddFeed') as HTMLButtonElement;
const feedList = document.getElementById('feedList')!;
const feedEmptyHint = document.getElementById('feedEmptyHint')!;
const feedAutoCheck = document.getElementById('feedAutoCheck') as HTMLInputElement;
const feedCheckInterval = document.getElementById('feedCheckInterval') as HTMLInputElement;
const btnCheckFeedsNow = document.getElementById('btnCheckFeedsNow') as HTMLButtonElement;
const feedCheckStatus = document.getElementById('feedCheckStatus')!;
const feedAutoSubmit = document.getElementById('feedAutoSubmit') as HTMLInputElement | null;

// --- Generic radio group handler ---
function initRadioGroup(groupId: string): void {
  const container = document.getElementById(groupId);
  if (!container) return;
  const options = container.querySelectorAll('.radio-option');
  options.forEach(function (opt) {
    opt.addEventListener('click', function () {
      const radio = opt.querySelector('input[type="radio"]') as HTMLInputElement | null;
      if (radio) {
        radio.checked = true;
        options.forEach(function (o) { o.classList.remove('selected'); });
        opt.classList.add('selected');
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });
}

function setRadioGroupValue(name: string, value: string): void {
  const input = document.querySelector('input[name="' + name + '"][value="' + value + '"]') as HTMLInputElement | null;
  if (input) {
    input.checked = true;
    const group = input.closest('.radio-group');
    if (group) {
      group.querySelectorAll('.radio-option').forEach(function (o) {
        o.classList.toggle('selected', o.contains(input));
      });
    }
  }
}

function getRadioGroupValue(name: string): string | null {
  const checked = document.querySelector('input[name="' + name + '"]:checked') as HTMLInputElement | null;
  return checked ? checked.value : null;
}

// Init all radio groups
initRadioGroup('filenameRadioGroup');
initRadioGroup('transcriptRadioGroup');
initRadioGroup('folderRadioGroup');
initRadioGroup('imageFormatGroup');

// --- Export mode radio selection ---
function updateRadioUI(mode: string): void {
  radioZip.classList.toggle('selected', mode === 'zip');
  radioVault.classList.toggle('selected', mode === 'vault');
  vaultSection.classList.toggle('visible', mode === 'vault');
}

radioInputs.forEach(function (input) {
  input.addEventListener('change', function (this: HTMLInputElement) { updateRadioUI(this.value); });
});

radioZip.addEventListener('click', function () {
  (radioZip.querySelector('input') as HTMLInputElement).checked = true;
  updateRadioUI('zip');
});
radioVault.addEventListener('click', function () {
  (radioVault.querySelector('input') as HTMLInputElement).checked = true;
  updateRadioUI('vault');
});

// --- Filename template: show/hide custom input ---
document.querySelectorAll('input[name="filenameTemplate"]').forEach(function (input) {
  input.addEventListener('change', function (this: HTMLInputElement) {
    const isCustom = this.value === 'custom';
    customTemplateRow.classList.toggle('visible', isCustom);
    updateFolderHint();
  });
});

// --- Folder hint ---
function updateFolderHint(): void {
  const tmpl = getEffectiveFilenameTemplate();
  const hasSlash = tmpl.indexOf('/') !== -1;
  folderHint.style.display = hasSlash ? 'block' : 'none';
  const folderRadios = document.querySelectorAll('input[name="folderMode"]');
  folderRadios.forEach(function (r) {
    (r as HTMLInputElement).disabled = hasSlash;
    const opt = r.closest('.radio-option') as HTMLElement;
    opt.style.opacity = hasSlash ? '0.5' : '1';
    opt.style.pointerEvents = hasSlash ? 'none' : '';
  });
}

function getEffectiveFilenameTemplate(): string {
  const val = getRadioGroupValue('filenameTemplate');
  if (val === 'custom') {
    return customTemplate.value.trim() || '{date}-{title}';
  }
  return val || '{date}-{title}';
}

customTemplate.addEventListener('input', updateFolderHint);

// --- Vault status display ---
function updateVaultStatus(): void {
  if (!VaultWriter.isSupported()) {
    setVaultStatusUI('unsupported', '当前浏览器不支持 File System Access API');
    btnPickVault.disabled = true;
    (radioVault as HTMLElement).style.opacity = '0.5';
    (radioVault as HTMLElement).style.pointerEvents = 'none';
    return;
  }

  VaultWriter.restoreHandle()
    .then(function (handle: any) {
      if (handle) {
        setVaultStatusUI('connected', '已连接: ' + VaultWriter.getDirectoryName());
        btnGrantPerm.style.display = 'none';
      } else if (VaultWriter.needsPermission()) {
        setVaultStatusUI('needs-permission', '需要授权: ' + VaultWriter.getDirectoryName());
        btnGrantPerm.style.display = '';
      } else {
        setVaultStatusUI('not-selected', '未选择 Vault 文件夹');
        btnGrantPerm.style.display = 'none';
      }
    })
    .catch(function () {
      setVaultStatusUI('not-selected', '未选择 Vault 文件夹');
    });
}

function setVaultStatusUI(statusClass: string, text: string): void {
  vaultStatus.className = 'vault-status ' + statusClass;
  vaultStatusText.textContent = text;
}

// --- Vault buttons ---
btnPickVault.addEventListener('click', function () {
  VaultWriter.pickDirectory()
    .then(function (handle: any) {
      if (handle) {
        updateVaultStatus();
        showStatus('success', 'Vault 文件夹已选择: ' + handle.name);
      }
    })
    .catch(function (err: Error) {
      showStatus('error', '选择文件夹失败: ' + err.message);
    });
});

btnGrantPerm.addEventListener('click', function () {
  VaultWriter.requestPermission().then(function (granted: boolean) {
    if (granted) {
      updateVaultStatus();
      showStatus('success', '权限已授予');
    } else {
      showStatus('error', '权限授予失败，请重试');
    }
  });
});

btnClearVault.addEventListener('click', function () {
  if (!confirm('确定要清除已保存的 Vault 文件夹吗？')) return;
  VaultWriter.clearHandle().then(function () {
    updateVaultStatus();
    showStatus('success', 'Vault 文件夹已清除');
  });
});

// --- Frontmatter field helpers ---
const fmFieldIds: Record<string, string> = {
  title: 'fmTitle', created: 'fmCreated', modified: 'fmModified', source: 'fmSource',
  type: 'fmType', tags: 'fmTags', biji_id: 'fmBijiId', exported: 'fmExported',
};

function getFrontmatterFields(): FrontmatterFields {
  const fields: Record<string, boolean> = {};
  Object.keys(fmFieldIds).forEach(function (key) {
    const el = document.getElementById(fmFieldIds[key]) as HTMLInputElement | null;
    fields[key] = el ? el.checked : true;
  });
  return fields as unknown as FrontmatterFields;
}

function setFrontmatterFields(fields: Record<string, boolean>): void {
  Object.keys(fmFieldIds).forEach(function (key) {
    const el = document.getElementById(fmFieldIds[key]) as HTMLInputElement | null;
    if (el) el.checked = fields[key] !== false;
  });
}

// --- Load settings ---
function loadSettings(): void {
  chrome.storage.local.get('settings', function (data: Record<string, any>) {
    const s = Object.assign({}, DEFAULT_SETTINGS, data.settings || {}) as Settings;
    s.frontmatterFields = Object.assign({}, DEFAULT_SETTINGS.frontmatterFields, s.frontmatterFields || {});

    // Export mode
    const modeInput = document.querySelector('input[name="exportMode"][value="' + s.exportMode + '"]') as HTMLInputElement | null;
    if (modeInput) { modeInput.checked = true; updateRadioUI(s.exportMode); }

    // Vault
    vaultSubfolder.value = s.vaultSubfolder;

    // Filename template
    const presets = ['{date}-{title}', '{title}-{date}', '{title}', '{date}/{title}'];
    if (presets.indexOf(s.filenameTemplate) !== -1) {
      setRadioGroupValue('filenameTemplate', s.filenameTemplate);
      customTemplateRow.classList.remove('visible');
    } else {
      setRadioGroupValue('filenameTemplate', 'custom');
      customTemplate.value = s.filenameTemplate;
      customTemplateRow.classList.add('visible');
    }

    dateFormat.value = s.dateFormat;
    setRadioGroupValue('transcriptMode', s.transcriptMode);
    setRadioGroupValue('folderMode', s.folderMode);
    setFrontmatterFields(s.frontmatterFields as unknown as Record<string, boolean>);
    setRadioGroupValue('imageFormat', s.imageFormat);

    includeAudioLink.checked = s.includeAudioLink;
    includeImages.checked = s.includeImages;
    voiceSentenceSplit.checked = s.voiceSentenceSplit;
    tagPrefix.value = s.tagPrefix;

    discoveryMode.checked = s.discoveryMode;
    fetchDelay.value = String(s.fetchDelay);
    scanDepth.value = String(s.scanDepth);

    enableInjectBtn.checked = s.enableInjectBtn !== false;
    injectBtnYoutube.checked = s.injectBtnYoutube !== false;
    injectBtnBilibili.checked = s.injectBtnBilibili !== false;
    injectBtnXiaoyuzhou.checked = s.injectBtnXiaoyuzhou !== false;

    feedAutoCheck.checked = !!s.feedAutoCheck;
    feedCheckInterval.value = String(s.feedCheckInterval || 60);
    if (feedAutoSubmit) feedAutoSubmit.checked = s.feedAutoSubmit !== false;

    chrome.storage.local.set({ discoveryMode: s.discoveryMode });
    updateFolderHint();
  });

  updateVaultStatus();
  loadFeedList();
}

// --- Save settings ---
function saveSettings(): void {
  const exportModeValue = document.querySelector('input[name="exportMode"]:checked') as HTMLInputElement | null;
  const settings: Settings = {
    exportMode: (exportModeValue ? exportModeValue.value : 'zip') as 'zip' | 'vault',
    vaultSubfolder: vaultSubfolder.value.trim() || DEFAULT_SETTINGS.vaultSubfolder,
    includeAudioLink: includeAudioLink.checked,
    includeImages: includeImages.checked,
    voiceSentenceSplit: voiceSentenceSplit.checked,
    tagPrefix: tagPrefix.value || '#',
    discoveryMode: discoveryMode.checked,
    fetchDelay: Math.max(100, Math.min(5000, parseInt(fetchDelay.value, 10) || 500)),
    scanDepth: Math.max(4, Math.min(20, parseInt(scanDepth.value, 10) || 10)),
    filenameTemplate: getEffectiveFilenameTemplate(),
    dateFormat: dateFormat.value || 'YYYY-MM-DD',
    transcriptMode: (getRadioGroupValue('transcriptMode') || 'none') as Settings['transcriptMode'],
    folderMode: (getRadioGroupValue('folderMode') || 'flat') as Settings['folderMode'],
    frontmatterFields: getFrontmatterFields(),
    imageFormat: (getRadioGroupValue('imageFormat') || 'link') as Settings['imageFormat'],
    enableInjectBtn: enableInjectBtn.checked,
    injectBtnYoutube: injectBtnYoutube.checked,
    injectBtnBilibili: injectBtnBilibili.checked,
    injectBtnXiaoyuzhou: injectBtnXiaoyuzhou.checked,
    feedAutoCheck: feedAutoCheck.checked,
    feedCheckInterval: parseInt(feedCheckInterval.value, 10) || 60,
    feedAutoSubmit: feedAutoSubmit ? feedAutoSubmit.checked : true,
  };

  chrome.storage.local.set({ settings, discoveryMode: settings.discoveryMode }, function () {
    showStatus('success', '设置已保存');
  });
}

// --- Reset to defaults ---
function resetSettings(): void {
  if (!confirm('确定要恢复所有设置为默认值吗？')) return;
  chrome.storage.local.set({ settings: DEFAULT_SETTINGS, discoveryMode: DEFAULT_SETTINGS.discoveryMode }, function () {
    loadSettings();
    showStatus('success', '设置已恢复为默认值');
  });
}

// --- Status messages ---
function showStatus(type: string, text: string): void {
  statusMsg.className = 'status-msg ' + type;
  statusMsg.textContent = text;
  statusMsg.style.display = 'block';
  setTimeout(function () { statusMsg.style.display = 'none'; }, 3000);
}

// --- Feed management UI ---
function loadFeedList(): void {
  chrome.runtime.sendMessage({ type: 'getFeeds' }, function (resp: any) {
    if (chrome.runtime.lastError || !resp) return;
    renderFeedList(resp.feeds || []);
  });
}

function renderFeedList(feeds: any[]): void {
  const items = feedList.querySelectorAll('.feed-item');
  items.forEach(function (item) { item.remove(); });

  if (feeds.length === 0) { feedEmptyHint.style.display = 'block'; return; }
  feedEmptyHint.style.display = 'none';

  feeds.forEach(function (feed) {
    const div = document.createElement('div');
    div.className = 'feed-item';

    const info = document.createElement('div');
    info.className = 'feed-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'feed-name';
    nameEl.textContent = feed.name || feed.url;
    info.appendChild(nameEl);
    const urlEl = document.createElement('div');
    urlEl.className = 'feed-url';
    urlEl.textContent = feed.url;
    info.appendChild(urlEl);
    if (feed.lastChecked) {
      const lastCheck = document.createElement('div');
      lastCheck.className = 'feed-last-check';
      lastCheck.textContent = '上次检查: ' + new Date(feed.lastChecked).toLocaleString('zh-CN');
      info.appendChild(lastCheck);
    }
    div.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'feed-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toggle-btn ' + (feed.enabled ? 'enabled' : 'disabled');
    toggleBtn.textContent = feed.enabled ? '已启用' : '已禁用';
    toggleBtn.addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: 'toggleFeed', feedId: feed.id }, function () { loadFeedList(); });
    });
    actions.appendChild(toggleBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', function () {
      if (!confirm('确定要删除此订阅源吗？')) return;
      chrome.runtime.sendMessage({ type: 'removeFeed', feedId: feed.id }, function () { loadFeedList(); });
    });
    actions.appendChild(deleteBtn);

    div.appendChild(actions);
    feedList.appendChild(div);
  });
}

// Add feed button
btnAddFeed.addEventListener('click', function () {
  const url = feedUrlInput.value.trim();
  if (!url) return;
  btnAddFeed.disabled = true;
  chrome.runtime.sendMessage({ type: 'addFeed', url, name: '' }, function (resp: any) {
    btnAddFeed.disabled = false;
    if (chrome.runtime.lastError) {
      showStatus('error', '添加失败: ' + chrome.runtime.lastError.message);
      return;
    }
    if (resp && resp.ok) {
      feedUrlInput.value = '';
      loadFeedList();
      showStatus('success', '订阅源已添加');
    } else {
      showStatus('error', '添加失败: ' + ((resp && resp.error) || '未知错误'));
    }
  });
});

// Check feeds now button
btnCheckFeedsNow.addEventListener('click', function () {
  btnCheckFeedsNow.disabled = true;
  feedCheckStatus.textContent = '检查中...';
  chrome.runtime.sendMessage({ type: 'checkFeedsNow' }, function (resp: any) {
    btnCheckFeedsNow.disabled = false;
    if (chrome.runtime.lastError) { feedCheckStatus.textContent = '检查失败'; return; }
    if (resp && resp.ok) {
      const r = resp.result || {};
      feedCheckStatus.textContent = '已检查 ' + (r.checked || 0) + ' 个源，新提交 ' + (r.newItems || 0) + ' 条';
      loadFeedList();
    } else {
      feedCheckStatus.textContent = '检查失败: ' + ((resp && resp.error) || '');
    }
  });
});

// --- Event bindings ---
btnSave.addEventListener('click', saveSettings);
btnReset.addEventListener('click', resetSettings);

// --- Init ---
loadSettings();
