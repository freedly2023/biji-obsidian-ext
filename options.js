// options.js — Settings page logic

(function () {
  'use strict';

  // Default settings
  var DEFAULTS = {
    exportMode: 'zip',
    vaultSubfolder: 'biji-notes',
    includeAudioLink: true,
    includeImages: true,
    voiceSentenceSplit: true,
    tagPrefix: '#',
    discoveryMode: false,
    fetchDelay: 500,
    scanDepth: 10,
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
  };

  // DOM references — existing
  var radioZip = document.getElementById('radioZip');
  var radioVault = document.getElementById('radioVault');
  var radioInputs = document.querySelectorAll('input[name="exportMode"]');
  var vaultSection = document.getElementById('vaultSection');
  var vaultStatus = document.getElementById('vaultStatus');
  var vaultStatusText = document.getElementById('vaultStatusText');
  var btnPickVault = document.getElementById('btnPickVault');
  var btnGrantPerm = document.getElementById('btnGrantPerm');
  var btnClearVault = document.getElementById('btnClearVault');
  var vaultSubfolder = document.getElementById('vaultSubfolder');
  var includeAudioLink = document.getElementById('includeAudioLink');
  var includeImages = document.getElementById('includeImages');
  var voiceSentenceSplit = document.getElementById('voiceSentenceSplit');
  var tagPrefix = document.getElementById('tagPrefix');
  var discoveryMode = document.getElementById('discoveryMode');
  var fetchDelay = document.getElementById('fetchDelay');
  var scanDepth = document.getElementById('scanDepth');
  var btnSave = document.getElementById('btnSave');
  var btnReset = document.getElementById('btnReset');
  var statusMsg = document.getElementById('statusMsg');

  // DOM references — new
  var dateFormat = document.getElementById('dateFormat');
  var customTemplateRow = document.getElementById('customTemplateRow');
  var customTemplate = document.getElementById('customTemplate');
  var folderHint = document.getElementById('folderHint');

  // --- Generic radio group handler ---
  // Makes radio-option labels toggle .selected class on click
  function initRadioGroup(groupId, name) {
    var container = document.getElementById(groupId);
    if (!container) return;
    var options = container.querySelectorAll('.radio-option');
    options.forEach(function (opt) {
      opt.addEventListener('click', function () {
        var radio = opt.querySelector('input[type="radio"]');
        if (radio) {
          radio.checked = true;
          options.forEach(function (o) {
            o.classList.remove('selected');
          });
          opt.classList.add('selected');
          // Trigger change event for dependent logic
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
  }

  function setRadioGroupValue(name, value) {
    var input = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (input) {
      input.checked = true;
      // Update UI
      var group = input.closest('.radio-group');
      if (group) {
        group.querySelectorAll('.radio-option').forEach(function (o) {
          o.classList.toggle('selected', o.contains(input));
        });
      }
    }
  }

  function getRadioGroupValue(name) {
    var checked = document.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : null;
  }

  // Init all radio groups
  initRadioGroup('filenameRadioGroup', 'filenameTemplate');
  initRadioGroup('transcriptRadioGroup', 'transcriptMode');
  initRadioGroup('folderRadioGroup', 'folderMode');
  initRadioGroup('imageFormatGroup', 'imageFormat');

  // --- Export mode radio selection ---
  function updateRadioUI(mode) {
    radioZip.classList.toggle('selected', mode === 'zip');
    radioVault.classList.toggle('selected', mode === 'vault');
    vaultSection.classList.toggle('visible', mode === 'vault');
  }

  radioInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      updateRadioUI(this.value);
    });
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
      var isCustom = this.value === 'custom';
      customTemplateRow.classList.toggle('visible', isCustom);
      updateFolderHint();
    });
  });

  // --- Folder hint: show when filename template has '/' ---
  function updateFolderHint() {
    var tmpl = getEffectiveFilenameTemplate();
    var hasSlash = tmpl.indexOf('/') !== -1;
    folderHint.style.display = hasSlash ? 'block' : 'none';
    // Disable folder radios if template has slash
    var folderRadios = document.querySelectorAll('input[name="folderMode"]');
    folderRadios.forEach(function (r) {
      r.disabled = hasSlash;
      r.closest('.radio-option').style.opacity = hasSlash ? '0.5' : '1';
      r.closest('.radio-option').style.pointerEvents = hasSlash ? 'none' : '';
    });
  }

  function getEffectiveFilenameTemplate() {
    var val = getRadioGroupValue('filenameTemplate');
    if (val === 'custom') {
      return customTemplate.value.trim() || '{date}-{title}';
    }
    return val || '{date}-{title}';
  }

  customTemplate.addEventListener('input', updateFolderHint);

  // --- Vault status display ---
  function updateVaultStatus() {
    if (typeof VaultWriter === 'undefined') {
      setVaultStatusUI('unsupported', 'VaultWriter 模块未加载');
      btnPickVault.disabled = true;
      return;
    }

    if (!VaultWriter.isSupported()) {
      setVaultStatusUI('unsupported', '当前浏览器不支持 File System Access API');
      btnPickVault.disabled = true;
      radioVault.style.opacity = '0.5';
      radioVault.style.pointerEvents = 'none';
      return;
    }

    VaultWriter.restoreHandle()
      .then(function (handle) {
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

  function setVaultStatusUI(statusClass, text) {
    vaultStatus.className = 'vault-status ' + statusClass;
    vaultStatusText.textContent = text;
  }

  // --- Vault buttons ---
  btnPickVault.addEventListener('click', function () {
    if (typeof VaultWriter === 'undefined') return;
    VaultWriter.pickDirectory()
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
    if (typeof VaultWriter === 'undefined') return;
    VaultWriter.requestPermission().then(function (granted) {
      if (granted) {
        updateVaultStatus();
        showStatus('success', '权限已授予');
      } else {
        showStatus('error', '权限授予失败，请重试');
      }
    });
  });

  btnClearVault.addEventListener('click', function () {
    if (typeof VaultWriter === 'undefined') return;
    if (!confirm('确定要清除已保存的 Vault 文件夹吗？')) return;
    VaultWriter.clearHandle().then(function () {
      updateVaultStatus();
      showStatus('success', 'Vault 文件夹已清除');
    });
  });

  // --- Frontmatter field helpers ---
  var fmFieldIds = {
    title: 'fmTitle',
    created: 'fmCreated',
    modified: 'fmModified',
    source: 'fmSource',
    type: 'fmType',
    tags: 'fmTags',
    biji_id: 'fmBijiId',
    exported: 'fmExported',
  };

  function getFrontmatterFields() {
    var fields = {};
    Object.keys(fmFieldIds).forEach(function (key) {
      var el = document.getElementById(fmFieldIds[key]);
      fields[key] = el ? el.checked : true;
    });
    return fields;
  }

  function setFrontmatterFields(fields) {
    Object.keys(fmFieldIds).forEach(function (key) {
      var el = document.getElementById(fmFieldIds[key]);
      if (el) el.checked = fields[key] !== false;
    });
  }

  // --- Load settings ---
  function loadSettings() {
    chrome.storage.local.get('settings', function (data) {
      var s = Object.assign({}, DEFAULTS, data.settings || {});
      // Deep merge frontmatterFields
      s.frontmatterFields = Object.assign(
        {},
        DEFAULTS.frontmatterFields,
        s.frontmatterFields || {}
      );

      // Export mode
      var modeInput = document.querySelector(
        'input[name="exportMode"][value="' + s.exportMode + '"]'
      );
      if (modeInput) {
        modeInput.checked = true;
        updateRadioUI(s.exportMode);
      }

      // Vault
      vaultSubfolder.value = s.vaultSubfolder;

      // Filename template
      var presets = ['{date}-{title}', '{title}-{date}', '{title}', '{date}/{title}'];
      if (presets.indexOf(s.filenameTemplate) !== -1) {
        setRadioGroupValue('filenameTemplate', s.filenameTemplate);
        customTemplateRow.classList.remove('visible');
      } else {
        setRadioGroupValue('filenameTemplate', 'custom');
        customTemplate.value = s.filenameTemplate;
        customTemplateRow.classList.add('visible');
      }

      // Date format
      dateFormat.value = s.dateFormat;

      // Transcript mode
      setRadioGroupValue('transcriptMode', s.transcriptMode);

      // Folder mode
      setRadioGroupValue('folderMode', s.folderMode);

      // Frontmatter fields
      setFrontmatterFields(s.frontmatterFields);

      // Image format
      setRadioGroupValue('imageFormat', s.imageFormat);

      // Export preferences
      includeAudioLink.checked = s.includeAudioLink;
      includeImages.checked = s.includeImages;
      voiceSentenceSplit.checked = s.voiceSentenceSplit;
      tagPrefix.value = s.tagPrefix;

      // Advanced
      discoveryMode.checked = s.discoveryMode;
      fetchDelay.value = s.fetchDelay;
      scanDepth.value = s.scanDepth;

      // Also sync the legacy discoveryMode key used by popup
      chrome.storage.local.set({ discoveryMode: s.discoveryMode });

      // Update dependent UI
      updateFolderHint();
    });

    updateVaultStatus();
  }

  // --- Save settings ---
  function saveSettings() {
    var exportModeValue = document.querySelector('input[name="exportMode"]:checked');
    var settings = {
      exportMode: exportModeValue ? exportModeValue.value : 'zip',
      vaultSubfolder: vaultSubfolder.value.trim() || DEFAULTS.vaultSubfolder,
      includeAudioLink: includeAudioLink.checked,
      includeImages: includeImages.checked,
      voiceSentenceSplit: voiceSentenceSplit.checked,
      tagPrefix: tagPrefix.value || '#',
      discoveryMode: discoveryMode.checked,
      fetchDelay: Math.max(100, Math.min(5000, parseInt(fetchDelay.value, 10) || 500)),
      scanDepth: Math.max(4, Math.min(20, parseInt(scanDepth.value, 10) || 10)),
      filenameTemplate: getEffectiveFilenameTemplate(),
      dateFormat: dateFormat.value || 'YYYY-MM-DD',
      transcriptMode: getRadioGroupValue('transcriptMode') || 'none',
      folderMode: getRadioGroupValue('folderMode') || 'flat',
      frontmatterFields: getFrontmatterFields(),
      imageFormat: getRadioGroupValue('imageFormat') || 'link',
    };

    chrome.storage.local.set(
      { settings: settings, discoveryMode: settings.discoveryMode },
      function () {
        showStatus('success', '设置已保存');
      }
    );
  }

  // --- Reset to defaults ---
  function resetSettings() {
    if (!confirm('确定要恢复所有设置为默认值吗？')) return;
    chrome.storage.local.set(
      { settings: DEFAULTS, discoveryMode: DEFAULTS.discoveryMode },
      function () {
        loadSettings();
        showStatus('success', '设置已恢复为默认值');
      }
    );
  }

  // --- Status messages ---
  function showStatus(type, text) {
    statusMsg.className = 'status-msg ' + type;
    statusMsg.textContent = text;
    statusMsg.style.display = 'block';
    setTimeout(function () {
      statusMsg.style.display = 'none';
    }, 3000);
  }

  // --- Event bindings ---
  btnSave.addEventListener('click', saveSettings);
  btnReset.addEventListener('click', resetSettings);

  // --- Init ---
  loadSettings();
})();
