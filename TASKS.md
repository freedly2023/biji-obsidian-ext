# 链接提交 + 订阅源追踪 — 实施跟踪

## Step 1: API 发现（inject.js 增强）✅
- [x] fetch hook 增强：POST 请求 body 捕获
- [x] XHR hook 增强：POST 请求 body 捕获
- [x] 通过 discovery 通道发送请求详情
- [x] API 端点已确认：`POST https://get-notes.luojilab.com/voicenotes/web/notes/stream` (SSE)

## Step 2: 链接提交模块 ✅
- [x] 新建 `link-submitter.js` IIFE 模块
- [x] `submitLink()` — SSE 流式响应解析，提取 note_id
- [x] `isAlreadySubmitted()` — URL 查重
- [x] `getSubmissionHistory()` — 提交历史
- [x] background.js 集成：importScripts + 消息处理

## Step 3: 页面内注入按钮 ✅
- [x] 更新 manifest.json：content_scripts、permissions、alarms
- [x] 新建 `content-inject-btn.js`：YouTube/B站/小宇宙按钮注入
- [x] 新建 `inject-btn.css`：按钮样式
- [x] SPA 导航监听（MutationObserver + setInterval + yt-navigate-finish）
- [x] 按钮状态：默认 → loading → 成功/失败/已提交

## Step 4: 订阅源管理模块 ✅
- [x] 新建 `feed-manager.js` IIFE 模块
- [x] RSS/Atom XML 解析器（DOMParser）
- [x] Feed CRUD：add/remove/toggle/getFeeds
- [x] `checkAllFeeds()` — 遍历 + 逐条提交（1s 间隔）
- [x] chrome.alarms 定时检查
- [x] background.js 集成：alarm 监听 + 消息处理

## Step 5: 设置页面 UI ✅
- [x] 链接提交卡片：总开关 + 平台开关 + API 端点显示
- [x] 订阅源管理卡片：列表 + 添加 + 自动检查 + 立即检查
- [x] options.js 加载/保存新设置字段

## 待验证（v1.3.0）
- [ ] 在 YouTube 视频页验证按钮注入
- [ ] 在 B站视频页验证按钮注入
- [ ] 在小宇宙播客页验证按钮注入
- [ ] 点击按钮提交链接到 biji.com
- [ ] 添加 RSS 订阅源并手动检查
- [ ] 完整链路：提交 → biji.com 处理 → 导出到 Obsidian

---

# 订阅管理功能重构（v1.4.0）— 实施跟踪

> 详细规划见 DEVDOC.md §10

## Step 1: feed-manager.js 重构
- [x] Feed 对象增强：新增 type、channelName 字段
- [x] 数据迁移：现有 feeds 自动补充 type（URL 模式检测）和 channelName
- [x] Feed Items 存储：新增 `feedItems` storage key，存储解析的 RSS 条目
- [x] parseFeedXml 增强：提取 thumbnail（media:thumbnail / itunes:image）
- [x] 两阶段流程：获取存储（不自动提交）+ 用户选择提交
- [x] editFeed() 方法
- [x] OPML 批量导入解析器（正则解析 XML，匹配 outline 元素属性）
- [x] addFeed() 自动 fire-and-forget 获取内容
- [x] importFeedsOpml() 导入后自动获取新 feeds 内容
- [x] YouTube URL 自动转换为 RSS feed URL
- [x] feedAutoSubmit 设置支持（兼容旧的自动提交行为）

## Step 2: tag-manager.js 新建
- [x] IIFE 模块：storePendingTags / getPendingTags
- [x] pendingTags storage key 管理
- [x] background.js importScripts 集成

## Step 3: background.js 消息处理器
- [x] getFeedItems — 获取 feed items（支持筛选）
- [x] submitFeedItems — 批量提交选中项 + 预存标签
- [x] refreshAllFeedItems / refreshFeedItems — 刷新 feed 内容
- [x] editFeed — 编辑 feed 属性
- [x] importFeedsOpml — OPML 批量导入
- [x] convertYoutubeUrl — YouTube URL 转换
- [x] getPendingTags — 获取待应用标签

## Step 4: subscription-shared.js 新建
- [x] renderFeedItemCard() — 播客阅读器风格卡片渲染
- [x] formatRelativeDate() — 相对时间显示
- [x] getStatusBadgeHtml() — 状态徽章
- [x] groupItemsByFeed() — 按频道分组

## Step 5: Popup Tab 系统 + 订阅 Tab
- [x] popup.html：添加 Tab 栏（笔记导出 | 订阅管理），现有内容包裹在 tab panel 中，新增订阅 panel
- [x] popup.js：Tab 切换逻辑
- [x] popup.js：订阅 Tab 数据加载、卡片渲染、筛选
- [x] popup.js：批量选择 + 提交功能
- [x] popup.js："管理订阅"按钮打开独立页面
- [x] popup.js：loadSubsTab() 自动刷新（有 feeds 无 items 时触发 refreshAll）

## Step 6: subscriptions.html + subscriptions.js 独立页面
- [x] 页面布局（参照 notes.html，800px 居中）
- [x] 订阅源管理卡片：feed 列表 + 添加 + 编辑 + 删除
- [x] OPML 批量导入 UI（折叠区域 + 文件选择器）
- [x] 添加订阅源后自动获取内容 + 延迟刷新列表
- [x] 筛选卡片：搜索 + 频道 + 类型 + 状态 + 日期 + 排序
- [x] 批量操作卡片：全选 + 提交 + 进度条
- [x] 内容列表：按频道分组卡片 + 分页
- [x] 与 notes.html 互通导航链接

## Step 7: 导出时标签合并 ✅
- [x] shared.js：添加 mergePendingTags() 辅助函数
- [x] popup.js / notes.js：导出前加载 pendingTags，合并到 note.tags

## Step 8: 收尾
- [ ] notes.html header 添加"订阅管理"导航链接
- [ ] options.html/options.js：添加"打开订阅管理"链接 + feedAutoSubmit 设置
- [ ] manifest.json 版本号 → 1.4.0
- [ ] DEVDOC.md 更新目录结构和消息类型清单

---

# 订阅内容拉取修复 + 小宇宙风格 UI — 实施跟踪 (v1.5.0)

## 第一部分：修复内容拉取

### feed-manager.js
- [x] 1a. fetchFeedContent 添加请求头（Accept、User-Agent）+ AbortController 15秒超时
- [x] 1b. parseFeedXml 增强播客 RSS 支持：itunes:duration、itunes:image、itunes:summary、enclosure URL
- [x] 1b. parseFeedXml 返回 `{ items, channel }` 对象，channel 包含 title 和 thumbnail
- [x] 1c. feed item 存储增加 duration、enclosureUrl 字段
- [x] 1d. _fetchAndStoreFeedItems 自动从 RSS channel 提取封面图存入 feed.thumbnail
- [x] 1d. 自动从 channel title 更新 feed.channelName（当 name 为 URL 时）
- [x] 1f. 拉取失败时存储 lastError 到 feed 对象；成功时清空
- [x] 1f. _checkAllFeedsAutoSubmit 适配 parseFeedXml 新返回格式

### subscriptions.html
- [x] 1g. 输入框占位符改为 "RSS / YouTube 频道 / 播客 RSS URL"

## 第二部分：小宇宙风格 UI 重设计

### subscriptions.html — 完整布局重构
- [x] 白色顶部栏：左侧"订阅更新"标题，右侧导航链接
- [x] 频道条：横向可滚动封面图行（52px 方形，圆角 12px），隐藏滚动条
- [x] 可折叠订阅管理面板（默认隐藏），通过频道条"管理"按钮切换
- [x] 紧凑过滤栏：搜索 + 类型/状态下拉 + 刷新按钮
- [x] 内容列表白色卡片容器
- [x] 底部固定批量操作栏（选中时才显示）
- [x] 分页保留
- [x] CSS：白色/浅灰背景 #f7f8fa，卡片白色+轻阴影，紫色仅作强调色
- [x] 移除厚重紫色头部
- [x] 响应式：max-width 800px 居中

### subscription-shared.js — 卡片 + formatDuration
- [x] 重写 feedItemCardHtml：72px 缩略图 + 2行标题 + 2行描述 + 元信息行
- [x] 添加 formatDuration：支持 ISO 8601（PT134M20S）、HH:MM:SS、MM:SS、秒数
- [x] 缩略图加载失败回退到播放图标

### subscriptions.js — 频道条/管理面板/平铺列表/轮询
- [x] renderChannelStrip：从 feeds 构建横向列表，显示封面图或首字母回退
- [x] "全部"默认选中，点击频道过滤列表
- [x] "管理"按钮切换订阅管理面板
- [x] renderPage 改为平铺列表（去掉按频道分组）
- [x] applyFilters 用 feedId 替代 channel name 过滤
- [x] 3秒 setTimeout 改为轮询（每2秒检查，最多14秒）
- [x] OPML 导入也使用轮询
- [x] feed 管理列表显示 lastError（有错误时显示警告图标+错误信息）
- [x] 批量操作栏仅在选中条目时显示（fixed bottom）

---

# Bug 修复 + 功能增强 (v1.5.1) — 实施跟踪

## 问题 1：YouTube 中文频道 URL 失败
- [ ] feed-manager.js：convertYoutubeUrl 正则 `/@([a-zA-Z0-9_-]+)/` 改为 `/@([^/?#]+)/`

## 问题 2：提交后状态不实时更新 + 按钮可用性
- [ ] popup.js：提交回调中只移除成功的 guid、显式 re-enable 按钮
- [ ] subscriptions.js：同上处理

## 问题 3：过滤栏添加日期筛选
- [ ] subscriptions.html：过滤栏增加 `<select id="filterDate">`（全部/近7天/近30天/近90天）
- [ ] subscriptions.js：applyFilters 增加日期范围过滤

## 问题 4：页面注入按钮自动带 tags
- [ ] content-inject-btn.js：添加 platformType + getChannelName()，submitLink 带 tags
- [ ] background.js：submitLink handler 成功后调用 TagManager.storePendingTags

## 问题 5：已提交条目添加 AI总结/原文 按钮
- [ ] subscription-shared.js：feedItemCardHtml 中 submitted+noteId 时追加两个 biji.com 链接
