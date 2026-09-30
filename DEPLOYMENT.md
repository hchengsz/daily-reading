# 免费后端与 TestFlight

当前状态：EAS 项目 `@hchengcs/daily-reading` 已关联，项目 ID 为 `fefa1986-fe9a-4787-9de1-ec563af12f78`，iOS Bundle ID 为 `com.hchengcs.dailyreading`。Supabase 私有存储迁移已完成；Render 免费后端已上线：https://daily-reading-74le.onrender.com 。部署 ID：dep-dap1k5e0tbcc7382lt70，版本：daf491c839c070504ffbc99b15f1e2d3e224cef9。健康检查 200，匿名 API 401，认证书库读取 200（9 本书）。EAS production 的 EXPO_PUBLIC_API_ORIGIN 已设置。Apple 签名已完成；iOS 1.0.0（1）构建成功，构建 ID fea1e4d9-cd4d-4d16-a57b-db32b12b2f2a；提交 ID 03176f97-9803-4d19-bc1c-fa89dbd474df 已完成，日志确认成功上传 App Store Connect。App Store Connect 应用 ID 6814803760，内部组 Team (Expo) 已配置；2026-09-22 Apple 已处理通过（VALID），内部／外部测试状态均为 MISSING_EXPORT_COMPLIANCE，加密合规与安装验证待完成。2026-09-23 再查 Apple API 返回 401，无法确认状态是否变化；浏览器自动连接超时，需用户在 App Store Connect 页面协助；已获授权并执行一次 PREFACE 在线 AI 测试：Gemini 返回模型繁忙错误，尚未验证翻译成功。TestFlight 构建已固定 Node 24.14.1；Apple 登录须用 EAS CLI 24.7.0（旧版出现 iTunes service key is empty）。

## 免费后端

- Render Free 运行 Node.js 24 后端；闲置会休眠，没有持久磁盘。
- Supabase 私有 Storage 存放书库 JSON、原始图书和 AI 缓存。使用 `STORAGE_PROVIDER=supabase`；不会在云存储错误时回退到 Render 临时磁盘。
- 目前是一个私人测试书库，使用独立访问码保护全部 API。尚未提供多用户隔离，请勿分发访问码给无关人员。
- 新上传文件限制 50MB。现有 9 本书均在限制以内。本地迁移预检共 39 个文件，约 145.3MB。
- 访问码只保存在应用内存，完全关闭应用后需重新输入。Supabase 服务端密钥和 Gemini 密钥绝不能放进 EXPO_PUBLIC_ 或 EAS 移动构建环境。

### 本机配置

`.env.deployment.local` 已被 Git 忽略。需要填入：

- `SUPABASE_URL`：已创建项目的 HTTPS Project URL。
- `SUPABASE_SERVICE_ROLE_KEY`：项目的 Secret key（sb_secret_）或 legacy service_role 服务端密钥，不是 publishable/anon key。
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

当前服务 ID 为 `srv-daot4hm0tbcc73fitiog`，已连接 main 分支。新建服务时可使用根目录 `render.yaml` 创建 Blueprint，套餐固定 `free`、自动部署关闭。现有服务由用户创建在 `oregon` 区域，继续复用，不迁移地区。填写其中要求的后端环境变量（不需要上传 RENDER_API_KEY）。不要添加持久磁盘或付费数据库。

构建命令：`npm ci && npm run backend:build`

启动命令：`npm run backend:start`

迁移完成后 `/healthz` 应返回 200；不带访问码的 `/api/library` 应返回 401。带 `Authorization: Bearer <访问码>` 应返回书库。验证翻译、导入以及服务重启后的数据持久性。健康检查只验证迁移标记和存储连通，不代表 Gemini 可用。

运行单个服务实例。书库写入在进程内串行处理；部署切换期间不要上传新书。多人发布前应改为每用户数据库记录及正式身份认证。

## TestFlight

1. 配置 Apple 签名：`npx eas-cli@24.7.0 credentials:configure-build -p ios -e testflight`。
2. 在 EAS production 环境设置 `EXPO_PUBLIC_API_ORIGIN` 为已验证的 Render HTTPS 地址。
3. `eas.json` 已设置 `EXPO_PUBLIC_BETA_ACCESS_REQUIRED=true`，书架提供访问码输入框。
4. 确认 EAS iOS 构建镜像满足 Xcode 26+ / iOS 26 SDK 要求。
5. `npx eas-cli@24.7.0 build --platform ios --profile testflight`。
6. 使用实际成功构建的 ID 上传：`npx eas-cli@24.7.0 submit --platform ios --profile testflight --id BUILD_ID`。
7. 确认 Apple 处理、出口合规及指定测试人员的 TestFlight 可安装状态。这些步骤不会公开上架 App Store。

本机 npm 启动器损坏时，可使用 `node "C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js"` 替代 `npx`。
