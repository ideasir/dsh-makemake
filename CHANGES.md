# CHANGE LOG

## 2026-08-22 适配 DSH 0.1.1-rc.2 + 多渠道管理

### 为什么
DSH 从 0.1.0-rc.8 升级到 0.1.1-rc.2，需要重新构建适配。同时完善多渠道管理 UI。

### 改了什么
- package.json 版本号改为 `0.1.1-rc.2`（跟随 DSH 适配版本）
- 所有 `@deepseek-ai/*` 依赖升到 `0.1.1-rc.2`
- **服务端 settings 注册**：`installSettingsSection()` 改为 `ctx.settings.register()`（新版 API，支持 schema 验证和持久化）
- **API Key 存储**：改用 DSH 核心连接 API `api.credentials.set()`（之前误用 looklook 的 remote，导致"不允许写入该凭据引用"）
- **响应解析**：`api.settings.update()` 用 `{ ns, patch }` 参数格式，响应读取 `res.result.ok`（之前读 `res.ok` 导致判断失败）
- **打印机图标**：点击变灰+加斜线（同小眼睛），再点恢复；后台设置关闭才消失
- **保存反馈**：保存成功显示"✓ 已保存"，失败显示错误
- **图片渲染**：`render` 函数返回图片 block（`{ type: 'image', attachment }`），工具结果能显示图片

### 踩过的坑
- DSH API 返回格式是 `{ rpcId, result: { ok, value } }`，不是直接 `{ ok, value }`
- `settings.update` 的参数名是 `patch` 不是 `section`（type 声明里写 patch）
- looklook 的 remote 会再包一层 `credentialRef()`，把 `MAKEMAKE_` 前缀改掉，导致保存失败——必须直接用 DSH 核心 API
- `npm install` 会删掉 profile 里以 symlink 安装的插件，必须重新复制完整目录
- 插件源码目录删 node_modules 后，node 解析不到 `@deepseek-ai/*`，必须 `npm install` 装回来再整体复制

### 部署
见 README.md 或 dsh-looklook/CHANGES.md 的部署流程。