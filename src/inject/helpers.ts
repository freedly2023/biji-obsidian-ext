// Shared helpers for inject modules (page context)

export const PREFIX = '[Biji Ext]';
const DEBUG_SCAN = false;

export function log(...args: any[]): void {
  if (!DEBUG_SCAN) return;
  console.log(PREFIX, ...args);
}

export function postToExtension(type: string, payload: any): void {
  window.dispatchEvent(
    new CustomEvent('biji-ext-data', {
      detail: JSON.stringify({ type, payload }),
    })
  );
}
