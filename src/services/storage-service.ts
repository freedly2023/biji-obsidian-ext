// chrome.storage.local Promise wrappers

export function storageGet(keys: string | string[]): Promise<Record<string, any>> {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, resolve);
  });
}

export function storageSet(items: Record<string, any>): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.set(items, resolve);
  });
}

export function storageRemove(keys: string | string[]): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.remove(keys, resolve);
  });
}
