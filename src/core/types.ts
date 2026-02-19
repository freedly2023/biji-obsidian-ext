// Core type definitions for Biji to Obsidian extension

export interface FrontmatterFields {
  title: boolean;
  created: boolean;
  modified: boolean;
  source: boolean;
  type: boolean;
  tags: boolean;
  biji_id: boolean;
  exported: boolean;
}

export interface Settings {
  filenameTemplate: string;
  dateFormat: string;
  transcriptMode: 'none' | 'merged' | 'separate';
  folderMode: 'flat' | 'byType' | 'byTag' | 'byMonth';
  frontmatterFields: FrontmatterFields;
  imageFormat: 'link' | 'obsidian';
  includeAudioLink: boolean;
  includeImages: boolean;
  voiceSentenceSplit: boolean;
  tagPrefix: string;
  // Export
  exportMode: 'zip' | 'vault';
  vaultSubfolder: string;
  contentFetchConcurrency: number;
  transcriptFetchConcurrency: number;
  zipExportConcurrencyLight: number;
  zipExportConcurrencyHeavy: number;
  vaultWriteConcurrency: number;
  // Advanced
  discoveryMode: boolean;
  fetchDelay: number;
  scanDepth: number;
  // Link submission buttons
  enableInjectBtn: boolean;
  injectBtnYoutube: boolean;
  injectBtnBilibili: boolean;
  injectBtnXiaoyuzhou: boolean;
  // Feed management
  feedAutoCheck: boolean;
  feedCheckInterval: number;
  feedAutoSubmit: boolean;
}

export interface Tag {
  name?: string;
  label?: string;
}

export interface NoteImage {
  url?: string;
  src?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  rawTranscript: string | null;
  createdAt: string | number;
  updatedAt: string | number;
  tags: (string | Tag)[];
  noteType: string | null;
  type: string;
  audioUrl: string | null;
  images: (string | NoteImage)[];
}

export interface Feed {
  id: string;
  url: string;
  name: string;
  enabled: boolean;
  addedAt: string;
  lastChecked: string | null;
  type: 'youtube' | 'podcast' | 'bilibili' | 'other';
  channelName: string;
}

export interface FeedItem {
  guid: string;
  feedId: string;
  title: string;
  url: string;
  pubDate: string;
  description: string;
  thumbnail: string;
  duration: string;
  enclosureUrl: string;
  status: 'new' | 'submitted' | 'noted' | 'submitting';
  noteId?: string;
}

export interface FeedItemFilter {
  feedId?: string;
  status?: 'new' | 'submitted' | 'noted';
}

export interface DateParts {
  date: string;
  year: string;
  month: string;
}
