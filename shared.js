// shared.js — Common modules for popup.js and notes.js
// All exports are window globals (no build tool required)

(function () {
  'use strict';

  // --- Settings loader ---
  var _defaultSettings = {
    filenameTemplate: '{date}-{title}',
    dateFormat: 'YYYY-MM-DD',
    transcriptMode: 'none',
    folderMode: 'flat',
    frontmatterFields: {
      title: true,
      created: true,
      modified: true,
      source: true,
      type: true,
      tags: true,
      biji_id: true,
      exported: true,
    },
    imageFormat: 'link',
    includeAudioLink: true,
    includeImages: true,
    voiceSentenceSplit: true,
    tagPrefix: '#',
  };

  window.loadSettings = function (cb) {
    chrome.storage.local.get('settings', function (data) {
      var settings = Object.assign({}, _defaultSettings, data.settings || {});
      if (cb) cb(settings);
    });
  };

  // --- Markdown Converter ---
  var MD = {
    formatDate: function (dateStr) {
      if (!dateStr) return null;
      try {
        var d = new Date(typeof dateStr === 'number' ? dateStr * 1000 : dateStr);
        if (isNaN(d.getTime())) return String(dateStr);
        var p = function (n) {
          return String(n).padStart(2, '0');
        };
        return (
          d.getFullYear() +
          '-' +
          p(d.getMonth() + 1) +
          '-' +
          p(d.getDate()) +
          'T' +
          p(d.getHours()) +
          ':' +
          p(d.getMinutes()) +
          ':' +
          p(d.getSeconds())
        );
      } catch (e) {
        return String(dateStr);
      }
    },

    formatDateShort: function (dateStr, fmt) {
      if (!dateStr) return null;
      try {
        var d = new Date(typeof dateStr === 'number' ? dateStr * 1000 : dateStr);
        if (isNaN(d.getTime())) return null;
        var p = function (n) {
          return String(n).padStart(2, '0');
        };
        var Y = String(d.getFullYear());
        var M = p(d.getMonth() + 1);
        var D = p(d.getDate());
        if (fmt === 'YYYYMMDD') return Y + M + D;
        if (fmt === 'YYYY/MM/DD') return Y + '/' + M + '/' + D;
        return Y + '-' + M + '-' + D;
      } catch (e) {
        return null;
      }
    },

    formatTags: function (tags) {
      if (!tags || !Array.isArray(tags)) return [];
      return tags
        .map(function (t) {
          var name = typeof t === 'string' ? t : t.name || t.label || '';
          return name.replace(/\s+/g, '-');
        })
        .filter(Boolean);
    },

    frontmatter: function (note, settings) {
      var fields = (settings && settings.frontmatterFields) || {
        title: true,
        created: true,
        modified: true,
        source: true,
        type: true,
        tags: true,
        biji_id: true,
        exported: true,
      };
      var lines = ['---'];
      if (fields.title) {
        var title = note.title || 'Untitled';
        lines.push('title: "' + title.replace(/"/g, '\\"') + '"');
      }
      if (fields.created) {
        var created = this.formatDate(note.createdAt);
        if (created) lines.push('created: ' + created);
      }
      if (fields.modified) {
        var modified = this.formatDate(note.updatedAt);
        if (modified) lines.push('modified: ' + modified);
      }
      if (fields.source) {
        lines.push('source: "biji.com (Get\u7B14\u8BB0)"');
      }
      if (fields.type && note.type) {
        lines.push('type: ' + note.type);
      }
      if (fields.tags) {
        var tags = this.formatTags(note.tags);
        if (tags.length > 0) {
          lines.push('tags:');
          tags.forEach(function (t) {
            lines.push('  - "' + t + '"');
          });
        }
      }
      if (fields.biji_id && note.id) {
        lines.push('biji_id: "' + note.id + '"');
      }
      if (fields.exported) {
        lines.push('exported: ' + this.formatDate(new Date().toISOString()));
      }
      lines.push('---');
      return lines.join('\n');
    },

    htmlToMd: function (html) {
      var md = html;
      md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
      md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
      md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
      md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
      md = md.replace(/<br\s*\/?>/gi, '\n');
      md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
      md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
      md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
      md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
      md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
      md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
      md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
      md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');
      md = md.replace(/<[^>]+>/g, '');
      md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      md = md
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
      md = md.replace(/\n{3,}/g, '\n\n');
      return md.trim();
    },

    formatImage: function (img, index, settings) {
      var url = typeof img === 'string' ? img : img.url || img.src || '';
      if (!url) return '';
      if (settings && settings.imageFormat === 'obsidian') {
        var fname = url.split('/').pop().split('?')[0] || 'image-' + (index + 1) + '.png';
        return '![[' + fname + ']]';
      }
      return '![\u56FE\u7247 ' + (index + 1) + '](' + url + ')';
    },

    convert: function (note, settings) {
      var parts = [this.frontmatter(note, settings), ''];
      if (note.title) {
        parts.push('# ' + note.title);
        parts.push('');
      }
      var content = note.content || '';
      if (content.includes('<') && content.includes('>')) {
        content = this.htmlToMd(content);
      } else {
        content = content.replace(/\r\n/g, '\n');
        if (note.type === 'voice' && settings.voiceSentenceSplit !== false) {
          content = content.replace(/([。！？.!?])\s*/g, '$1\n\n');
        }
      }
      parts.push(content);
      if (note.audioUrl && settings.includeAudioLink !== false) {
        parts.push('', '---', '**\u5F55\u97F3**: [\u6536\u542C](' + note.audioUrl + ')');
      }
      if (note.images && note.images.length > 0 && settings.includeImages !== false) {
        parts.push('', '---', '## \u56FE\u7247', '');
        var self = this;
        note.images.forEach(function (img, i) {
          var line = self.formatImage(img, i, settings);
          if (line) parts.push(line);
        });
      }
      return parts.join('\n');
    },

    _looksLikeMarkdown: function (text) {
      // Detect if text contains markdown syntax
      return (
        /^#{1,6}\s/m.test(text) ||
        /\*\*[^*]+\*\*/m.test(text) ||
        /\*[^*]+\*/m.test(text) ||
        /\[.+?\]\(.+?\)/m.test(text) ||
        /^[-*+]\s/m.test(text) ||
        /^\d+\.\s/m.test(text) ||
        /^---$/m.test(text) ||
        /^>\s/m.test(text)
      );
    },

    mdToHtml: function (md) {
      var html = md;
      // Headings
      html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
      html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
      html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
      html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
      // Horizontal rules
      html = html.replace(/^---$/gm, '<hr>');
      // Bold
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Italic
      html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      // Images (must be before links to avoid partial match)
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
      // Links
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      // Unordered lists
      html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>');
      // Ordered lists
      html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
      // Blockquotes
      html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
      // Paragraphs — double newlines
      html = html.replace(/\n\n+/g, '</p><p>');
      html = '<p>' + html + '</p>';
      // Clean up empty paragraphs
      html = html.replace(/<p>\s*<\/p>/g, '');
      // Single newlines to <br>
      html = html.replace(/\n/g, '<br>');
      return html;
    },

    convertTranscript: function (note, settings) {
      var parts = [this.frontmatter(note, settings), ''];
      parts.push('# ' + (note.title || 'Untitled') + ' \u2014 Transcript');
      parts.push('');
      var content = note.rawTranscript || note.content || '';
      if (content.includes('<') && content.includes('>')) {
        content = this.htmlToMd(content);
      }
      parts.push(content);
      return parts.join('\n');
    },
  };
  window.MD = MD;

  // --- Server Exporter (main note PDF/DOCX via biji.com API) ---
  var ServerExporter = {
    exportNote: function (noteId, format) {
      return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage(
          {
            type: 'exportNote',
            noteId: noteId,
            format: format,
          },
          function (response) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || 'Message failed'));
              return;
            }
            if (!response || response.error) {
              reject(new Error((response && response.error) || 'Export failed'));
              return;
            }
            fetch(response.access_url)
              .then(function (res) {
                if (!res.ok) throw new Error('Download failed: ' + res.status);
                return res.blob();
              })
              .then(resolve)
              .catch(reject);
          }
        );
      });
    },
  };
  window.ServerExporter = ServerExporter;

  // --- File naming ---
  window.sanitize = function (name) {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  };

  window.getDateParts = function (note, settings) {
    var raw = note.createdAt;
    if (!raw) return { date: 'undated', year: 'undated', month: '00' };
    try {
      var d = new Date(typeof raw === 'number' ? raw * 1000 : raw);
      if (isNaN(d.getTime())) return { date: 'undated', year: 'undated', month: '00' };
      var p = function (n) {
        return String(n).padStart(2, '0');
      };
      var fmt = (settings && settings.dateFormat) || 'YYYY-MM-DD';
      var dateStr = MD.formatDateShort(raw, fmt) || 'undated';
      return {
        date: dateStr,
        year: String(d.getFullYear()),
        month: p(d.getMonth() + 1),
      };
    } catch (e) {
      return { date: 'undated', year: 'undated', month: '00' };
    }
  };

  window.filename = function (note, settings) {
    var template = (settings && settings.filenameTemplate) || '{date}-{title}';
    var parts = window.getDateParts(note, settings);
    var title = note.title ? window.sanitize(note.title) : 'note-' + note.id;
    var result = template
      .replace(/\{date\}/g, parts.date)
      .replace(/\{title\}/g, title)
      .replace(/\{id\}/g, note.id || 'unknown')
      .replace(/\{type\}/g, note.type || 'text')
      .replace(/\{year\}/g, parts.year)
      .replace(/\{month\}/g, parts.month);
    var segments = result.split('/');
    segments = segments.map(function (seg) {
      return seg.replace(/[<>:"|?*]/g, '').trim();
    });
    result = segments.join('/');
    if (!result.endsWith('.md')) result += '.md';
    return result;
  };

  window.getFolderPrefix = function (note, settings) {
    var mode = (settings && settings.folderMode) || 'flat';
    var template = (settings && settings.filenameTemplate) || '{date}-{title}';
    if (template.indexOf('/') !== -1) return '';
    if (mode === 'flat') return '';
    if (mode === 'byType') return (note.type || 'text') + '/';
    if (mode === 'byTag') {
      var tags = MD.formatTags(note.tags);
      return tags.length > 0 ? tags[0] + '/' : 'untagged/';
    }
    if (mode === 'byMonth') {
      var parts = window.getDateParts(note, settings);
      return parts.year + '-' + parts.month + '/';
    }
    return '';
  };

  window.fullPath = function (note, settings) {
    return window.getFolderPrefix(note, settings) + window.filename(note, settings);
  };

  window.escapeHtml = function (str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  // --- Export Tracker ---
  var ExportTracker = {
    _exportedSet: null,
    _lastExportTime: null,

    load: function (cb) {
      var self = this;
      chrome.storage.local.get(['exportedIds', 'lastExportTime'], function (data) {
        self._exportedSet = new Set(data.exportedIds || []);
        self._lastExportTime = data.lastExportTime || null;
        if (cb) cb();
      });
    },

    markExported: function (ids) {
      if (!this._exportedSet) this._exportedSet = new Set();
      var self = this;
      ids.forEach(function (id) {
        self._exportedSet.add(id);
      });
      this._lastExportTime = new Date().toISOString();
      chrome.storage.local.set({
        exportedIds: Array.from(this._exportedSet),
        lastExportTime: this._lastExportTime,
      });
    },

    isExported: function (id) {
      return this._exportedSet ? this._exportedSet.has(id) : false;
    },

    getNewCount: function (notes) {
      var self = this;
      return notes.filter(function (n) {
        return !self.isExported(n.id);
      }).length;
    },

    getNewNotes: function (notes) {
      var self = this;
      return notes.filter(function (n) {
        return !self.isExported(n.id);
      });
    },

    clear: function (cb) {
      this._exportedSet = new Set();
      this._lastExportTime = null;
      chrome.storage.local.remove(['exportedIds', 'lastExportTime'], function () {
        if (cb) cb();
      });
    },
  };
  window.ExportTracker = ExportTracker;

  // --- Image Fetcher ---
  var ImageFetcher = {
    _cache: {},

    fetchAsArrayBuffer: function (url) {
      var self = this;
      if (self._cache[url] && self._cache[url].arrayBuffer) {
        return Promise.resolve(self._cache[url]);
      }
      return fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('Image fetch failed: ' + res.status);
          return res.arrayBuffer();
        })
        .then(function (buf) {
          return new Promise(function (resolve) {
            // Get dimensions from the image
            var blob = new Blob([buf]);
            var img = new Image();
            img.onload = function () {
              var result = {
                arrayBuffer: buf,
                width: img.naturalWidth,
                height: img.naturalHeight,
                blob: blob,
              };
              self._cache[url] = result;
              URL.revokeObjectURL(img.src);
              resolve(result);
            };
            img.onerror = function () {
              var result = { arrayBuffer: buf, width: 400, height: 300, blob: blob };
              self._cache[url] = result;
              URL.revokeObjectURL(img.src);
              resolve(result);
            };
            img.src = URL.createObjectURL(blob);
          });
        });
    },

    fetchAsBase64: function (url) {
      var self = this;
      if (self._cache[url] && self._cache[url].base64) {
        return Promise.resolve(self._cache[url].base64);
      }
      return fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('Image fetch failed: ' + res.status);
          return res.blob();
        })
        .then(function (blob) {
          return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onloadend = function () {
              var base64 = reader.result;
              if (!self._cache[url]) self._cache[url] = {};
              self._cache[url].base64 = base64;
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        });
    },

    clearCache: function () {
      this._cache = {};
    },
  };
  window.ImageFetcher = ImageFetcher;

  // --- PDF Converter ---
  var PDFConverter = {
    noteToHtml: function (note, settings) {
      var html =
        "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333;\">";

      // Title
      if (note.title) {
        html +=
          '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
          window.escapeHtml(note.title) +
          '</h1>';
      }

      // Metadata
      var date = MD.formatDate(note.createdAt);
      if (date) {
        html +=
          '<div style="font-size: 12px; color: #888; margin-bottom: 16px;">' +
          window.escapeHtml(date) +
          ' | ' +
          window.escapeHtml(note.type || 'text') +
          '</div>';
      }

      // Content
      var content = note.content || '';
      if (content.includes('<') && content.includes('>')) {
        html += '<div>' + content + '</div>';
      } else if (MD._looksLikeMarkdown(content)) {
        html += '<div>' + MD.mdToHtml(content) + '</div>';
      } else {
        content = content.replace(/\r\n/g, '\n');
        var paragraphs = content.split(/\n\n+/);
        paragraphs.forEach(function (p) {
          if (p.trim()) {
            html +=
              '<p style="margin: 10px 0;">' +
              window.escapeHtml(p.trim()).replace(/\n/g, '<br>') +
              '</p>';
          }
        });
      }

      // Audio link
      if (note.audioUrl && settings.includeAudioLink !== false) {
        html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
        html +=
          '<p><strong>\u5F55\u97F3</strong>: <a href="' +
          window.escapeHtml(note.audioUrl) +
          '">\u6536\u542C</a></p>';
      }

      // Merged transcript
      if (settings.transcriptMode === 'merged' && note.rawTranscript) {
        html += '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
        html +=
          '<h2 style="font-size: 16px; margin-bottom: 12px;">\u539F\u59CB\u6587\u5B57\u8BB0\u5F55</h2>';
        var rawContent = note.rawTranscript;
        if (rawContent.includes('<') && rawContent.includes('>')) {
          html += '<div>' + rawContent + '</div>';
        } else {
          html +=
            '<p style="margin: 10px 0;">' +
            window.escapeHtml(rawContent).replace(/\n/g, '<br>') +
            '</p>';
        }
      }

      html += '</div>';
      return html;
    },

    // Pre-fetch images and embed as base64 data URIs so html2canvas can render them
    _prepareImagesHtml: function (note, settings) {
      if (!note.images || note.images.length === 0 || settings.includeImages === false) {
        return Promise.resolve('');
      }
      var urls = note.images
        .map(function (img) {
          return typeof img === 'string' ? img : img.url || img.src || '';
        })
        .filter(Boolean);
      if (urls.length === 0) return Promise.resolve('');

      return Promise.all(
        urls.map(function (url) {
          return ImageFetcher.fetchAsBase64(url).catch(function () {
            return null;
          });
        })
      ).then(function (base64Results) {
        var html = '<hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">';
        html += '<h2 style="font-size: 16px; margin-bottom: 12px;">\u56FE\u7247</h2>';
        base64Results.forEach(function (b64) {
          if (b64) {
            html +=
              '<img src="' + b64 + '" style="max-width: 100%; margin: 8px 0; border-radius: 4px;">';
          }
        });
        return html;
      });
    },

    generatePdf: function (note, settings) {
      // Main note PDF: use server-side API for better quality
      return ServerExporter.exportNote(note.id, 'pdf');
    },

    // Local PDF generation for transcripts (uses html2pdf.js)
    _generateLocalPdf: function (htmlContent) {
      if (typeof html2pdf === 'undefined') {
        return Promise.reject(new Error('html2pdf library not loaded'));
      }

      var container = document.createElement('div');
      container.innerHTML = htmlContent;
      // Must be in normal flow for html2canvas to render; hide off-screen
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '700px';
      container.style.zIndex = '-9999';
      container.style.opacity = '1';
      container.style.pointerEvents = 'none';
      document.body.appendChild(container);

      var opt = {
        margin: [10, 10, 10, 10],
        filename: 'note.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 700 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      };

      return html2pdf()
        .set(opt)
        .from(container)
        .outputPdf('blob')
        .then(function (blob) {
          document.body.removeChild(container);
          return blob;
        })
        .catch(function (err) {
          if (container.parentNode) document.body.removeChild(container);
          throw err;
        });
    },

    generateTranscriptPdf: function (note, settings) {
      var html =
        "<div style=\"font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.8; color: #333;\">";
      html +=
        '<h1 style="font-size: 22px; font-weight: 600; margin-bottom: 16px; color: #222;">' +
        window.escapeHtml(note.title || 'Untitled') +
        ' \u2014 Transcript</h1>';
      var content = note.rawTranscript || note.content || '';
      if (content.includes('<') && content.includes('>')) {
        html += '<div>' + content + '</div>';
      } else if (MD._looksLikeMarkdown(content)) {
        html += '<div>' + MD.mdToHtml(content) + '</div>';
      } else {
        content = content.replace(/\r\n/g, '\n');
        var paragraphs = content.split(/\n\n+/);
        paragraphs.forEach(function (p) {
          if (p.trim()) {
            html +=
              '<p style="margin: 10px 0;">' +
              window.escapeHtml(p.trim()).replace(/\n/g, '<br>') +
              '</p>';
          }
        });
      }
      html += '</div>';
      return this._generateLocalPdf(html);
    },
  };
  window.PDFConverter = PDFConverter;

  // --- DOCX Converter ---
  var DOCXConverter = {
    FONT: 'Microsoft YaHei',
    SIZE: 22, // 11pt

    // Parse an HTML string into an array of docx Paragraph objects
    _htmlToDocxChildren: function (html) {
      var self = this;
      var children = [];
      // Use a temporary DOM element to parse HTML
      var tmp = document.createElement('div');
      tmp.innerHTML = html;

      function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          var text = node.textContent;
          if (text.trim()) {
            children.push(
              new docx.Paragraph({
                children: [new docx.TextRun({ text: text, size: self.SIZE, font: self.FONT })],
                spacing: { after: 120 },
              })
            );
          }
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        var tag = node.tagName.toLowerCase();

        if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
          var headingSize = tag === 'h1' ? 32 : tag === 'h2' ? 28 : 24;
          children.push(
            new docx.Paragraph({
              children: [
                new docx.TextRun({
                  text: node.textContent,
                  bold: true,
                  size: headingSize,
                  font: self.FONT,
                }),
              ],
              spacing: { before: 200, after: 120 },
            })
          );
        } else if (tag === 'p' || tag === 'div') {
          var runs = self._inlineToRuns(node);
          if (runs.length > 0) {
            children.push(
              new docx.Paragraph({
                children: runs,
                spacing: { after: 120 },
              })
            );
          }
        } else if (tag === 'ul' || tag === 'ol') {
          var items = node.querySelectorAll('li');
          items.forEach(function (li) {
            children.push(
              new docx.Paragraph({
                children: [
                  new docx.TextRun({
                    text: '\u2022  ' + li.textContent.trim(),
                    size: self.SIZE,
                    font: self.FONT,
                  }),
                ],
                spacing: { after: 60 },
              })
            );
          });
        } else if (tag === 'hr') {
          children.push(
            new docx.Paragraph({
              children: [
                new docx.TextRun({ text: '\u2500'.repeat(50), color: 'CCCCCC', size: 16 }),
              ],
              spacing: { before: 200, after: 100 },
            })
          );
        } else if (tag === 'br') {
          children.push(new docx.Paragraph({ children: [], spacing: { after: 60 } }));
        } else if (tag === 'img') {
          // Skip images here — handled separately
        } else if (tag === 'a') {
          var href = node.getAttribute('href') || '';
          var linkText = node.textContent || href;
          if (href) {
            children.push(
              new docx.Paragraph({
                children: [
                  new docx.ExternalHyperlink({
                    children: [
                      new docx.TextRun({
                        text: linkText,
                        style: 'Hyperlink',
                        size: self.SIZE,
                        font: self.FONT,
                      }),
                    ],
                    link: href,
                  }),
                ],
                spacing: { after: 120 },
              })
            );
          }
        } else if (tag === 'strong' || tag === 'b') {
          children.push(
            new docx.Paragraph({
              children: [
                new docx.TextRun({
                  text: node.textContent,
                  bold: true,
                  size: self.SIZE,
                  font: self.FONT,
                }),
              ],
              spacing: { after: 120 },
            })
          );
        } else {
          // Recurse into unknown elements
          for (var i = 0; i < node.childNodes.length; i++) {
            processNode(node.childNodes[i]);
          }
        }
      }

      for (var i = 0; i < tmp.childNodes.length; i++) {
        processNode(tmp.childNodes[i]);
      }
      return children;
    },

    // Convert inline children (text, <strong>, <em>, <a>, <br>) into TextRun array
    _inlineToRuns: function (parentEl) {
      var self = this;
      var runs = [];
      function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          var t = node.textContent;
          if (t) runs.push(new docx.TextRun({ text: t, size: self.SIZE, font: self.FONT }));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        var tag = node.tagName.toLowerCase();
        if (tag === 'strong' || tag === 'b') {
          runs.push(
            new docx.TextRun({
              text: node.textContent,
              bold: true,
              size: self.SIZE,
              font: self.FONT,
            })
          );
        } else if (tag === 'em' || tag === 'i') {
          runs.push(
            new docx.TextRun({
              text: node.textContent,
              italics: true,
              size: self.SIZE,
              font: self.FONT,
            })
          );
        } else if (tag === 'a') {
          var href = node.getAttribute('href') || '';
          runs.push(
            new docx.ExternalHyperlink({
              children: [
                new docx.TextRun({
                  text: node.textContent || href,
                  style: 'Hyperlink',
                  size: self.SIZE,
                  font: self.FONT,
                }),
              ],
              link: href,
            })
          );
        } else if (tag === 'br') {
          runs.push(new docx.TextRun({ break: 1 }));
        } else {
          for (var i = 0; i < node.childNodes.length; i++) {
            walk(node.childNodes[i]);
          }
        }
      }
      for (var i = 0; i < parentEl.childNodes.length; i++) {
        walk(parentEl.childNodes[i]);
      }
      return runs;
    },

    // Convert plain text (non-HTML) into paragraphs with sentence splitting for voice notes
    _plainTextToChildren: function (text, note, settings) {
      var self = this;
      var children = [];
      text = text.replace(/\r\n/g, '\n');
      if (note.type === 'voice' && settings.voiceSentenceSplit !== false) {
        text = text.replace(/([。！？.!?])\s*/g, '$1\n\n');
      }
      var paragraphs = text.split(/\n\n+/);
      paragraphs.forEach(function (p) {
        if (p.trim()) {
          children.push(
            new docx.Paragraph({
              children: [new docx.TextRun({ text: p.trim(), size: self.SIZE, font: self.FONT })],
              spacing: { after: 120 },
            })
          );
        }
      });
      return children;
    },

    generateDocx: function (note, settings) {
      // Main note DOCX: use server-side API for better quality
      return ServerExporter.exportNote(note.id, 'docx');
    },

    // Local DOCX generation for transcripts
    _buildTranscriptChildren: function (note, settings) {
      var self = this;
      var children = [];

      // Title
      children.push(
        new docx.Paragraph({
          children: [
            new docx.TextRun({
              text: (note.title || 'Untitled') + ' \u2014 Transcript',
              bold: true,
              size: 36,
              font: self.FONT,
            }),
          ],
          spacing: { after: 200 },
        })
      );

      var content = note.rawTranscript || note.content || '';
      if (content.includes('<') && content.includes('>')) {
        var htmlChildren = self._htmlToDocxChildren(content);
        htmlChildren.forEach(function (c) {
          children.push(c);
        });
      } else if (MD._looksLikeMarkdown(content)) {
        var htmlFromMd = MD.mdToHtml(content);
        var mdChildren = self._htmlToDocxChildren(htmlFromMd);
        mdChildren.forEach(function (c) {
          children.push(c);
        });
      } else {
        var textChildren = self._plainTextToChildren(content, note, settings);
        textChildren.forEach(function (c) {
          children.push(c);
        });
      }

      return children;
    },

    generateTranscriptDocx: function (note, settings) {
      if (typeof docx === 'undefined') {
        return Promise.reject(new Error('docx library not loaded'));
      }
      var children = this._buildTranscriptChildren(note, settings);
      var doc = new docx.Document({
        sections: [
          {
            properties: {},
            children: children,
          },
        ],
      });
      return docx.Packer.toBlob(doc);
    },
  };
  window.DOCXConverter = DOCXConverter;

  // --- Common export helpers ---

  // Get file extension for current format
  window.getFileExt = function (format) {
    if (format === 'pdf') return '.pdf';
    if (format === 'docx') return '.docx';
    return '.md';
  };

  // Convert a note's full path from .md to the target format extension
  window.fullPathWithFormat = function (note, settings, format) {
    var path = window.fullPath(note, settings);
    if (format !== 'md') {
      path = path.replace(/\.md$/, window.getFileExt(format));
    }
    return path;
  };

  // Deduplicate filename within a used-set
  window.deduplicateFilename = function (fn, used, ext) {
    if (!used[fn]) return fn;
    var base = fn.replace(ext, '');
    var c = 2;
    while (used[base + '-' + c + ext]) c++;
    return base + '-' + c + ext;
  };

  // Sort notes by createdAt (newest first)
  window.sortNotesByDate = function (arr) {
    arr.sort(function (a, b) {
      var tA = a.createdAt
        ? new Date(typeof a.createdAt === 'number' ? a.createdAt * 1000 : a.createdAt).getTime()
        : 0;
      var tB = b.createdAt
        ? new Date(typeof b.createdAt === 'number' ? b.createdAt * 1000 : b.createdAt).getTime()
        : 0;
      return tB - tA;
    });
    return arr;
  };

  // --- Export Engine (shared export logic for popup.js and notes.js) ---
  var ExportEngine = {
    // Fetch missing rawTranscript for voice notes via background.js detail API
    fetchMissingTranscripts: function (notes, onProgress) {
      var missing = notes.filter(function (n) {
        return !n.rawTranscript;
      });
      if (missing.length === 0) return Promise.resolve();

      var done = 0;
      var total = missing.length;

      function fetchNext(index) {
        if (index >= missing.length) return Promise.resolve();
        var note = missing[index];
        done++;
        if (onProgress) onProgress(done, total);

        return new Promise(function (resolve) {
          chrome.runtime.sendMessage(
            {
              type: 'fetchTranscript',
              noteId: note.id,
              noteType: note.noteType || note.type || '',
            },
            function (res) {
              if (chrome.runtime.lastError) {
                console.warn(
                  '[Biji Ext] Transcript fetch error for',
                  note.id,
                  chrome.runtime.lastError
                );
                resolve();
                return;
              }
              if (res && res.transcript) {
                note.rawTranscript = res.transcript;
                chrome.runtime.sendMessage({
                  type: 'storeVueNotes',
                  notes: [{ id: note.id, rawTranscript: res.transcript }],
                });
              }
              resolve();
            }
          );
        }).then(function () {
          return fetchNext(index + 1);
        });
      }

      return fetchNext(0);
    },

    // Get list of active file formats from format state object
    getActiveFormats: function (activeFileFormats) {
      return Object.keys(activeFileFormats).filter(function (f) {
        return activeFileFormats[f];
      });
    },

    // Process a single note's transcript files for ZIP export
    processTranscript: function (note, formats, folder, used, settings) {
      if (settings.transcriptMode === 'none') return Promise.resolve();
      if (!note.rawTranscript && !note.content) return Promise.resolve();

      var chain = Promise.resolve();

      formats.forEach(function (format) {
        chain = chain.then(function () {
          if (format === 'md') {
            if (settings.transcriptMode === 'separate') {
              var tFn = window
                .fullPathWithFormat(note, settings, 'md')
                .replace('.md', '-transcript.md');
              tFn = window.deduplicateFilename(tFn, used, '.md');
              used[tFn] = true;
              folder.file(tFn, MD.convertTranscript(note, settings));
            }
            // merged mode: already appended to main MD content
          } else if (format === 'pdf') {
            if (settings.transcriptMode !== 'separate') return;
            var tFn = window
              .fullPathWithFormat(note, settings, 'pdf')
              .replace('.pdf', '-transcript.pdf');
            tFn = window.deduplicateFilename(tFn, used, '.pdf');
            used[tFn] = true;
            return PDFConverter.generateTranscriptPdf(note, settings)
              .then(function (blob) {
                folder.file(tFn, blob);
              })
              .catch(function () {
                var fallback = tFn.replace('.pdf', '.md');
                folder.file(fallback, MD.convertTranscript(note, settings));
              });
          } else if (format === 'docx') {
            if (settings.transcriptMode !== 'separate') return;
            var tFn = window
              .fullPathWithFormat(note, settings, 'docx')
              .replace('.docx', '-transcript.docx');
            tFn = window.deduplicateFilename(tFn, used, '.docx');
            used[tFn] = true;
            return DOCXConverter.generateTranscriptDocx(note, settings)
              .then(function (blob) {
                folder.file(tFn, blob);
              })
              .catch(function () {
                var fallback = tFn.replace('.docx', '.md');
                folder.file(fallback, MD.convertTranscript(note, settings));
              });
          }
        });
      });

      return chain;
    },

    // ZIP export: generate ZIP with notes in specified formats
    zipExport: function (notes, settings, formats, onProgress) {
      var zip = new JSZip();
      var folder = zip.folder('biji-export');
      var used = {};
      var total = notes.length;

      function processNote(index) {
        if (index >= total) return ExportEngine._finishZip(zip, notes);
        var note = notes[index];

        function processFormat(fmtIndex) {
          if (fmtIndex >= formats.length) {
            return ExportEngine.processTranscript(note, formats, folder, used, settings).then(
              function () {
                if (onProgress) onProgress(index + 1, total);
                return processNote(index + 1);
              }
            );
          }

          var format = formats[fmtIndex];
          var ext = window.getFileExt(format);
          var fn = window.fullPathWithFormat(note, settings, format);
          fn = window.deduplicateFilename(fn, used, ext);
          used[fn] = true;

          var genPromise;
          if (format === 'md') {
            var mdContent;
            if (settings.transcriptMode === 'merged' && note.rawTranscript) {
              mdContent = MD.convert(note, settings);
              var rawContent = note.rawTranscript;
              if (rawContent.includes('<') && rawContent.includes('>')) {
                rawContent = MD.htmlToMd(rawContent);
              }
              mdContent += '\n\n---\n\n## \u539F\u59CB\u6587\u5B57\u8BB0\u5F55\n\n' + rawContent;
            } else {
              mdContent = MD.convert(note, settings);
            }
            genPromise = Promise.resolve(mdContent);
          } else if (format === 'pdf') {
            genPromise = ServerExporter.exportNote(note.id, 'pdf');
          } else {
            genPromise = ServerExporter.exportNote(note.id, 'docx');
          }

          return genPromise
            .then(function (data) {
              folder.file(fn, data);
            })
            .catch(function (err) {
              console.warn('[Biji Ext] Export error (' + format + ') for', note.id, err);
              // Fallback to MD on server export failure
              var mdFn = fn.replace(ext, '.md');
              if (!used[mdFn]) {
                folder.file(mdFn, MD.convert(note, settings));
                used[mdFn] = true;
              }
            })
            .then(function () {
              return processFormat(fmtIndex + 1);
            });
        }

        return processFormat(0);
      }

      return processNote(0);
    },

    // Finish ZIP generation: compress and trigger download
    _finishZip: function (zip, notes) {
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function (content) {
        var ts = new Date().toISOString().substring(0, 10);
        saveAs(content, 'biji-export-' + ts + '.zip');
        ExportTracker.markExported(
          notes.map(function (n) {
            return n.id;
          })
        );
        return { success: true };
      });
    },

    // Vault export: write notes as MD files to Obsidian vault
    vaultExport: function (notes, settings, onProgress) {
      var subfolder = settings.vaultSubfolder || 'biji-notes';
      var converter = {
        filename: function (note) {
          return window.fullPath(note, settings);
        },
        convert: function (note) {
          if (settings.transcriptMode === 'merged' && note.rawTranscript) {
            var mainContent = MD.convert(note, settings);
            var rawContent = note.rawTranscript;
            if (rawContent.includes('<') && rawContent.includes('>')) {
              rawContent = MD.htmlToMd(rawContent);
            }
            return (
              mainContent + '\n\n---\n\n## \u539F\u59CB\u6587\u5B57\u8BB0\u5F55\n\n' + rawContent
            );
          }
          return MD.convert(note, settings);
        },
      };

      return VaultWriter.writeAllNotes(notes, subfolder, converter, onProgress).then(
        function (result) {
          if (settings.transcriptMode === 'separate') {
            var notesWithContent = notes.filter(function (n) {
              return !!n.content;
            });
            if (notesWithContent.length > 0) {
              var txConverter = {
                filename: function (note) {
                  return window.fullPath(note, settings).replace('.md', '-transcript.md');
                },
                convert: function (note) {
                  return MD.convertTranscript(note, settings);
                },
              };
              return VaultWriter.writeAllNotes(
                notesWithContent,
                subfolder,
                txConverter,
                function (done, total) {
                  if (onProgress) onProgress(done, total, done, 0);
                }
              ).then(function (txResult) {
                return {
                  written: result.written + txResult.written,
                  errors: result.errors.concat(txResult.errors),
                };
              });
            }
          }
          return result;
        }
      );
    },
  };
  window.ExportEngine = ExportEngine;

  // --- CommonJS exports for testing ---
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      MD: MD,
      sanitize: window.sanitize,
      filename: window.filename,
      getDateParts: window.getDateParts,
      getFolderPrefix: window.getFolderPrefix,
      fullPath: window.fullPath,
      escapeHtml: window.escapeHtml,
      getFileExt: window.getFileExt,
      fullPathWithFormat: window.fullPathWithFormat,
      deduplicateFilename: window.deduplicateFilename,
      sortNotesByDate: window.sortNotesByDate,
    };
  }
})();
