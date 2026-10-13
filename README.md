# Pulsar

基于 ParaTranz 协议的桌面翻译工作台。Electron 负责桌面窗口与登录，Nuxt 4 / Vue 负责前端，Rust / Axum / reqwest 负责相应服务。布局参考用户指定的 Transifex 编辑器。

## 开发与构建

需要 Node.js 24.11+、Rust，以及目标平台的工具链（Windows 使用 MSVC，macOS 使用 Xcode 命令行工具）。

```text
npm install
npm run dev
npm run typecheck
cargo test --manifest-path service/Cargo.toml
npm run package
python scripts/package_portable.py
```

`npm run dev:web` 仅启动浏览器界面预览。`npm run package` 生成 Nuxt 静态资源和 Rust release 服务，并将它们包含到 Electron 应用中。

### GitHub Actions

[构建与发布](https://github.com/CxJuice/ScTranslateKit/actions/workflows/build.yml) 在推送代码、版本标签和 Pull Request 时执行各平台测试、类型检查及源码构建；手动运行时额外打包并发布以下版本：

| 平台 | 架构 | 分发格式 |
| --- | --- | --- |
| Windows | x64 | 安装 EXE、便携 EXE、ZIP |
| macOS | Universal（Intel x64、Apple Silicon ARM64） | DMG、ZIP |
| Linux | x64、ARM64 | AppImage、DEB、RPM、tar.gz |

共 4 种平台／架构组合、13 个分发包。每个版本在对应平台编译 Rust 服务；macOS Universal 同时包含两种架构的 Electron 和 Rust 服务。导出时检查服务架构、执行权限和分发包数量，并生成 SHA256 校验文件及带提交编号的构建清单。

Release 仅由手动运行 Actions 发布：打开上述工作流，点击 **Run workflow**，选择默认分支 `master` 后运行。每次运行会把 GitHub Actions 运行编号写入应用版本和安装包文件名；例如源码版本 `0.1.1` 会构建为应用版本 `0.1.2-build.42`，Release 标签仍为 `v0.1.1+build.42`。所有平台构建成功后创建并发布 GitHub Release，并更新 Latest 下载入口。默认分支发布成功后，工作流会把应用版本的稳定部分（如 `0.1.2`）同步回 `package.json` 和 `package-lock.json` 并提交到默认分支，后续发布自动从新版本继续递增，不会自动发布新的 Release。下一次正式发布前仍需在 `CHANGELOG.md` 添加对应版本的更新记录。无需手动创建版本标签。勾选 `validate_only` 会构建并保留临时安装包用于验证，但不会发布 Release 或提交版本变更。

也可手动选择与 `package.json` 版本一致的 `v*` 标签，发布该标签对应的 Release；推送标签本身只触发检查和构建。发布前核对 4 个构建清单、13 个分发包的提交编号及校验值，上传完整并确认远端校验值后才公开 Release。已有标签指向其他提交时停止发布，防止源码与安装包不一致。预发布版本号自动标记为 Pre-release。

自动运行不生成或上传分发包。手动发布用的临时 Artifacts 最多保留 7 天，Release 上传及校验成功后删除本次临时 Artifacts；失败时保留以便排查。安装包通过 Release 下载，历史 Release 和标签继续保留。已清理 Artifacts 的运行若需重新打包，请重新手动触发工作流。Rust 仅缓存依赖下载，按操作系统共享，不缓存 `service/target` 编译目录；收集分发包时移动文件，减少重复存储。手动发布与自动检查使用独立并发组，新推送不会中断正在发布的任务。

自动更新通过 `https://Pulsar.42kit.com` 提供。首次配置时，在绑定 `42kit.com` 的 Cloudflare 账户中创建 R2 bucket 并部署 Worker：运行 `npm run cf:create-updates-bucket` 和 `npm run cf:deploy-updates`。GitHub 仓库还需设置 Actions 变量 `CLOUDFLARE_ACCOUNT_ID`，以及具有 R2 对象写入权限的 secret `CLOUDFLARE_API_TOKEN`。手动发布成功后，工作流会把更新清单和安装文件同步到 R2。Windows 安装版和 Linux AppImage 会在启动后自动检查并下载，下载完成后退出时安装；也可在“设置 → 关于”手动检查或立即重启安装。macOS 会检查更新并提示用户，用户确认后打开对应 DMG 下载页面，再手动安装。便携 EXE 和 Linux DEB/RPM/tar.gz 不支持应用内安装更新。macOS 包当前使用临时签名，故由用户下载并手动安装。

当前 Electron 44 提供的桌面架构为 x64 和 ARM64，不构建已停止提供的 32 位版本。Windows 包未签名；macOS 使用本地临时签名，未经过 Apple 公证。CI 构建成功不代表已验证各平台的安装或真实账户操作。
