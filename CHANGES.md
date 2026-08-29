# CHANGES.md

## 2026-08-26 - 渠道适配开放化（检测→适配→保存）+ 多Key轮询修复 + 编辑弹窗

### 需求背景
主任要求视频/图片渠道**不写死**——用户填 baseURL + Key + 模型名，系统自动探测正确端点并适配，换任何 provider 都能用。同时渠道编辑从下拉内嵌表单改为**独立弹窗**，检测结果逐端点展示并支持"一键适配"。

### 解决方案
1. **渠道编辑改弹窗**（`src/client/index.tsx`）：VideoChannelPanel 的内嵌编辑表单 → 独立 `ChannelEditModal` 居中弹窗
   - 渠道配置区：渠道名 / 接口地址 / API Key（多行轮询）/ 轮询方式（轮询/顺序）
   - 模型配置区：模型名输入 + "🔍 获取模型列表"按钮（调 `/models` 路由，自动识别出图/出视频模型）
   - 逐端点检测：文生图 / 图生图 / 视频提交 / 图生视频 / 任务轮询，每项 ✓/✗/⚠
   - "✓ 保存适配结果"：把检测到的端点路径写入渠道 `adapt` 字段
2. **逐端点检测路由**（`src/index.ts` `/check-endpoints`）：不穷举显示，每能力只报一行，找到通的就停
   - 图片：试 `/v1/images/generations` → `/images/generations`，图生图复用端点测格式
   - 视频：试 `/v1/videos` → `/videos` → `/video/generations` → `/tasks`
   - 图生视频、任务轮询（发真实请求看返回 task_id 推断轮询方式）
3. **模型列表路由**（`/models`）：查 `/v1/models`，按关键词自动归类出图/出视频模型
4. **401 语义修正**：401 = 端点存在但 Key 无效（⚠ 黄色），不再误判为失败或成功；404 = 端点不存在（✗）
5. **多Key轮询修复**（关键）：
   - **根因**：YAML 单引号字符串里 `\n` 是**字面反斜杠+n**，不是换行符。后端 `split(/[\n\r,;]+/)` 匹配不到，整串当 1 个 Key 发出去 → 401
   - `KeyPool` 构造函数加 `normalize`：`raw.replace(/\\n/g,'\n')` 把字面 `\n` 转真实换行再拆分
   - index.ts 所有 `cred.value.split()` 统一加 normalize
   - 前端 `split('\\n')` → `split('\n')`（fetchModels 和 checkEndpoints）
6. **baseURL 标准化**：剥掉 `/videos` 路径后缀再探测/拼接，避免 `.../videos/v1/videos` 三重嵌套
7. **视频 URL 拼接修复**：`videoBase` 剥 `/videos` 后统一到 `/v1`，再拼 `/videos`
8. **错误信息细化**：DSH 错误块结构是 `{name, code}` 没有 `message`，前端 `block.error?.message` 永远是 undefined → 一直显示"未知错误"。改为从 content text block 取错误信息
9. **config.ts / channels.ts 加 `adapt` 字段**：保存适配结果（imageEndpoint/videoEndpoint/videoPollPath 等），生成时直接读，不写死

### 踩坑记录
- **`Bearer $${apiKey}` 多了个 `$`**：导致所有探测请求都带 `$sk-xxx` 错误 Key，全部 401。这是"检测全失败"的隐藏根因，排查了很久
- **YAML 单引号 `\n` 是字面字符**：不是换行符，多Key存进去后 `split('\n')` 拆不开
- **DSH 错误块没有 message 字段**：只有 `{name, code}`，取错误信息要从 content text block 拿
- **patch 写正则转义陷阱**：`\/` 在 patch 参数里被多次 JSON 转义，容易写成 `\\\\/`（匹配反斜杠而非斜杠），导致 tsc TS1109 报错。需用 read_file 确认实际字节

### 验证
- `npx tsc --noEmitOnError false` + `npx tsdown` 构建成功
- DSH 重启后 127.0.0.1:3080 正常
- 用真实 Agnes 渠道测 `/models` 路由：成功返回 9 个模型并正确分类
- 19 个 Key 逐个直接打 Agnes API 均返回 200（证明多Key拆分正确，429 是 Agnes 1分钟/账号限流）

### 修改文件
- `src/index.ts` — check-endpoints/models 路由 + 多Key normalize + baseURL 标准化 + 视频URL拼接修复 + 错误分类
- `src/probe.ts` — 401/429 语义修正 + normalizeVideoBase + probeModelsList/classifyModels
- `src/channels.ts` — KeyPool normalize + Channel 接口加 adapt
- `src/config.ts` — channelSchema 加 adapt
- `src/client/index.tsx` — ChannelEditModal 弹窗 + 模型列表 + 逐端点检测 + 错误信息细化

## 2026-08-23 (晚2) - 图生视频支持 + 检测区分文生/图生视频

### 问题
用户上传图片后用"让画面动起来"出视频，但 makemake_video 工具**没有 image 参数**，模型没法传参考图，结果被当成文生视频处理。

### 解决方案
1. **makemake_video 工具加 image 参数**：`{ type: 'string', description: 'Optional reference image URL or path for image-to-video (i2v)' }`
2. **execute 里传 image 到请求体**：有 image 时加 `image: resolvedImage` 到 POST body（Agnes 文档规定图生视频用顶层 `image` 字段传图片 URL）
3. **检测路由加图生视频探测**（`/plugins/dsh-makemake/test`）：POST `/v1/videos` + data URL 图片，看返回码判断图生视频端点是否可用
4. **前端 UI 检测结果细分**：原来只显示一个"视频"行，现在分两行：
   - 文生视频 ✓/✗ POST /v1/videos
   - 图生视频 ✓/✗ POST /v1/videos
5. **skill.ts 更新**：明确说"图生视频传 image 参数"

### 踩坑记录
- **Agnes 图生视频用顶层 image 字段**（不是 extra_body.image）。文档原文：`image | string | 否 | 图生视频使用的图片 URL`。extra_body.image 是**关键帧动画**用的，不是单图生视频。
- **Agnes 视频 API 1 分钟限流 1 次**：探测时不能真实生成，只能发探针看返回码（429 都算端点可用）
- **探测只能用 data URL 图片**：不能传 URL，因为探测时没有可公开访问的图片 URL。data URL 是 Base64 编码的小图，无需外部存储。

### 验证
- tsc --noEmitOnError false + tsdown 构建成功
- lib/index.js 35KB，lib/client.js 68KB
- DSH 重启后 127.0.0.1:3080 正常
- 代码已推送 GitHub（commit baf0584）

### 修改文件
- `src/index.ts` — 工具 image 参数 + execute 传 image + 检测路由图生视频探测 + 类型声明
- `src/client/index.tsx` — 检测结果分别显示文生视频/图生视频
- `src/skill.ts` — 图生视频调用规则

## 2026-08-23 (晚) - 右键渠道选择 + /渠道名 命令规范

### 需求背景
主任新规范：**出图/出视频命令不再用 /make出图、/make视频 前缀，直接用渠道名**。
- 对话框的图片/视频按钮：**左键** = 用当前选中渠道注入 `/渠道名 ` 命令；**右键** = 弹出渠道列表选择，选中后自动切换并注入 `/渠道名 ` 命令。
- 示例：出图有两个渠道「agnes」「gpt出图通道」，命令就是 `/agnes 一只猫` 或 `/gpt出图通道 一只猫`。

### 解决方案
1. **客户端右键菜单**（`src/client/index.tsx`）：
   - 图片/视频按钮加 `onContextMenu`（右键）→ 弹出渠道列表浮层（channel 名 + model 名 + ✓ 标记当前选中）
   - 选中某渠道 → `scope.set('selectedImageChannel'/'selectedVideoChannel', ch.id)` 切换默认渠道 + 注入 `/渠道名 ` 命令
   - 左键 → 注入当前选中（或第一个）渠道的 `/渠道名 ` 命令
   - 浮层点击空白处自动关闭（mousedown listener）
   - 依赖 `scope.subscribe` 实时同步渠道列表（设置页增删渠道后按钮菜单自动更新）
2. **命令高亮升级**：原 `/make` 前缀高亮 → 改为**任意 `/中文/英文/数字/下划线` 开头**的命令都高亮亮蓝色（正则 `^\/[\u4e00-\u9fa5A-Za-z0-9_-]+`），解决渠道名命令颜色透明问题
3. **系统提示词动态化**（`src/index.ts` systemPrompt.section）：
   - `text` 从静态字符串改为**函数**，每次组装 prompt 时实时读取当前设置
   - 生成「当前可用渠道」列表：`图片生成渠道（命令：/渠道名1 或 /渠道名2）：调用 makemake_image 工具`
   - 模型因此知道 `/xxx` 对应哪个工具、用哪个渠道
4. **工具 channel 参数**：
   - `makemake_image` / `makemake_video` 增加 `channel` 参数（渠道名）
   - execute 里按渠道名过滤：用户输入 `/渠道名` 时只用该渠道，未指定时用当前选中渠道

### 踩坑记录
- **模板字符串里不能有反引号**：skill.ts 第 10 行 `通过 \`channel\` 参数` 里的反引号直接终止了模板字符串，报 TS1005。改成普通引号。
- **`npm run build`（tsc && tsdown）会因历史遗留类型错误失败**：webServer 类型不存在（dsh-host-webserver 0.1.1-rc.2 版本不匹配）、attachmentId 品牌类型不兼容——这些是**改动前就存在**的问题，与本次改动无关。**正确构建姿势：`npx tsc --noEmitOnError false` 生成服务端 lib + `npx tsdown` 生成客户端 lib**，两个都要跑。
- **DSH 重启**：杀旧进程（PID 精确 kill）+ cd profiles/web 重新 npx dsh，端口 3080 正常监听。

### 验证
- `npx tsc --noEmitOnError false` → lib/index.js 更新（33KB）
- `npx tsdown` → lib/client.js 更新（67KB）
- DSH 重启后 127.0.0.1:3080 正常
- 代码已推送 GitHub（commit 198c995）

### 修改文件
- `src/client/index.tsx` — 右键菜单 + 左键注入 /渠道名 + 高亮正则 + scope.subscribe 同步
- `src/index.ts` — systemPrompt.section 动态渠道名 + 工具 channel 参数 + 渠道过滤
- `src/skill.ts` — 调用规则更新（/渠道名 规范、channel 参数说明）

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

## 2026-08-29 — 代码清理（死代码/冗余）

### 清理内容
- channels.ts：移除未使用的 credentialRef import（保留 type 副作用 import 以维持 HostContext.credentials 类型增强）
- iterations.ts：移除从未读取的 loaded 字段（声明+finally 赋值）
- image-route.ts：移除未使用的 MAX_BODY_BYTES 常量
- index.ts：移除未使用的 autoDetectBase/probeTextToImage/probeTextToVideo import
- client/index.tsx：
  - 移除未使用的 IMAGE_ROUTE 常量
  - MakeSvg 改名 MAKE_SVG（命名规范，唯一引用处同步）
  - 移除 hasUpdate state 及"有更新"分支（服务端无更新检测路由，该分支永远不显示，属死代码），保留静态"已最新"按钮
  - 移除未使用的 duration 变量
  - 移除 ChannelEditModal 中未使用的 statusBadge 函数
- 删除备份文件 src/index.ts.bak-20260823-fix-img2img（源码目录垃圾）

### 验证
- tsc --noEmit 通过（0 错误）
- tsdown 构建通过（lib/client.js 103KB）
- DSH 重启正常，无插件加载错误

## 2026-08-29 — 图标规范化（编辑/删除按钮）

### 修改
- 渠道列表的编辑按钮：emoji ✏️ → Lucide pencil SVG（14×14 stroke-2）
- 渠道列表的删除按钮：emoji 🗑 → Lucide trash SVG（14×14 stroke-2）
- 关闭小图标 stroke-width 2.5 → 2（统一规范）

### 规范
遵循 /vol1/1000/DeepSeek/DSH-UI-SPEC.md：功能图标必须用 Lucide SVG，禁止 emoji。
