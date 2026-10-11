# ScTranslateKit

基于 ParaTranz 协议的桌面翻译工作台。Electron 负责桌面窗口与登录，Nuxt 4 / Vue 负责前端，Rust / Axum / reqwest 负责相应服务。布局参考用户指定的 Transifex 编辑器。

## 开发与构建

需要 Node.js 24.11+、Rust 及 Windows MSVC 工具链。

```text
npm install
npm run dev
npm run typecheck
cargo test --manifest-path service/Cargo.toml
npm run package
python scripts/package_portable.py
```

`npm run dev:web` 仅启动浏览器界面预览。`npm run package` 生成 Nuxt 静态资源和 Rust release 服务，并将它们包含到 Electron 应用中。

## 下载与构建状态

Windows x64 安装版见 [GitHub Releases](https://github.com/CxJuice/ScTranslateKit/releases/latest)。安装 EXE 附带 SHA256 校验文件；应用无需另外安装 Node.js、Rust 或 Python。安装包未签名。

当前版本已完成静态构建和安装程序打包；安装/卸载流程尚未实际验证。真实账户登录和项目读取已有运行记录，真实译文提交尚未完成端到端验证。
