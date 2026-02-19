// Unified sanitization / escaping utilities
// Previously in shared.js (escapeHtml), subscription-shared.js (escHtml),
// and feed-manager.js (decodeXmlEntities, stripHtml)

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtmlAttr(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function decodeXmlEntities(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

export function htmlToText(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('style, script, link, noscript').forEach(el => el.remove());
  return (div.textContent || '').trim();
}

export function parseSentenceList(raw: string): string | null {
  if (!raw || raw.charAt(0) !== '{') return null;
  try {
    const obj = JSON.parse(raw);
    const list = obj.sentence_list || obj.sentenceList || obj.sentences;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list
      .map((s: any) => s.text || s.content || s.sentence || '')
      .filter(Boolean)
      .join('\n\n');
  } catch (_) {
    return null;
  }
}

export function normalizeTranscript(raw: string): string {
  if (!raw) return '';
  const parsed = parseSentenceList(raw);
  if (parsed) return parsed;
  if (raw.includes('<') && raw.includes('>')) {
    return htmlToText(raw) || stripHtml(raw) || raw;
  }
  return raw;
}
