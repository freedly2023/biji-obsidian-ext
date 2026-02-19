(function () {
    'use strict';

    // Shared constants — single source of truth
    const BIJI_API_BASE = 'https://get-notes.luojilab.com/voicenotes/web/notes';
    const BIJI_EXPORT_API = 'https://get-notes.luojilab.com/voicenotes/web/export/tasks';
    const SUBMIT_API_URL = 'https://get-notes.luojilab.com/voicenotes/web/notes/stream';
    const DEFAULT_SETTINGS = {
        filenameTemplate: '{date}-{title}',
        dateFormat: 'YYYY-MM-DD',
        transcriptMode: 'none',
        folderMode: 'flat',
        frontmatterFields: {
            title: true,
            created: true,
            modified: true,
            source: true,
            type: true,
            tags: true,
            biji_id: true,
            exported: true,
        },
        imageFormat: 'link',
        includeAudioLink: true,
        includeImages: true,
        voiceSentenceSplit: true,
        tagPrefix: '#',
        // Export
        exportMode: 'zip',
        vaultSubfolder: 'biji-notes',
        contentFetchConcurrency: 5,
        transcriptFetchConcurrency: 5,
        zipExportConcurrencyLight: 6,
        zipExportConcurrencyHeavy: 2,
        vaultWriteConcurrency: 4,
        // Advanced
        discoveryMode: false,
        fetchDelay: 500,
        scanDepth: 10,
        // Link submission buttons
        enableInjectBtn: true,
        injectBtnYoutube: true,
        injectBtnBilibili: true,
        injectBtnXiaoyuzhou: true,
        // Feed management
        feedAutoCheck: false,
        feedCheckInterval: 60,
        feedAutoSubmit: true,
    };

    // Vault Writer — Direct write to Obsidian vault via File System Access API
    // Rewritten from vault-writer.js
    const DB_NAME = 'biji-exporter';
    const STORE_NAME = 'handles';
    const HANDLE_KEY = 'vaultDir';
    const DEFAULT_VAULT_WRITE_CONCURRENCY = 4;
    let directoryHandle = null;
    let _pendingHandle = null;
    function runWithConcurrency(items, concurrency, worker) {
        if (items.length === 0)
            return Promise.resolve();
        const limit = Math.max(1, Math.min(concurrency, items.length));
        let cursor = 0;
        function runNext() {
            if (cursor >= items.length)
                return Promise.resolve();
            const index = cursor++;
            return worker(items[index], index).then(runNext);
        }
        const workers = Array.from({ length: limit }, () => runNext());
        return Promise.all(workers).then(() => { });
    }
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                e.target.result.createObjectStore(STORE_NAME);
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
    function saveHandleToDB(handle) {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        });
    }
    function loadHandleFromDB() {
        return openDB().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = (e) => reject(e.target.error);
            });
        });
    }
    function deleteHandleFromDB() {
        return openDB().then(db => {
            return new Promise(resolve => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            });
        });
    }
    function isSupported() {
        return typeof window.showDirectoryPicker === 'function';
    }
    function pickDirectory() {
        return window.showDirectoryPicker({ mode: 'readwrite' })
            .then((handle) => {
            directoryHandle = handle;
            return saveHandleToDB(handle).then(() => handle);
        })
            .catch((e) => {
            if (e.name === 'AbortError')
                return null;
            throw e;
        });
    }
    function restoreHandle() {
        return loadHandleFromDB()
            .then(handle => {
            if (!handle)
                return null;
            return handle.queryPermission({ mode: 'readwrite' }).then((perm) => {
                if (perm === 'granted') {
                    directoryHandle = handle;
                    return handle;
                }
                _pendingHandle = handle;
                return null;
            });
        })
            .catch((e) => {
            console.warn('[Biji Ext] Could not restore vault handle:', e);
            return null;
        });
    }
    function requestPermission() {
        if (!_pendingHandle)
            return Promise.resolve(false);
        return _pendingHandle.requestPermission({ mode: 'readwrite' })
            .then((perm) => {
            if (perm === 'granted') {
                directoryHandle = _pendingHandle;
                _pendingHandle = null;
                return true;
            }
            return false;
        })
            .catch(() => false);
    }
    function writeFile(dirHandle, filename, content) {
        return dirHandle.getFileHandle(filename, { create: true })
            .then((fileHandle) => fileHandle.createWritable())
            .then((writable) => writable.write(content).then(() => writable.close()));
    }
    function writeAllNotes(notes, subfolder, markdownConverter, onProgress, concurrency) {
        if (!directoryHandle) {
            return Promise.reject(new Error('No vault directory selected'));
        }
        let targetDirPromise;
        if (subfolder) {
            targetDirPromise = directoryHandle.getDirectoryHandle(subfolder, { create: true });
        }
        else {
            targetDirPromise = Promise.resolve(directoryHandle);
        }
        return targetDirPromise.then(targetDir => {
            const used = {};
            const total = notes.length;
            let done = 0;
            let written = 0;
            const errors = [];
            const jobs = notes.map(note => {
                let fn = markdownConverter.filename(note);
                if (used[fn]) {
                    const base = fn.replace('.md', '');
                    let c = 2;
                    while (used[base + '-' + c + '.md'])
                        c++;
                    fn = base + '-' + c + '.md';
                }
                used[fn] = true;
                return { note, fn };
            });
            return runWithConcurrency(jobs, Math.max(1, Math.min(12, Math.floor(concurrency || DEFAULT_VAULT_WRITE_CONCURRENCY))), (job) => {
                return Promise.resolve()
                    .then(() => markdownConverter.convert(job.note))
                    .then(md => writeFile(targetDir, job.fn, md))
                    .then(() => {
                    written++;
                })
                    .catch(e => {
                    const message = e && e.message ? e.message : String(e);
                    errors.push({ filename: job.fn, error: message });
                })
                    .then(() => {
                    done++;
                    if (onProgress)
                        onProgress(done, total, written, errors.length);
                });
            }).then(() => ({ written, errors }));
        });
    }
    function clearHandle() {
        directoryHandle = null;
        _pendingHandle = null;
        return deleteHandleFromDB();
    }
    function getDirectoryName() {
        if (directoryHandle)
            return directoryHandle.name;
        if (_pendingHandle)
            return _pendingHandle.name + ' (needs permission)';
        return null;
    }
    function isReady() {
        return !!directoryHandle;
    }
    function needsPermission() {
        return !!_pendingHandle && !directoryHandle;
    }
    const VaultWriterModule = {
        isSupported, pickDirectory, restoreHandle, requestPermission,
        writeFile, writeAllNotes, clearHandle, getDirectoryName, isReady, needsPermission,
    };

    // options.ts — Settings page logic
    // Converted from options.js — window.* globals replaced with imports
    const ACTIVE_TAB_STORAGE_KEY = 'options.activeTab';
    const INPUT_SAVE_DEBOUNCE_MS = 400;
    // DOM references — export mode
    const radioZip = document.getElementById('radioZip');
    const radioVault = document.getElementById('radioVault');
    const radioInputs = document.querySelectorAll('input[name="exportMode"]');
    const vaultSection = document.getElementById('vaultSection');
    const vaultStatus = document.getElementById('vaultStatus');
    const vaultStatusText = document.getElementById('vaultStatusText');
    const btnPickVault = document.getElementById('btnPickVault');
    const btnGrantPerm = document.getElementById('btnGrantPerm');
    const btnClearVault = document.getElementById('btnClearVault');
    const vaultSubfolder = document.getElementById('vaultSubfolder');
    const contentFetchConcurrency = document.getElementById('contentFetchConcurrency');
    const transcriptFetchConcurrency = document.getElementById('transcriptFetchConcurrency');
    const zipExportConcurrencyLight = document.getElementById('zipExportConcurrencyLight');
    const zipExportConcurrencyHeavy = document.getElementById('zipExportConcurrencyHeavy');
    const vaultWriteConcurrency = document.getElementById('vaultWriteConcurrency');
    const includeAudioLink = document.getElementById('includeAudioLink');
    const includeImages = document.getElementById('includeImages');
    const voiceSentenceSplit = document.getElementById('voiceSentenceSplit');
    const tagPrefix = document.getElementById('tagPrefix');
    const discoveryMode = document.getElementById('discoveryMode');
    const fetchDelay = document.getElementById('fetchDelay');
    const scanDepth = document.getElementById('scanDepth');
    const btnSave = document.getElementById('btnSave');
    const btnReset = document.getElementById('btnReset');
    const statusMsg = document.getElementById('statusMsg');
    const autosaveState = document.getElementById('autosaveState');
    // DOM references — tabs
    const settingsTabs = document.querySelectorAll('.settings-tab');
    const settingsPanels = document.querySelectorAll('.settings-panel');
    // DOM references — new
    const dateFormat = document.getElementById('dateFormat');
    const customTemplateRow = document.getElementById('customTemplateRow');
    const customTemplate = document.getElementById('customTemplate');
    const folderHint = document.getElementById('folderHint');
    // DOM references — link submission
    const enableInjectBtn = document.getElementById('enableInjectBtn');
    const injectBtnYoutube = document.getElementById('injectBtnYoutube');
    const injectBtnBilibili = document.getElementById('injectBtnBilibili');
    const injectBtnXiaoyuzhou = document.getElementById('injectBtnXiaoyuzhou');
    // DOM references — feed management
    const feedUrlInput = document.getElementById('feedUrlInput');
    const btnAddFeed = document.getElementById('btnAddFeed');
    const feedList = document.getElementById('feedList');
    const feedEmptyHint = document.getElementById('feedEmptyHint');
    const feedAutoCheck = document.getElementById('feedAutoCheck');
    const feedCheckInterval = document.getElementById('feedCheckInterval');
    const btnCheckFeedsNow = document.getElementById('btnCheckFeedsNow');
    const feedCheckStatus = document.getElementById('feedCheckStatus');
    const feedAutoSubmit = document.getElementById('feedAutoSubmit');
    // Save state
    let hasLoadedSettings = false;
    let pendingSaveTimer = null;
    let saveInFlight = false;
    let queuedSaveSource = null;
    let statusMsgTimer = null;
    const settingFieldIds = new Set([
        'vaultSubfolder',
        'contentFetchConcurrency',
        'transcriptFetchConcurrency',
        'zipExportConcurrencyLight',
        'zipExportConcurrencyHeavy',
        'vaultWriteConcurrency',
        'includeAudioLink',
        'includeImages',
        'voiceSentenceSplit',
        'tagPrefix',
        'discoveryMode',
        'fetchDelay',
        'scanDepth',
        'dateFormat',
        'customTemplate',
        'enableInjectBtn',
        'injectBtnYoutube',
        'injectBtnBilibili',
        'injectBtnXiaoyuzhou',
        'feedAutoCheck',
        'feedCheckInterval',
        'feedAutoSubmit',
        'fmTitle',
        'fmCreated',
        'fmModified',
        'fmSource',
        'fmType',
        'fmTags',
        'fmBijiId',
        'fmExported',
    ]);
    const settingFieldNames = new Set([
        'exportMode',
        'filenameTemplate',
        'transcriptMode',
        'folderMode',
        'imageFormat',
    ]);
    // --- Generic radio group handler ---
    function initRadioGroup(groupId) {
        const container = document.getElementById(groupId);
        if (!container)
            return;
        const options = container.querySelectorAll('.radio-option');
        options.forEach(function (opt) {
            opt.addEventListener('click', function () {
                const radio = opt.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    options.forEach(function (o) { o.classList.remove('selected'); });
                    opt.classList.add('selected');
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });
    }
    function setRadioGroupValue(name, value) {
        const input = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
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
    function getRadioGroupValue(name) {
        const checked = document.querySelector('input[name="' + name + '"]:checked');
        return checked ? checked.value : null;
    }
    function clearPendingSaveTimer() {
        if (pendingSaveTimer !== null) {
            window.clearTimeout(pendingSaveTimer);
            pendingSaveTimer = null;
        }
    }
    function formatSaveTime() {
        return new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }
    function setAutosaveState(state, text) {
        autosaveState.className = 'autosave-state ' + state;
        if (text) {
            autosaveState.textContent = text;
            return;
        }
        if (state === 'saved')
            autosaveState.textContent = '已自动保存';
        if (state === 'pending')
            autosaveState.textContent = '检测到修改，准备自动保存';
        if (state === 'saving')
            autosaveState.textContent = '自动保存中...';
        if (state === 'error')
            autosaveState.textContent = '保存失败，请重试';
    }
    function setActiveTab(tabId) {
        const validTab = Array.from(settingsTabs).find(function (tab) {
            return tab.dataset.tab === tabId;
        });
        const nextTabId = validTab ? tabId : (settingsTabs[0]?.dataset.tab || 'export');
        settingsTabs.forEach(function (tab) {
            tab.classList.toggle('active', tab.dataset.tab === nextTabId);
        });
        settingsPanels.forEach(function (panel) {
            panel.classList.toggle('active', panel.dataset.panel === nextTabId);
        });
        localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, nextTabId);
    }
    function initTabs() {
        if (settingsTabs.length === 0)
            return;
        const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
        setActiveTab(stored || settingsTabs[0].dataset.tab || 'export');
        settingsTabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                setActiveTab(tab.dataset.tab || 'export');
            });
        });
    }
    function isSettingsControl(target) {
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement))
            return false;
        if (target.id && settingFieldIds.has(target.id))
            return true;
        if (target.name && settingFieldNames.has(target.name))
            return true;
        return false;
    }
    function shouldDebounceControl(target) {
        return target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'number');
    }
    function scheduleAutoSave(delayMs) {
        if (!hasLoadedSettings)
            return;
        clearPendingSaveTimer();
        setAutosaveState('pending', delayMs > 0 ? '检测到修改，准备自动保存' : '检测到修改，正在自动保存');
        if (delayMs <= 0) {
            persistSettings('auto');
            return;
        }
        pendingSaveTimer = window.setTimeout(function () {
            pendingSaveTimer = null;
            persistSettings('auto');
        }, delayMs);
    }
    function bindAutoSave() {
        document.addEventListener('input', function (event) {
            const target = event.target;
            if (!isSettingsControl(target))
                return;
            if (!shouldDebounceControl(target))
                return;
            scheduleAutoSave(INPUT_SAVE_DEBOUNCE_MS);
        });
        document.addEventListener('change', function (event) {
            const target = event.target;
            if (!isSettingsControl(target))
                return;
            scheduleAutoSave(0);
        });
    }
    // Init all radio groups
    initRadioGroup('filenameRadioGroup');
    initRadioGroup('transcriptRadioGroup');
    initRadioGroup('folderRadioGroup');
    initRadioGroup('imageFormatGroup');
    // --- Export mode radio selection ---
    function updateRadioUI(mode) {
        radioZip.classList.toggle('selected', mode === 'zip');
        radioVault.classList.toggle('selected', mode === 'vault');
        vaultSection.classList.toggle('visible', mode === 'vault');
    }
    radioInputs.forEach(function (input) {
        input.addEventListener('change', function () { updateRadioUI(this.value); });
    });
    radioZip.addEventListener('click', function () {
        radioZip.querySelector('input').checked = true;
        updateRadioUI('zip');
    });
    radioVault.addEventListener('click', function () {
        radioVault.querySelector('input').checked = true;
        updateRadioUI('vault');
    });
    // --- Filename template: show/hide custom input ---
    document.querySelectorAll('input[name="filenameTemplate"]').forEach(function (input) {
        input.addEventListener('change', function () {
            const isCustom = this.value === 'custom';
            customTemplateRow.classList.toggle('visible', isCustom);
            updateFolderHint();
        });
    });
    // --- Folder hint ---
    function updateFolderHint() {
        const tmpl = getEffectiveFilenameTemplate();
        const hasSlash = tmpl.indexOf('/') !== -1;
        folderHint.style.display = hasSlash ? 'block' : 'none';
        const folderRadios = document.querySelectorAll('input[name="folderMode"]');
        folderRadios.forEach(function (r) {
            r.disabled = hasSlash;
            const opt = r.closest('.radio-option');
            opt.style.opacity = hasSlash ? '0.5' : '1';
            opt.style.pointerEvents = hasSlash ? 'none' : '';
        });
    }
    function getEffectiveFilenameTemplate() {
        const val = getRadioGroupValue('filenameTemplate');
        if (val === 'custom') {
            return customTemplate.value.trim() || '{date}-{title}';
        }
        return val || '{date}-{title}';
    }
    customTemplate.addEventListener('input', updateFolderHint);
    // --- Vault status display ---
    function updateVaultStatus() {
        if (!VaultWriterModule.isSupported()) {
            setVaultStatusUI('unsupported', '当前浏览器不支持 File System Access API');
            btnPickVault.disabled = true;
            radioVault.style.opacity = '0.5';
            radioVault.style.pointerEvents = 'none';
            return;
        }
        VaultWriterModule.restoreHandle()
            .then(function (handle) {
            if (handle) {
                setVaultStatusUI('connected', '已连接: ' + VaultWriterModule.getDirectoryName());
                btnGrantPerm.style.display = 'none';
            }
            else if (VaultWriterModule.needsPermission()) {
                setVaultStatusUI('needs-permission', '需要授权: ' + VaultWriterModule.getDirectoryName());
                btnGrantPerm.style.display = '';
            }
            else {
                setVaultStatusUI('not-selected', '未选择 Vault 文件夹');
                btnGrantPerm.style.display = 'none';
            }
        })
            .catch(function () {
            setVaultStatusUI('not-selected', '未选择 Vault 文件夹');
        });
    }
    function setVaultStatusUI(statusClass, text) {
        vaultStatus.className = 'vault-status ' + statusClass;
        vaultStatusText.textContent = text;
    }
    // --- Vault buttons ---
    btnPickVault.addEventListener('click', function () {
        VaultWriterModule.pickDirectory()
            .then(function (handle) {
            if (handle) {
                updateVaultStatus();
                showStatus('success', 'Vault 文件夹已选择: ' + handle.name);
            }
        })
            .catch(function (err) {
            showStatus('error', '选择文件夹失败: ' + err.message);
        });
    });
    btnGrantPerm.addEventListener('click', function () {
        VaultWriterModule.requestPermission().then(function (granted) {
            if (granted) {
                updateVaultStatus();
                showStatus('success', '权限已授予');
            }
            else {
                showStatus('error', '权限授予失败，请重试');
            }
        });
    });
    btnClearVault.addEventListener('click', function () {
        if (!confirm('确定要清除已保存的 Vault 文件夹吗？'))
            return;
        VaultWriterModule.clearHandle().then(function () {
            updateVaultStatus();
            showStatus('success', 'Vault 文件夹已清除');
        });
    });
    // --- Frontmatter field helpers ---
    const fmFieldIds = {
        title: 'fmTitle', created: 'fmCreated', modified: 'fmModified', source: 'fmSource',
        type: 'fmType', tags: 'fmTags', biji_id: 'fmBijiId', exported: 'fmExported',
    };
    function getFrontmatterFields() {
        const fields = {};
        Object.keys(fmFieldIds).forEach(function (key) {
            const el = document.getElementById(fmFieldIds[key]);
            fields[key] = el ? el.checked : true;
        });
        return fields;
    }
    function setFrontmatterFields(fields) {
        Object.keys(fmFieldIds).forEach(function (key) {
            const el = document.getElementById(fmFieldIds[key]);
            if (el)
                el.checked = fields[key] !== false;
        });
    }
    function clampNumber(value, min, max, fallback) {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n))
            return fallback;
        return Math.max(min, Math.min(max, n));
    }
    function collectSettings() {
        const exportModeValue = document.querySelector('input[name="exportMode"]:checked');
        return {
            exportMode: (exportModeValue ? exportModeValue.value : 'zip'),
            vaultSubfolder: vaultSubfolder.value.trim() || DEFAULT_SETTINGS.vaultSubfolder,
            contentFetchConcurrency: clampNumber(contentFetchConcurrency.value, 1, 12, DEFAULT_SETTINGS.contentFetchConcurrency),
            transcriptFetchConcurrency: clampNumber(transcriptFetchConcurrency.value, 1, 12, DEFAULT_SETTINGS.transcriptFetchConcurrency),
            zipExportConcurrencyLight: clampNumber(zipExportConcurrencyLight.value, 1, 12, DEFAULT_SETTINGS.zipExportConcurrencyLight),
            zipExportConcurrencyHeavy: clampNumber(zipExportConcurrencyHeavy.value, 1, 6, DEFAULT_SETTINGS.zipExportConcurrencyHeavy),
            vaultWriteConcurrency: clampNumber(vaultWriteConcurrency.value, 1, 12, DEFAULT_SETTINGS.vaultWriteConcurrency),
            includeAudioLink: includeAudioLink.checked,
            includeImages: includeImages.checked,
            voiceSentenceSplit: voiceSentenceSplit.checked,
            tagPrefix: tagPrefix.value || '#',
            discoveryMode: discoveryMode.checked,
            fetchDelay: Math.max(100, Math.min(5000, parseInt(fetchDelay.value, 10) || 500)),
            scanDepth: Math.max(4, Math.min(20, parseInt(scanDepth.value, 10) || 10)),
            filenameTemplate: getEffectiveFilenameTemplate(),
            dateFormat: dateFormat.value || 'YYYY-MM-DD',
            transcriptMode: (getRadioGroupValue('transcriptMode') || 'none'),
            folderMode: (getRadioGroupValue('folderMode') || 'flat'),
            frontmatterFields: getFrontmatterFields(),
            imageFormat: (getRadioGroupValue('imageFormat') || 'link'),
            enableInjectBtn: enableInjectBtn.checked,
            injectBtnYoutube: injectBtnYoutube.checked,
            injectBtnBilibili: injectBtnBilibili.checked,
            injectBtnXiaoyuzhou: injectBtnXiaoyuzhou.checked,
            feedAutoCheck: feedAutoCheck.checked,
            feedCheckInterval: parseInt(feedCheckInterval.value, 10) || 60,
            feedAutoSubmit: feedAutoSubmit ? feedAutoSubmit.checked : true,
        };
    }
    function persistSettings(source) {
        if (!hasLoadedSettings)
            return;
        if (saveInFlight) {
            queuedSaveSource = source === 'manual' ? 'manual' : (queuedSaveSource || 'auto');
            return;
        }
        clearPendingSaveTimer();
        saveInFlight = true;
        setAutosaveState('saving', source === 'manual' ? '保存中...' : '自动保存中...');
        const settings = collectSettings();
        chrome.storage.local.set({ settings, discoveryMode: settings.discoveryMode }, function () {
            saveInFlight = false;
            if (chrome.runtime.lastError) {
                setAutosaveState('error', '保存失败，请重试');
                showStatus('error', '保存失败: ' + chrome.runtime.lastError.message);
            }
            else {
                setAutosaveState('saved', '已保存 ' + formatSaveTime());
                if (source === 'manual') {
                    showStatus('success', '设置已保存');
                }
            }
            if (queuedSaveSource) {
                const nextSource = queuedSaveSource;
                queuedSaveSource = null;
                persistSettings(nextSource);
            }
        });
    }
    // --- Load settings ---
    function loadSettings() {
        chrome.storage.local.get('settings', function (data) {
            const s = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
            s.frontmatterFields = Object.assign({}, DEFAULT_SETTINGS.frontmatterFields, s.frontmatterFields || {});
            // Export mode
            const modeInput = document.querySelector('input[name="exportMode"][value="' + s.exportMode + '"]');
            if (modeInput) {
                modeInput.checked = true;
                updateRadioUI(s.exportMode);
            }
            // Vault
            vaultSubfolder.value = s.vaultSubfolder;
            contentFetchConcurrency.value = String(s.contentFetchConcurrency);
            transcriptFetchConcurrency.value = String(s.transcriptFetchConcurrency);
            zipExportConcurrencyLight.value = String(s.zipExportConcurrencyLight);
            zipExportConcurrencyHeavy.value = String(s.zipExportConcurrencyHeavy);
            vaultWriteConcurrency.value = String(s.vaultWriteConcurrency);
            // Filename template
            const presets = ['{date}-{title}', '{title}-{date}', '{title}', '{date}/{title}'];
            if (presets.indexOf(s.filenameTemplate) !== -1) {
                setRadioGroupValue('filenameTemplate', s.filenameTemplate);
                customTemplateRow.classList.remove('visible');
            }
            else {
                setRadioGroupValue('filenameTemplate', 'custom');
                customTemplate.value = s.filenameTemplate;
                customTemplateRow.classList.add('visible');
            }
            dateFormat.value = s.dateFormat;
            setRadioGroupValue('transcriptMode', s.transcriptMode);
            setRadioGroupValue('folderMode', s.folderMode);
            setFrontmatterFields(s.frontmatterFields);
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
            if (feedAutoSubmit)
                feedAutoSubmit.checked = s.feedAutoSubmit !== false;
            chrome.storage.local.set({ discoveryMode: s.discoveryMode });
            updateFolderHint();
            hasLoadedSettings = true;
            setAutosaveState('saved', '已加载当前设置');
        });
        updateVaultStatus();
        loadFeedList();
    }
    // --- Save settings ---
    function saveSettings() {
        persistSettings('manual');
    }
    // --- Reset to defaults ---
    function resetSettings() {
        if (!confirm('确定要恢复所有设置为默认值吗？'))
            return;
        clearPendingSaveTimer();
        queuedSaveSource = null;
        chrome.storage.local.set({ settings: DEFAULT_SETTINGS, discoveryMode: DEFAULT_SETTINGS.discoveryMode }, function () {
            hasLoadedSettings = false;
            loadSettings();
            showStatus('success', '设置已恢复为默认值');
        });
    }
    // --- Status messages ---
    function showStatus(type, text) {
        if (statusMsgTimer !== null) {
            window.clearTimeout(statusMsgTimer);
            statusMsgTimer = null;
        }
        statusMsg.className = 'status-msg ' + type;
        statusMsg.textContent = text;
        statusMsg.style.display = 'block';
        statusMsgTimer = window.setTimeout(function () {
            statusMsg.style.display = 'none';
            statusMsgTimer = null;
        }, 3000);
    }
    // --- Feed management UI ---
    function loadFeedList() {
        chrome.runtime.sendMessage({ type: 'getFeeds' }, function (resp) {
            if (chrome.runtime.lastError || !resp)
                return;
            renderFeedList(resp.feeds || []);
        });
    }
    function renderFeedList(feeds) {
        const items = feedList.querySelectorAll('.feed-item');
        items.forEach(function (item) { item.remove(); });
        if (feeds.length === 0) {
            feedEmptyHint.style.display = 'block';
            return;
        }
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
                if (!confirm('确定要删除此订阅源吗？'))
                    return;
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
        if (!url)
            return;
        btnAddFeed.disabled = true;
        chrome.runtime.sendMessage({ type: 'addFeed', url, name: '' }, function (resp) {
            btnAddFeed.disabled = false;
            if (chrome.runtime.lastError) {
                showStatus('error', '添加失败: ' + chrome.runtime.lastError.message);
                return;
            }
            if (resp && resp.ok) {
                feedUrlInput.value = '';
                loadFeedList();
                showStatus('success', '订阅源已添加');
            }
            else {
                showStatus('error', '添加失败: ' + ((resp && resp.error) || '未知错误'));
            }
        });
    });
    // Check feeds now button
    btnCheckFeedsNow.addEventListener('click', function () {
        btnCheckFeedsNow.disabled = true;
        feedCheckStatus.textContent = '检查中...';
        chrome.runtime.sendMessage({ type: 'checkFeedsNow' }, function (resp) {
            btnCheckFeedsNow.disabled = false;
            if (chrome.runtime.lastError) {
                feedCheckStatus.textContent = '检查失败';
                return;
            }
            if (resp && resp.ok) {
                const r = resp.result || {};
                feedCheckStatus.textContent = '已检查 ' + (r.checked || 0) + ' 个源，新提交 ' + (r.newItems || 0) + ' 条';
                loadFeedList();
            }
            else {
                feedCheckStatus.textContent = '检查失败: ' + ((resp && resp.error) || '');
            }
        });
    });
    // --- Event bindings ---
    btnSave.addEventListener('click', saveSettings);
    btnReset.addEventListener('click', resetSettings);
    // --- Init ---
    initTabs();
    bindAutoSave();
    loadSettings();

})();
