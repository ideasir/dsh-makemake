# dsh-makemake 开发文档

## 1. 项目结构

```text
src/
├── index.ts               # Host 半部：工具注册、webServer 路由
├── client/
│   ├── index.tsx          # Client 半部：插件卡片、渠道管理、模式切换 UI
│   └── plugin-settings.ts # 插件设置客户端
├── image-route.ts         # 图片路由，存储 attachment
├── video-route.ts         # 视频路由
├── video-frame.ts         # 视频帧处理
├── channels.ts            # 渠道配置
├── probe.ts               # 渠道能力探测
├── iterations.ts          # 迭代计数
├── reference.ts           # 参考图引用
├── shared.ts              # 共享类型和常量
└── skill.ts               # 技能定义
lib/                       # 构建产物（lib/index.js + lib/client.js）
cordis.patch.yml           # DSH bundle 注册 patch
```

运行时使用 `lib/` 构建产物。`src/` 是唯一源码，修改后必须重新构建。

## 2. 环境要求

- Node.js 20+；
- npm；
- DSH 相关依赖（`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-api-remotes` 等）；
- OpenAI 兼容的图片/视频生成服务端点。

## 3. 构建

```bash
npm install
npm run build
```

`build` 等价于：

```bash
tsc        # 编译 Host 半部
tsdown     # 构建浏览器 bundle
```

类型检查：

```bash
npm run typecheck
```

## 4. Host 半部设计

`src/index.ts` 负责：

1. 注册 `makemake_image` / `makemake_video` 工具；
2. 注册 `/plugins/dsh-makemake/image` 图片路由；
3. 注册 `/plugins/dsh-makemake/video` 视频路由；
4. 渠道配置管理（namespace `creation`）；
5. 图片/视频附件临时存储。

### 渠道配置

`creation` namespace 下：

```yaml
imageChannels:            # 出图渠道列表
  - id: ch-xxx
    name: 渠道名
    baseURL: https://...
    model: ...
    pollMode: round-robin  # 多 Key 轮询
videoChannels:            # 出视频渠道列表
  - id: ch-yyy
    ...
selectedImageChannel:     # 当前选中的出图渠道 ID
selectedVideoChannel:     # 当前选中的出视频渠道 ID
activeMode:               # 用户当前激活的生成模式：image | video | null
```

### 凭据管理

- 使用 DSH 核心 API：`api.credentials.set({ ref, value })`；
- 引用格式：`MAKEMAKE_CHANNEL_<channelId>`。

### 工具

- `makemake_image`：文生图 / 图生图，返回附件 ID；
- `makemake_video`：文生视频 / 图生视频 / 视频延续，返回附件 ID。

## 5. Client 半部设计

客户端（`src/client/index.tsx`）负责：

1. 注册 `settings.plugin.item` 插件卡片；
2. 渠道管理 UI（增删改、测 Key、轮询模式）；
3. 生成模式切换（图片/视频徽章）；
4. 智能检测（探测渠道能力）。

### 版本号

卡片版本号在 `src/client/index.tsx` 中硬编码（`useState('0828-0.1.2-rc.2')`），更新版本号时必须同步修改。

## 6. 图片渲染

- 路由：`/plugins/dsh-makemake/image`；
- 支持 GET（浏览器 `<img>`）和 POST；
- 通过 `tool.call.toolview` slot 渲染。

## 7. 部署

```bash
# 构建后部署到 DSH profile
cp -r lib/* /root/.dsh/profiles/web/node_modules/dsh-makemake/
# 重启 DSH
```

## 8. 发布流程

1. 修改 `src/` 和/或 `package.json`；
2. 更新版本号（`package.json` + `src/client/index.tsx` 中的 `useState` 默认值）；
3. 更新 `CHANGES.md`；
4. 运行 `npm run build`；
5. 部署到 DSH Profile 并重启；
6. 验证文生图/图生图/视频功能；
7. `git commit` 并 `git push`。

## 9. 注意事项

- 图片/视频附件存储是临时的，DSH 重启后丢失；
- 图片路由地址使用 `window.location.origin` 动态获取，适配任意访问方式；
- 多 Key 轮询：错误时循环尝试下一个 Key，迭代计数在成功后才提交。
