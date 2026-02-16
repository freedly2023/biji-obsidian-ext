// Image Fetcher — fetch images as ArrayBuffer or Base64
// Extracted from shared.js ImageFetcher

interface ImageCacheEntry {
  arrayBuffer?: ArrayBuffer;
  width?: number;
  height?: number;
  blob?: Blob;
  base64?: string;
}

const _cache: Record<string, ImageCacheEntry> = {};

export function fetchAsArrayBuffer(
  url: string,
): Promise<{ arrayBuffer: ArrayBuffer; width: number; height: number; blob: Blob }> {
  if (_cache[url] && _cache[url].arrayBuffer) {
    return Promise.resolve(_cache[url] as any);
  }
  return fetch(url)
    .then(res => {
      if (!res.ok) throw new Error('Image fetch failed: ' + res.status);
      return res.arrayBuffer();
    })
    .then(buf => {
      return new Promise(resolve => {
        const blob = new Blob([buf]);
        const img = new Image();
        img.onload = function () {
          const result = {
            arrayBuffer: buf,
            width: img.naturalWidth,
            height: img.naturalHeight,
            blob: blob,
          };
          _cache[url] = result;
          URL.revokeObjectURL(img.src);
          resolve(result);
        };
        img.onerror = function () {
          const result = { arrayBuffer: buf, width: 400, height: 300, blob: blob };
          _cache[url] = result;
          URL.revokeObjectURL(img.src);
          resolve(result);
        };
        img.src = URL.createObjectURL(blob);
      });
    });
}

export function fetchAsBase64(url: string): Promise<string> {
  if (_cache[url] && _cache[url].base64) {
    return Promise.resolve(_cache[url].base64!);
  }
  return fetch(url)
    .then(res => {
      if (!res.ok) throw new Error('Image fetch failed: ' + res.status);
      return res.blob();
    })
    .then(blob => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = function () {
          const base64 = reader.result as string;
          if (!_cache[url]) _cache[url] = {};
          _cache[url].base64 = base64;
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    });
}

export function clearCache(): void {
  for (const key of Object.keys(_cache)) {
    delete _cache[key];
  }
}

export const ImageFetcher = { fetchAsArrayBuffer, fetchAsBase64, clearCache };
