// Settings loader — async version of window.loadSettings

import type { Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/constants';
import { storageGet } from './storage-service';

export async function loadSettings(): Promise<Settings> {
  const data = await storageGet('settings');
  return Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
}

// Callback-based version for backward compatibility with existing JS
export function loadSettingsCb(cb: (settings: Settings) => void): void {
  chrome.storage.local.get('settings', function (data: Record<string, any>) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {}) as Settings;
    if (cb) cb(settings);
  });
}
