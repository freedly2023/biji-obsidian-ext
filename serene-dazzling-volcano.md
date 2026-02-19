# 修复：所有 Transcript PDF 导出空白

## Context

导出 transcript PDF 版本时，录音转录和网页链接转录都是空白的。MD 和 DOCX 版本均正常。问题出在 `_generateLocalPdf` 的渲染管线。

## 根因

`_generateLocalPdf`（pdf-converter.ts:92-167）在 popup 环境中渲染失败：

1. 容器被 append 到 popup body 末尾，设为 `position: absolute; left: -9999px`
2. `onclone` 回调中把容器改为 `position: static`，但 popup body 有大量 UI 元素（header、tabs、panels 等），容器被推到所有 UI 下方
3. html2canvas 配置了 `scrollX: 0, scrollY: 0` + 显式 `width/height`，从文档左上角 (0,0) 开始捕获
4. 捕获到的是 popup UI 区域，不是 PDF 容器内容 → 空白 PDF

popup.html body 结构：`<div class="header">` → `<div class="tab-bar">` → `<div class="tab-panel">` × 2 → scripts → **PDF 容器在最后**

## 修改计划（2 个文件）

### 1. `src/services/pdf-converter.ts` — 主修复：重写 `_generateLocalPdf`

**核心改动**：修复容器定位 + html2canvas 捕获区域

```typescript
function _generateLocalPdf(htmlContent: string): Promise<Blob> {
  if (typeof html2pdf === 'undefined') {
    return Promise.reject(new Error('html2pdf library not loaded'));
  }

  const container = document.createElement('div');
  container.innerHTML = htmlContent;
  container.setAttribute('data-pdf-render', '1');
  // 用 fixed 定位在视口左上角，visibility: hidden 隐藏但保持布局计算
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = '700px';
  container.style.visibility = 'hidden';
  container.style.zIndex = '-1';
  container.style.background = '#ffffff';
  container.style.color = '#333';
  document.body.appendChild(container);

  return new Promise<void>(resolve => {
    requestAnimationFrame(() => { setTimeout(resolve, 50); });
  }).then(() => {
    const containerHeight = container.scrollHeight;
    const containerWidth = container.offsetWidth || 700;

    if (containerHeight === 0) {
      document.body.removeChild(container);
      return Promise.reject(new Error('Container height is 0'));
    }

    const opt = {
      margin: [10, 10, 10, 10],
      filename: 'note.pdf',
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        // 不再设置 width/height/scrollX/scrollY，让 html2pdf 自动处理元素捕获
        onclone: function (clonedDoc: Document) {
          // 移除外部样式表，防止 popup CSS 干扰
          clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => {
            if (!el.closest('[data-pdf-render]')) el.remove();
          });
          // 隐藏所有其他 body 子元素
          Array.from(clonedDoc.body.children).forEach(child => {
            if (!(child as HTMLElement).hasAttribute ||
                !(child as HTMLElement).hasAttribute('data-pdf-render')) {
              (child as HTMLElement).style.display = 'none';
            }
          });
          // 容器设为可见 + 正常定位
          const el = clonedDoc.querySelector('[data-pdf-render]') as HTMLElement;
          if (el) {
            el.style.position = 'static';
            el.style.visibility = 'visible';
            el.style.width = containerWidth + 'px';
            el.style.background = '#ffffff';
            el.style.color = '#333';
          }
          const body = clonedDoc.body as HTMLElement;
          body.style.margin = '0';
          body.style.padding = '0';
          body.style.background = '#ffffff';
        },
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    };

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
```

**关键变化**：
- 容器定位：`absolute; left: -9999px` → `fixed; left: 0; top: 0; visibility: hidden`
- 移除 html2canvas 的 `width/height/scrollX/scrollY/windowWidth/windowHeight`，让库自动从元素计算
- `onclone` 中隐藏所有非 PDF 的 body 子元素（`display: none`），确保容器是唯一可见元素
- `onclone` 中设置 `body.margin = '0'; body.padding = '0'` 消除偏移
- 渲染延迟从 0ms 增加到 50ms，确保布局计算完成
- 新增 `containerHeight === 0` 检查

### 2. `src/types/globals.d.ts` — 补充 html2pdf 类型（可选）

如果需要用 `.toPdf().output('blob')` 替代 `.outputPdf('blob')`，需要更新类型定义。但先用现有 API 测试，如果 `outputPdf('blob')` 能正常工作就不改。

### 3. `src/core/sanitize.ts` — 加强 `normalizeTranscript`（次要修复）

第 63 行增加 `stripHtml` 回退，防止 raw HTML 泄漏：
```typescript
return htmlToText(raw) || stripHtml(raw) || raw;
```

### 4. `src/services/pdf-converter.ts` — `generateTranscriptPdf` HTML 安全网（次要修复）

import 添加 `stripHtml`，在 `looksLikeMarkdown` 判断前加 HTML 检测：
```typescript
if (content.includes('<') && content.includes('>')) {
    content = htmlToText(content) || stripHtml(content) || content;
}
```

## 不需要改的地方

- `noteToHtml` merged 模式：已用 `escapeHtml`，安全
- `markdown-converter.ts`：已有 HTML 安全网
- `docx-converter.ts`：虽然可以加 HTML 安全网提升一致性，但不是必须的
- `api-fetcher.ts`：无需改动

## 验证

1. `npm run build` 确认编译通过
2. 加载扩展，测试录音笔记的 transcript PDF 导出 → 不再空白
3. 测试 web link 笔记的 transcript PDF 导出 → 不再空白
4. 测试 merged 模式下的 PDF 导出
5. 回归测试：MD、DOCX 导出正常
