// DOCX Converter — generate DOCX from notes
// Extracted from shared.js DOCXConverter

import type { Note, Settings } from '../core/types';
import { formatDate } from '../core/date-utils';
import { looksLikeMarkdown, mdToHtml } from '../core/markdown-converter';
import { exportNote as serverExportNote } from './server-exporter';

const FONT = 'Microsoft YaHei';
const SIZE = 22; // 11pt

function _htmlToDocxChildren(html: string): any[] {
  const children: any[] = [];
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  function processNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text && text.trim()) {
        children.push(
          new docx.Paragraph({
            children: [new docx.TextRun({ text: text, size: SIZE, font: FONT })],
            spacing: { after: 120 },
          }),
        );
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = (node as Element).tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const headingSize = tag === 'h1' ? 32 : tag === 'h2' ? 28 : 24;
      children.push(
        new docx.Paragraph({
          children: [
            new docx.TextRun({ text: node.textContent || '', bold: true, size: headingSize, font: FONT }),
          ],
          spacing: { before: 200, after: 120 },
        }),
      );
    } else if (tag === 'p' || tag === 'div') {
      const runs = _inlineToRuns(node as Element);
      if (runs.length > 0) {
        children.push(new docx.Paragraph({ children: runs, spacing: { after: 120 } }));
      }
    } else if (tag === 'ul' || tag === 'ol') {
      const items = (node as Element).querySelectorAll('li');
      items.forEach(li => {
        children.push(
          new docx.Paragraph({
            children: [new docx.TextRun({ text: '\u2022  ' + li.textContent!.trim(), size: SIZE, font: FONT })],
            spacing: { after: 60 },
          }),
        );
      });
    } else if (tag === 'hr') {
      children.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: '\u2500'.repeat(50), color: 'CCCCCC', size: 16 })],
          spacing: { before: 200, after: 100 },
        }),
      );
    } else if (tag === 'br') {
      children.push(new docx.Paragraph({ children: [], spacing: { after: 60 } }));
    } else if (tag === 'a') {
      const href = (node as Element).getAttribute('href') || '';
      const linkText = node.textContent || href;
      if (href) {
        children.push(
          new docx.Paragraph({
            children: [
              new docx.ExternalHyperlink({
                children: [new docx.TextRun({ text: linkText, style: 'Hyperlink', size: SIZE, font: FONT })],
                link: href,
              }),
            ],
            spacing: { after: 120 },
          }),
        );
      }
    } else if (tag === 'strong' || tag === 'b') {
      children.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: node.textContent || '', bold: true, size: SIZE, font: FONT })],
          spacing: { after: 120 },
        }),
      );
    } else if (tag === 'img') {
      // Skip — handled separately
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        processNode(node.childNodes[i]);
      }
    }
  }

  for (let i = 0; i < tmp.childNodes.length; i++) {
    processNode(tmp.childNodes[i]);
  }
  return children;
}

function _inlineToRuns(parentEl: Element): any[] {
  const runs: any[] = [];
  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent;
      if (t) runs.push(new docx.TextRun({ text: t, size: SIZE, font: FONT }));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (tag === 'strong' || tag === 'b') {
      runs.push(new docx.TextRun({ text: node.textContent || '', bold: true, size: SIZE, font: FONT }));
    } else if (tag === 'em' || tag === 'i') {
      runs.push(new docx.TextRun({ text: node.textContent || '', italics: true, size: SIZE, font: FONT }));
    } else if (tag === 'a') {
      const href = (node as Element).getAttribute('href') || '';
      runs.push(
        new docx.ExternalHyperlink({
          children: [new docx.TextRun({ text: node.textContent || href, style: 'Hyperlink', size: SIZE, font: FONT })],
          link: href,
        }),
      );
    } else if (tag === 'br') {
      runs.push(new docx.TextRun({ break: 1 }));
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        walk(node.childNodes[i]);
      }
    }
  }
  for (let i = 0; i < parentEl.childNodes.length; i++) {
    walk(parentEl.childNodes[i]);
  }
  return runs;
}

function _plainTextToChildren(text: string, note: Note, settings: Settings): any[] {
  const children: any[] = [];
  text = text.replace(/\r\n/g, '\n');
  if (note.type === 'voice' && settings.voiceSentenceSplit !== false) {
    text = text.replace(/([。！？.!?])\s*/g, '$1\n\n');
  }
  const paragraphs = text.split(/\n\n+/);
  paragraphs.forEach(p => {
    if (p.trim()) {
      children.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: p.trim(), size: SIZE, font: FONT })],
          spacing: { after: 120 },
        }),
      );
    }
  });
  return children;
}

function _buildNoteChildren(note: Note, settings: Settings): any[] {
  const children: any[] = [];

  if (note.title) {
    children.push(
      new docx.Paragraph({
        children: [new docx.TextRun({ text: note.title, bold: true, size: 36, font: FONT })],
        spacing: { after: 200 },
      }),
    );
  }

  const date = formatDate(note.createdAt);
  if (date) {
    children.push(
      new docx.Paragraph({
        children: [new docx.TextRun({ text: date + ' | ' + (note.type || 'text'), size: 18, font: FONT, color: '888888' })],
        spacing: { after: 200 },
      }),
    );
  }

  const content = note.content || '';
  if (content.includes('<') && content.includes('>')) {
    _htmlToDocxChildren(content).forEach(c => children.push(c));
  } else if (looksLikeMarkdown(content)) {
    _htmlToDocxChildren(mdToHtml(content)).forEach(c => children.push(c));
  } else {
    _plainTextToChildren(content, note, settings).forEach(c => children.push(c));
  }

  if (settings.transcriptMode === 'merged' && note.rawTranscript) {
    children.push(
      new docx.Paragraph({
        children: [new docx.TextRun({ text: '\u2500'.repeat(50), color: 'CCCCCC', size: 16 })],
        spacing: { before: 200, after: 100 },
      }),
    );
    children.push(
      new docx.Paragraph({
        children: [new docx.TextRun({ text: '原始文字记录', bold: true, size: 28, font: FONT })],
        spacing: { after: 120 },
      }),
    );
    const rawContent = note.rawTranscript;
    if (rawContent.includes('<') && rawContent.includes('>')) {
      _htmlToDocxChildren(rawContent).forEach(c => children.push(c));
    } else {
      _plainTextToChildren(rawContent, note, settings).forEach(c => children.push(c));
    }
  }

  return children;
}

function _buildTranscriptChildren(note: Note, settings: Settings): any[] {
  const children: any[] = [];

  children.push(
    new docx.Paragraph({
      children: [new docx.TextRun({ text: (note.title || 'Untitled') + ' — Transcript', bold: true, size: 36, font: FONT })],
      spacing: { after: 200 },
    }),
  );

  const content = note.rawTranscript || note.content || '';
  if (content.includes('<') && content.includes('>')) {
    _htmlToDocxChildren(content).forEach(c => children.push(c));
  } else if (looksLikeMarkdown(content)) {
    _htmlToDocxChildren(mdToHtml(content)).forEach(c => children.push(c));
  } else {
    _plainTextToChildren(content, note, settings).forEach(c => children.push(c));
  }

  return children;
}

export function generateDocx(note: Note, settings: Settings): Promise<Blob> {
  return serverExportNote(note.id, 'docx').catch((err: Error) => {
    console.warn('[Biji Ext] Server DOCX failed, using local generation:', err.message);
    if (typeof docx === 'undefined') {
      return Promise.reject(new Error('docx library not loaded'));
    }
    const children = _buildNoteChildren(note, settings);
    const doc = new docx.Document({ sections: [{ properties: {}, children }] });
    return docx.Packer.toBlob(doc);
  });
}

export function generateTranscriptDocx(note: Note, settings: Settings): Promise<Blob> {
  if (typeof docx === 'undefined') {
    return Promise.reject(new Error('docx library not loaded'));
  }
  const children = _buildTranscriptChildren(note, settings);
  const doc = new docx.Document({ sections: [{ properties: {}, children }] });
  return docx.Packer.toBlob(doc);
}

export const DOCXConverter = { generateDocx, generateTranscriptDocx };
