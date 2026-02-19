// PDF Converter — generate PDFs from notes
// Extracted from shared.js PDFConverter

import type { Note, Settings } from '../core/types';
import { escapeHtml, htmlToText, stripHtml, normalizeTranscript } from '../core/sanitize';
import { formatDate } from '../core/date-utils';
import { looksLikeMarkdown, mdToHtml, htmlToMd } from '../core/markdown-converter';
import { exportNote as serverExportNote } from './server-exporter';
import { fetchAsBase64 } from './image-fetcher';

const PDF_LIGHTWEIGHT = {
  html2canvasScale: 1.35,
  html2pdfJpegQuality: 0.82,
  canvasJpegQuality: 0.82,
  jsPdfCompress: true,
} as const;

const PDF_RENDER_SAFETY = {
  bottomReservePx: 24,
  lineDescentPadPx: 4,
  htmlBottomPadPx: 24,
} as const;

function looksLikeHtmlFragment(text: string): boolean {
  if (!text) return false;
  if (text.indexOf('<') === -1 || text.indexOf('>') === -1) return false;
  return /<\/?[a-z][\w:-]*(\s[^>]*)?>/i.test(text);
}

function stripInlineMarkdown(text: string): string {
  if (!text) return '';
  let out = text;
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string) => {
    const label = (alt || '').trim();
    return label ? '[图片] ' + label : '[图片]';
  });
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  out = out.replace(/`([^`]+)`/g, '$1');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/\*([^*\n]+)\*/g, '$1');
  out = out.replace(/_([^_\n]+)_/g, '$1');
  out = out.replace(/~~([^~]+)~~/g, '$1');
  return out;
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /\|/.test(trimmed) && trimmed.replace(/\|/g, '').trim().length > 0;
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());
}

function splitMarkdownTableRow(line: string): string[] {
  let raw = line.trim();
  if (raw.startsWith('|')) raw = raw.slice(1);
  if (raw.endsWith('|')) raw = raw.slice(0, -1);
  return raw.split('|').map(cell => stripInlineMarkdown(cell.trim()));
}

function textDisplayWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    width += code > 255 ? 2 : 1;
  }
  return width;
}

function padDisplayText(text: string, width: number): string {
  const delta = Math.max(0, width - textDisplayWidth(text));
  return text + ' '.repeat(delta);
}

function renderTableText(rows: string[][]): string[] {
  if (!rows || rows.length === 0) return [];
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const normalized = rows.map(r => {
    const out = r.slice(0, colCount);
    while (out.length < colCount) out.push('');
    return out;
  });
  const colWidths = Array(colCount).fill(0);
  normalized.forEach(r => {
    r.forEach((cell, idx) => {
      colWidths[idx] = Math.max(colWidths[idx], textDisplayWidth(cell));
    });
  });

  const makeBorder = (left: string, mid: string, right: string): string =>
    left + colWidths.map(w => '─'.repeat(w + 2)).join(mid) + right;

  const lines: string[] = [];
  lines.push(makeBorder('┌', '┬', '┐'));
  normalized.forEach((row, idx) => {
    const rowLine = '│ ' + row.map((cell, i) => padDisplayText(cell, colWidths[i])).join(' │ ') + ' │';
    lines.push(rowLine);
    if (idx === 0 && normalized.length > 1) {
      lines.push(makeBorder('├', '┼', '┤'));
    }
  });
  lines.push(makeBorder('└', '┴', '┘'));
  return lines;
}

function markdownToReadableText(md: string): string {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const rendered: string[] = [];
  let inCodeFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      rendered.push('');
      continue;
    }

    if (inCodeFence) {
      rendered.push(line);
      continue;
    }

    if (!trimmed) {
      rendered.push('');
      continue;
    }

    if (
      i + 1 < lines.length &&
      isMarkdownTableRow(line) &&
      isMarkdownTableSeparator(lines[i + 1])
    ) {
      const tableRows: string[][] = [splitMarkdownTableRow(line)];
      i += 2;
      while (i < lines.length && isMarkdownTableRow(lines[i])) {
        tableRows.push(splitMarkdownTableRow(lines[i]));
        i++;
      }
      i -= 1;
      renderTableText(tableRows).forEach(tl => rendered.push(tl));
      rendered.push('');
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      rendered.push(stripInlineMarkdown(headingMatch[2]).trim());
      rendered.push('');
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      rendered.push('────────────────');
      rendered.push('');
      continue;
    }

    const quoteMatch = /^>\s+(.+)$/.exec(line);
    if (quoteMatch) {
      rendered.push('“' + stripInlineMarkdown(quoteMatch[1]).trim() + '”');
      continue;
    }

    const orderedMatch = /^(\s*)(\d+)\.\s+(.+)$/.exec(line);
    if (orderedMatch) {
      rendered.push((orderedMatch[1] || '') + orderedMatch[2] + '. ' + stripInlineMarkdown(orderedMatch[3]).trim());
      continue;
    }

    const unorderedMatch = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    if (unorderedMatch) {
      rendered.push((unorderedMatch[1] || '') + '• ' + stripInlineMarkdown(unorderedMatch[2]).trim());
      continue;
    }

    rendered.push(stripInlineMarkdown(line));
  }

  return rendered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeRenderableText(raw: string): string {
  if (!raw) return '';
  if (looksLikeHtmlFragment(raw)) {
    const md = htmlToMd(raw);
    const readable = markdownToReadableText(md);
    return readable || htmlToText(raw) || stripHtml(raw) || raw;
  }
  if (looksLikeMarkdown(raw)) {
    return markdownToReadableText(raw);
  }
  return raw;
}

function softWrapLongTokens(text: string): string {
  if (!text) return '';
  return text
    .split(/(\s+)/)
    .map(token => {
      if (!token || /\s+/.test(token) || token.length <= 64) return token;
      const parts = token.match(/.{1,32}/g);
      return parts ? parts.join('\u200B') : token;
    })
    .join('');
}

function textToParagraphsHtml(text: string, splitSentences = false): string {
  if (!text) return '';
  let normalized = text.replace(/\r\n/g, '\n');
  if (splitSentences) {
    normalized = normalized.replace(/([。！？.!?])\s*/g, '$1\n\n');
  }
  const paragraphs = normalized.split(/\n\n+/);
  let html = '';
  paragraphs.forEach(p => {
    if (p.trim()) {
      const wrapped = softWrapLongTokens(p.trim());
      if (/[┌┬┐├┼┤└┴┘│]/.test(wrapped)) {
        html += '<pre style="margin: 10px 0; white-space: pre-wrap; font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.6;">' +
          escapeHtml(wrapped) + '</pre>';
      } else {
        html += '<p style="margin: 10px 0;">' +
          escapeHtml(wrapped).replace(/\n/g, '<br>') + '</p>';
      }
    }
  });
  return html;
}

function buildMergedPdfHtml(note: Note, settings: Settings): string {
  let html =
    "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; width: 700px; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333; word-break: break-word; overflow-wrap: anywhere;\">";

  html +=
    '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
    escapeHtml(note.title || 'Untitled') + '</h1>';

  const date = formatDate(note.createdAt);
  if (date) {
    html +=
      '<div style="font-size: 12px; color: #888; margin-bottom: 16px;">' +
      escapeHtml(date) + ' | ' + escapeHtml(note.type || 'text') + '</div>';
  }

  let main = normalizeRenderableText(note.content || '');
  html += textToParagraphsHtml(main, note.type === 'voice' && settings.voiceSentenceSplit !== false);

  if (note.audioUrl && settings.includeAudioLink !== false) {
    html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
    html += '<p style="margin: 10px 0;"><strong>录音</strong>: ' + escapeHtml(note.audioUrl) + '</p>';
  }

  const raw = normalizeTranscript(note.rawTranscript || '');
  if (raw.trim()) {
    html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
    html += '<h2 style="font-size: 16px; margin-bottom: 12px;">原始文字记录</h2>';
    html += textToParagraphsHtml(raw, false);
  }

  html += '</div>';
  return html;
}

function wrapTextByWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxWidthPx) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

async function _createA4PdfInstance(): Promise<any> {
  const jsPdfCtor = (window as any).jspdf?.jsPDF || (window as any).jsPDF;
  if (jsPdfCtor) {
    return new jsPdfCtor({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: PDF_LIGHTWEIGHT.jsPdfCompress,
    });
  }

  if (typeof html2pdf === 'undefined') {
    throw new Error('html2pdf library not loaded');
  }

  const seedOpt = {
    margin: [0, 0, 0, 0],
    filename: 'seed.pdf',
    image: { type: 'jpeg', quality: PDF_LIGHTWEIGHT.html2pdfJpegQuality },
    html2canvas: {
      scale: PDF_LIGHTWEIGHT.html2canvasScale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: PDF_LIGHTWEIGHT.jsPdfCompress,
    },
  };

  const seedWorker = (html2pdf() as any)
    .set(seedOpt)
    .from('<div style="width:1px;height:1px;overflow:hidden;">.</div>', 'string');
  const seeded = (seedWorker && typeof seedWorker.toPdf === 'function')
    ? seedWorker.toPdf()
    : seedWorker;
  const pdf = (seeded && typeof seeded.get === 'function')
    ? await Promise.resolve(seeded.get('pdf'))
    : seeded && seeded.prop && seeded.prop.pdf
      ? seeded.prop.pdf
      : null;

  if (!pdf) {
    throw new Error('Failed to resolve jsPDF from html2pdf worker');
  }

  const pageCount = (pdf.internal && typeof pdf.internal.getNumberOfPages === 'function')
    ? pdf.internal.getNumberOfPages()
    : 0;
  if (pageCount > 1 && typeof pdf.deletePage === 'function') {
    for (let i = pageCount; i > 1; i--) pdf.deletePage(i);
  }
  if (pageCount === 0 && typeof pdf.addPage === 'function') {
    pdf.addPage();
  }
  if (typeof pdf.setPage === 'function') {
    pdf.setPage(1);
  }

  return pdf;
}

async function _generateMergedPdfByCanvas(
  note: Note,
  settings: Settings,
  opts?: { logPrefix?: string },
): Promise<Blob> {
  const logPrefix = opts && opts.logPrefix ? opts.logPrefix : 'Merged PDF';

  function toPlainText(raw: string): string {
    return normalizeRenderableText(raw);
  }

  const mainTextRaw = toPlainText(note.content || '');
  let mainText = mainTextRaw.replace(/\r\n/g, '\n');
  if (note.type === 'voice' && settings.voiceSentenceSplit !== false) {
    mainText = mainText.replace(/([。！？.!?])\s*/g, '$1\n\n');
  }
  const transcriptText = normalizeTranscript(note.rawTranscript || '').replace(/\r\n/g, '\n');

  const pageWidthPx = 1240;
  const pageHeightPx = 1754;
  const marginPx = 72;
  const maxTextWidthPx = pageWidthPx - marginPx * 2;
  const maxY = pageHeightPx - marginPx - PDF_RENDER_SAFETY.bottomReservePx;

  function createPage(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    canvas.width = pageWidthPx;
    canvas.height = pageHeightPx;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('2d canvas context unavailable');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageWidthPx, pageHeightPx);
    ctx.textBaseline = 'top';
    return { canvas, ctx };
  }

  const pages: HTMLCanvasElement[] = [];
  let page = createPage();
  let y = marginPx;

  function nextPage(): void {
    pages.push(page.canvas);
    page = createPage();
    y = marginPx;
  }

  function ensureSpace(heightPx: number): void {
    if (y + heightPx + PDF_RENDER_SAFETY.lineDescentPadPx > maxY) nextPage();
  }

  function drawBlock(
    text: string,
    fontPx: number,
    color: string,
    lineHeightPx: number,
    paragraphGapPx: number,
    fontWeight: 'normal' | 'bold' = 'normal',
  ): void {
    if (!text) return;
    const applyTextStyle = (lineFontPx: number, tableLine: boolean): CanvasRenderingContext2D => {
      const ctx = page.ctx;
      if (tableLine) {
        ctx.font = fontWeight + ' ' + lineFontPx + 'px SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      } else {
        ctx.font = fontWeight + ' ' + lineFontPx + 'px "Microsoft YaHei", "PingFang SC", -apple-system, sans-serif';
      }
      ctx.fillStyle = color;
      return ctx;
    };

    const paragraphs = text.split(/\n{2,}/);
    paragraphs.forEach(paragraph => {
      if (!paragraph.trim()) {
        y += lineHeightPx;
        return;
      }
      const rawLines = paragraph.split('\n');
      rawLines.forEach(rawLine => {
        const tableLine = /[┌┬┐├┼┤└┴┘│]/.test(rawLine);
        const currentFontPx = tableLine ? Math.max(18, fontPx - 6) : fontPx;
        const currentLineHeight = tableLine ? Math.max(28, lineHeightPx - 6) : lineHeightPx;
        const measureCtx = applyTextStyle(currentFontPx, tableLine);
        const wrappedLines = wrapTextByWidth(measureCtx, rawLine, maxTextWidthPx);
        wrappedLines.forEach(line => {
          const metrics = measureCtx.measureText(line || ' ');
          const descent = Math.ceil((metrics.actualBoundingBoxDescent || 0) + PDF_RENDER_SAFETY.lineDescentPadPx);
          const requiredHeight = Math.max(currentLineHeight, currentFontPx + descent);
          ensureSpace(requiredHeight);
          const drawCtx = applyTextStyle(currentFontPx, tableLine);
          drawCtx.fillText(line, marginPx, y);
          y += currentLineHeight;
        });
      });
      y += paragraphGapPx;
    });
  }

  drawBlock(note.title || 'Untitled', 44, '#222222', 58, 18, 'bold');
  const date = formatDate(note.createdAt);
  if (date) {
    drawBlock(date + ' | ' + (note.type || 'text'), 22, '#888888', 34, 14);
  }

  if (mainText.trim()) {
    drawBlock(mainText, 28, '#222222', 42, 14);
  }

  if (note.audioUrl && settings.includeAudioLink !== false) {
    drawBlock('录音: ' + note.audioUrl, 24, '#444444', 36, 14);
  }

  if (transcriptText.trim()) {
    drawBlock('原始文字记录', 32, '#222222', 48, 10, 'bold');
    drawBlock(transcriptText, 28, '#222222', 42, 10);
  }

  pages.push(page.canvas);

  function canvasHasInk(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const stepX = Math.max(12, Math.floor(canvas.width / 80));
    const stepY = Math.max(12, Math.floor(canvas.height / 110));
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const data = ctx.getImageData(x, y, 1, 1).data;
        if (data[3] > 0 && (data[0] < 245 || data[1] < 245 || data[2] < 245)) {
          return true;
        }
      }
    }
    return false;
  }

  const hasInk = pages.some(canvasHasInk);
  if (!hasInk && (mainText.trim() || transcriptText.trim() || (note.title || '').trim())) {
    throw new Error('Canvas rendered blank pages for non-empty merged note');
  }

  const pdf = await _createA4PdfInstance();
  const pageWidthMm = pdf.internal.pageSize.getWidth();
  const pageHeightMm = pdf.internal.pageSize.getHeight();
  pages.forEach((canvas, index) => {
    if (index > 0 && typeof pdf.addPage === 'function') {
      pdf.addPage();
    } else if (index === 0 && typeof pdf.setPage === 'function') {
      pdf.setPage(1);
    }
    const dataUrl = canvas.toDataURL('image/jpeg', PDF_LIGHTWEIGHT.canvasJpegQuality);
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWidthMm, pageHeightMm);
  });

  const blob = pdf.output('blob');
  if (!blob || blob.size < 1024) {
    throw new Error('Canvas merged PDF appears empty (' + (blob ? blob.size : 0) + ' bytes)');
  }
  console.info('[Biji Ext] ' + logPrefix + ' generated via canvas pages:', pages.length, 'size:', blob.size);
  return blob;
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
  if (looksLikeHtmlFragment(content)) {
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

  const htmlWithBottomPad =
    '<div style="padding-bottom:' + PDF_RENDER_SAFETY.htmlBottomPadPx + 'px;">' +
    htmlContent +
    '</div>';

  const opt = {
    margin: [10, 10, 10, 10],
    filename: 'note.pdf',
    image: { type: 'jpeg', quality: PDF_LIGHTWEIGHT.html2pdfJpegQuality },
    html2canvas: {
      scale: PDF_LIGHTWEIGHT.html2canvasScale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: PDF_LIGHTWEIGHT.jsPdfCompress,
    },
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
      const worker = (html2pdf() as any).set(opt).from(htmlWithBottomPad, 'string');
      return run(worker, 'string');
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function renderFromDomContainer(): Promise<Blob> {
    const container = document.createElement('div');
    container.innerHTML = htmlWithBottomPad;
    container.setAttribute('data-pdf-render', '1');
    container.setAttribute('aria-hidden', 'true');
    container.style.position = 'fixed';
    container.style.left = '-100000px';
    container.style.top = '-100000px';
    container.style.width = '700px';
    container.style.zIndex = '-2147483648';
    container.style.pointerEvents = 'none';
    container.style.opacity = '0';
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
  // In merged mode, server-side export may omit transcript content (especially link notes),
  // so always use local rendering for consistent merged output.
  const needLocalTranscript = settings.transcriptMode === 'merged';
  if (needLocalTranscript) {
    return _generateMergedPdfByCanvas(note, settings, { logPrefix: 'Merged PDF' }).catch((err: Error) => {
      console.warn('[Biji Ext] Canvas merged PDF failed, fallback to html2pdf:', err.message);
      const mergedHtml = buildMergedPdfHtml(note, settings);
      return _generateLocalPdf(mergedHtml);
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

  const transcriptCanvasNote: Note = {
    ...note,
    title: (note.title || 'Untitled') + ' — Transcript',
    content: content,
    rawTranscript: null,
    audioUrl: null,
    createdAt: '',
  };
  return _generateMergedPdfByCanvas(transcriptCanvasNote, settings, { logPrefix: 'Transcript PDF' }).catch((canvasErr: Error) => {
    console.warn('[Biji Ext] Transcript canvas failed, fallback to html2pdf:', canvasErr.message);

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
  });
}

export const PDFConverter = { noteToHtml, generatePdf, generateTranscriptPdf };
