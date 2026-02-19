// Shared constants — single source of truth

import type { Settings } from './types';

export const BIJI_API_BASE = 'https://get-notes.luojilab.com/voicenotes/web/notes';
export const BIJI_EXPORT_API = 'https://get-notes.luojilab.com/voicenotes/web/export/tasks';
export const SUBMIT_API_URL = 'https://get-notes.luojilab.com/voicenotes/web/notes/stream';

export const DEFAULT_SETTINGS: Settings = {
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
