# Biji to Obsidian 扩展 — v2.0.0 全面重构计划

> 版本 2.0.0 | 创建日期 2026-02-15

---

## 1. 当前问题分析

当前项目 v1.4.0 功能正常，但存在以下架构和质量问题：

### 1.1 架构问题

| 问题 | 说明 |
|------|------|
| **无模块系统** | 所有 JS 使用 IIFE + `window.*` 全局变量，无依赖追踪 |
| **shared.js 过大** | 1512 行巨型 IIFE，包含 MD 转换器、ExportEngine、ExportTracker、ImageFetcher、PDFConverter、DOCXConverter 等 10+ 模块 |
| **background.js 消息分发** | 862 行，单个 `onMessage` 监听器有 20+ if/else 分支（180 行） |
| **无构建工具** | 纯 JS，无 webpack/rollup/vite |

### 1.2 代码质量问题

| 问题 | 说明 |
|------|------|
| **重复代码** | `normalizeNote()` 在 inject.js 和 background.js 各有一份；日期函数在 3 个文件重复；`escapeHtml` 重复 |
| **Promise 链嵌套** | 未使用 async/await，大量 `.then().then().catch()` |
| **内联样式** | popup.html 有 530 行内联 CSS + 多处 inline style 属性 |
| **硬编码常量** | API URL、超时值、限制值散布多个文件 |
| **DEFAULT_SETTINGS 重复** | `shared.js` 和 `options.js` 各有一份默认设置对象 |

### 1.3 安全问题

| 问题 | 说明 |
|------|------|
| **`<all_urls>` 权限** | manifest.json 中 host_permissions 过宽 |
| **凭证明文存储** | API headers 存在 chrome.storage.local 未做字段过滤 |

### 1.4 缺失项

- 无 TypeScript 类型检查
- 无单元测试
- 无日志框架
- 无 i18n 系统
- 无 CHANGELOG

---

## 2. 技术选型

### 构建工具：Rollup

| 维度 | Rollup | Webpack | Vite |
|------|--------|---------|------|
| Tree-shaking | 原生最优 | 较弱 | 依赖 Rollup |
| 多入口 IIFE | 天然支持 | 需配置 | 偏 ESM |
| 配置复杂度 | 低 | 高 | 中 |
| Chrome Extension 适配 | 优秀 | 可用 | 需插件 |

**结论**：Rollup 最适合 Chrome Extension 场景——多入口 IIFE 输出，配置简洁，tree-shaking 最优。

### 语言：TypeScript

引入 Rollup 后 TypeScript 的编译成本几乎为零，但类型安全收益很大：
- 接口定义（Note, Settings, Feed, FeedItem）消除隐式约定
- 编译期捕获参数错误
- IDE 自动补全和重构支持

---

## 3. 目标文件结构

```
biji-obsidian-ext/
├── src/
│   ├── core/                        # 纯逻辑模块，无 Chrome API 依赖
│   │   ├── types.ts                 # Note, Settings, Feed, FeedItem 等接口
│   │   ├── constants.ts             # API URL、超时值、DEFAULT_SETTINGS
│   │   ├── normalize-note.ts        # normalizeNote + findNotesArray（消除重复）
│   │   ├── date-utils.ts            # formatDate, formatDateShort, formatRelativeDate
│   │   ├── sanitize.ts              # sanitize, escapeHtml, stripHtml, decodeXmlEntities
│   │   ├── filename.ts              # filename, fullPath, getFolderPrefix, deduplicateFilename
│   │   ├── markdown-converter.ts    # MD 对象
│   │   └── sort-utils.ts            # sortNotesByDate
│   │
│   ├── services/                    # Chrome API 依赖的服务层
│   │   ├── storage-service.ts       # chrome.storage Promise 封装
│   │   ├── settings-service.ts      # loadSettings
│   │   ├── export-tracker.ts
│   │   ├── server-exporter.ts
│   │   ├── image-fetcher.ts
│   │   ├── pdf-converter.ts
│   │   ├── docx-converter.ts
│   │   ├── export-engine.ts
│   │   ├── vault-writer.ts
│   │   ├── link-submitter.ts
│   │   ├── feed-manager.ts
│   │   ├── feed-parser.ts          # 从 feed-manager 提取的 RSS/Atom 解析
│   │   └── tag-manager.ts
│   │
│   ├── background/                  # Service Worker 入口
│   │   ├── index.ts                 # 主入口
│   │   ├── message-router.ts        # 路由表模式替代 if/else
│   │   ├── api-fetcher.ts           # fetchAllNotes, fetchNoteTranscript
│   │   └── export-api.ts            # createExportTask, pollExportTask
│   │
│   ├── inject/                      # 页面上下文注入
│   │   ├── index.ts
│   │   ├── network-hooks.ts         # XHR + Fetch hook
│   │   ├── vue-scanner.ts           # Vue Store 扫描
│   │   └── transcript-fetcher.ts
│   │
│   ├── content/
│   │   └── index.ts                 # bridge 逻辑
│   │
│   ├── content-inject-btn/
│   │   ├── index.ts
│   │   └── platforms.ts
│   │
│   ├── pages/
│   │   ├── popup/
│   │   │   ├── popup.ts
│   │   │   └── subs-tab.ts          # 订阅标签页（从 popup.js 后半提取）
│   │   ├── options/
│   │   │   └── options.ts
│   │   ├── notes/
│   │   │   └── notes.ts
│   │   └── subscriptions/
│   │       └── subscriptions.ts
│   │
│   ├── shared-ui/
│   │   └── subscription-shared.ts
│   │
│   └── types/
│       └── globals.d.ts             # JSZip, html2pdf, docx 等第三方库声明
│
├── styles/
│   ├── common.css                   # 公共样式（btn, card, form-group 等）
│   ├── popup.css
│   ├── notes.css
│   ├── options.css
│   ├── subscriptions.css
│   ├── inject-btn.css               # 保留原文件
│   └── nav-shared.css               # 保留原文件
│
├── html/                            # 精简后的 HTML（CSS 用 <link> 引入）
│   ├── popup.html
│   ├── notes.html
│   ├── options.html
│   └── subscriptions.html
│
├── dist/                            # 构建输出（.gitignore）
├── lib/                             # 第三方库（保持不变，不走 Rollup）
├── rollup.config.js
├── tsconfig.json
├── package.json
└── .gitignore
```

---

## 4. 实施方案

### 阶段 0：基础设施搭建

**目标**：引入 Rollup + TypeScript，不改任何逻辑代码，验证构建输出功能一致。

1. `npm init -y`，安装依赖：
   - `rollup`, `@rollup/plugin-typescript`, `@rollup/plugin-node-resolve`, `@rollup/plugin-commonjs`, `rollup-plugin-copy`
   - `typescript`
2. 创建 `tsconfig.json`（`allowJs: true`, `strict: true`, `target: ES2020`）
3. 创建 `rollup.config.js` — 8 个入口点，每个输出 IIFE 到 `dist/`：
   - `background.js`, `inject.js`, `content.js`, `content-inject-btn.js`
   - `popup.js`, `notes.js`, `options.js`, `subscriptions.js`
4. 配置 copy 插件复制：`manifest.json`, HTML, CSS, `lib/`, 图标
5. 把现有 JS 原封不动复制到 `src/` 对应位置（暂保持 .js）
6. 创建 `.gitignore`（dist/, node_modules/）
7. 添加 `npm run build` 和 `npm run watch` 脚本

**关键文件**：
- 新建: `package.json`, `tsconfig.json`, `rollup.config.js`, `.gitignore`

**验证**：加载 `dist/` 到 Chrome，所有功能正常。

---

### 阶段 1：类型系统 + 核心模块提取

**目标**：定义 TypeScript 类型，提取纯逻辑模块到 `src/core/`，消除重复代码。

1. **`src/core/types.ts`** — Note, Settings, Feed, FeedItem, FeedItemFilter 等接口定义
2. **`src/core/constants.ts`** — 提取自：
   - `background.js:17-18` 的 `BIJI_API_BASE`, `BIJI_EXPORT_API`
   - `link-submitter.js:10` 的 `SUBMIT_API_URL`
   - `shared.js:8-28` 和 `options.js:7-41` 的 `DEFAULT_SETTINGS`（消除两处重复）
3. **`src/core/normalize-note.ts`** — 统一自：
   - `inject.js:28-138` 的 `normalizeNote()` + `findNotesArray()`
   - `background.js:31-131` 的重复实现（标记为 "MIRROR — keep in sync"）
4. **`src/core/date-utils.ts`** — 统一自：
   - `shared.js:39-82` 的 `MD.formatDate`, `MD.formatDateShort`
   - `subscription-shared.js:165-177` 的 `formatRelativeDate`
5. **`src/core/sanitize.ts`** — 统一自：
   - `shared.js:375-377` 的 `window.escapeHtml`
   - `subscription-shared.js:159-163` 的 `SubShared.escHtml`
   - `feed-manager.js` 中的 `decodeXmlEntities`, `stripHtml`
6. **`src/core/filename.ts`** — 提取自 `shared.js` 的 sanitize, filename, fullPath, getDateParts, getFolderPrefix, deduplicateFilename, getFileExt, fullPathWithFormat
7. **`src/core/sort-utils.ts`** — 提取自 `shared.js` 的 sortNotesByDate
8. **`src/core/markdown-converter.ts`** — 提取自 `shared.js` 的完整 MD 对象
9. **`src/types/globals.d.ts`** — JSZip, saveAs, html2pdf, docx 的类型声明

**关键源文件**：
- `shared.js`（拆分来源）
- `inject.js:28-138`, `background.js:31-131`（重复代码消除）

**验证**：构建成功，加载 Chrome 测试导出功能（MD/PDF/DOCX 各测一次）。

---

### 阶段 2：服务层重构 + async/await

**目标**：迁移 Chrome API 依赖模块为 TypeScript + async/await。

按顺序迁移（每个模块迁移后验证）：

| # | 模块 | 来源 |
|---|------|------|
| 1 | `storage-service.ts` | 新建 — chrome.storage.local 的 Promise 封装（get/set/remove） |
| 2 | `settings-service.ts` | loadSettings（callback → async） |
| 3 | `export-tracker.ts` | 提取自 `shared.js:379-432` |
| 4 | `server-exporter.ts` | 提取自 `shared.js:434-562` |
| 5 | `image-fetcher.ts` | 提取自 `shared.js:564-606` |
| 6 | `pdf-converter.ts` | 提取自 `shared.js:608-740` |
| 7 | `docx-converter.ts` | 提取自 `shared.js:742-1000` |
| 8 | `export-engine.ts` | 提取自 `shared.js:1002-1512`（最复杂） |
| 9 | `vault-writer.ts` | 重写自 `vault-writer.js` |
| 10 | `link-submitter.ts` | 重写自 `link-submitter.js` |
| 11 | `tag-manager.ts` | 重写自 `tag-manager.js` |
| 12 | `feed-parser.ts` | 从 `feed-manager.js` 提取 RSS/Atom XML 解析（~170行） |
| 13 | `feed-manager.ts` | 重写自 `feed-manager.js` |

**关键源文件**：
- `shared.js`（拆分来源，行号见上）
- `vault-writer.js`, `link-submitter.js`, `tag-manager.js`, `feed-manager.js`

**验证**：每个模块迁移后构建并测试对应功能。

---

### 阶段 3：background.js 重构

**目标**：将 862 行的 background.js 拆分为清晰模块。

1. **`src/background/message-router.ts`** — 路由表模式：
   ```typescript
   const routes: Record<string, MessageHandler> = {
     'getNotes': handleGetNotes,
     'fetchAll': handleFetchAll,
     // ...20+ handlers
   };
   ```
   替代当前 `background.js:625-804` 的 20+ if/else 分支

2. **`src/background/api-fetcher.ts`** — 提取自 `background.js:140-310`：
   - fetchAllNotes, fetchNoteContent, fetchNoteTranscript
   - extractTranscript, extractContent, findTimestampStrings, findParagraphArray

3. **`src/background/export-api.ts`** — 提取自 `background.js:312-410`：
   - createExportTask, pollExportTask, exportNoteViaAPI

4. **`src/background/index.ts`** — 主入口：初始化 badge、alarm、message router、恢复 apiHeaders

**消除 importScripts**：当前 background.js 用 `importScripts('feed-manager.js', 'link-submitter.js', 'tag-manager.js')`。重构后通过 `import` 引入，Rollup 打包为单个 IIFE。

**关键源文件**：`background.js`

**验证**：测试全部消息类型（getNotes, fetchAll, submitFeedItems, refreshAllFeedItems 等）。

---

### 阶段 4：inject.js + content script 重构

**目标**：拆分 inject.js 的 663 行。

1. **`src/inject/network-hooks.ts`** — XHR hook + Fetch hook（~200 行）
2. **`src/inject/vue-scanner.ts`** — scanVueStore, autoScanVueStore（~150 行）
3. **`src/inject/transcript-fetcher.ts`** — fetchRawTranscript（~50 行）
4. **`src/inject/index.ts`** — 组合上述模块 + 事件监听注册
5. **`src/content/index.ts`** — bridge 逻辑
6. **`src/content-inject-btn/index.ts`** + **`platforms.ts`**

**注意**：inject.js 通过 `import` 引入 `normalize-note.ts`，Rollup 打包为单个 IIFE 在页面上下文运行。

**关键源文件**：`inject.js`, `content.js`, `content-inject-btn.js`

**验证**：在 biji.com 测试网络拦截、Vue Store 扫描、主动获取。在 YouTube/B站测试按钮注入。

---

### 阶段 5：CSS 提取 + HTML 清理

**目标**：将内联样式提取为独立 CSS 文件。

1. 从 `popup.html:5-530` 的 530 行 `<style>` 提取到 `styles/popup.css`
2. 识别 4 个页面共享的样式（.btn, .card, .form-group, .progress, body 等）→ `styles/common.css`
3. 从 `options.html` 提取 → `styles/options.css`
4. 从 `notes.html` 提取 → `styles/notes.css`
5. 从 `subscriptions.html` 提取 → `styles/subscriptions.css`
6. HTML 精简：移除 `<style>` 块，添加 `<link rel="stylesheet">`
7. 清除 HTML 中的 `style="..."` 属性，改用 CSS class

**关键源文件**：`popup.html`, `options.html`, `notes.html`, `subscriptions.html`

**验证**：视觉对比每个页面，确保样式一致。

---

### 阶段 6：Extension Pages 重构

**目标**：重构 popup.js (846行)、notes.js、options.js、subscriptions.js。

1. 从 `popup.js:690-845` 提取订阅标签页逻辑 → `src/pages/popup/subs-tab.ts`
2. 重构 `popup.ts`：用 `import` 替代 `window.*` 全局变量
3. 重构 `notes.ts`
4. 重构 `options.ts`
5. 重构 `subscriptions.ts`
6. 重构 `subscription-shared.ts`

HTML 的 `<script>` 标签简化：
```html
<!-- 之前：多个 script 标签加载 shared.js + 各种模块 -->
<!-- 之后：第三方库 + 单个 Rollup bundle -->
<script src="lib/jszip.min.js"></script>
<script src="lib/FileSaver.min.js"></script>
<script src="lib/html2pdf.bundle.min.js"></script>
<script src="lib/docx.min.js"></script>
<script src="popup.js"></script>
```

**关键源文件**：`popup.js`, `notes.js`, `options.js`, `subscriptions.js`, `subscription-shared.js`

**验证**：全部页面功能测试——导出、管理、设置、订阅。

---

### 阶段 7：安全加固 + 收尾

1. **manifest.json 权限收紧**：`<all_urls>` → `optional_host_permissions`，添加 RSS 订阅时动态 `chrome.permissions.request()`
2. **API headers 存储过滤**：只保留认证相关字段
3. 创建 `CHANGELOG.md`
4. 版本号 → v2.0.0
5. 清理旧文件（根目录下的原始 .js/.html 在确认 dist/ 稳定后删除）

**验证**：完整功能回归测试。

---

## 5. 验证方案

每个阶段完成后执行以下测试清单：

| # | 测试项 | 说明 |
|---|--------|------|
| 1 | **笔记捕获** | 打开 biji.com，检查 XHR/Fetch 拦截和 Vue Store 扫描 |
| 2 | **全量获取** | 点击"获取全部笔记"，检查游标分页和进度反馈 |
| 3 | **ZIP 导出** | 选择笔记 → 导出 ZIP（MD/PDF/DOCX 格式各测一次） |
| 4 | **Vault 导出** | 选择目录 → 写入 Vault |
| 5 | **增量导出** | 验证 ExportTracker 正确追踪已导出 ID |
| 6 | **订阅管理** | popup 订阅 Tab + 独立页面，刷新/提交/OPML 导入 |
| 7 | **设置页面** | 所有选项读写正确，保存/重置正常 |
| 8 | **视频平台按钮** | YouTube/B站/小宇宙页面注入按钮正常显示 |
| 9 | **Badge 更新** | 捕获笔记后图标角标数字正确 |

---

## 6. 当前文件→目标模块映射

| 当前文件 | 目标模块 |
|----------|----------|
| `shared.js` (1512行) | `core/` 8 个模块 + `services/` 8 个模块 |
| `background.js` (862行) | `background/` 4 个模块 |
| `inject.js` (663行) | `inject/` 4 个模块 |
| `content.js` (111行) | `content/index.ts` |
| `content-inject-btn.js` (257行) | `content-inject-btn/` 2 个模块 |
| `popup.js` (846行) | `pages/popup/` 2 个模块 |
| `notes.js` (559行) | `pages/notes/notes.ts` |
| `options.js` (552行) | `pages/options/options.ts` |
| `subscriptions.js` (446行) | `pages/subscriptions/subscriptions.ts` |
| `subscription-shared.js` (180行) | `shared-ui/subscription-shared.ts` |
| `vault-writer.js` (231行) | `services/vault-writer.ts` |
| `feed-manager.js` (797行) | `services/feed-manager.ts` + `services/feed-parser.ts` |
| `link-submitter.js` (138行) | `services/link-submitter.ts` |
| `tag-manager.js` (81行) | `services/tag-manager.ts` |
| `popup.html` (684行) | `html/popup.html` (精简) + `styles/popup.css` |
| `notes.html` (502行) | `html/notes.html` (精简) + `styles/notes.css` |
| `options.html` (791行) | `html/options.html` (精简) + `styles/options.css` |
| `subscriptions.html` (270行) | `html/subscriptions.html` (精简) + `styles/subscriptions.css` |
