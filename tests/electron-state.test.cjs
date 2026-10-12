const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const mainPath = path.resolve(__dirname, '../electron/main.cjs');
const requireFromMain = createRequire(mainPath);
const source = fs.readFileSync(mainPath, 'utf8').split('if (!smoke && !app.requestSingleInstanceLock())')[0];

function harness(t, overrides = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sckit-state-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const sessions = new Map();
  const ipcHandlers = new Map();
  const getSession = name => {
    if (!sessions.has(name)) sessions.set(name, {
      proxy: { mode: 'system' },
      async setProxy(config) { this.proxy = config; },
      async closeAllConnections() {},
      async resolveProxy() { return 'DIRECT'; },
      cookies: { async get() { return []; }, async flushStore() {} },
    });
    return sessions.get(name);
  };
  const electron = {
    app: { getAppPath: () => folder, getPath: () => folder, isPackaged: false },
    protocol: { registerSchemesAsPrivileged() {} },
    ipcMain: { handle(name, action) { ipcHandlers.set(name, action); }, on() {} },
    session: { defaultSession: getSession('default'), fromPartition: getSession },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(Buffer.from(value).toString('base64')),
      decryptString: value => Buffer.from(value.toString(), 'base64').toString(),
    },
    dialog: { showErrorBox() { throw new Error('Unexpected service error dialog'); } },
  };
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return electron;
      if (name === './presence.cjs') return () => ({ stop() {} });
      if (name === 'node:child_process' && overrides.spawn) return { spawn: overrides.spawn };
      return requireFromMain(name);
    },
    process: { argv: [], env: overrides.env || {}, platform: 'win32' },
    __dirname: path.dirname(mainPath), Buffer, URL, AbortSignal,
    setTimeout, clearTimeout, fetch: overrides.fetch || fetch,
  });
  vm.runInContext(source, context, { filename: mainPath });
  const run = expression => vm.runInContext(expression, context);
  return { run, context, folder, sessions, electron, ipcHandlers };
}

test('LLM URL, model, prompt and API key survive inactive-provider saves and rereading', t => {
  const h = harness(t);
  h.run(`saveTranslationSettings({ ...defaultTranslationSettings(), provider: 'llm', llmRequestUrl: 'https://example.test/v1/chat/completions', llmModel: 'test-model', llmPrefixPrompt: 'Keep placeholders.', llmApiKey: 'test-only-key' })`);
  h.run(`saveTranslationSettings({ ...defaultTranslationSettings(), provider: 'google', llmRequestUrl: '', llmModel: '', llmPrefixPrompt: '' })`);
  const saved = h.run('readTranslationSettings()');
  assert.equal(saved.llmRequestUrl, 'https://example.test/v1/chat/completions');
  assert.equal(saved.llmModel, 'test-model');
  assert.equal(saved.llmPrefixPrompt, 'Keep placeholders.');
  assert.equal(saved.llmApiKey, 'test-only-key');
  assert.equal(h.run('publicTranslationSettings()').llmConfigured, true);
  assert.equal('llmApiKey' in h.run('publicTranslationSettings()'), false);
  h.run(`saveTranslationSettings({ ...readTranslationSettings(), provider: 'llm', llmPrefixPrompt: '' })`);
  assert.equal(h.run('readTranslationSettings().llmPrefixPrompt'), '');
});

test('testing unsaved proxy values leaves login, translation and persisted settings unchanged', async t => {
  const h = harness(t);
  h.run(`probeProxyUrl = async target => ({ target: new URL(target).origin, ok: true, status: 200, elapsedMs: 1 })`);
  const modes = ['http', 'socks5', 'direct', 'system'];
  for (const mode of modes) {
    const result = await h.run(`testProxyConnectivity({ mode: '${mode}', host: '127.0.0.1', port: 7890 })`);
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);
  }
  assert.equal(h.sessions.has('persist:paratranz'), false);
  assert.equal(h.sessions.has('persist:translation-web'), false);
  assert.equal(h.run('readTranslationSettings().proxy.mode'), 'system');
  assert.equal(fs.existsSync(path.join(h.folder, 'translation-settings.bin')), false);
});

test('global proxy settings cover all desktop sessions and encode IPv6 correctly', async t => {
  const h = harness(t);
  await h.run(`configureGlobalProxy({ proxy: { mode: 'socks5', host: '[::1]', port: 1080 } })`);
  for (const name of ['default', 'persist:paratranz', 'persist:translation-web', 'persist:cambridge']) {
    assert.equal(h.sessions.get(name).proxy.proxyRules, 'socks5://[::1]:1080');
  }
  assert.equal(h.run(`serviceProxyUrl({ proxy: { mode: 'socks5', host: '[::1]', port: 1080 } })`), 'socks5h://[::1]:1080');
  assert.throws(() => h.run(`proxyForTest({ mode: 'http', host: 'http://127.0.0.1', port: 7890 })`));
  assert.throws(() => h.run(`proxyForTest({ mode: 'socks5', host: '127.0.0.1', port: 65536 })`));
});

test('connectivity probes finish at response headers and enforce an overall deadline', async t => {
  const h = harness(t);
  const server = http.createServer((request, response) => {
    if (request.url === '/headers') { response.writeHead(200); response.flushHeaders(); }
    // /stall deliberately never sends a response.
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = await h.run(`probeProxyUrl('${base}/headers', undefined, 500)`);
  assert.equal(headers.ok, true);
  assert.equal(headers.status, 200);
  const stalled = await h.run(`probeProxyUrl('${base}/stall', undefined, 50)`);
  assert.equal(stalled.ok, false);
  assert.equal(stalled.message, '连接超时');
  assert.ok(stalled.elapsedMs < 1000);
});

test('expired login credentials are not retried as cookie-readiness failures', async t => {
  const h = harness(t);
  h.sessions.set('persist:paratranz', { cookies: { async get() {
    return [{ name: 'sid', value: 'test-session' }, { name: 'unrelated', value: 'excluded' }];
  } } });
  h.run(`globalThis.credentialCalls = 0; serviceRequest = async () => { credentialCalls++; return { ok: false, status: 401 }; }`);
  const result = await h.run('cookieConnection(0, 8)');
  assert.equal(result.status, 401);
  assert.equal(h.run('credentialCalls'), 1);
  assert.equal(h.run(`cookieHeader([{ name: 'sid', value: 'test-session' }])`), 'sid=test-session');
});

test('login retries cookie readiness before connecting and accepts an existing session', async t => {
  const h = harness(t);
  let reads = 0;
  h.sessions.set('persist:paratranz', { cookies: {
    async get() { return ++reads === 1 ? [] : [{ name: 'sid', value: 'test-session' }]; },
  } });
  h.run(`serviceRequest = async () => ({ ok: true, data: { authenticated: true } })`);
  const result = await h.run('cookieConnection(0, 2)');
  assert.equal(result.ok, true);
  assert.equal(reads, 2);
});

test('session login cookies are stored using safeStorage and restored without overwriting live cookies', async t => {
  const h = harness(t);
  const stored = [{ name: 'sid', value: 'test-session', domain: 'paratranz.cn', path: '/', hostOnly: true, secure: true, httpOnly: true, session: true, sameSite: 'lax' },
    { name: 'user', value: 'test-user', domain: '.paratranz.cn', path: '/', hostOnly: false, session: true, sameSite: 'lax' },
    { name: 'locale', value: 'zh-CN', domain: 'paratranz.cn', session: false },
    { name: 'unrelated', value: 'excluded', domain: 'paratranz.cn', session: true }];
  let cookies = stored;
  const restored = [];
  h.sessions.set('persist:paratranz', { cookies: {
    async get() { return cookies; }, async flushStore() {}, async set(details) { restored.push(details); },
  } });
  await h.run(`persistLoginSession(session.fromPartition('persist:paratranz'))`);
  const archive = fs.readFileSync(path.join(h.folder, 'paratranz-session.bin'), 'utf8');
  assert.equal(archive.includes('test-session'), false);
  cookies = [stored[0]];
  await h.run('restoreLoginSession()');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].name, 'user');
  assert.equal(restored[0].domain, '.paratranz.cn');
  assert.equal('expirationDate' in restored[0], false);
  restored.length = 0;
  cookies = [];
  await h.run('restoreLoginSession()');
  assert.equal(restored.length, 2);
  assert.equal('domain' in restored.find(cookie => cookie.name === 'sid'), false);
});

test('disconnect removes the saved login snapshot and the login session storage', async t => {
  const h = harness(t);
  let cleared = false;
  h.sessions.set('persist:paratranz', { async clearStorageData() { cleared = true; } });
  fs.writeFileSync(path.join(h.folder, 'paratranz-session.bin'), 'test snapshot');
  h.run(`validateSender = () => {}; serviceRequest = async () => ({ ok: true }); registerIpc()`);
  const result = await h.ipcHandlers.get('sc:disconnect')({});
  assert.equal(result.ok, true);
  assert.equal(cleared, true);
  assert.equal(fs.existsSync(path.join(h.folder, 'paratranz-session.bin')), false);
});

test('direct mode removes inherited proxy environment when restarting the service', async t => {
  let serviceEnv;
  const h = harness(t, {
    env: { HTTP_PROXY: 'http://old.test:7890', https_proxy: 'http://old.test:7890', ALL_PROXY: 'socks5://old.test:1080', SCKIT_PROXY: 'http://old.test:7890' },
    spawn(_exe, _args, options) {
      serviceEnv = options.env;
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => child.emit('exit', 0);
      setImmediate(() => child.stdout.emit('data', Buffer.from('{"status":"ready","port":12345}\n')));
      return child;
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ authenticated: true }) }),
  });
  const servicePath = path.join(h.folder, 'service/target/release/sctranslate-service.exe');
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  fs.writeFileSync(servicePath, 'test placeholder');
  h.run(`saveTranslationSettings({ ...defaultTranslationSettings(), proxy: { mode: 'direct', host: '127.0.0.1', port: 7890 } })`);
  await h.run('startService()');
  for (const key of ['HTTP_PROXY', 'https_proxy', 'ALL_PROXY', 'SCKIT_PROXY']) assert.equal(key in serviceEnv, false);
  await h.run(`serviceRequest('/credentials', 'POST', { token: 'test-only-token', projectId: 0 })`);
  await h.run('restartService()');
  assert.equal(h.run('activeServiceCredentials.token'), 'test-only-token');
  await h.run(`serviceRequest('/credentials', 'DELETE')`);
  assert.equal(h.run('activeServiceCredentials'), null);
  h.run('closing = true');
  await h.run('stopService()');
});
