// Canonical normalizeNote + findNotesArray
// Previously duplicated in inject.js and background.js

import type { Note } from './types';

export function normalizeNote(raw: Record<string, any>): Note {
  return {
    id: raw.id || raw.noteId || raw.note_id || raw._id || '',
    title: raw.title || raw.subject || '',
    content:
      raw.content || raw.text || raw.body || raw.html || raw.richText ||
      raw.rich_text || raw.result || raw.answer || raw.output || raw.summary ||
      raw.aiContent || raw.ai_content || raw.description || '',
    rawTranscript:
      raw.transcript ||
      raw.rawText ||
      raw.raw_text ||
      raw.voiceText ||
      raw.voice_text ||
      raw.asr ||
      raw.asrText ||
      raw.asr_text ||
      raw.originalText ||
      raw.original_text ||
      raw.speechText ||
      raw.speech_text ||
      raw.rawContent ||
      raw.raw_content ||
      null,
    createdAt:
      raw.createdAt ||
      raw.created_at ||
      raw.createTime ||
      raw.create_time ||
      raw.createdTime ||
      raw.created ||
      raw.ctime ||
      '',
    updatedAt:
      raw.updatedAt ||
      raw.updated_at ||
      raw.updateTime ||
      raw.update_time ||
      raw.modifiedAt ||
      raw.modified ||
      raw.mtime ||
      '',
    tags: raw.tags || raw.labels || raw.categories || [],
    noteType: raw.note_type || raw.noteType || raw.entry_type || null,
    type: raw.type || raw.note_type || raw.noteType || 'text',
    audioUrl: raw.audioUrl || raw.audio_url || raw.voiceUrl || raw.voice_url || null,
    images: raw.images || raw.imgs || raw.pictures || raw.attachments || [],
  };
}

const PRIORITY_KEYS = [
  'notes', 'list', 'data', 'items', 'results', 'records', 'c',
  'noteList', 'note_list', 'entries', 'rows', 'content', 'timeline',
  'feeds', 'posts',
];

export function findNotesArray(obj: any, depth = 0): any[] | null {
  if (depth > 10 || !obj) return null;

  if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
    const f = obj[0];
    if (
      (f.id || f.noteId || f.note_id || f._id) &&
      (f.content || f.title || f.name || f.text || f.body || f.subject || f.html || f.richText)
    ) {
      return obj;
    }
    if (
      obj.length >= 5 &&
      (f.id || f.noteId || f.note_id || f._id)
    ) {
      return obj;
    }
  }

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const allKeys = Object.keys(obj);
    const sortedKeys: string[] = [];
    PRIORITY_KEYS.forEach(pk => {
      if (allKeys.indexOf(pk) !== -1) sortedKeys.push(pk);
    });
    allKeys.forEach(k => {
      if (sortedKeys.indexOf(k) === -1) sortedKeys.push(k);
    });

    for (let i = 0; i < sortedKeys.length; i++) {
      const key = sortedKeys[i];
      if (!obj.hasOwnProperty(key)) continue;
      const r = findNotesArray(obj[key], depth + 1);
      if (r) return r;
    }
  }

  return null;
}
