# 链接提交 + 订阅源追踪 — 实施跟踪

## Step 1: API 发现（inject.js 增强）
- [x] fetch hook 增强：POST 请求 body 捕获
- [x] XHR hook 增强：POST 请求 body 捕获
- [x] 通过 discovery 通道发送请求详情
- [x] API 端点已确认：`POST https://get-notes.luojilab.com/voicenotes/web/notes/stream` (SSE)

## Step 2: 链接提交模块
- [x] 新建 `link-submitter.js` IIFE 模块
- [x] `submitLink()` — SSE 流式响应解析，提取 note_id
- [x] `isAlreadySubmitted()` — URL 查重
- [x] `getSubmissionHistory()` — 提交历史
- [x] background.js 集成：importScripts + 消息处理

## Step 3: 页面内注入按钮
- [x] 更新 manifest.json：content_scripts、permissions、alarms
- [x] 新建 `content-inject-btn.js`：YouTube/B站/小宇宙按钮注入
- [x] 新建 `inject-btn.css`：按钮样式
- [x] SPA 导航监听（MutationObserver + setInterval + yt-navigate-finish）
- [x] 按钮状态：默认 → loading → 成功/失败/已提交

## Step 4: 订阅源管理模块
- [x] 新建 `feed-manager.js` IIFE 模块
- [x] RSS/Atom XML 解析器（DOMParser）
- [x] Feed CRUD：add/remove/toggle/getFeeds
- [x] `checkAllFeeds()` — 遍历 + 逐条提交（1s 间隔）
- [x] chrome.alarms 定时检查
- [x] background.js 集成：alarm 监听 + 消息处理

## Step 5: 设置页面 UI
- [x] 链接提交卡片：总开关 + 平台开关 + API 端点显示
- [x] 订阅源管理卡片：列表 + 添加 + 自动检查 + 立即检查
- [x] options.js 加载/保存新设置字段

## 待验证
- [ ] 在 YouTube 视频页验证按钮注入
- [ ] 在 B站视频页验证按钮注入
- [ ] 在小宇宙播客页验证按钮注入
- [ ] 点击按钮提交链接到 biji.com
- [ ] 添加 RSS 订阅源并手动检查
- [ ] 完整链路：提交 → biji.com 处理 → 导出到 Obsidian
