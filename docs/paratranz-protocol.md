# ParaTranz 接口记录

核对日期：2026-10-11，Australia/Sydney。项目 8340，文件 3485163。浏览器页面构建标识 `Build_20261010_230227`。官方 OpenAPI：<https://paratranz.cn/api-docs?format=json>，版本 0.5.7。

## 浏览器实际观察到的请求

|用途|请求|
|---|---|
|当前账户|GET `/api/account`|
|项目|GET `/api/projects/8340`|
|文件|GET `/api/projects/8340/files/3485163`|
|词条分页|GET `/api/projects/8340/strings?detailed=1&file=3485163&stage=0`|
|文本与键值搜索|GET `/api/projects/8340/strings?detailed=1&text=Delphi&stage=0`|
|当前文件原文搜索|GET `/api/projects/8340/strings?detailed=1&original=Delphi&stage=0&file=3485163`|
|翻译建议|GET `/api/projects/8340/strings/1088220072/suggestions?rate=70`|
|匹配的术语|GET `/api/projects/8340/strings/1088220072/terms`|

网页请求使用 Cookie，会话 Cookie 名包含 `sid`，本记录没有保存 Cookie 值或 Token。未经认证的词条请求实测返回 `401 Unauthorized`。

项目元数据为公开接口：无 Token 或故意无效的 Bearer Token 请求 `/api/projects/8340` 均返回 200，因此不能用项目读取成功判断认证成功。连接时还会读取受保护的 `/api/projects/{projectId}/strings?pageSize=1&detailed=0`；该请求成功后才替换当前凭据。打包版通过 Electron → Rust → 真实 HTTPS API 使用诊断用无效 Token 验证，正确返回 401。

网页搜索范围下拉框的值为 `text / original / translation / key / context`。Shift+Enter 保留当前文件；本应用的主列表搜索始终保留所选文件；建议面板的词汇索引另行按 `original` 查询，不传 `file` 或 `stage`，覆盖建议来源项目所有文件及状态。

默认文件在采集时共 434 条，已翻译 209 条，有疑问 15 条，未翻译查询 `rowCount=225, pageSize=50, pageCount=5`。这些为采集时统计，不代表以后状态。

词条分页结构为 `{results, page, pageSize, rowCount, pageCount}`。`results[]` 中的 `file` 是对象 `{id,name,project}`，还提供 `fileId`；`detailed=1` 包含 `history`、`importHistory` 和 `comments`。

建议响应为数组，包含 `original,translation,key,id,project,matching,contains`。`contains=1` 代表包含匹配，不能把它的 `matching` 与普通相似匹配直接比较。术语响应为数组，包含 `term,translation,pos,note,match`。

当前应用请求建议时使用 `rate=0`，避免服务器最低匹配率提前过滤候选；仍遵守串行请求与 30 秒缓存。对返回的每条候选使用现成 `leven@4.1.0` 库计算完整原文的标准归一化 Levenshtein 相似度：`1 - distance / max(lengthA, lengthB)`，插入、删除、替换的成本均为 1。显示和排序均采用本地分数，低于 70% 和空原文/空译文的结果被过滤。相同分数按词条 ID 排序。

没有自行设置词权重、停用词、短语窗口、锚点或额外包含加分，也不采用服务器 `matching`、`contains` 决定建议分类。大小写、符号、空白、标签和变量原样参与计算。只有完整字符串一致才是 100%；短名称里的单个词或数字不能因子串相等得到 100%。术语匹配仍使用术语接口，与翻译记忆建议分开。算法依据和库选择见 [算法选型](matching-algorithm.md)。

本地计算覆盖接口返回的所有候选；官方接口最多返回 30 条且仍由服务器检索候选，应用没有下载完整翻译记忆库，因此不声称覆盖服务器未返回的词条。

## 官方文档确认的请求

- 项目侧栏：GET `/api/account` 获取当前账户 ID，随后 GET `/api/users/{userId}/projects` 读取参与项目（成员条目中的 `project` 为项目简略对象）。
- 项目资料：PUT `/api/projects/{projectId}`，仅发送 `{name,desc}`；文件重命名/移动：PUT `/api/projects/{projectId}/files/{fileId}`，仅发送 `{name}`，名称使用完整路径。
- 管理权限：成员 permission 为 3（管理员）或 10（所有者）才开放管理表单，服务端作最终权限判断。修改前读取远端并核对编辑时的名称/说明；服务端没有条件写入时仍存在比较到提交的竞争窗口。
- Token 放在 `Authorization` 请求头，示例使用 `Bearer {TOKEN}`。
- 文件列表：GET `/api/projects/{projectId}/files`。
- 单条读取：GET `/api/projects/{projectId}/strings/{stringId}`。
- 保存：PUT `/api/projects/{projectId}/strings/{stringId}`，应用仅提交 `{translation,stage}`。
- 历史：GET `/api/projects/{projectId}/history?tid={stringId}&pageSize=50`。
- `pageSize` 最大 800；应用提供 50 / 100 / 200 / 500。
- 状态：0 未翻译，1 已翻译，2 有疑问，3 已检查，5 已审核，9 已锁定，-1 已隐藏。
- 全局按用户限制 480 次/分钟；翻译建议必须串行，正常使用复用 30 秒缓存。

保存协议依据官方文档实现；没有为了验证而改动真实项目词条。6 项自动测试使用本地模拟上游检验本地请求认证、分页字段、版本冲突、窄范围 PUT、草稿恢复、公开项目不代表认证成功、建议串行及缓存。本机诊断记录不随源码发布。


## 搜索历史翻译（2026-10-11 浏览器实测）

在指定 ParaTranz 编辑页点击「搜索历史翻译」，展开原位搜索表单；搜索范围为文本或键值、原文、译文、键值，默认不勾选「仅在当前项目中搜索」。Enter 提交。

观察到的真实只读请求：

- `GET /api/memory?projectId=8340&text=Delphi&field=`
- `GET /api/memory?projectId=8340&text=德尔斐&field=translation&inCurrentProject=true`
- `GET /api/memory?projectId=8340&text=RSI&field=original&inCurrentProject=true`

`field` 为 `'' | original | translation | key`；未限制项目时省略 `inCurrentProject`。`projectId` 始终为当前项目。该路径未出现在本地官方 OpenAPI 快照中，因此实现依据上述网站实际请求，不将其标成官方公开 API 契约。

响应：`{results, page:1, pageSize:50, rowCount:{value,relation}}`。Delphi 返回 10 条，RSI 原文范围在当前项目返回总数 613、前 50 条；网站搜索区没有出现分页控件。条目含 id/key/original/translation/stage/project 对象/user/createdAt/updatedAt，另有服务端 `_score` 和 `others` 字段。应用保留接口搜索结果顺序，不将 `_score` 当相似度百分比。自动建议继续使用本地 Levenshtein 算法；手动历史搜索显示接口返回的查询结果。

桌面链路：Nuxt `memory` → Electron IPC 白名单 → Rust `GET /memory`，复用已登录会话或 API Token。搜索字段白名单、projectId 和文本长度由 Rust 校验。清除、卸载或项目切换后，晚到的搜索响应会被忽略。原文/译文/键值用 Vue 文本节点显示并高亮字面搜索词，不插入接口 HTML。原文及译文的字面 `\n` 按换行显示，使用译文仍保留原始值。

按用户要求，应用的搜索表单直接常驻建议栏顶部，不使用折叠入口。Ctrl + Shift + F 聚焦输入框；尚未搜索或清除时显示自动建议。


## 项目主页的加载顺序（2026-10-11）

启动先恢复认证并读取本地草稿，主页调用 `projects`（账户及用户参与项目列表）。启动不自动选择上次项目或请求词条。选中项目后请求 `project` 与 `files`，根目录先显示并展开，其余目录默认折叠。选中文件后 `bootstrap` 加载真实项目/文件/草稿及词条，随后进入 `/editor`；选词条继续自动获取术语和建议。`/projects?tab=files` 用于从编辑器返回当前项目文件页，`/` 为项目选择主页。

登录状态与工作台是否打开由 `connected` 与 `workspaceReady` 分别表示。返回主页不会丢弃当前工作台，可以通过「继续翻译」回到原词条；重启应用仍从项目选择开始。


## 共用项目导航（2026-10-11）

`app.vue` 持有单一 `useWorkspaceNavigation` 和常驻侧栏；目录数据、当前项目、搜索和展开状态在页面导航中保留。主页与编辑页通过同一个导航入口返回、切换项目、打开文件或继续翻译；旧 `/projects` 路径重定向到 `/`。项目首次选择才读取项目资料与文件列表，再次返回直接显示内存数据，显式刷新才重新请求；刷新保留筛选和展开状态。认证恢复后仍等待用户选择项目，不自动加载上次项目或词条。切换路由前串行保存草稿，保存失败阻止离开；未新增远端写入接口。


## 建议搜索固定为全局（2026-10-11）

按用户要求，建议栏历史翻译搜索固定为全局；移除「仅在当前项目中搜索」开关。Nuxt 不发送 `inCurrentProject`，Rust 不再添加该过滤参数，统一请求 `/api/memory?projectId=<编辑器上下文>&text=<搜索词>&field=<字段>`。保留网站协议需要的 `projectId` 上下文；搜索结果不按当前项目 ID 再过滤。可搜索范围和返回结果由 ParaTranz 决定。


## 实时词条占用（2026-10-11）

浏览器重新载入指定编辑页，观察站点公开 JS 与 WebSocket 帧：
- WebSocket 地址 `wss://paratranz.cn/socket.io/?uid=<account.id>&EIO=4&transport=websocket`；Engine.IO 4、Socket.IO 命名空间 `/editing`。
- 命名空间连接 auth 为 `{project: <projectId>}`。站点客户端强制 websocket，query 携带 uid；登录身份由服务端校验，uid 不是凭证。
- `editors` 事件参数为完整数组：`id, username, avatar, editing, editStartedAt, editorSessionId`，`editing` 为字符串 ID。不能用词条最后修改人推断占用。
- 客户端发送 `edit(stringId, ack)`，ack 返回占用用户数组；发送 `leave()` 释放占用。每 300000ms 发送 `heartbeat(stringId)` 保持占用。网站在返回其他页面/退出时断开 editing socket。
- 浏览器观察到项目编辑广播，edit ack 返回当前词条的用户名和开始时间。网站遇到其他 uid 占用时禁用编辑；同 uid 可编辑。
- 公开前端来源：`https://paratranz.cn/assets/index-DAMuVALW.js` 和 `https://paratranz.cn/assets/Strings-D1Ms94am.js`。抓取副本位于 artifacts/presence。未提交任何网站译文。

客户端采用官方 socket.io-client，Electron 主进程持有连接，并通过 Electron 网络代理设置建立 WebSocket。Rust 的 `/internal/presence` 受随机本地密钥保护，只向主进程返回经 `/account` 核对过的 uid 和 Cookie 认证头（POST，网页登录账号必须与当前 API 连接账号相同）；该路径不在 renderer RPC 白名单中。Nuxt 只收到用户占用快照，不收到 Token/Cookie；renderer CSP 保持 connect-src self。

进入真实项目的编辑页时加入命名空间并发布当前可编辑词条；离开编辑页释放词条占用并继续观察该项目；换项目、退出、断开登录时释放连接。选中已锁定或隐藏词条仅观察，不发布自己的占用。列表显示用户名，当前词条显示正在编辑用户；其他用户占用时保留草稿并暂停编辑/提交。断线立即清空占用展示并提示重连，不把缓存当作在线事实。占用是协作状态，服务端的保存权限与版本检查仍为最终依据。


### 占用认证修正

本次真实客户端观测发现 API Token 可访问字符串、术语和建议接口，但 Socket.IO 返回认证拒绝。客户端改为独立使用 Electron `persist:paratranz` 分区 Cookie 登录会话。`/internal/presence` 改为 POST 接收主进程 Cookie，并通过 `/account` 比较 Cookie 身份与当前 API 身份。缺少会话时显示「网页登录」；登录只补充实时通道会话，不替换原 API Token。Cookie 完成登录后实际收到占用广播，用户确认 3 位正在编辑的用户；后按要求移除项目级人数/名单，仅保留具体词条占用显示。

## 账号登录与项目选择分离（2026-10-11）

首次登录、Token 连接和已保存 Token 恢复都使用本地 /credentials 的 projectId=0，不发起默认项目访问；必须先通过 GET /api/account 并读取有效 user.id。未登录、无法确认用户或网络失败不会替换工作中的凭据。成功后主页通过现有 /account 与 /users/{id}/projects 加载参与项目，选中文件才进入编辑器。非零 projectId 的旧接口调用仍可验证指定项目的访问权限。

常规网页登录是推荐入口，Token 是默认折叠的备选入口。主进程仅在成功登录后记住所选方式，connection.json 不含 Token 或 Cookie；Token 仍由 safeStorage 加密，网页会话仍使用 persist:paratranz 分区。占用专用网页登录保持原 API 连接和主登录偏好。当前自然启动日志验证了无项目 Token 恢复和实际项目读取；本次未重新进行首次网页认证。

## 项目术语管理（2026-10-11）

- 官方协议来源：https://paratranz.cn/api-docs?format=json ，已实时读取术语路径、Term schema、TermList 和分页参数。页面参考：https://paratranz.apifox.cn/api-44145258 、https://paratranz.apifox.cn/api-44145261 。
- GET /projects/{projectId}/terms?page=1&pageSize=800 返回分页对象 results/page/rowCount/pageCount；API 没有公开搜索参数，客户端串行读取所有分页后本地搜索与 50 条分页展示。
- GET /projects/{projectId}/terms/{termId} 读取完整编辑资料，POST /projects/{projectId}/terms 创建，PUT /projects/{projectId}/terms/{termId} 修改，DELETE 同一路径删除。删除仅创建者和管理员可用；重复术语/权限等远端错误在侧栏保留表单并显示。
- 写入字段 term、translation、pos、note、variants、caseSensitive；原文/译文原有首尾空白保留，variants 一行一个去空值及精确重复。未指定词性时不发送 pos。uid/project/updatedBy 等只读字段不发送到远端写入。
- RPC 新增 projectTerms/term/createTerm/updateTerm/deleteTerm，已加入 Electron 操作白名单。updateTerm/deleteTerm 必须提供从完整读取取得的 expected；Rust 在写入前核对规范化字段及 updatedAt，防止直接覆盖已变化的版本。ParaTranz 未提供条件写入保证，GET 至写入间仍可能竞争。
