// tag-manager.js — IIFE module for pending tag storage
// Loaded via importScripts in background.js service worker

var TagManager = (function () {
  'use strict';

  var PENDING_TAGS_KEY = 'pendingTags';

  function getPendingTags() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(PENDING_TAGS_KEY, function (data) {
        resolve(data[PENDING_TAGS_KEY] || {});
      });
    });
  }

  function savePendingTags(tags) {
    return new Promise(function (resolve) {
      var obj = {};
      obj[PENDING_TAGS_KEY] = tags;
      chrome.storage.local.set(obj, resolve);
    });
  }

  function storePendingTags(noteId, tags) {
    return getPendingTags().then(function (all) {
      all[noteId] = {
        tags: tags,
        appliedAt: null,
      };
      return savePendingTags(all);
    });
  }

  function getTagsForNote(noteId) {
    return getPendingTags().then(function (all) {
      var entry = all[noteId];
      return entry ? entry.tags : [];
    });
  }

  function markApplied(noteIds) {
    return getPendingTags().then(function (all) {
      var now = new Date().toISOString();
      noteIds.forEach(function (id) {
        if (all[id]) {
          all[id].appliedAt = now;
        }
      });
      return savePendingTags(all);
    });
  }

  // Merge pending tags into a note's tags array (non-destructive)
  function mergeTagsForNote(note) {
    return getTagsForNote(note.id).then(function (pendingTags) {
      if (!pendingTags || pendingTags.length === 0) return note;

      var existing = (note.tags || []).map(function (t) {
        return typeof t === 'string' ? t : t.name || t.label || '';
      });

      pendingTags.forEach(function (tag) {
        if (tag && existing.indexOf(tag) === -1) {
          existing.push(tag);
        }
      });

      note.tags = existing;
      return note;
    });
  }

  return {
    getPendingTags: getPendingTags,
    storePendingTags: storePendingTags,
    getTagsForNote: getTagsForNote,
    markApplied: markApplied,
    mergeTagsForNote: mergeTagsForNote,
  };
})();
