# Changelog

## v2.0.0

- TypeScript + Rollup 构建系统，替代原始 JS 文件
- 模块化重构：core/, services/, background/, inject/, pages/
- CSS 提取为独立样式文件（styles/）
- 权限收紧：`<all_urls>` 移至 `optional_host_permissions`，RSS 订阅按需请求权限
- API headers 存储安全过滤（白名单机制）
- 清理根目录旧 .js 文件
