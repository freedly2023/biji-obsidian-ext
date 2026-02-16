// Feed Parser — RSS/Atom XML parsing (regex-based, no DOMParser)
// Extracted from feed-manager.js

import { decodeXmlEntities, stripHtml } from '../core/sanitize';

export interface ParsedFeedItem {
  title: string;
  url: string;
  guid: string;
  pubDate: string;
  description: string;
  thumbnail: string;
  duration: string;
  enclosureUrl: string;
}

export interface ParsedChannel {
  title: string;
  thumbnail: string;
}

function xmlTagContent(xml: string, tagName: string): string {
  const re = new RegExp(
    '<(?:[a-zA-Z0-9]+:)?' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?' + tagName + '\\s*>',
    'i',
  );
  const m = re.exec(xml);
  return m ? m[1].trim() : '';
}

function xmlAttr(tagStr: string, attrName: string): string {
  const re = new RegExp(attrName + '\\s*=\\s*["\']([^"\']*)["\']', 'i');
  const m = re.exec(tagStr);
  return m ? m[1] : '';
}

function xmlFindAll(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const re = new RegExp('<' + tagName + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tagName + '\\s*>', 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[0]);
  }
  return results;
}

function getMediaThumbnailRegex(itemXml: string, link: string): string {
  const mtMatch = /<(?:media:)?thumbnail[^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
  if (mtMatch) return mtMatch[1];
  let mcMatch = /<(?:media:)?content[^>]+url\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']image[^"']*["']/i.exec(itemXml);
  if (!mcMatch) mcMatch = /<(?:media:)?content[^>]*type\s*=\s*["']image[^"']*["'][^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
  if (mcMatch) return mcMatch[1];
  const iiMatch = /<(?:itunes:)?image[^>]+href\s*=\s*["']([^"']+)["']/i.exec(itemXml);
  if (iiMatch) return iiMatch[1];
  let vidMatch = (link || '').match(/[?&]v=([^&]+)/) || (link || '').match(/youtu\.be\/([^?]+)/);
  if (!vidMatch) {
    const idText = xmlTagContent(itemXml, 'id');
    const vm = idText.match(/video:([^:]+)$/);
    if (vm) vidMatch = [null as any, vm[1]];
  }
  if (vidMatch) return 'https://i.ytimg.com/vi/' + vidMatch[1] + '/mqdefault.jpg';
  return '';
}

function safeISODate(str: string): string {
  try { return new Date(str).toISOString(); } catch { return new Date().toISOString(); }
}

function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str || '';
  return str.substring(0, max) + '...';
}

export function parseFeedXml(xmlText: string): { items: ParsedFeedItem[]; channel: ParsedChannel } {
  const items: ParsedFeedItem[] = [];
  const channel: ParsedChannel = { title: '', thumbnail: '' };

  // Channel-level info (RSS 2.0)
  let channelMatch = /<channel\b[^>]*>([\s\S]*?)<item\b/i.exec(xmlText);
  if (!channelMatch) channelMatch = /<channel\b[^>]*>([\s\S]*?)<\/channel>/i.exec(xmlText);
  if (channelMatch) {
    const chXml = channelMatch[1];
    channel.title = xmlTagContent(chXml, 'title');
    const chImgMatch = /<(?:itunes:)?image[^>]+href\s*=\s*["']([^"']+)["']/i.exec(chXml);
    if (chImgMatch) channel.thumbnail = chImgMatch[1];
    if (!channel.thumbnail) {
      const imgBlock = /<image\b[^>]*>([\s\S]*?)<\/image>/i.exec(chXml);
      if (imgBlock) {
        const imgUrl = xmlTagContent(imgBlock[1], 'url');
        if (imgUrl) channel.thumbnail = imgUrl;
      }
    }
  }

  // Atom feed-level info
  if (!channel.title) {
    let feedMatch = /<feed\b[^>]*>([\s\S]*?)<entry\b/i.exec(xmlText);
    if (!feedMatch) feedMatch = /<feed\b[^>]*>([\s\S]*?)<\/feed>/i.exec(xmlText);
    if (feedMatch) {
      channel.title = xmlTagContent(feedMatch[1], 'title');
      channel.thumbnail = xmlTagContent(feedMatch[1], 'icon') || xmlTagContent(feedMatch[1], 'logo') || '';
    }
  }

  // RSS 2.0 items
  const rssItems = xmlFindAll(xmlText, 'item');
  if (rssItems.length > 0) {
    rssItems.forEach(itemXml => {
      const title = xmlTagContent(itemXml, 'title');
      const link = xmlTagContent(itemXml, 'link');
      const guid = xmlTagContent(itemXml, 'guid') || link;
      const pubDate = xmlTagContent(itemXml, 'pubDate');
      let description = xmlTagContent(itemXml, 'description');
      if (!description) description = xmlTagContent(itemXml, 'summary');
      const duration = xmlTagContent(itemXml, 'duration');
      let thumbnail = getMediaThumbnailRegex(itemXml, link);
      if (!thumbnail && channel.thumbnail) thumbnail = channel.thumbnail;
      let enclosureUrl = '';
      const encMatch = /<enclosure[^>]+url\s*=\s*["']([^"']+)["']/i.exec(itemXml);
      if (encMatch) enclosureUrl = encMatch[1];
      const itemUrl = link || enclosureUrl || guid;

      if (itemUrl) {
        items.push({
          title: decodeXmlEntities(title),
          url: decodeXmlEntities(itemUrl),
          guid: decodeXmlEntities(guid || itemUrl),
          pubDate: pubDate ? safeISODate(pubDate) : new Date().toISOString(),
          description: truncate(stripHtml(decodeXmlEntities(description)), 200),
          thumbnail: decodeXmlEntities(thumbnail),
          duration,
          enclosureUrl: decodeXmlEntities(enclosureUrl),
        });
      }
    });
    return { items, channel };
  }

  // Atom entries
  const atomEntries = xmlFindAll(xmlText, 'entry');
  atomEntries.forEach(entryXml => {
    const title = xmlTagContent(entryXml, 'title');
    const linkMatch = /<link[^>]+href\s*=\s*["']([^"']+)["']/i.exec(entryXml);
    const link = linkMatch ? linkMatch[1] : '';
    const id = xmlTagContent(entryXml, 'id') || link;
    const updated = xmlTagContent(entryXml, 'updated') || xmlTagContent(entryXml, 'published');
    const summary = xmlTagContent(entryXml, 'summary') || xmlTagContent(entryXml, 'content');
    const thumbnail = getMediaThumbnailRegex(entryXml, link);
    if (link) {
      items.push({
        title: decodeXmlEntities(title),
        url: decodeXmlEntities(link),
        guid: decodeXmlEntities(id),
        pubDate: updated ? safeISODate(updated) : new Date().toISOString(),
        description: truncate(stripHtml(decodeXmlEntities(summary)), 200),
        thumbnail: decodeXmlEntities(thumbnail),
        duration: '',
        enclosureUrl: '',
      });
    }
  });

  return { items, channel };
}

// OPML parser
export function parseOpml(opmlText: string): Array<{ url: string; name: string; type: string | null }> {
  const feeds: Array<{ url: string; name: string; type: string | null }> = [];
  const outlineRe = /<outline\b[^>]*>/gi;
  let match;
  while ((match = outlineRe.exec(opmlText)) !== null) {
    const tag = match[0];
    const xmlUrl = xmlAttr(tag, 'xmlUrl');
    if (xmlUrl) {
      feeds.push({
        url: xmlUrl,
        name: xmlAttr(tag, 'text') || xmlAttr(tag, 'title') || xmlUrl,
        type: xmlAttr(tag, 'type') === 'rss' ? null : (xmlAttr(tag, 'category') || null),
      });
    }
  }
  return feeds;
}
