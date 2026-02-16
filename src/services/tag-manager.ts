// Tag Manager — pending tag storage for subscription items
// Rewritten from tag-manager.js

const PENDING_TAGS_KEY = 'pendingTags';

export function getPendingTags(): Promise<Record<string, { tags: string[]; appliedAt: string | null }>> {
  return new Promise(resolve => {
    chrome.storage.local.get(PENDING_TAGS_KEY, (data: Record<string, any>) => {
      resolve(data[PENDING_TAGS_KEY] || {});
    });
  });
}

function savePendingTags(tags: Record<string, any>): Promise<void> {
  return new Promise(resolve => {
    const obj: Record<string, any> = {};
    obj[PENDING_TAGS_KEY] = tags;
    chrome.storage.local.set(obj, resolve);
  });
}

export function storePendingTags(noteId: string, tags: string[]): Promise<void> {
  return getPendingTags().then(all => {
    all[noteId] = { tags, appliedAt: null };
    return savePendingTags(all);
  });
}

export function getTagsForNote(noteId: string): Promise<string[]> {
  return getPendingTags().then(all => {
    const entry = all[noteId];
    return entry ? entry.tags : [];
  });
}

export function markApplied(noteIds: string[]): Promise<void> {
  return getPendingTags().then(all => {
    const now = new Date().toISOString();
    noteIds.forEach(id => {
      if (all[id]) all[id].appliedAt = now;
    });
    return savePendingTags(all);
  });
}

export function mergeTagsForNote(note: any): Promise<any> {
  return getTagsForNote(note.id).then(pendingTags => {
    if (!pendingTags || pendingTags.length === 0) return note;

    const existing = (note.tags || []).map((t: any) =>
      typeof t === 'string' ? t : t.name || t.label || '',
    );

    pendingTags.forEach(tag => {
      if (tag && existing.indexOf(tag) === -1) existing.push(tag);
    });

    note.tags = existing;
    return note;
  });
}

export const TagManagerModule = {
  getPendingTags, storePendingTags, getTagsForNote, markApplied, mergeTagsForNote,
};
