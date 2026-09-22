# 免费后端与 TestFlight

当前状态：EAS 项目 `@hchengcs/daily-reading` 已关联，项目 ID 为 `fefa1986-fe9a-4787-9de1-ec563af12f78`，iOS Bundle ID 为 `com.hchengcs.dailyreading`。Supabase 和 Render 尚未完成实际部署，Apple 签名及 TestFlight 构建／上传待完成。

## 免费后端

- Render Free 运行 Node.js 24 后端；闲置会休眠，没有持久磁盘。
- Supabase 私有 Storage 存放书库 JSON、原始图书和 AI 缓存。使用 `STORAGE_PROVIDER=supabase`；不会在云存储错误时回退到 Render 临时磁盘。
- 目前是一个私人测试书库，使用独立访问码保护全部 API。尚未提供多用户隔离，请勿分发访问码给无关人员。
- 新上传文件限制 50MB。现有 9 本书均在限制以内。本地迁移预检共 39 个文件，约 145.3MB。
- 访问码只保存在应用内存，完全关闭应用后需重新输入。Supabase 服务端密钥和 Gemini 密钥绝不能放进 EXPO_PUBLIC_ 或 EAS 移动构建环境。

### 本机配置

`.env.deployment.local` 已被 Git 忽略。需要填入：

- `SUPABASE_URL`：已创建项目的 HTTPS Project URL。
- `SUPABASE_SERVICE_ROLE_KEY`：项目的 legacy service_role 服务端密钥，不是 anon key。
- `RENDER_API_KEY`：仅在使用 Render 官方 API 部署时需要。

本机已有的 Gemini 配置已复制到此文件；私人测试访问码已生成，均未输出到聊天。不要提交此文件。

### 初始化并迁移

使用 Node.js 24，在项目根目录执行：

```powershell
node --env-file=.env.deployment.local scripts/prepare-cloud-storage.mjs
node --env-file=.env.deployment.local scripts/migrate-storage.mjs
node --env-file=.env.deployment.local scripts/migrate-storage.mjs --apply
```

第一个命令仅创建或验证私有存储桶。第二个仅预检；第三个上传。迁移遇到不同的现有云文件会停止，不会覆盖；可在网络中断后重新运行。书库 JSON 和健康检查标记最后写入。远端文件使用相对路径的 SHA-256 键，兼容中文书名；不要手动改远端键。

### Render

将已验证的代码推送到仓库后，使用根目录 `render.yaml` 创建 Blueprint，套餐固定 `free`、区域 `singapore`、自动部署关闭。填写其中要求的后端环境变量（不需要上传 RENDER_API_KEY）。不要添加持久磁盘或付费数据库。

构建命令：`npm ci && npm run backend:build`

启动命令：`npm run backend:start`

迁移完成后 `/healthz` 应返回 200；不带访问码的 `/api/library` 应返回 401。带 `Authorization: Bearer <访问码>` 应返回书库。验证翻译、导入以及服务重启后的数据持久性。健康检查只验证迁移标记和存储连通，不代表 Gemini 可用。

运行单个服务实例。书库写入在进程内串行处理；部署切换期间不要上传新书。多人发布前应改为每用户数据库记录及正式身份认证。

## TestFlight

1. 配置 Apple 签名：`npx eas-cli@23.2.0 credentials:configure-build -p ios -e testflight`。
2. 在 EAS production 环境设置 `EXPO_PUBLIC_API_ORIGIN` 为已验证的 Render HTTPS 地址。
3. `eas.json` 已设置 `EXPO_PUBLIC_BETA_ACCESS_REQUIRED=true`，书架提供访问码输入框。
4. 确认 EAS iOS 构建镜像满足 Xcode 26+ / iOS 26 SDK 要求。
5. `npx eas-cli@23.2.0 build --platform ios --profile testflight`。
6. 使用实际成功构建的 ID 上传：`npx eas-cli@23.2.0 submit --platform ios --profile testflight --id BUILD_ID`。
7. 确认 Apple 处理、出口合规及指定测试人员的 TestFlight 可安装状态。这些步骤不会公开上架 App Store。

本机 npm 启动器损坏时，可使用 `node "C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js"` 替代 `npx`。
