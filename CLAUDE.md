# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

**GET笔记超级助手** — Chrome/Chromium 浏览器扩展（Manifest V3），用于抓取 `biji.com` 笔记并导出到 Obsidian，同时支持 RSS/YouTube/播客订阅自动化。

## 开发与调试

### 加载扩展（无构建步骤，直接运行）

1. 打开 `chrome://extensions/`，开启「开发者模式」
2. 点击「加载已解压的扩展程序」，选择项目根目录
3. 修改 JS/HTML/CSS 后，点击扩展页的「刷新」图标（无需重新加载）

### 基础回归验证（每次改动后执行）

1. 登录 biji.com，确认 `apiHeaders` 被捕获（弹窗显示「已获取认证」）
2. 弹窗点击「获取全部笔记」— 验证分页抓取可完成/取消
3. MD/PDF/DOCX 导出是否成功，PDF/DOCX 失败时是否回退到 MD
4. Vault 目录绑定与二次授权恢复是否正常
5. 订阅源新增/手动刷新/批量提交是否正常
6. YouTube / B站 / 小宇宙页面注入按钮是否显示、可提交、有去重

## 架构

### 无构建工具

项目**无 npm 构建链、无打包工具**，所有 JS 以 IIFE 或直接脚本形式运行，第三方库预打包在 `lib/` 目录。修改任何 `.js` 文件后直接刷新扩展即生效。

### 核心数据流

```
Biji 页面 (page context)
  └─ inject.js（Hook XHR/fetch + Vue store 扫描）
       └─ content.js（桥接：biji-ext-* 自定义事件 → chrome.runtime.sendMessage）
            └─ background.js（Service Worker：消息路由、存储、API、alarms）
                 ├─ chrome.storage.local（settings / notes / feeds / apiHeaders 等）
                 └─ Biji API / Feed URL

popup.js / notes.js / options.js / subscriptions.js
  ├─ → background.js（chrome.runtime.sendMessage 通信）
  ├─ → chrome.storage.local（直接读取）
  └─ → JSZip 下载 / File System Access API 写 Obsidian Vault
```

### 文件职责速查

| 文件 | 职责 |
|---|---|
| `background.js` | 核心 Service Worker：消息路由、笔记抓取、导出任务、订阅管理、alarms 定时 |
| `inject.js` | 在 biji.com 页面上下文中 Hook XHR/fetch、扫描 Vue2/3/Pinia/Vuex 状态 |
| `content.js` | 桥接脚本：注入 inject.js，转发 biji-ext-* 自定义事件到扩展上下文 |
| `content-inject-btn.js` | 在 YouTube/B站/小宇宙页面注入「Get笔记」一键提交按钮，监听 SPA 路由变化 |
| `popup.js` | 弹窗：抓取触发、导出引擎（MD/PDF/DOCX/ZIP/Vault）、订阅快捷管理 |
| `notes.js` | 笔记管理页：多条件筛选分页 + 批量导出（与 popup.js 含大量重复导出逻辑） |
| `options.js` | 设置页：导出规则/Frontmatter/并发参数/Vault 绑定/订阅配置，带 debounce 自动保存 |
| `subscriptions.js` | 订阅管理页：CRUD、筛选分页、批量提交、OPML 导入 |
| `lib/` | 预打包第三方库：JSZip · FileSaver.js · html2pdf.js · docx.js |
| `styles/` | 各页面独立 CSS + `common.css` |

### 消息通信

所有页面通过 `chrome.runtime.sendMessage` 与 `background.js` 的 `routes` 对象通信。常用消息类型：`getNotes`、`fetchAll`、`cancelFetch`、`exportNote`、`submitLink`、`getFeeds`、`addFeed`、`checkFeedsNow`、`submitFeedItems`。

### 存储结构

`chrome.storage.local` 核心键：`settings`、`notes`（`{[id]: note}`）、`apiHeaders`、`feeds`、`feedItems`（`{[guid]: item}`）、`exportedIds`、`submittedLinks`。

Obsidian Vault 目录句柄持久化到 **IndexedDB**（不在 `chrome.storage.local` 中）。

### 导出策略

- **PDF/DOCX**：优先调用服务端导出 API（`/export/tasks`），失败时回退本地（`html2pdf` / `docx.js`）
- **`transcriptMode=merged`**：强制本地渲染，确保正文+转录合并
- **ZIP 根目录**：固定为 `biji-export/`
- **Vault 子目录**：默认 `biji-notes`，可配置

### 订阅条目状态机

`new` → `submitting` → `submitted` / `noted`

## 已知技术债

- `popup.js` 与 `notes.js` 重复包含大量导出引擎代码（`ExportEngine`/`VaultWriter`/工具函数），修 bug 需双改
- 无自动化测试
- Feed XML 解析依赖正则，非标准 feed 可能误解析
- 注入按钮 DOM 选择器强依赖目标站点结构，站点改版易失效
