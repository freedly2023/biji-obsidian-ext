// Sort utilities
// Previously window.sortNotesByDate in shared.js

import type { Note } from './types';

export function sortNotesByDate(arr: Note[]): Note[] {
  arr.sort((a, b) => {
    const tA = a.createdAt
      ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime()
      : 0;
    const tB = b.createdAt
      ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime()
      : 0;
    return tB - tA;
  });
  return arr;
}
