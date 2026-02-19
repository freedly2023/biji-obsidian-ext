// PDF Converter — generate PDFs from notes
// Extracted from shared.js PDFConverter

import type { Note, Settings } from '../core/types';
import { escapeHtml, htmlToText, stripHtml, normalizeTranscript } from '../core/sanitize';
import { formatDate } from '../core/date-utils';
import { looksLikeMarkdown, mdToHtml } from '../core/markdown-converter';
import { exportNote as serverExportNote } from './server-exporter';
import { fetchAsBase64 } from './image-fetcher';

function looksLikeHtmlFragment(text: string): boolean {
  if (!text) return false;
  if (text.indexOf('<') === -1 || text.indexOf('>') === -1) return false;
  return /<\/?[a-z][\w:-]*(\s[^>]*)?>/i.test(text);
}

export function noteToHtml(note: Note, settings: Settings): string {
  let html =
    "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333;\">";

  if (note.title) {
    html +=
      '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
      escapeHtml(note.title) + '</h1>';
  }

  const date = formatDate(note.createdAt);
  if (date) {
    html +=
      '<div style="font-size: 12px; color: #888; margin-bottom: 16px;">' +
      escapeHtml(date) + ' | ' + escapeHtml(note.type || 'text') + '</div>';
  }

  const content = note.content || '';
  if (content.includes('<') && content.includes('>')) {
    const cleaned = htmlToText(content);
    const text = (cleaned || content).replace(/\r\n/g, '\n');
    const paragraphs = text.split(/\n\n+/);
    paragraphs.forEach(p => {
      if (p.trim()) {
        html += '<p style="margin: 10px 0;">' +
          escapeHtml(p.trim()).replace(/\n/g, '<br>') + '</p>';
      }
    });
  } else if (looksLikeMarkdown(content)) {
    html += '<div>' + mdToHtml(content) + '</div>';
  } else {
    let text = content.replace(/\r\n/g, '\n');
    const paragraphs = text.split(/\n\n+/);
    paragraphs.forEach(p => {
      if (p.trim()) {
        html += '<p style="margin: 10px 0;">' +
          escapeHtml(p.trim()).replace(/\n/g, '<br>') + '</p>';
      }
    });
  }

  if (note.audioUrl && settings.includeAudioLink !== false) {
    html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
    html += '<p><strong>录音</strong>: <a href="' + escapeHtml(note.audioUrl) + '">收听</a></p>';
  }

  if (settings.transcriptMode === 'merged' && note.rawTranscript) {
    html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
    html += '<h2 style="font-size: 16px; margin-bottom: 12px;">原始文字记录</h2>';
    const rawContent = normalizeTranscript(note.rawTranscript);
    html += '<p style="margin: 10px 0;">' +
      escapeHtml(rawContent).replace(/\n/g, '<br>') + '</p>';
  }

  html += '</div>';
  return html;
}

function _prepareImagesHtml(note: Note, settings: Settings): Promise<string> {
  if (!note.images || note.images.length === 0 || settings.includeImages === false) {
    return Promise.resolve('');
  }
  const urls = note.images
    .map(img => typeof img === 'string' ? img : (img as any).url || (img as any).src || '')
    .filter(Boolean);
  if (urls.length === 0) return Promise.resolve('');

  return Promise.all(
    urls.map(url => fetchAsBase64(url).catch(() => null)),
  ).then(base64Results => {
    let html = '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
    html += '<h2 style="font-size: 16px; margin-bottom: 12px;">图片</h2>';
    base64Results.forEach(b64 => {
      if (b64) {
        html += '<img src="' + b64 + '" style="max-width: 100%; margin: 8px 0; border-radius: 4px;">';
      }
    });
    return html;
  });
}

function _generateLocalPdf(htmlContent: string): Promise<Blob> {
  if (typeof html2pdf === 'undefined') {
    return Promise.reject(new Error('html2pdf library not loaded'));
  }

  const opt = {
    margin: [10, 10, 10, 10],
    filename: 'note.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  function run(worker: any, sourceLabel: string): Promise<Blob> {
    const getBlob = (worker && typeof worker.toPdf === 'function')
      ? worker.toPdf().output('blob')
      : (worker && typeof worker.outputPdf === 'function')
        ? worker.outputPdf('blob')
        : (worker && typeof worker.output === 'function')
          ? worker.output('blob')
          : Promise.reject(new Error('html2pdf output API not available'));
    return Promise.resolve(getBlob).then((blob: Blob) => {
      if (!blob || blob.size < 1024) {
        throw new Error('Generated PDF appears empty via ' + sourceLabel + ' (' + (blob ? blob.size : 0) + ' bytes)');
      }
      console.info('[Biji Ext] Transcript PDF generated via', sourceLabel, 'size:', blob.size);
      return blob;
    });
  }

  function renderFromString(): Promise<Blob> {
    try {
      const worker = (html2pdf() as any).set(opt).from(htmlContent, 'string');
      return run(worker, 'string');
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function renderFromDomContainer(): Promise<Blob> {
    const container = document.createElement('div');
    container.innerHTML = htmlContent;
    container.setAttribute('data-pdf-render', '1');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '700px';
    container.style.zIndex = '-1';
    container.style.pointerEvents = 'none';
    container.style.background = '#ffffff';
    container.style.color = '#333';
    document.body.appendChild(container);

    const cleanup = () => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };

    return new Promise<void>(resolve => {
      requestAnimationFrame(() => { setTimeout(resolve, 50); });
    }).then(() => {
      const containerHeight = container.scrollHeight;
      if (containerHeight === 0) {
        cleanup();
        return Promise.reject(new Error('Container height is 0'));
      }
      const worker = (html2pdf() as any).set(opt).from(container);
      return run(worker, 'dom').finally(cleanup);
    }).catch((err: Error) => {
      cleanup();
      throw err;
    });
  }

  return renderFromString().catch((firstErr: Error) => {
    console.warn('[Biji Ext] html2pdf string source failed, fallback to DOM container:', firstErr.message);
    return renderFromDomContainer();
  });
}

export function generatePdf(note: Note, settings: Settings): Promise<Blob> {
  const needLocalTranscript = settings.transcriptMode === 'merged' && note.rawTranscript;
  if (needLocalTranscript) {
    const noteHtml = noteToHtml(note, settings);
    return _prepareImagesHtml(note, settings).then(imgHtml => {
      return _generateLocalPdf(noteHtml + imgHtml);
    });
  }
  return serverExportNote(note.id, 'pdf').catch((err: Error) => {
    console.warn('[Biji Ext] Server PDF failed, using local generation:', err.message);
    const noteHtml = noteToHtml(note, settings);
    return _prepareImagesHtml(note, settings).then(imgHtml => {
      return _generateLocalPdf(noteHtml + imgHtml);
    });
  });
}

export function generateTranscriptPdf(note: Note, settings: Settings): Promise<Blob> {
  let content = normalizeTranscript(note.rawTranscript || '') || note.content || '';
  if (!content.trim()) {
    return Promise.reject(new Error('Transcript content is empty'));
  }

  let html =
    "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333;\">";
  html +=
    '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
    escapeHtml(note.title || 'Untitled') + ' — Transcript</h1>';
  // Avoid stripping normal text like "<音乐>" unless it really looks like HTML tags.
  if (looksLikeHtmlFragment(content)) {
    content = htmlToText(content) || stripHtml(content) || content;
  }
  if (looksLikeMarkdown(content)) {
    html += '<div>' + mdToHtml(content) + '</div>';
  } else {
    let text = content.replace(/\r\n/g, '\n');
    if (note.type === 'voice' && settings.voiceSentenceSplit !== false) {
      text = text.replace(/([。！？.!?])\s*/g, '$1\n\n');
    }
    const paragraphs = text.split(/\n\n+/);
    paragraphs.forEach(p => {
      if (p.trim()) {
        html += '<p style="margin: 10px 0;">' +
          escapeHtml(p.trim()).replace(/\n/g, '<br>') + '</p>';
      }
    });
  }
  html += '</div>';
  return _generateLocalPdf(html);
}

export const PDFConverter = { noteToHtml, generatePdf, generateTranscriptPdf };
