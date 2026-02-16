// Server Exporter — export notes via biji.com API (PDF/DOCX)
// Extracted from shared.js ServerExporter

export function exportNote(noteId: string, format: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'exportNote', noteId, format },
      (response: any) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Message failed'));
          return;
        }
        if (!response || response.error) {
          reject(new Error((response && response.error) || 'Export failed'));
          return;
        }
        fetch(response.access_url)
          .then(res => {
            if (!res.ok) throw new Error('Download failed: ' + res.status);
            return res.blob();
          })
          .then(resolve)
          .catch(reject);
      },
    );
  });
}

export const ServerExporter = { exportNote };
