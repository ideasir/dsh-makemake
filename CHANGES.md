# CHANGES.md

## 2026-08-22 - 图片地址动态适配任意访问方式

### 问题
图片路由 `/plugins/dsh-makemake/image` 使用硬编码相对路径，浏览器用当前页面的 origin 拼接。导致：
- SSH 隧道访问（localhost:3333）→ 请求 localhost:3333/plugins/... → 404（DSH 在 3080）
- 任何非默认端口的访问方式都会 404

### 解决方案
改用 `window.location.origin` 动态获取当前页面 origin，自动适配所有访问方式。

**修改文件：**
- `src/client/index.tsx` - ImageResultCard 组件第 521 行
  - 旧：`src={`/plugins/dsh-makemake/image?...`}`
  - 新：`src={`${window.location.origin}/plugins/dsh-makemake/image?...`}`

### 部署
1. 构建：`npx tsc && npx tsdown -c tsdown.config.ts`
2. 部署：`cp -r lib/* /root/.dsh/profiles/web/node_modules/dsh-makemake/`
3. 重启 DSH：`kill <pid> && npx dsh --profile web --port 3080 --no-open`

### 验证
- 隧道访问：浏览器访问 `http://localhost:3333`，图片地址自动变为 `http://localhost:3333/plugins/dsh-makemake/image`
- 局域网访问：浏览器访问 `http://10.10.100.10:3080`，图片地址自动变为 `http://10.10.100.10:3080/plugins/dsh-makemake/image`
- 其他访问方式同理

### 注意事项
- DSH 官方禁止 `--host 0.0.0.0`，原因是安全考虑（远程代码执行风险），无法绕过
- SSH 隧道方案继续有效，只需 Windows 上保持隧道运行
