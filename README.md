# Make Make

> 当前版本 `0821-rc.8`，适配 DSH `v0.1.0-rc.8`。文生图插件，支持 Google Gemini、OpenAI、字节 Seedream。

## 功能

- **generate_image 工具** — 给 AI 一张图片，模型可调用此工具生成
- **设置页** — 配置提供商、模型、API Key
- **聊天内渲染** — 生成的图片直接嵌入对话流

## 支持的提供商

| 提供商 | API | 默认模型 |
|--------|-----|---------|
| Google Gemini | generativelanguage.googleapis.com | gemini-3.1-flash-image |
| OpenAI / 中转站 | api.openai.com/v1 | gpt-image-2 |
| 字节 Seedream | ark.cn-beijing.volces.com/api/v3 | doubao-seedream-5-0-260128 |

## 安装

```bash
cd ~/.dsh/profiles/web
npm install /path/to/dsh-makemake
```

或在 package.json 的 `dsh.profile.bundles` 中添加 `"dsh-makemake"`，重启 DSH。

## 配置

设置页 → Plugins → 图像生成，选择提供商并填写 API Key。

## 依赖

- `@deepseek-ai/dsh-attachment` — 图片附件服务
- `@deepseek-ai/dsh-settings` — 设置持久化
- `@deepseek-ai/dsh-tools` — 工具注册
- `@deepseek-ai/schemastery` — 配置 schema

无额外运行时依赖。

## 与 dsh-looklook 的关系

- **looklook** = 看（图片/视频/文档识别）
- **makemake** = 做（文生图）
- 两者互补，可独立使用
