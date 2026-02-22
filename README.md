# GET笔记超级助手

> 让Get笔记成为你超级助手

一键批量下载导出、一键导入Obsidian、一键订阅您喜欢的视频与播客、一键提交转录，一个插件全搞定。

`MD/DOCX/PDF` · `油管/B站/小宇宙` · `原文/总结/合并都OK` · `你的笔记你做主`

---

## 核心功能

### 一键收内容
YouTube、B站、小宇宙页面可直接提交，不用手动复制链接。

### 自动追更新
订阅后自动检查新内容，支持批量提交，省去重复操作。

### 批量导出到 Obsidian
支持 Markdown、PDF、DOCX，可 ZIP 下载，也可直接写入 Obsidian 仓库。

---

## 功能一览

- 支持导出为 Markdown、PDF、DOCX
- 支持 ZIP 下载，或直接写入 Obsidian 仓库（File System Access API）
- 支持命名模板、Frontmatter 字段与标签策略
- 支持「仅导出新增笔记」，减少重复导出
- 支持 YouTube、B站、小宇宙页面注入「Get笔记」一键提交按钮
- 支持订阅源（RSS/YouTube/播客）管理、定时检查与批量提交
- 支持 OPML 批量导入订阅源

---

## 安装方式（开发者模式）

1. 下载并解压扩展压缩包到本地文件夹
2. 打开 `chrome://extensions/`，开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压后的文件夹
4. 安装完成后，点击工具栏图标将扩展固定，方便随时使用

支持 Chrome / Edge / Brave / Arc 等 Chromium 系浏览器。

---

## 三步上手

1. 打开并登录 `biji.com`，确保账号状态正常
2. 点击工具栏图标，在弹窗中点击「获取全部笔记」
3. 选择导出格式（MD/PDF/DOCX）和导出方式（ZIP/Obsidian仓库），点击导出

---

## 隐私与安全

- 数据全部保存在浏览器本地存储，不上传到第三方服务器
- 仅在你主动触发抓取、导出、提交时发起网络请求
- 遵循 Manifest V3 最新扩展标准，代码完全开源可审查

---

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 保存设置、笔记缓存、导出记录、订阅状态 |
| `cookies` | 辅助访问登录态相关请求 |
| `alarms` | 执行订阅源定时检查 |
| host 权限 | 读取 biji.com 笔记数据；YouTube/B站/小宇宙页面注入按钮 |

---

## 插件架构

### 技术栈

- **平台**：Chrome/Chromium 扩展，Manifest V3
- **背景脚本**：Service Worker（`background.js`）
- **页面脚本**：原生 JavaScript，IIFE 模式，无构建工具
- **存储**：`chrome.storage.local` + IndexedDB（目录句柄）
- **文件系统**：File System Access API（直写 Obsidian 仓库）
- **内置第三方库**（`lib/`）：JSZip 3.10.1 · FileSaver.js · html2pdf.js · docx.js

### 文件结构

| 文件 | 角色 | 说明 |
|------|------|------|
| `manifest.json` | 扩展声明 | 权限、入口、content script、页面注册 |
| `background.js` | 后台核心 | 消息路由、抓取、导出 API、订阅管理、定时任务 |
| `content.js` | 桥接脚本 | 注入 `inject.js`，连接页面上下文与扩展上下文 |
| `inject.js` | 页面上下文钩子 | Hook XHR/fetch、扫描 Vue 状态、抓 transcript |
| `content-inject-btn.js` | 站外按钮注入 | 在 YouTube/B站/小宇宙页面注入提交按钮 |
| `popup.js` | 弹窗主逻辑 | 抓取、导出、订阅快捷管理 |
| `notes.js` | 笔记管理页 | 搜索筛选分页、批量导出 |
| `options.js` | 设置页 | 导出规则、性能参数、订阅配置，自动保存 |
| `subscriptions.js` | 订阅管理页 | 订阅 CRUD、筛选、分页、批量提交 |

页面文件：`popup.html` · `notes.html` · `options.html` · `subscriptions.html` · `welcome.html` · `help.html`

### 总体架构（数据流）

```
Biji 页面 (page context)
  └─ inject.js（XHR/fetch Hook + Vue 状态扫描）
       └─ content.js（桥接：自定义事件 → chrome.runtime.sendMessage）
            └─ background.js（Service Worker：消息路由、存储、API、定时任务）
                 ├─ chrome.storage.local（设置、笔记、订阅、记录）
                 ├─ Biji API / Export API
                 └─ Feed URL（RSS/YouTube/播客）

popup.js / notes.js / options.js / subscriptions.js
  ├─ → background.js（消息通信）
  ├─ → chrome.storage.local（直读）
  └─ → ZIP 下载 / Obsidian 仓库直写
```

### 关键链路

**链路 1：认证头捕获**
1. 用户在 `biji.com` 浏览，触发网络请求
2. `inject.js` Hook XHR/fetch，提取请求头
3. 经 `content.js` → `background.js` 传递 `apiHeaders` 消息
4. 后台白名单过滤后写入 `chrome.storage.local`

**链路 2：笔记数据获取**
- 自动来源：Hook 网络响应 + Vue store 扫描
- 手动来源：弹窗「获取全部笔记」→ 后台分页 API 抓取
- 统一经 `normalizeNote` 后入库

**链路 3：导出**
- 导出前补全缺失正文（`fetchContent`）和转录（`fetchTranscript`）
- ZIP：JSZip 打包并触发浏览器下载
- Obsidian仓库：File System Access API 直写目录，句柄持久化到 IndexedDB

**链路 4：订阅自动化**
- 订阅源存储在 `feeds`，`alarms` 定时触发 `checkAllFeeds`
- 拉取 RSS/Atom → 解析条目 → 新条目标记/自动提交
- 支持 RSS 2.0 / Atom / YouTube 频道 / OPML 批量导入

### 核心数据模型

**Note（规范化后）**
```ts
type Note = {
  id: string; title: string; content: string
  rawTranscript: string | null
  createdAt: string | number; updatedAt: string | number
  tags: Array<string | { name?: string; label?: string }>
  noteType: string | null; type: string
  audioUrl: string | null
  images: Array<string | { url?: string; src?: string }>
}
```

**Feed**
```ts
type Feed = {
  id: string; url: string; name: string; enabled: boolean
  addedAt: string; lastChecked: string | null
  type: "youtube" | "bilibili" | "podcast" | "other"
  channelName: string; thumbnail?: string; lastError?: string
}
```

**FeedItem 状态机**：`new` → `submitting` → `submitted` / `noted`

### chrome.storage.local 键清单

| 键名 | 说明 |
|------|------|
| `settings` | 全局设置（格式、模板、并发、订阅等） |
| `notes` | 笔记缓存 `{ [id]: note }` |
| `apiHeaders` | 过滤后的认证请求头 |
| `exportedIds` | 已导出笔记 ID 列表 |
| `feeds` | 订阅源配置 |
| `feedItems` | 订阅条目缓存（最多约 10000 条） |
| `submittedLinks` | 外链提交历史（最多约 500 条） |

---

## 帮助文档

详细使用步骤与常见问题见 `help.html`，或访问 [在线帮助中心](https://freedly2023.github.io/biji-obsidian-site/help.html)。
