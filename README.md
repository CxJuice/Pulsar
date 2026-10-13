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

Release 仅由手动运行 Actions 发布：打开上述工作流，点击 **Run workflow**，选择默认分支 `master` 后运行。每次运行自动把 GitHub Actions 运行编号追加到应用版本、安装包文件名和原生安装包版本元数据中；所有平台构建成功后创建并发布 GitHub Release，标签为 `v<版本号>+build.<运行编号>`，例如 `v0.1.1+build.42`，并更新 Latest 下载入口。无需手动创建版本标签。勾选 `validate_only` 会构建并保留临时安装包用于验证，但不会发布 Release。

也可手动选择与 `package.json` 版本一致的 `v*` 标签，发布该标签对应的 Release；推送标签本身只触发检查和构建。发布前核对 4 个构建清单、13 个分发包的提交编号及校验值，上传完整并确认远端校验值后才公开 Release。已有标签指向其他提交时停止发布，防止源码与安装包不一致。预发布版本号自动标记为 Pre-release。

自动运行不生成或上传分发包。手动发布用的临时 Artifacts 最多保留 7 天，Release 上传及校验成功后删除本次临时 Artifacts；失败时保留以便排查。安装包通过 Release 下载，历史 Release 和标签继续保留。已清理 Artifacts 的运行若需重新打包，请重新手动触发工作流。Rust 仅缓存依赖下载，按操作系统共享，不缓存 `service/target` 编译目录；收集分发包时移动文件，减少重复存储。手动发布与自动检查使用独立并发组，新推送不会中断正在发布的任务。

当前 Electron 44 提供的桌面架构为 x64 和 ARM64，不构建已停止提供的 32 位版本。Windows 包未签名；macOS 使用本地临时签名，未经过 Apple 公证。CI 构建成功不代表已验证各平台的安装或真实账户操作。
