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
