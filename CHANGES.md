# CHANGES.md

## 2026-08-22 - 移除自定义图片路由，改用 DSH 原生附件渲染

### 问题
之前的自定义图片路由方案不兼容：
- 浏览器请求 `/plugins/dsh-makemake/image?attachmentId=xxx`，需要通过 SSH 隧道转发到 DSH
- `window.location.origin` 动态获取 origin 的方案仍然依赖自定义路由
- 图片渲染和 DSH 原生附件机制冲突

### 解决方案
改用 DSH 原生附件渲染机制，去掉所有自定义路由代码：
- 服务端只注册工具 `generate_image`，返回 `{ type: 'image', attachment }` 给 DSH 原生渲染
- 删除 `image-route.ts` 文件
- 删除 `webServer` 路由注册
- 删除客户端 `tool.call.toolview` 插槽和 `ImageResultCard` 组件
- 移除 `@deepseek-ai/dsh-host-webserver` 依赖

### 修改文件
- `src/index.ts` — 去掉 webServer 路由，简化注入列表，去掉 `presentResult`
- `src/shared.ts` — 删除 `IMAGE_ROUTE` 常量
- `src/image-route.ts` — **删除整个文件**
- `src/client/index.tsx` — 删除 `ImageResultCard` 组件和相关逻辑
- `package.json` — 移除 `@deepseek-ai/dsh-host-webserver` 依赖

### 架构说明
**之前（错误）：**
- 服务端：工具 → 返回 attachment → 自定义 `/plugins/.../image` 路由 → 浏览器 `<img>` 请求
- 客户端：注册 `tool.call.toolview` 插槽 → 手动渲染 `<img src={origin + '/plugins/...'}>`

**现在（正确）：**
- 服务端：工具 → 返回 `{ type: 'image', attachment }` → DSH 原生渲染
- 客户端：无需处理图片，DSH 自动处理

### 依赖变化
- 移除：`@deepseek-ai/dsh-host-webserver`（不再需要 webServer）
- 保留：`@deepseek-ai/dsh-attachment`（工具返回 attachment 类型）
- 保留：`@deepseek-ai/dsh-credentials`（渠道 Key 管理）

### 注意事项
- DSH 原生附件存储在 `$DSH_HOME/attachments/v1`，持久化到文件系统
- Attachment ID 在 DSH 会话期间有效，重启后仍然存在（不同于之前的内存 map）
- 图片渲染、预览、下载全部由 DSH 处理，插件无需关心
- 客户端仍保留 `settings.plugin.item` 插槽用于配置界面，以及 `conversation.input.right` 插槽用于打印机图标
