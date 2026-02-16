// PDF Converter — generate PDFs from notes
// Extracted from shared.js PDFConverter

import type { Note, Settings } from '../core/types';
import { escapeHtml } from '../core/sanitize';
import { formatDate } from '../core/date-utils';
import { looksLikeMarkdown, mdToHtml } from '../core/markdown-converter';
import { exportNote as serverExportNote } from './server-exporter';
import { fetchAsBase64 } from './image-fetcher';

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
    html += '<div>' + content + '</div>';
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
    const rawContent = note.rawTranscript;
    if (rawContent.includes('<') && rawContent.includes('>')) {
      html += '<div>' + rawContent + '</div>';
    } else {
      html += '<p style="margin: 10px 0;">' +
        escapeHtml(rawContent).replace(/\n/g, '<br>') + '</p>';
    }
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

  const container = document.createElement('div');
  container.innerHTML = htmlContent;
  container.setAttribute('data-pdf-render', '1');
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = '700px';
  container.style.zIndex = '-9999';
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';
  document.body.appendChild(container);

  const containerHeight = container.scrollHeight;
  const containerWidth = container.offsetWidth || 700;

  const opt = {
    margin: [10, 10, 10, 10],
    filename: 'note.pdf',
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: containerWidth,
      windowHeight: containerHeight,
      width: containerWidth,
      height: containerHeight,
      scrollX: 0,
      scrollY: 0,
      onclone: function (clonedDoc: Document) {
        const el = clonedDoc.querySelector('[data-pdf-render]') as HTMLElement;
        if (el) {
          el.style.position = 'static';
          el.style.left = 'auto';
          el.style.top = 'auto';
          el.style.zIndex = 'auto';
          el.style.opacity = '1';
          el.style.width = containerWidth + 'px';
          el.style.minHeight = containerHeight + 'px';
        }
        (clonedDoc.body as HTMLElement).style.width = containerWidth + 'px';
        (clonedDoc.body as HTMLElement).style.minWidth = containerWidth + 'px';
        (clonedDoc.body as HTMLElement).style.minHeight = containerHeight + 'px';
        (clonedDoc.body as HTMLElement).style.overflow = 'visible';
        (clonedDoc.body as HTMLElement).style.background = '#ffffff';
        (clonedDoc.documentElement as HTMLElement).style.width = containerWidth + 'px';
        (clonedDoc.documentElement as HTMLElement).style.minHeight = containerHeight + 'px';
        (clonedDoc.documentElement as HTMLElement).style.overflow = 'visible';
        const h2pContainer = clonedDoc.getElementById('html2pdf__container');
        if (h2pContainer) {
          h2pContainer.style.overflow = 'visible';
          h2pContainer.style.width = '700px';
        }
      },
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };

  return new Promise<void>(resolve => {
    requestAnimationFrame(() => { setTimeout(resolve, 0); });
  }).then(() => {
    return html2pdf().set(opt).from(container).outputPdf('blob').then((blob: Blob) => {
      document.body.removeChild(container);
      if (!blob || blob.size < 1024) {
        throw new Error('Generated PDF appears empty (' + (blob ? blob.size : 0) + ' bytes)');
      }
      return blob;
    }).catch((err: Error) => {
      if (container.parentNode) document.body.removeChild(container);
      throw err;
    });
  });
}

export function generatePdf(note: Note, settings: Settings): Promise<Blob> {
  return serverExportNote(note.id, 'pdf').catch((err: Error) => {
    console.warn('[Biji Ext] Server PDF failed, using local generation:', err.message);
    const noteHtml = noteToHtml(note, settings);
    return _prepareImagesHtml(note, settings).then(imgHtml => {
      return _generateLocalPdf(noteHtml + imgHtml);
    });
  });
}

export function generateTranscriptPdf(note: Note, settings: Settings): Promise<Blob> {
  const content = note.rawTranscript || note.content || '';
  if (!content.trim()) {
    return Promise.reject(new Error('Transcript content is empty'));
  }

  let html =
    "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333;\">";
  html +=
    '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
    escapeHtml(note.title || 'Untitled') + ' — Transcript</h1>';
  if (content.includes('<') && content.includes('>')) {
    html += '<div>' + content + '</div>';
  } else if (looksLikeMarkdown(content)) {
    html += '<div>' + mdToHtml(content) + '</div>';
  } else {
    let text = content.replace(/\r\n/g, '\n');
    let paragraphs = text.split(/\n\n+/);
    if (paragraphs.length <= 1) {
      paragraphs = text.split(/(?<=[。！？.!?])\s*/);
    }
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
