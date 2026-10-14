const assert = require('node:assert/strict');
const http = require('node:http');
const { AsyncLocalStorage } = require('node:async_hooks');
const { test } = require('node:test');
const { Client: LegacyClient } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport: LegacyTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { Client: ModernClient, StreamableHTTPClientTransport: ModernTransport } = require('@modelcontextprotocol/client');
const { startMcpHttpServer } = require('../electron/mcp-server.cjs');
const { createMcpHarness, delay } = require('./helpers/mcp-harness.cjs');
const { createMcpOperationContext } = require('../electron/mcp-operation-context.cjs');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function freePort() {
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function endpoint(t, handlers = {}) {
  const port = await freePort(), token = 'x'.repeat(43);
  const handle = await startMcpHttpServer({ port, token, handlers, shutdownTimeoutMs: 200 });
  t.after(() => handle.close());
  return { handle, url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } };
}
async function legacy(endpoint) {
  const client = new LegacyClient({ name: 'legacy-audit', version: '1' });
  await client.connect(new LegacyTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
  return client;
}

test('modern pinned client discovers 2026 protocol and shares tools with the legacy client', async t => {
  const endpointState = await endpoint(t, { getWorkspace: async () => ({ ready: true }), defaultPrompt: 'audit' });
  const modern = new ModernClient({ name: 'modern-audit', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const old = await legacy(endpointState);
  try {
    await modern.connect(new ModernTransport(new URL(endpointState.url), { requestInit: { headers: endpointState.headers } }));
    assert.equal(modern.getProtocolEra(), 'modern');
    assert.equal((await modern.listTools()).tools.length, (await old.listTools()).tools.length);
    const result = await modern.callTool({ name: 'get_workspace', arguments: {} });
    assert.equal(JSON.parse(result.content[0].text).ready, true);
    assert.equal((await modern.getPrompt({ name: 'pulsar_translation_prompt' })).messages[0].content.text, 'audit');
  } finally { await modern.close(); await old.close(); }
});

test('GET streams are explicitly rejected and shutdown releases the port', async t => {
  const ep = await endpoint(t);
  const response = await fetch(ep.url, { headers: { ...ep.headers, Accept: 'text/event-stream' } });
  assert.equal(response.status, 405); await response.text();
  const client = await legacy(ep);
  await ep.handle.close();
  assert.equal(ep.handle.getStatus().closing, true);
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(ep.handle.port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve)); await client.close();
});

test('authorization and origin validation reject forged browser requests', async t => {
  const ep=await endpoint(t);
  for(const [headers,status] of [[{},401],[{...ep.headers,Origin:'https://evil.example'},403],[{...ep.headers,Origin:'http://localhost@evil.example'},403],[{...ep.headers,Origin:'http://localhost/'},403]]) {
    const response=await fetch(ep.url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});
    assert.equal(response.status,status);await response.text();
  }
  const invalid=await fetch(ep.url,{method:'POST',headers:{...ep.headers,'Content-Type':'application/json'},body:'{'});
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).error.code,-32700);
});

test('a failed listener start can be retried after the occupied port is released', async t => {
  const occupied=http.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  const port=occupied.address().port;
  await assert.rejects(startMcpHttpServer({port,token:'x'.repeat(43),handlers:{}}),/EADDRINUSE/);
  await new Promise(resolve=>occupied.close(resolve));
  const handle=await startMcpHttpServer({port,token:'x'.repeat(43),handlers:{}});t.after(()=>handle.close());
  assert.equal(handle.port,port);
});

test('legacy cancellation stays within its session and reaches the handler signal', async t => {
  const contexts = new AsyncLocalStorage(), started = [deferred(), deferred()], gates = [deferred(), deferred()];
  const signals = [], effects = [];
  const ep = await endpoint(t, {
    runRequest: (context, invoke) => contexts.run(context, invoke),
    getWorkspace: async () => {
      const index = signals.length, signal = contexts.getStore().signal; signals.push(signal); started[index].resolve();
      await gates[index].promise; signal.throwIfAborted(); effects.push(index); return { index };
    },
  });
  const first = await legacy(ep), second = await legacy(ep), controller = new AbortController();
  try {
    const canceled = first.callTool({ name: 'get_workspace', arguments: {} }, undefined, { signal: controller.signal });
    const rejection = assert.rejects(canceled);
    await started[0].promise;
    const kept = second.callTool({ name: 'get_workspace', arguments: {} });
    await started[1].promise; controller.abort(); await rejection;
    for (let i = 0; i < 30 && !signals[0].aborted; i++) await delay(10);
    assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
    gates[0].resolve(); gates[1].resolve();
    assert.equal(JSON.parse((await kept).content[0].text).index, 1); assert.deepEqual(effects, [1]);
  } finally { gates.forEach(gate => gate.resolve()); await first.close(); await second.close(); }
});

test('modern stream cancellation reaches the handler and suppresses effects', { timeout: 3000 }, async t => {
  const contexts = new AsyncLocalStorage(), started = deferred(), gate = deferred(); let signal, effect = false;
  const ep = await endpoint(t, {
    runRequest: (context, invoke) => contexts.run(context, invoke),
    getWorkspace: async () => { signal = contexts.getStore().signal; started.resolve(); await gate.promise; signal.throwIfAborted(); effect = true; return {}; },
  });
  const client = new ModernClient({ name: 'cancel-modern', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const controller = new AbortController();
  try {
    await client.connect(new ModernTransport(new URL(ep.url), { requestInit: { headers: ep.headers } }));
    const pending = client.callTool({ name: 'get_workspace', arguments: {} }, { signal: controller.signal });
    const rejected = assert.rejects(pending); await started.promise; controller.abort(); await rejected;
    for (let i = 0; i < 30 && !signal.aborted; i++) await delay(10);
    assert.equal(signal.aborted, true); gate.resolve(); await delay(20); assert.equal(effect, false);
  } finally { gate.resolve(); await client.close(); }
});

test('concurrent lifecycle starts close the replaced listener instead of leaking it', async t => {
  const h = createMcpHarness(), ports = [await freePort(), await freePort()];
  t.after(async () => { await h.run('stopMcpServer()'); h.cleanup(); });
  const settings = JSON.parse(JSON.stringify(h.run('readMcpSettings()'))); settings.token = 'x'.repeat(43);
  await Promise.all(ports.map(port => h.call('startMcpServer', { ...settings, port })));
  assert.equal(h.run('mcpServerPort'), ports[1]); assert.equal(h.run('mcpServerState'), 'running');
  await assert.rejects(fetch(`http://127.0.0.1:${ports[0]}/mcp`));
  const response = await fetch(`http://127.0.0.1:${ports[1]}/mcp`); assert.equal(response.status, 401); await response.text();
});

test('canceling one consumer preserves the shared session read for another consumer', async t => {
  const h = createMcpHarness(), started = deferred(), gate = deferred();
  t.after(() => h.cleanup());
  h.state.onSession = async () => { started.resolve(); await gate.promise; };
  const controller = new AbortController();
  h.context.requestSignal = controller.signal;
  const first = h.run('mcpOperations.run({ signal: requestSignal }, () => mcpSessionStatus())');
  const rejected = assert.rejects(first);
  await started.promise; controller.abort(); await rejected;
  const second = h.run('mcpSessionStatus()'); gate.resolve();
  assert.equal((await second).user.id, 1); assert.equal(h.counts.session, 1);
});

test('operation cancellation covers a registration race and drains completed work', async () => {
  const begun = deferred(), gate = deferred(), calls = []; let effect = false;
  const contexts = createMcpOperationContext({ generation: () => 2,
    begin: async operation => { calls.push(['begin', operation.id]); begun.resolve(); await gate.promise; },
    cancel: async operation => calls.push(['cancel', operation.id]), finish: async operation => calls.push(['finish', operation.id]) });
  const controller = new AbortController();
  const pending = contexts.run({ signal: controller.signal }, () => { effect = true; });
  const rejected = assert.rejects(pending); await begun.promise; controller.abort();
  const drained = contexts.drain(); gate.resolve(); await rejected; await drained;
  assert.equal(effect, false); assert.deepEqual(calls.map(call => call[0]), ['begin', 'cancel', 'finish']);
  assert.equal(contexts.count(), 0);
});

test('implicit and explicit project lists both aggregate unless fileId is provided', async t => {
  const h = createMcpHarness(); t.after(() => h.cleanup());
  h.run('mcpWorkspaceContext = { accountId: 1, connectionEpoch: 0, project: {id: 8340}, file: {id: 20} }');
  await h.call('mcpListStrings', {}); await h.call('mcpListStrings', {projectId:8340});
  assert.equal(h.state.listPayloads.every(payload => payload.fileId === undefined), true);
});

test('current entry rejects a changed frontend selection and background context supplies terms and suggestions', async t => {
  const h = createMcpHarness(), started = deferred(), gate = deferred(); t.after(() => h.cleanup());
  h.run('mcpWorkspaceContext = { accountId: 1, connectionEpoch: 0, project: {id: 8340}, file: {id: 20}, selected: {id: 1} }');
  h.state.onRead = async () => { started.resolve(); await gate.promise; };
  const pending = h.run('mcpGetCurrentEntry()'), rejected = assert.rejects(pending, /前台选中/);
  await started.promise;
  h.run('mcpWorkspaceContext = { accountId: 1, connectionEpoch: 0, project: {id: 8340}, file: {id: 20}, selected: {id: 2} }');
  gate.resolve(); await rejected;
  const context = await h.call('mcpGetTranslationContext', {projectId:8340,stringId:1});
  assert.equal(context.terms[0].translation, '原文'); assert.equal(context.suggestions[0].translation, '原文');
});
