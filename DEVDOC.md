# Biji to Obsidian — Chrome Extension 开发文档

> 版本 1.2.0 | 最后更新 2026-02-10

---

## 1. 项目概述

Chrome Manifest V3 扩展，将 biji.com（Get笔记）的语音/文字笔记导出为 Obsidian 兼容的 Markdown 文件。

### 核心能力

| 能力 | 实现方式 |
|------|----------|
| 被动捕获 | XHR/Fetch hook 拦截 biji.com API 响应 |
| Vue Store 扫描 | 页面上下文直接读取 Vue 2/3 + Vuex/Pinia 状态 |
| 主动全量获取 | 调用 biji.com API 进行游标分页，自动遍历所有笔记 |
| ZIP 导出 | JSZip 打包下载 |
| Vault 直写 | File System Access API 直接写入 Obsidian vault 目录 |
| 批量选择 | 在 popup 中勾选笔记，仅导出选中项 |
| PDF/DOCX 导出 | html2pdf.js (PDF) + docx.js (DOCX) 格式导出 |
| 增量导出 | 追踪已导出笔记 ID，支持"仅导出新增"功能 |
| 笔记管理页 | 全页面搜索/筛选/排序/分页/批量导出 |

---

## 2. 目录结构

```
biji-obsidian-ext/
├── manifest.json          # Chrome Extension Manifest V3 配置
├── background.js          # Service Worker — 消息中转 & 数据存储
├── content.js             # Content Script — 注入 inject.js，桥接消息
├── inject.js              # Page Context — 网络拦截、Vue 扫描、API 主动获取
├── shared.js              # 公共模块（MD转换器、文件名、ExportTracker、ImageFetcher、PDF/DOCX转换器）
├── popup.html             # 弹出面板 UI
├── popup.js               # 弹出面板逻辑（导出、选择、设置跳转）
├── notes.html             # 笔记管理全页面 UI
├── notes.js               # 笔记管理逻辑（搜索、筛选、排序、分页、批量导出）
├── options.html           # 设置页面 UI
├── options.js             # 设置页面逻辑（读写 chrome.storage）
├── vault-writer.js        # File System Access API 封装
├── lib/
│   ├── jszip.min.js       # JSZip 库
│   ├── FileSaver.min.js   # FileSaver 库
│   ├── html2pdf.bundle.min.js  # PDF 生成库（html2canvas + jsPDF）
│   └── docx.min.js        # DOCX 生成库
├── icon.svg               # 矢量图标
├── icon48.png             # 48px 图标
├── icon128.png            # 128px 图标
└── DEVDOC.md              # 本文档
```

---

## 3. 架构与消息流

### 3.1 运行上下文

Chrome Extension 有三个隔离的 JS 运行上下文：

```
┌─────────────────────────────────────────────────┐
│                 biji.com 页面                     │
│  ┌─────────────┐     CustomEvent      ┌────────┐│
│  │  inject.js  │ ◄─────────────────► │content.js││
│  │ (PAGE ctx)  │  biji-ext-data       │(ISOLATED)││
│  │             │  biji-ext-scan-*     │          ││
│  │ - XHR hook  │  biji-ext-fetch-*    │          ││
│  │ - Fetch hook│                      │          ││
│  │ - Vue scan  │                      │          ││
│  │ - API fetch │                      │          ││
│  └─────────────┘                      └────┬───┘│
└────────────────────────────────────────────│────┘
                          chrome.runtime.sendMessage
                                             │
                    ┌────────────────────────▼────────┐
                    │         background.js            │
                    │       (Service Worker)            │
                    │  - chrome.storage 读写            │
                    │  - storeNotes / storeDiscovery    │
                    │  - badge 更新                     │
                    │  - fetchStatus 转发               │
                    └───────────────┬──────────────────┘
                                    │ chrome.runtime
                    ┌───────────────▼──────────────────┐
                    │    popup.js / options.js          │
                    │    (Extension Pages)              │
                    └──────────────────────────────────┘
```

### 3.2 消息类型清单

| type | 方向 | payload | 说明 |
|------|------|---------|------|
| `notes` | inject→content→background | `{ url, notes[] }` | 捕获到的笔记数组 |
| `discovery` | inject→content→background | `{ url, preview }` | API 发现日志 |
| `fetchStatus` | inject→content→background→popup | `{ status, fetched, done }` | 主动获取进度 |
| `storeVueNotes` | popup→background | `{ notes[] }` | Vue 扫描结果存储 |
| `getNotes` | popup→background | — | 请求所有笔记（async response） |
| `getDiscovery` | popup→background | — | 请求发现日志 |
| `clearNotes` | popup→background | — | 清空笔记 |
| `clearDiscovery` | popup→background | — | 清空日志 |
| `scanVueStore` | popup→content→inject | — | 触发 Vue Store 扫描 |
| `fetchAll` | popup→content→inject | `{ fetchDelay }` | 触发全量获取 |
| `cancelFetch` | popup→content→inject | — | 取消全量获取 |
| `fetchTranscript` | popup→content→inject | `{ noteId }` | 获取单条笔记的原始转文字 |

### 3.3 CustomEvent 清单 (content.js ↔ inject.js)

| 事件名 | 方向 | detail |
|--------|------|--------|
| `biji-ext-data` | inject→content | `JSON.stringify({ type, payload })` |
| `biji-ext-scan-request` | content→inject | 无 |
| `biji-ext-scan-result` | inject→content | `JSON.stringify({ notes })` |
| `biji-ext-fetch-all` | content→inject | `JSON.stringify({ fetchDelay })` |
| `biji-ext-fetch-cancel` | content→inject | 无 |
| `biji-ext-fetch-transcript` | content→inject | `JSON.stringify({ noteId })` |
| `biji-ext-transcript-result` | inject→content | `JSON.stringify({ noteId, transcript })` |

---

## 4. 数据模型

### 4.1 标准化笔记对象 (normalizeNote)

inject.js 和 background.js 都有 `normalizeNote()` 函数，将 API 返回的各种字段名映射为统一结构：

```javascript
{
  id: String,            // 笔记唯一 ID
  title: String,         // 标题
  content: String,       // 正文/总结（可能是 HTML 或纯文本）
  rawTranscript: String?, // 原始录音转文字（从 API 候选字段或 /note/{id}/web 获取）
  createdAt: String,     // 创建时间（ISO 字符串或 Unix 时间戳）
  updatedAt: String,     // 更新时间
  tags: Array,           // 标签数组（字符串或 {name} 对象）
  type: String,          // 笔记类型："voice" | "text"
  audioUrl: String?,     // 语音笔记的录音 URL
  images: Array          // 图片数组（字符串 URL 或 {url/src} 对象）
}
```

**rawTranscript 字段说明：**
- 语音笔记的 `content` 通常是 AI 总结内容，`rawTranscript` 是原始录音转文字
- normalizeNote() 会尝试多个候选字段名：`transcript`, `rawText`, `raw_text`, `voiceText`, `voice_text`, `asr`, `asrText`, `asr_text`, `originalText`, `original_text`, `speechText`, `speech_text`, `rawContent`, `raw_content`
- 如果列表 API 不包含该字段，导出时可通过 `fetchTranscript` 消息从 `/note/{id}/web` 页面逐条获取

### 4.2 chrome.storage.local 结构

| Key | 类型 | 说明 |
|-----|------|------|
| `notes` | `{ [id]: NormalizedNote }` | 所有捕获的笔记，以 ID 为键 |
| `discoveryLogs` | `Array<{ url, preview, time }>` | API 发现日志，最多 100 条 |
| `settings` | `Settings` | 用户设置（完整结构见下方） |
| `discoveryMode` | `Boolean` | 遗留字段，与 settings.discoveryMode 同步 |
| `exportedIds` | `string[]` | 已导出笔记 ID 列表（增量导出追踪） |
| `lastExportTime` | `string` (ISO) | 上次导出时间 |

### 4.3 Settings 完整结构与默认值

```javascript
{
  // 导出方式
  exportMode: 'zip',              // 'zip' | 'vault'
  vaultSubfolder: 'biji-notes',   // vault 内子文件夹名

  // 文件命名
  filenameTemplate: '{date}-{title}',  // 模板字符串
  dateFormat: 'YYYY-MM-DD',            // 'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY/MM/DD'

  // 文字记录
  transcriptMode: 'none',  // 'none' | 'separate' | 'merged'

  // 文件夹分类
  folderMode: 'flat',      // 'flat' | 'byType' | 'byTag' | 'byMonth'

  // Frontmatter 字段开关
  frontmatterFields: {
    title: true,
    created: true,
    modified: true,
    source: true,
    type: true,
    tags: true,
    biji_id: true,
    exported: true
  },

  // 图片格式
  imageFormat: 'link',     // 'link' | 'obsidian'

  // 导出偏好
  includeAudioLink: true,
  includeImages: true,
  voiceSentenceSplit: true,
  tagPrefix: '#',

  // 高级
  discoveryMode: false,
  fetchDelay: 500,         // 毫秒，范围 100-5000
  scanDepth: 10            // Vue 扫描递归深度，范围 4-20
}
```

---

## 5. 各文件详细说明

### 5.1 manifest.json

- Manifest V3
- `permissions`: `storage`
- `host_permissions`: biji.com + luojilab.com 域名
- content_scripts 在 `document_start` 注入 `content.js`
- `inject.js` 通过 `web_accessible_resources` 暴露给页面

### 5.2 inject.js（页面上下文）

运行在 biji.com 的页面 JS 上下文中（非隔离世界），因此可以：
- 访问 `window.__vue__`、`__vue_app__`、`__INITIAL_STATE__`
- Hook `XMLHttpRequest` 和 `fetch`
- 使用页面 cookie 发起 API 请求

**主要模块：**

| 模块 | 功能 |
|------|------|
| `normalizeNote(raw)` | 原始笔记 → 标准格式（含 rawTranscript 字段） |
| `findNotesArray(obj, depth)` | 递归搜索对象树中的笔记数组（优先键：notes, list, data...） |
| `scanVueStore()` | 扫描 Vue 2/3 的 Vuex/Pinia state |
| `autoScanVueStore()` | 页面加载后自动扫描（1s→2s→3s→5s→8s 递增重试） |
| `processResponse(url, text)` | 处理拦截的 API 响应，提取笔记 + 字段发现日志 |
| `fetchRawTranscript(noteId)` | 从 `/note/{id}/web` 页面获取原始转文字（备用方案） |
| `HookedXHR` | XMLHttpRequest 代理 |
| `fetch` hook | fetch 代理 |

**API 信息：**
- 基础 URL: `https://get-notes.luojilab.com/voicenotes/web/notes`
- 分页参数: `?limit=50&since_id=<lastId>&sort=create_desc`
- 认证: `credentials: 'include'`（依赖页面 cookie）
- 使用 `origFetch` (hook 前保存的原始 fetch) 避免无限递归

### 5.3 content.js（Content Script，83 行）

**职责：** 桥接 inject.js（页面上下文）和扩展 API（background/popup）。

- 动态注入 `inject.js` 到页面 `<head>`
- 监听 `biji-ext-data` 事件 → 转发到 `background.js`
- 监听 `scanVueStore` 消息 → 分派 `biji-ext-scan-request` → 等待结果 → 回传
- 监听 `fetchAll` 消息 → 分派 `biji-ext-fetch-all`
- 监听 `cancelFetch` 消息 → 分派 `biji-ext-fetch-cancel`

**注意：** `scanVueStore` 使用 `return true` 保持 `sendResponse` 通道打开（异步），超时 10 秒。

### 5.4 background.js（Service Worker，86 行）

**职责：** 消息路由 + 数据持久化。

- `storeNotes(newNotes)`: 合并新笔记到 `chrome.storage.local.notes`（以 ID 去重，Object.assign 合并）
- `storeDiscoveryLog(entry)`: 存储 API 发现日志（最多 100 条）
- `updateBadge(count)`: 更新扩展图标角标数字
- `fetchStatus` 消息: 从 content script 转发到 popup（`chrome.runtime.sendMessage` + `.catch` 防止 popup 未打开时报错）

### 5.5 popup.html + popup.js（弹出面板，207 行 HTML + 642 行 JS）

**UI 区域（step-based 流程）：**

| 区域 | 功能 |
|------|------|
| header | 标题 + ⚙ 设置按钮 |
| Step 1 获取笔记 | 获取全部笔记按钮 + 取消 + 状态文字 |
| noteCountBar | 已捕获 N 条笔记 + 全选 checkbox（inline） |
| noteList | 笔记列表（最多显示 50 条，每条前有 checkbox） |
| Step 2 导出 | 格式切换（ZIP/Vault）+ Vault 状态（inline）+ 统一导出按钮 |
| progress | 进度条 |
| advancedToggle | 折叠的"高级选项"（扫描 Vue Store / 清空数据 / Discovery 模式） |
| tip | 提示文字 |

**popup.js 关键模块：**

| 模块 | 说明 |
|------|------|
| `loadSettings(cb)` | 从 chrome.storage 加载设置，合并默认值 |
| `MD` 对象 | Markdown 转换器 |
| `MD.formatDate(dateStr)` | ISO 日期格式化（用于 frontmatter） |
| `MD.formatDateShort(dateStr, fmt)` | 短日期格式化（用于文件名） |
| `MD.frontmatter(note, settings)` | 生成 YAML frontmatter（按 frontmatterFields 开关） |
| `MD.htmlToMd(html)` | HTML → Markdown 转换（正则替换） |
| `MD.formatImage(img, index, settings)` | 根据 imageFormat 生成 `![]()` 或 `![[]]` |
| `MD.convert(note, settings)` | 完整 Markdown 转换（frontmatter + 标题 + 正文 + 音频 + 图片） |
| `MD.convertTranscript(note, settings)` | 生成 transcript 专用 Markdown |
| `sanitize(name)` | 移除文件名非法字符，截断 100 字符 |
| `getDateParts(note)` | 返回 `{ date, year, month }` |
| `filename(note)` | 根据 filenameTemplate 生成文件名 |
| `getFolderPrefix(note)` | 根据 folderMode 生成文件夹前缀 |
| `fullPath(note)` | `getFolderPrefix + filename` 完整路径 |
| `getNotesToExport()` | 返回选中笔记（无选中则返回全部） |
| `refresh()` | 刷新笔记列表和统计 |
| `initFormatToggle()` | 初始化 ZIP/Vault 格式切换按钮 |
| `updateFormatToggleUI()` | 更新格式切换 UI + Vault 状态 |
| `updateExportButtonText()` | 根据选中数量和格式更新导出按钮文字 |
| `refreshVaultStatus()` | 刷新 Vault 连接状态（inline 显示） |
| `exportToZip()` | ZIP 导出（含 transcript 获取逻辑） |
| `exportToVault()` | Vault 导出（含 transcript 获取 + 分离文件写入） |
| `fetchMissingTranscripts(notes, onProgress)` | 异步逐条获取缺少 rawTranscript 的语音笔记 |

**文件名模板变量：**

| 变量 | 值 | 示例 |
|------|----|------|
| `{date}` | 按 dateFormat 格式化的日期 | `2026-01-11` |
| `{title}` | 清洗后的标题 | `健康` |
| `{id}` | 笔记 ID | `abc123` |
| `{type}` | 笔记类型 | `voice` |
| `{year}` | 年份 | `2026` |
| `{month}` | 月份 (两位) | `01` |

**文件夹前缀逻辑：**
- 如果模板本身包含 `/`（如 `{date}/{title}`），folderMode 被忽略
- `flat`: 无前缀
- `byType`: `voice/` 或 `text/`
- `byTag`: 第一个标签名 + `/`，无标签则 `untagged/`
- `byMonth`: `2026-01/`

**Transcript 模式：**
- `none`: 不生成额外内容
- `separate`: 生成 `xxx-transcript.md` 独立文件，使用 `rawTranscript`（优先）或 `content`
- `merged`: 在主文件末尾追加 `---` + `## 原始文字记录` + `rawTranscript`（优先）或 `content`
- 导出前若有语音笔记缺少 `rawTranscript`，会异步逐条从 `/note/{id}/web` 获取

**批量选择：**
- `selectedIds` 对象追踪选中的笔记 ID
- 全选 checkbox 支持 `indeterminate` 状态
- 未选中任何笔记时导出全部

### 5.6 shared.js（公共模块）

从 popup.js 提取的公共代码，供 popup.js 和 notes.js 共同引用。所有导出为 `window.XXX` 全局变量。

| 模块 | 说明 |
|------|------|
| `window.loadSettings(cb)` | 从 chrome.storage 加载设置，合并默认值 |
| `window.MD` | Markdown 转换器（frontmatter/htmlToMd/convert/convertTranscript） |
| `window.sanitize(name)` | 移除文件名非法字符 |
| `window.getDateParts(note, settings)` | 返回 `{ date, year, month }` |
| `window.filename(note, settings)` | 根据模板生成文件名 |
| `window.getFolderPrefix(note, settings)` | 根据 folderMode 生成文件夹前缀 |
| `window.fullPath(note, settings)` | 完整路径（前缀 + 文件名） |
| `window.escapeHtml(str)` | HTML 实体编码 |
| `window.ExportTracker` | 增量导出追踪（load/markExported/isExported/getNewCount/getNewNotes/clear） |
| `window.ImageFetcher` | 图片获取工具（fetchAsArrayBuffer/fetchAsBase64，含内存缓存） |
| `window.PDFConverter` | PDF 生成器（noteToHtml/generatePdf，使用 html2pdf.js） |
| `window.DOCXConverter` | DOCX 生成器（generateDocx，使用 docx.js） |
| `window.getFileExt(format)` | 获取文件扩展名 |
| `window.fullPathWithFormat(note, settings, format)` | 带格式的完整路径 |
| `window.deduplicateFilename(fn, used, ext)` | 文件名去重 |
| `window.sortNotesByDate(arr)` | 按创建时间降序排序 |

### 5.7 notes.html + notes.js（笔记管理全页面）

全屏笔记管理页面，支持搜索/筛选/排序/分页/批量导出。从 popup "管理全部笔记" 按钮打开新标签页。

**功能：**

| 功能 | 说明 |
|------|------|
| 文字搜索 | 按标题和标签实时筛选（200ms 防抖） |
| 类型筛选 | 全部 / 语音 / 文字 / 链接 |
| 日期筛选 | 起始日期 ~ 结束日期 |
| 导出状态 | 全部 / 已导出 / 未导出 |
| 排序 | 最新优先 / 最早优先 / 按标题 / 按类型 |
| 分页 | 每页 50 条，底部翻页控件 |
| 批量选择 | 全选影响所有筛选结果（不只当前页） |
| 格式选择 | MD / PDF / DOCX |
| 导出方式 | ZIP 下载 / 写入 Vault |

**FilterEngine 对象：**
- `searchText`, `noteType`, `dateFrom`, `dateTo`, `exportStatus`, `sortBy`
- `apply(notes)` 返回筛选+排序后的数组

### 5.8 options.html + options.js（设置页面，585 行 HTML + 376 行 JS）

**设置卡片：**

| 卡片 | 设置项 |
|------|--------|
| 导出方式 | ZIP / Vault radio |
| Vault 设置 | 文件夹选择、权限、子文件夹路径 |
| 文件命名 | 5 个预设模板 radio + 自定义输入 + 日期格式 select |
| 文字记录导出 | none / separate / merged radio |
| 笔记分类 | flat / byType / byTag / byMonth radio |
| 导出格式 | 8 个 frontmatter 字段 checkbox (2列) + 图片格式 radio |
| 导出偏好 | 音频链接、图片、断句、标签前缀 |
| 高级设置 | Discovery 模式、请求间隔、扫描深度 |
| 保存/重置 | 保存按钮 + 恢复默认 |

**options.js 关键函数：**

| 函数 | 说明 |
|------|------|
| `initRadioGroup(groupId)` | 通用 radio 卡片点击 → `.selected` 样式切换 |
| `setRadioGroupValue(name, value)` | 编程设置 radio 值 + UI |
| `getRadioGroupValue(name)` | 读取当前选中的 radio 值 |
| `getEffectiveFilenameTemplate()` | 返回实际模板（自定义时读取输入框） |
| `updateFolderHint()` | 模板含 `/` 时禁用文件夹分类 + 显示提示 |
| `getFrontmatterFields()` | 读取 8 个 checkbox 状态 → 对象 |
| `setFrontmatterFields(fields)` | 设置 8 个 checkbox 状态 |
| `loadSettings()` | 从 storage 加载 → 填充所有表单 |
| `saveSettings()` | 收集所有表单值 → 写入 storage |
| `resetSettings()` | 恢复默认值 |

### 5.7 vault-writer.js（203 行）

File System Access API 封装。

| 方法 | 说明 |
|------|------|
| `isSupported()` | 检查 `showDirectoryPicker` 是否存在 |
| `pickDirectory()` | 弹出目录选择器，保存 handle 到 IndexedDB |
| `restoreHandle()` | 从 IndexedDB 恢复 handle，检查权限 |
| `requestPermission()` | 请求读写权限 |
| `writeFile(dirHandle, filename, content)` | 写入单个文件 |
| `writeAllNotes(notes, subfolder, converter, onProgress)` | 批量写入所有笔记 |
| `clearHandle()` | 清除保存的 handle |
| `getDirectoryName()` | 返回目录名 |
| `isReady()` | handle 是否就绪 |
| `needsPermission()` | 是否需要重新授权 |

**IndexedDB 配置：**
- 数据库名: `biji-exporter`
- Store: `handles`
- Key: `vaultDir`

---

## 6. API 详情

### Biji.com 笔记 API

```
GET https://get-notes.luojilab.com/voicenotes/web/notes
  ?limit=50
  &since_id=<cursor>
  &sort=create_desc
```

- **认证**: Cookie-based（需要用户已登录 biji.com）
- **分页**: 游标分页，`since_id` 为上一页最后一条笔记的 ID
- **响应结构**: `{ c: { list: [...notes...] } }`（通过 `findNotesArray` 递归搜索）
- **限流**: HTTP 429，自动等待 5 秒重试
- **认证失败**: HTTP 401/403
- **默认每页**: 50 条
- **重试策略**: 最多 3 次，指数退避（1s, 2s, 4s）

---

## 7. 导出的 Markdown 格式

### 示例输出

```markdown
---
title: "健康"
created: 2026-01-11T14:30:00
modified: 2026-01-11T15:00:00
source: "biji.com (Get笔记)"
type: voice
tags:
  - "生活"
biji_id: "abc123"
exported: 2026-02-09T10:00:00
---

# 健康

今天讨论了一些关于健康饮食的话题。

主要内容是关于蛋白质的摄入量。

---
**录音**: [收听](https://example.com/audio.mp3)

---
## 图片

![图片 1](https://example.com/img1.jpg)
```

### Obsidian 图片格式（可选）

```markdown
![[img1.jpg]]
```

---

## 8. 开发注意事项

### 8.1 上下文隔离

- **inject.js** 运行在页面上下文，**不能**调用 `chrome.*` API
- **content.js** 运行在隔离世界，**不能**访问 `window.__vue__`
- 两者之间只能通过 `CustomEvent` 通信（`window.dispatchEvent` / `window.addEventListener`）
- **popup.js** 和 **options.js** 运行在扩展页面上下文，可以调用 `chrome.*`，但不能直接访问 biji.com 页面

### 8.2 fetch 的 hook 注意

inject.js 中 hook 了 `window.fetch`，但主动获取使用的是 hook 前保存的 `origFetch`，避免被自身 hook 捕获导致无限递归。

### 8.3 设置同步

- 所有设置存储在 `chrome.storage.local` 的 `settings` 键下
- `discoveryMode` 同时存储在顶层键（遗留兼容，popup 中 discoveryToggle 读取的是顶层键）
- options.js 保存时会同步两个位置

### 8.4 笔记去重

- 背景脚本 `storeNotes()` 以笔记 ID 为键存储，使用 `Object.assign` 合并（后到的数据覆盖前面的）
- 导出时 `used[fn]` 对象追踪已使用的文件名，重名自动追加 `-2`, `-3` 后缀

### 8.5 CSS 约定

- 主色调: `#6C5CE7`
- Radio 卡片选中: `.selected` class → 紫色边框 + 淡紫背景
- 字体: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- popup 宽度固定 380px
- options 页面最大宽度 800px

---

## 9. 浏览器兼容性

| 特性 | Chrome 86+ | Firefox | Safari |
|------|-----------|---------|--------|
| 核心功能 | 完整 | 部分 | 部分 |
| File System Access API | 支持 | 不支持 | 不支持 |
| Vault 直写 | 支持 | 不可用 | 不可用 |
| ZIP 导出 | 支持 | 支持 | 支持 |
| IndexedDB | 支持 | 支持 | 支持 |

---

## 10. 可能的后续迭代方向

- [ ] vault-writer.js 支持子文件夹嵌套创建（当前 `fullPath` 含 `/` 时 vault 写入不会自动创建中间目录）
- [x] 增量导出：记录已导出笔记 ID，下次只导出新增/修改的（v1.2.0 ExportTracker）
- [ ] 导出进度持久化：popup 关闭后重新打开能恢复进度
- [ ] 图片本地下载：将远程图片下载到 vault 的 attachments 文件夹
- [ ] 标签前缀实际应用：当前 `tagPrefix` 设置已保存但未在 frontmatter 输出中使用
- [ ] Discovery 日志查看界面
- [ ] i18n 国际化（当前界面为中文）
- [x] 笔记搜索/过滤：全页面笔记管理（v1.2.0 notes.html）
- [x] 导出历史记录（v1.2.0 ExportTracker 追踪已导出 ID）
- [x] PDF/DOCX 导出格式支持（v1.2.0）
- [x] popup 笔记列表按日期排序（v1.2.0）
