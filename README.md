# Make Make

> 当前版本 `0828-0.1.2-rc.2`，适配 DSH `v0.1.1-rc.2`（开发者预览版）。为 DeepSeek Harness 提供图片和视频生成能力，AI 可以画图、生成视频。支持 Gemini、OpenAI、Seedream 等多个生成渠道。

## 功能
- 文生图（多图生成支持）
- 多图生成（多张参考图）
- 多轮对话
- 多渠道配置（可按项目精细度选择）

## 架构
- 服务端：Node.js (TypeScript)，处理图片生成和路由
- 客户端：React (TypeScript)，插件 UI 组件
- 协议：OpenAI 兼容协议（/v1/images/generations）

## 目录结构
```
├── src/
│   ├── client/          # 客户端 React 组件
│   │   ├── index.tsx    # 插件主入口，注册 slot、工具
│   │   └── plugin-settings.ts
│   ├── image-route.ts   # 图片路由，存储 attachment
│   ├── shared.ts        # 共享类型和常量
│   └── index.ts         # 服务端入口，注册 webServer 路由
├── lib/                 # 构建产物
│   ├── client.js        # 客户端 bundle
│   └── index.js         # 服务端 bundle
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── CHANGES.md
```

## 构建流程
```bash
# 构建
cd /vol1/1000/DeepSeek/dsh-makemake
npx tsc && npx tsdown -c tsdown.config.ts

# 部署到 DSH profile
cp -r lib/* /root/.dsh/profiles/web/node_modules/dsh-makemake/

# 重启 DSH
kill $(pgrep -f "dsh.*3080")
cd /root/.dsh/profiles/web && npx dsh --profile web --port 3080 --no-open
```

## 依赖包（从 dsh-looklook 复制）
- @deepseek-ai/dsh-api-remotes
- dsh-host-apiproxy
- @deepseek-ai/dsh-client-web-react
- @deepseek-ai/schemastery
- zod

## 渠道配置
- namespace: `creation`
- 字段：
  - `imageChannels`: Channel[] - 出图渠道列表
  - `selectedImageChannel`: string - 当前选中的出图渠道 ID
  - `videoChannels`: Channel[] - 出视频渠道列表
  - `selectedVideoChannel`: string - 当前选中的出视频渠道 ID

## 凭据管理
- 使用 DSH 核心 API：`api.credentials.set({ ref, value })`
- 引用格式：`MAKEMAKE_CHANNEL_<channelId>`

## 工具注册
- `makemake_image`：AI 生图工具，返回附件 ID
- `makemake_video`：AI 生视频工具，返回附件 ID
- 图片/视频存储在内存 map，重启后丢失

## 图片渲染
- 路由：`/plugins/dsh-makemake/image`
- 支持 GET（浏览器 <img>）和 POST
- 通过 `tool.call.toolview` slot 渲染

## 注意事项
- 图片路由地址使用 `window.location.origin` 动态获取，适配任意访问方式
- DSH 官方禁止 `--host 0.0.0.0`，需通过 SSH 隧道或组网 IP 访问
- attachment 存储是临时的，DSH 重启后丢失
