# ScTranslateKit

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

[自动构建](https://github.com/CxJuice/ScTranslateKit/actions/workflows/build.yml) 在推送代码、Pull Request 和手动运行时构建以下版本：

| 平台 | 架构 | 分发格式 |
| --- | --- | --- |
| Windows | x64、ARM64 | 安装 EXE、便携 EXE、ZIP |
| macOS | Intel x64、Apple Silicon ARM64、Universal | DMG、ZIP |
| Linux | x64、ARM64 | AppImage、DEB、RPM、tar.gz |

共 7 种平台／架构组合、20 个分发包。每个版本在对应平台编译 Rust 服务；macOS Universal 同时包含两种架构的 Electron 和 Rust 服务。导出时检查服务架构、执行权限和分发包数量，并生成 SHA256 校验文件及带提交编号的构建清单。

构建结果保存在每次运行的 Artifacts 中，保留 30 天。推送与 `package.json` 版本一致的 `v*` 标签时，所有版本构建成功后自动上传到对应 GitHub Release；普通代码推送和手动运行只生成 Artifacts。

当前 Electron 44 提供的桌面架构为 x64 和 ARM64，不构建已停止提供的 32 位版本。Windows 包未签名；macOS 使用本地临时签名，未经过 Apple 公证。CI 构建成功不代表已验证各平台的安装或真实账户操作。

## 下载与构建状态

Windows x64 安装版见 [GitHub Releases](https://github.com/CxJuice/ScTranslateKit/releases/latest)。安装 EXE 附带 SHA256 校验文件；应用无需另外安装 Node.js、Rust 或 Python。安装包未签名。

当前版本已完成静态构建和安装程序打包；安装/卸载流程尚未实际验证。真实账户登录和项目读取已有运行记录，真实译文提交尚未完成端到端验证。
