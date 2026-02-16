# Biji to Obsidian 扩展 — v2.0.0 重构任务追踪

> 详细规划见 REFACTOR.md

---

## 阶段 0：基础设施搭建

> 目标：引入 Rollup + TypeScript，不改逻辑代码，验证构建输出功能一致

- [x] `npm init -y`，安装 Rollup + TypeScript 依赖
  - rollup, @rollup/plugin-typescript, @rollup/plugin-node-resolve, rollup-plugin-copy, tslib
  - typescript
- [x] 创建 `tsconfig.json`（allowJs: true, strict: true, target: ES2020）
- [x] 创建 `rollup.config.js` — 8 个入口点 IIFE 输出到 `dist/`
  - background.js, inject.js, content.js, content-inject-btn.js
  - popup.js, notes.js, options.js, subscriptions.js
  - 使用自定义 concatFiles 插件将依赖文件拼接到主入口（替代 importScripts 和多 script 标签）
- [x] 配置 copy 插件复制 manifest.json, HTML, CSS, lib/, 图标到 dist/
- [x] 现有 JS 原封不动复制到 `src/` 对应位置（暂保持 .js 扩展名）
- [x] 创建 `.gitignore`（dist/, node_modules/）
- [x] 添加 `npm run build` 和 `npm run watch` 脚本
- [x] HTML 文件中多余的 script 标签已合并（依赖由 Rollup 打包）

### 阶段 0 验证
- [x] 加载 `dist/` 到 Chrome，所有功能正常 ✔ (2026-02-16)

---

## 阶段 1：类型系统 + 核心模块提取

> 目标：定义 TypeScript 类型，提取纯逻辑模块到 src/core/，消除重复代码

- [x] 创建 `src/core/types.ts` — Note, Settings, Feed, FeedItem, FeedItemFilter, DateParts 等接口
- [x] 创建 `src/core/constants.ts` — 提取硬编码常量
  - background.js:17-18 的 BIJI_API_BASE, BIJI_EXPORT_API
  - link-submitter.js:10 的 SUBMIT_API_URL
  - shared.js:8-28 和 options.js:7-41 的 DEFAULT_SETTINGS（消除重复）
- [x] 创建 `src/core/normalize-note.ts` — 统一 inject.js:28-138 和 background.js:31-131 的重复实现
- [x] 创建 `src/core/date-utils.ts` — 统一 shared.js:39-82 和 subscription-shared.js:165-177 的日期函数
- [x] 创建 `src/core/sanitize.ts` — 统一 escapeHtml (shared.js/subscription-shared.js) + decodeXmlEntities/stripHtml (feed-manager.js)
- [x] 创建 `src/core/filename.ts` — 提取 shared.js 的 sanitize, filename, fullPath, getDateParts, getFolderPrefix, deduplicateFilename, getFileExt, fullPathWithFormat
- [x] 创建 `src/core/sort-utils.ts` — 提取 shared.js 的 sortNotesByDate
- [x] 创建 `src/core/markdown-converter.ts` — 提取 shared.js 的完整 MD 对象（含 MD 命名空间兼容导出）
- [x] 创建 `src/types/globals.d.ts` — JSZip, saveAs, html2pdf, docx, VaultWriter, chrome 类型声明

### 阶段 1 验证
- [x] 构建成功 ✔ (2026-02-16) — 8 个入口点全部通过
- [x] 加载 Chrome 测试导出功能（MD/PDF/DOCX 各测一次） ✔ (2026-02-16)

---

## 阶段 2：服务层重构 + async/await

> 目标：迁移 Chrome API 依赖模块为 TypeScript + async/await

- [x] `src/services/storage-service.ts` — chrome.storage.local Promise 封装
- [x] `src/services/settings-service.ts` — loadSettings（callback → async + 兼容 cb 版本）
- [x] `src/services/export-tracker.ts` — 提取自 shared.js:379-432
- [x] `src/services/server-exporter.ts` — 提取自 shared.js:434-562
- [x] `src/services/image-fetcher.ts` — 提取自 shared.js:564-606
- [x] `src/services/pdf-converter.ts` — 提取自 shared.js:608-740
- [x] `src/services/docx-converter.ts` — 提取自 shared.js:742-1000
- [x] `src/services/export-engine.ts` — 提取自 shared.js:1002-1512
- [x] `src/services/vault-writer.ts` — 重写自 vault-writer.js
- [x] `src/services/link-submitter.ts` — 重写自 link-submitter.js（使用 core/constants SUBMIT_API_URL）
- [x] `src/services/tag-manager.ts` — 重写自 tag-manager.js
- [x] `src/services/feed-parser.ts` — 从 feed-manager.js 提取 RSS/Atom XML 解析（使用 core/sanitize）
- [x] `src/services/feed-manager.ts` — 重写自 feed-manager.js（import feed-parser, link-submitter, tag-manager）
- [x] `src/shared.js` — 改写为薄 import 封装层（import → window.* 赋值）
- [x] `src/vault-writer.js` — 改写为薄 import 封装层
- [x] `src/link-submitter.js` — 改写为薄 import 封装层
- [x] `src/tag-manager.js` — 改写为薄 import 封装层
- [x] `src/feed-manager.js` — 改写为薄 import 封装层
- [x] `src/subscription-shared.js` — 改写为使用 core/sanitize + core/date-utils

### 阶段 2 验证
- [x] 构建成功 ✔ (2026-02-16) — 8 个入口点全部通过
- [x] 加载 Chrome 测试全部功能（导出、订阅、设置等） ✔ (2026-02-16)
- [x] shared.js 已改为薄封装层（原始 1512 行 → 50 行 import wrapper） ✔

---

## 阶段 3：background.js 重构

> 目标：将 862 行的 background.js 拆分为清晰模块

- [x] `src/background/message-router.ts` — 路由表模式替代 20+ if/else 分支
- [x] `src/background/api-fetcher.ts` — fetchAllNotes, fetchNoteContent, fetchNoteTranscript 等
- [x] `src/background/export-api.ts` — createExportTask, pollExportTask
- [x] `src/background/index.ts` — 主入口：badge、alarm、message router、apiHeaders 恢复
- [x] 消除 importScripts — 通过 import 引入，Rollup 打包为单个 IIFE
- [x] 删除旧文件：src/background.js, src/link-submitter.js, src/feed-manager.js, src/tag-manager.js

### 阶段 3 验证
- [x] 构建成功 ✔ (2026-02-16) — 零警告
- [x] 测试全部消息类型（getNotes, fetchAll, submitFeedItems, refreshAllFeedItems 等） ✔ (2026-02-16)
- [x] Badge 更新正常 ✔
- [x] Alarm 定时任务正常 ✔

---

## 阶段 4：inject.js + content script 重构

> 目标：拆分 inject.js 的 663 行

- [x] `src/inject/network-hooks.ts` — XHR hook + Fetch hook（~200行）
- [x] `src/inject/vue-scanner.ts` — scanVueStore, autoScanVueStore（~150行）
- [x] `src/inject/transcript-fetcher.ts` — fetchRawTranscript（~50行）
- [x] `src/inject/index.ts` — 组合上述模块 + 事件监听注册
- [x] `src/content/index.ts` — bridge 逻辑
- [x] `src/content-inject-btn/index.ts` + `platforms.ts`
- [x] 删除旧文件：src/inject.js, src/content.js, src/content-inject-btn.js

### 阶段 4 验证
- [x] 构建成功 ✔ (2026-02-16) — 零警告
- [x] biji.com 页面：XHR/Fetch 拦截正常 ✔ (2026-02-16)
- [x] biji.com 页面：Vue Store 扫描正常 ✔
- [x] biji.com 页面：全量获取（游标分页）正常 ✔
- [x] YouTube/B站/小宇宙：按钮注入正常 ✔

---

## 阶段 5：CSS 提取 + HTML 清理

> 目标：内联样式提取为独立 CSS 文件

- [x] 从 popup.html:5-530 提取 530 行 `<style>` → `styles/popup.css`
- [x] 识别 4 个页面共享样式 → `styles/common.css`
- [x] 从 options.html 提取 → `styles/options.css`
- [x] 从 notes.html 提取 → `styles/notes.css`
- [x] 从 subscriptions.html 提取 → `styles/subscriptions.css`
- [x] HTML 精简：移除 `<style>` 块，添加 `<link rel="stylesheet">`
- [x] 清除 HTML 中的 `style="..."` 属性，改用 CSS class

### 阶段 5 验证
- [x] 视觉对比每个页面，确保样式完全一致 ✔ (2026-02-16)

---

## 阶段 6：Extension Pages 重构

> 目标：重构 popup.js (846行)、notes.js、options.js、subscriptions.js

- [x] 从 popup.js:690-845 提取订阅标签页逻辑 → `src/pages/popup/subs-tab.ts`
- [x] 重构 `src/pages/popup/popup.ts` — 用 import 替代 window.* 全局变量
- [x] 重构 `src/pages/notes/notes.ts`
- [x] 重构 `src/pages/options/options.ts`
- [x] 重构 `src/pages/subscriptions/subscriptions.ts`
- [x] 重构 `src/shared-ui/subscription-shared.ts`
- [x] HTML script 标签简化为：第三方库 + 单个 Rollup bundle
- [x] 删除旧文件：src/popup.js, src/notes.js, src/options.js, src/subscriptions.js, src/subscription-shared.js, src/shared.js, src/vault-writer.js
- [x] rollup.config.js 移除 concatFiles 插件，入口改为 TypeScript 模块

### 阶段 6 验证
- [x] 构建成功 ✔ (2026-02-16) — 8 个入口点全部通过，零错误
- [ ] popup 笔记导出：选择 + 导出（ZIP/Vault × MD/PDF/DOCX）
- [ ] popup 订阅 Tab：刷新 + 提交
- [ ] notes.html：搜索/筛选/排序/分页/批量导出
- [ ] options.html：所有设置读写 + 保存/重置
- [ ] subscriptions.html：源管理 + OPML 导入 + 内容浏览 + 批量提交

---

## 回归 Bug 修复 (2026-02-16)

> v2.0.0 重构后发现的三个回归 bug

- [x] Transcript 获取串行 → 改为 5 并发 worker 池（`export-engine.ts:fetchMissingTranscripts`）
- [x] PDF Transcript 文档为空 → 纯文本按标点分段 + 空内容提前 reject（`pdf-converter.ts:generateTranscriptPdf`）
- [x] 获取全部笔记上限 100 条 → `findNotesArray` 条件 1 补 `f.name`，条件 2 移除错误的 content 检查（`normalize-note.ts`）

---

## 阶段 7：安全加固 + 收尾

> 目标：权限收紧、安全加固、版本升级

- [ ] manifest.json：`<all_urls>` → `optional_host_permissions`
- [ ] RSS 订阅时动态 `chrome.permissions.request()` 获取域名权限
- [ ] API headers 存储过滤：只保留认证相关字段
- [ ] 创建 `CHANGELOG.md`
- [ ] 版本号 → v2.0.0
- [ ] 清理根目录旧文件（原始 .js/.html，确认 dist/ 稳定后）

### 阶段 7 验证
- [ ] 完整功能回归测试（9 项验证清单，见 REFACTOR.md §5）

---

## 最终验证清单

- [ ] 笔记捕获：biji.com XHR/Fetch 拦截 + Vue Store 扫描
- [ ] 全量获取：游标分页 + 进度反馈
- [ ] ZIP 导出：MD/PDF/DOCX 格式
- [ ] Vault 导出：目录选择 + 文件写入
- [ ] 增量导出：ExportTracker 追踪正确
- [ ] 订阅管理：popup Tab + 独立页面，刷新/提交/OPML
- [ ] 设置页面：所有选项读写 + 保存/重置
- [ ] 视频平台按钮：YouTube/B站/小宇宙注入正常
- [ ] Badge 更新：角标数字正确
