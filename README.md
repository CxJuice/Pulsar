# Pulsar

基于 ParaTranz 协议的桌面翻译工作台。Electron 负责桌面窗口与登录，Nuxt 4 / Vue 负责前端，Rust / Axum / reqwest 负责相应服务。布局参考用户指定的 Transifex 编辑器。

## MCP 接入

批量任务可使用 `get_strings` 一次读取最多 25 个词条及各自的 `snapshotToken`，再用 `prefill_translations` 批量写入草稿，或在直存权限开启后使用 `save_translations_to_paratranz` 合并为一次 ParaTranz 批量编辑。修改已有译文时指定 `mode: "edit"`，保留每条词条的原状态；新译文使用 `mode: "save"`。超过 25 条的任务分组处理。结果包含 `succeeded`、`failed` 和逐条 `results`，冲突或上游未接受的词条会单独报告；提交结果无法确认时应先重新读取，不应直接重试。单条工具仍可使用。

在桌面应用的“设置 → MCP 接入”启用本机 MCP 服务，然后将页面显示的 URL 和 Bearer 令牌配置到支持 Streamable HTTP 的 MCP 客户端。设置可修改本机端口，并分别控制词条读取、本机草稿写入、ParaTranz 直存权限及直存目标状态；直存默认关闭，默认目标状态为“已翻译”。服务只绑定 `127.0.0.1`，令牌使用系统安全存储加密保存。

服务注册固定的 14 个工具，调用时按当前权限校验。读取工具包括 `get_workspace`、`list_projects`、`list_project_files`、`list_strings`、`search_translations`、`get_current_entry`、`get_string`、`get_strings` 和 `get_translation_context`；草稿工具为 `prefill_translation`、`prefill_translations`；直存工具为 `save_translation_to_paratranz`、`edit_translation` 和 `save_translations_to_paratranz`。术语及相似译文建议由 `get_translation_context` 按需读取。省略 `fileId` 的列表与搜索均使用项目全文聚合。

端点兼容现代 `2026-07-28` 协议和旧版 Streamable HTTP 初始化会话。旧版会话隔离请求编号与取消通知，最多 32 个会话，空闲 30 分钟过期；GET 长连接返回 405。服务关闭与配置更新串行执行，并排空或取消请求。设置页每 3 秒刷新运行状态、活动请求数和最近授权请求时间。

直存仅接受设置中选定的“未翻译”“已翻译”“有疑问”“已检查”或“已审核”状态。提交前核对词条版本、草稿内容、账号连接及权限版本；取消、登出或撤销权限会阻止尚未发出的写入，已发送的上游 PUT 仍可能完成。直存先在用户资料目录的 `mcp-save-recovery.jsonl` 记录旧内容和目标译文，再记录返回结果及核对状态，返回 `recoveryRecordId` 供核查。日志包含原文与译文，不包含访问令牌，不会自动重放未确认提交；达到 64 MiB 时须导出清理后继续直存。成功且内容核对通过后才清除匹配草稿，核对异常时保留草稿。

读取与上游 PUT 之间采用后写入生效的并发策略；提交前检测到版本变化会拒绝保存，校验通过后的并发修改仍可能被最后提交的译文覆盖。`get_workspace.remoteWritePolicy` 返回该策略。版本检查、恢复记录和提交后核对不构成远端原子事务。MCP 标准 Prompt `pulsar_translation_prompt` 返回设置中的默认翻译提示词，客户端需主动选择使用。

Token 登录保留网站 Cookie 交换，以支持词条占用状态；业务数据及批量编辑通过 JSON API 读取、保存。所有上游请求共享最多 4 个并发槽，翻译建议另有串行队列，避免多个批次叠加放大并发。

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
