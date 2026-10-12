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

构建结果保存在每次运行的 Artifacts 中，保留 30 天。主分支推送或在主分支手动运行时，所有版本构建成功后自动创建并发布 GitHub Release，标签为 `v<版本号>+build.<运行编号>`，例如 `v0.1.0+build.2`，并更新 Latest 下载入口。无需手动创建版本标签；旧版本和标签保留。

推送与 `package.json` 版本一致的 `v*` 标签时，自动发布该标签对应的 Release。其他分支和 Pull Request 只构建。发布前核对 7 个构建清单、20 个分发包的提交编号及校验值，上传完整并确认远端校验值后才公开 Release。重复运行复用同一构建标签；已有标签指向其他提交时停止发布，防止源码与安装包不一致。预发布版本号自动标记为 Pre-release。

当前 Electron 44 提供的桌面架构为 x64 和 ARM64，不构建已停止提供的 32 位版本。Windows 包未签名；macOS 使用本地临时签名，未经过 Apple 公证。CI 构建成功不代表已验证各平台的安装或真实账户操作。
## 右键翻译模块

右键选中的单个英文单词会在右侧「翻译」模块中查询剑桥英汉词典；应用读取词条释义、音标和例句后，使用当前界面风格展示，并保留打开剑桥原网页的入口。右键多个单词或句子会将所选文本翻译成简体中文。未选中文本时，在原文或译文区域右键可翻译当前原文句子。

「文本翻译」默认在应用右侧嵌入 Google 翻译或 DeepL 网页。服务商、网页/API 模式及密钥在设置页配置，也可使用 OpenAI 兼容的 LLM 接口；密钥通过 Electron 安全存储加密保存在本机。系统代理、直连、HTTP 和 SOCKS5 设置同时作用于内嵌网页和 API 请求。

设置页“关于”显示运行中构建的提交及源码指纹。双击 `启动.py` 会核对本地打包产物与当前源码；旧包不会被当作当前代码运行，必要时会构建并启动当前源码。

提交译文前会重新读取 ParaTranz 词条并比较版本与内容；若发现冲突会保留本机草稿，供重新载入和手动合并。ParaTranz 目前公开的更新词条接口没有文档化的条件写入参数，远端读取与提交之间仍可能发生并发写入；此保护不等同于服务端原子锁。
