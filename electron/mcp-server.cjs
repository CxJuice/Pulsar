const http = require('node:http');
const { timingSafeEqual, randomUUID } = require('node:crypto');
const { McpServer, createMcpHandler, isLegacyRequest } = require('@modelcontextprotocol/server');
const { NodeStreamableHTTPServerTransport, toNodeHandler } = require('@modelcontextprotocol/node');
const z = require('zod/v4');
const { MCP_BATCH_LIMIT } = require('./mcp-batch.cjs');
const MCP_SUBMISSION_STAGES = [0, 1, 2, 3, 5];

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function errorResult(error) {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : 'MCP 请求失败' }],
    isError: true,
  };
}

function registerTool(server, name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema: z.object(inputSchema) }, async (args, context) => {
    try {
      const invoke = () => handler(args);
      const result = server.pulsarHandlers.runRequest
        ? await server.pulsarHandlers.runRequest({ signal: context.mcpReq.signal, requestId: context.mcpReq.id, sessionId: context.sessionId, tool: name }, invoke)
        : await invoke();
      return textResult(result);
    }
    catch (error) { return errorResult(error); }
  });
}

function createServer(handlers) {
  const server = new McpServer({ name: 'pulsar-translation-workspace', version: '1.0.0' });
  server.pulsarHandlers = handlers;

  server.registerPrompt('pulsar_translation_prompt', {
    title: 'Pulsar 默认翻译提示词',
    description: 'Pulsar 设置中的默认翻译提示词，并附带当前文本读取数量规则。',
  }, async () => {
    const reading = handlers.getReadingPolicy?.();
    const policyText = reading?.mode === 'manual'
      ? `\n\n【当前文本读取设置】手动模式：每次调用 list_strings 固定读取 ${reading.count} 条。请按此数量规划分页，不要尝试更改 pageSize；Pulsar 会强制应用此数量。`
      : reading
        ? `\n\n【当前文本读取设置】自动模式：每次最多读取 ${reading.maxCount} 条；可按任务需要设置 list_strings 的 pageSize，省略时使用建议值 ${reading.count}。`
        : '';
    const prompt = typeof handlers.defaultPrompt === 'string' ? handlers.defaultPrompt : '';
    return {
      messages: [{ role: 'user', content: { type: 'text', text: `${prompt}${policyText}` } }],
    };
  });

  // Keep discovery stable across settings changes and MCP clients that cache tools/list.
  // Every handler checks the current encrypted settings before it reads or writes data.
  registerTool(server, 'get_workspace', '读取 Pulsar 前台工作区、账号连接状态、textReading 数量模式与此刻生效的 effectivePermissions（包括翻译上下文查询权限）；需要启用读取权限。tools/list 是稳定工具清单，不代表权限已开启。', {}, () => handlers.getWorkspace());
  registerTool(server, 'list_projects', '列出当前连接账号参与的 ParaTranz 项目；后台访问开启时可在未打开项目时调用，关闭时仅返回当前前台项目。需要启用读取权限。', {}, () => handlers.listProjects());
  registerTool(server, 'list_project_files', '列出指定账号项目中的文件；若后台访问关闭，只能列出当前前台项目的文件。需要启用读取权限。', {
    projectId: z.number().int().positive(),
  }, args => handlers.listProjectFiles(args));
  registerTool(server, 'list_strings', '按 projectId 分页读取账号项目中的词条；先用 get_workspace 查看 textReading。automatic 模式可按任务指定 pageSize，省略时采用建议 count；manual 模式每页固定 count 并忽略传入 pageSize（最多 50）。省略 fileId 时读取全文聚合，也可指定文件并按原文、译文、键值或上下文筛选。后台访问关闭时只允许当前前台项目；需要启用读取权限。', {
    projectId: z.number().int().positive().optional(),
    fileId: z.number().int().positive().optional(),
    page: z.number().int().min(1).max(100000).optional(),
    pageSize: z.number().int().min(1).max(50).optional(),
    stage: z.number().int().min(-1).max(9).optional(),
    search: z.string().max(200).optional(),
    searchMode: z.enum(['text', 'original', 'translation', 'key', 'context']).optional(),
  }, args => handlers.listStrings(args));
  registerTool(server, 'search_translations', '在指定账号项目的全文聚合或文件中搜索已译文；返回匹配词条后，使用 get_string 读取完整译文并取得 snapshotToken。后台访问关闭时只允许当前前台项目；需要启用读取权限。', {
    projectId: z.number().int().positive().optional(),
    fileId: z.number().int().positive().optional(),
    query: z.string().trim().min(1).max(200),
    page: z.number().int().min(1).max(100000).optional(),
    pageSize: z.number().int().min(1).max(50).optional(),
    stage: z.number().int().min(-1).max(9).optional(),
  }, args => handlers.searchTranslations(args));
  registerTool(server, 'get_current_entry', '读取 Pulsar 前台当前选中词条的原文、键值、上下文、术语、远端译文、本机草稿和服务端版本快照令牌；此工具需要前台已有选中词条。后台读取请用 get_string；需要启用读取权限。', {}, () => handlers.getCurrentEntry());
  registerTool(server, 'get_string', '按项目 ID 和词条 ID 读取账号项目中的词条及本机草稿，并创建短时、一次性的服务端版本快照令牌。写入工具只需提交该令牌，不要复制或序列化时间戳；后台访问关闭时只允许当前前台项目。需要启用读取权限。', {
    projectId: z.number().int().positive().optional(),
    stringId: z.number().int().positive(),
  }, args => handlers.getString(args));
  registerTool(server, 'get_translation_context', '翻译时读取指定词条的文本片段、项目术语和相似译文建议；在 get_string/get_strings 取得原文后按需调用，遵循术语并核对建议语境。建议按相似度降序返回，默认返回 1 条；可用 suggestionCount 请求更多（最多 20 条）。需要启用“翻译时查询文本片段、术语与相似译文”权限，后台访问受当前设置限制。', {
    projectId: z.number().int().positive().optional(), stringId: z.number().int().positive(),
    suggestionCount: z.number().int().min(1).max(20).optional(),
  }, args => handlers.getTranslationContext(args));
  const stringIdSchema = z.number().int().positive().max(2147483647);
  registerTool(server, 'get_strings', '批量读取同一账号项目的 1 到 25 个词条及各自的一次性 snapshotToken，最多 4 个并行读取。批量任务优先使用此工具，避免逐条 get_string；逐条返回成功或失败，ID 不得重复。需要读取权限。', {
    projectId: stringIdSchema,
    stringIds: z.array(stringIdSchema).min(1).max(MCP_BATCH_LIMIT).refine(ids => new Set(ids).size === ids.length, '词条 ID 不得重复'),
  }, args => handlers.getStrings(args));
  registerTool(server, 'prefill_translation', '把译文保存为当前账号的 Pulsar 本机草稿；是否允许操作未打开的项目由后台访问设置控制，是否同步前台编辑器由界面同步设置控制。需要启用“写入本机草稿”权限，不会提交到 ParaTranz。传入 get_string 或 get_current_entry 返回的一次性 snapshotToken；不要传时间戳。', {
    projectId: z.number().int().positive(),
    stringId: z.number().int().positive(),
    translation: z.string().min(1).max(16000),
    snapshotToken: z.string().min(40).max(64),
  }, args => handlers.prefillTranslation(args));
  const draftItemSchema = z.object({ stringId: stringIdSchema, translation: z.string().min(1).max(16000),
    snapshotToken: z.string().min(40).max(64) });
  const uniqueItems = schema => z.array(schema).min(1).max(MCP_BATCH_LIMIT)
    .refine(items => new Set(items.map(item => item.stringId)).size === items.length, '词条 ID 不得重复');
  registerTool(server, 'prefill_translations', '批量将同一项目的 1 到 25 条译文写入本机草稿，不提交 ParaTranz。每条需使用 get_strings 或 get_string 的 snapshotToken；冲突条目单独返回失败，其余草稿合并一次落盘。需要草稿写入权限。批量任务优先使用此工具。', {
    projectId: stringIdSchema, items: uniqueItems(draftItemSchema),
  }, args => handlers.prefillTranslations(args));

  const saveInputSchema = {
    projectId: z.number().int().positive(),
    stringId: z.number().int().positive(),
    translation: z.string().min(1).max(16000),
    stage: z.number().int().refine(value => MCP_SUBMISSION_STAGES.includes(value), '无效的 ParaTranz 词条状态').optional(),
    snapshotToken: z.string().min(40).max(64),
  };
  registerTool(server, 'save_translation_to_paratranz', '把译文直接提交到指定账号项目的 ParaTranz 词条；是否允许操作未打开的项目由后台访问设置控制。需要启用直存并至少允许一个目标状态；调用前可用 get_workspace 检查 effectivePermissions。必须先用 get_string 读取并传入 snapshotToken；版本字段保存在 Pulsar 服务端，发现变化会拒绝提交。界面同步设置开启时会通知前台。', saveInputSchema, args => handlers.saveTranslationToParaTranz(args));
  registerTool(server, 'edit_translation', '修改指定账号项目中已有译文并直接保存到 ParaTranz；是否允许操作未打开的项目由后台访问设置控制。需要启用直存；调用前可用 get_workspace 检查 effectivePermissions.saveToParaTranz 和 saveStages。仅接受已有译文且未锁定或隐藏的词条，始终保留原状态；若原状态未获准，会拒绝提交而不会改成其他状态。必须先用 get_string 读取并传入 snapshotToken；版本快照由 Pulsar 服务端保存和校验，连接器无需提交时间戳。界面同步设置开启时会通知前台。', saveInputSchema, args => handlers.editTranslation(args));
  registerTool(server, 'save_translations_to_paratranz', '批量直存同一账号项目的 1 到 25 条译文，合并为一次 ParaTranz 批量编辑。每条使用 get_strings 或 get_string 返回的 snapshotToken；远端版本和草稿逐条核对，冲突与上游未接受的词条返回单独失败。mode=edit 用于修改已有译文并保留各自原状态，mode=save 用于新译文及允许的目标状态。只有用户明确要求写回且直存权限开启时调用；批量任务优先使用此工具，不要逐条循环调用。结果不确定时先重新读取，不要盲目重试。', {
    projectId: stringIdSchema, mode: z.enum(['save', 'edit']).optional(),
    items: uniqueItems(draftItemSchema.extend({ stage: saveInputSchema.stage })),
  }, args => handlers.saveTranslationsToParaTranz(args));

  return server;
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function safeTokenMatch(candidate, token) {
  if (typeof candidate !== 'string' || typeof token !== 'string') return false;
  const first = Buffer.from(candidate);
  const second = Buffer.from(token);
  return first.length === second.length && timingSafeEqual(first, second);
}

function loopbackHost(value, port) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(`http://${value}`);
    return !parsed.username && !parsed.password && !parsed.pathname.replace(/\/$/, '') &&
      !parsed.search && !parsed.hash && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) &&
      Number(parsed.port || 80) === port;
  } catch { return false; }
}

function loopbackOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.origin === value && !parsed.username && !parsed.password && parsed.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase());
  } catch { return false; }
}

function sendJson(res, status, value) {
  if (res.headersSent) return res.destroy();
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

async function startMcpHttpServer({ port, token, handlers, shutdownTimeoutMs = 2000, sessionLimit = 32, sessionTtlMs = 30 * 60 * 1000 }) {
  let activeRequests = 0;
  let lastRequestAt = null;
  let closing = false, closePromise;
  const sessions = new Map(), sockets = new Set(), opening = new Set();
  const modern = createMcpHandler(() => createServer(handlers), { legacy: 'reject', responseMode: 'sse', maxSubscriptions: 8 });
  const modernNode = toNodeHandler(modern);
  const closeSession = async entry => {
    if (entry.transport.sessionId) sessions.delete(entry.transport.sessionId);
    opening.delete(entry);
    try { await entry.server.close(); } catch { /* Cleanup must not leak rejected promises. */ }
  };
  const httpServer = http.createServer(async (req, res) => {
    if (closing) return sendJson(res, 503, { error: 'MCP 服务正在关闭' });
    if (!isLoopback(req.socket.remoteAddress)) return sendJson(res, 403, { error: '本 MCP 服务仅允许本机连接' });
    if (!loopbackHost(req.headers.host, port)) return sendJson(res, 403, { error: '无效的本机 MCP Host' });

    const origin = req.headers.origin;
    if (origin) {
      if (!loopbackOrigin(origin)) return sendJson(res, 403, { error: '无效的本机 MCP Origin' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }

    let pathname;
    try { pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname; }
    catch { return sendJson(res, 400, { error: '无效的 MCP 路径' }); }
    if (pathname !== '/mcp') return sendJson(res, 404, { error: 'MCP endpoint 不存在' });
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!['POST', 'GET', 'DELETE'].includes(req.method || '')) return sendJson(res, 405, { error: 'MCP endpoint 不支持此方法' });

    const authorization = req.headers.authorization || '';
    const suppliedToken = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization)?.[1];
    if (!safeTokenMatch(suppliedToken, token)) return sendJson(res, 401, { error: 'MCP Bearer 令牌无效' });
    if (req.method === 'GET') {
      res.setHeader('Allow', 'POST, DELETE, OPTIONS');
      return sendJson(res, 405, { error: '无需 GET 长连接；使用 POST 调用 MCP' });
    }

    activeRequests++;
    lastRequestAt = new Date().toISOString();
    let requestCounted = true;
    const finishRequest = () => {
      if (!requestCounted) return;
      requestCounted = false;
      activeRequests = Math.max(0, activeRequests - 1);
    };
    res.once('finish', finishRequest);
    res.once('close', finishRequest);
    let entry;
    try {
      const bytes = [];
      let size = 0;
      if (Number(req.headers['content-length'] || 0) > 4 * 1024 * 1024) return sendJson(res, 413, { error: 'MCP 请求过大' });
      if (req.method === 'POST') {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) return sendJson(res, 413, { error: 'MCP 请求过大' });
          bytes.push(chunk);
        }
      }
      let body;
      try { body = req.method === 'POST' ? JSON.parse(Buffer.concat(bytes).toString('utf8')) : undefined; }
      catch { return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); }
      const webHeaders = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') webHeaders.set(name, value);
      const modernRequest = new Request(`http://127.0.0.1:${port}/mcp`, { method: req.method, headers: webHeaders });
      if (!await isLegacyRequest(modernRequest, body)) return await modernNode(req, res, body);
      const sessionId = req.headers['mcp-session-id'];
      entry = typeof sessionId === 'string' ? sessions.get(sessionId) : null;
      if (!entry) {
        if (sessionId) return sendJson(res, 404, { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32001, message: 'MCP session expired' } });
        if (body?.method !== 'initialize') return sendJson(res, 400, { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32000, message: 'Initialize MCP first' } });
        if (sessions.size + opening.size >= sessionLimit) return sendJson(res, 429, { error: 'MCP 会话数已达上限' });
        const server = createServer(handlers);
        const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => { opening.delete(entry); sessions.set(id, entry); },
          onsessionclosed: id => { sessions.delete(id); } });
        entry = { server, transport, lastUsedAt: Date.now(), active: 0 };
        opening.add(entry);
        await server.connect(transport);
        const onmessage = transport.onmessage;
        transport.onmessage = (message, extra) => {
          onmessage?.(message, extra);
          if (message.method === 'notifications/cancelled' && message.params?.requestId !== undefined) {
            transport.closeSSEStream(message.params.requestId);
          }
        };
      }
      entry.lastUsedAt = Date.now(); entry.active++;
      res.once('close', () => {
        if (!res.writableFinished && body?.id !== undefined) {
          entry.transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: body.id, reason: 'HTTP response closed' } });
        }
      });
      await entry.transport.handleRequest(req, res, body);
    } catch {
      sendJson(res, 500, { error: 'MCP 请求处理失败' });
    } finally {
      if (entry) {
        entry.active = Math.max(0, entry.active - 1);
        if (!entry.transport.sessionId) void closeSession(entry);
      }
    }
  });
  httpServer.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const cleanup = setInterval(() => {
    for (const entry of sessions.values()) if (!entry.active && Date.now() - entry.lastUsedAt > sessionTtlMs) void closeSession(entry);
  }, Math.min(sessionTtlMs, 60_000));
  cleanup.unref();

  httpServer.headersTimeout = 15000;
  httpServer.requestTimeout = 120000;
  try { await new Promise((resolve, reject) => {
    const onError = error => { httpServer.off('listening', onListening); reject(error); };
    const onListening = () => { httpServer.off('error', onError); resolve(); };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port, '127.0.0.1');
  }); } catch (error) {
    clearInterval(cleanup);
    await modern.close();
    throw error;
  }

  return {
    port: httpServer.address()?.port || port,
    getStatus: () => ({ activeRequests, lastRequestAt, sessions: sessions.size, closing }),
    close: () => {
      if (closePromise) return closePromise;
      closing = true; clearInterval(cleanup);
      closePromise = new Promise(resolve => {
        const timeout = setTimeout(() => { for (const socket of sockets) socket.destroy(); resolve(); }, shutdownTimeoutMs);
        httpServer.close(() => { clearTimeout(timeout); resolve(); });
        void modern.close();
        for (const entry of sessions.values()) void closeSession(entry);
        for (const entry of opening) void closeSession(entry);
        httpServer.closeIdleConnections();
      });
      return closePromise;
    },
  };
}

module.exports = { startMcpHttpServer };
