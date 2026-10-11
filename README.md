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

## 当前词条 QA

QA 只检查当前选中的词条，并随编辑框输入实时更新。数字和百分比检查覆盖全文，不受 `item_` 键值、冒号或括号位置限制；核对数值及出现次数，支持小数、正负号、全角数字和逗号千位分隔，忽略标签、占位符和 URL 中的数字。保留 SCCL 的变量、标签、换行和物品类型标签提示。

数字和百分比提示只展示未对应的值及所在行上下文；点击译文中的「定位」可选中并滚动到对应文本。换行提示显示两侧数量和多出或缺少的次数。

选择词条后立即获取翻译建议和术语，建议获取不依赖当前辅助面板；面板切换复用该词条结果，快速换条忽略旧响应。建议仍由 Rust 服务串行请求并缓存 30 秒，本地计算匹配度。

## 后台提交

点击提交后立即打开下一条，上传按队列在后台进行，编辑和导航保持可用。「有疑问」「已审核」也采用相同行为。每次提交固定点击时的词条、译文和状态，先保存本地草稿；成功回包不会跳回旧词条或覆盖后续输入。提交失败时显示词条警告，可返回词条核对并重新提交。退出时尚未完成上传的内容保留为草稿。

## 下载与构建状态

Windows x64 安装版见 [GitHub Releases](https://github.com/CxJuice/ScTranslateKit/releases/latest)。安装 EXE 附带 SHA256 校验文件；应用无需另外安装 Node.js、Rust 或 Python。安装包未签名。

当前版本已完成静态构建和安装程序打包；安装/卸载流程尚未实际验证。真实账户登录和项目读取已有运行记录，真实译文提交尚未完成端到端验证。
