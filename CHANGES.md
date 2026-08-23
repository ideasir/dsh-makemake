# CHANGES.md

## 2026-08-23 - 图生图修复 + 渠道检测按钮 + 提示词透传

### 问题
1. **图生图彻底失效**：之前走 `/images/edits`（Agnes 该端点 404 不存在）+ FormData，参考图根本没被使用，实际降级成文生图
2. **图生图降级**：参考图读不到时静默降级文生图，用户不知道
3. **提示词被 AI 二次改写**：会话里 AI 把用户的话改成 "Same scene" "ADDITION" 等扩写内容，图生图结果跟用户想要的完全不一样
4. **渠道兼容性未知**：不同 API（Agnes、umfun、OpenAI）图生图传图格式不同（顶层 image / extra_body.image / edits），没有检测手段

### 解决方案
1. **图生图端点修复**：核对 Agnes 官方文档（agnes-ai.com/zh-Hans/docs/agnes-image-21-flash），图生图是 `POST /v1/images/generations` + JSON body，参考图放 `extra_body.image` 数组（Data URI Base64），顶层不传 image。实测返回 i2i 路径 200 成功
2. **失败不降级**：参考图读不到直接报错，不再静默降级文生图
3. **提示词透传铁律**：`skill.ts` 增加规则——prompt 必须原样透传用户说的话，禁止改写/扩写/翻译/补充描述
4. **渠道检测按钮**：渠道编辑面板加「🔍 检测」按钮，调用服务端 `/plugins/dsh-makemake/test` 路由
   - 检测方式：**快速探针**（不真实生成图，毫秒级返回）
     - 文生图：空参数 POST `/images/generations`，看返回码判断（503=端点存在但缺参、404=端点不存在、401=Key 无效、其他=可用）
     - 图生图：发 1x1 透明 PNG + 缺 model 名，看返回码判断 3 种格式（顶层 image / extra_body.image / /images/edits）哪个被接受
     - 视频：POST `/v1/videos` + GET `/v1/videos` 探测端点存在性
   - 结果展示：检测成功 ✓ + 文生图端点 + 图生图端点（小字标注）+ 视频端点，各带 ✓/✗ 和 HTTP 端点

### 踩坑记录
- **Agnes 图生图不是 /images/edits**：该端点 404。官方文档明确是 `/images/generations` + `extra_body.image` 数组
- **Agnes 不支持 FormData**：`/images/generations` 只收 `Content-Type: application/json`，收 multipart 返回 400
- **umfun（New API 网关）出图很慢**：真实生成 39 秒才返回，检测不能等真实生成，必须用探针法
- **DSH webServer handler 是 Node IncomingMessage**：不能 `new Response(req).json()`，要 `for await (const chunk of req)` 读 body
- **DSH 重启要确认旧进程真的死了**：`pkill -f "dsh.*3080"` 匹配不全时端口被占，新进程 EADDRINUSE 退出；用 `ss -tlnp | grep 3080` 确认

### 验证
- umfun 渠道检测：0.3 秒，文生图 ✓，图生图 3 格式全 ✓
- Agnes 渠道检测：2.3 秒，文生图 ✓，图生图 3 格式全 ✓
- Agnes 视频检测：1.0 秒，`/v1/videos` ✓
- umfun 图生图真实调用：39 秒返回 base64（通道真的支持，只是慢）

### 修改文件
- `src/index.ts` — 图生图逻辑重写（extra_body.image）、新增 `/plugins/dsh-makemake/test` 检测路由
- `src/client/index.tsx` — 检测按钮 UI + 状态管理 + 结果展示
- `src/skill.ts` — 提示词透传铁律

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
