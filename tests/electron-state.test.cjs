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
      async clearStorageData() { this.storageCleared = true; },
      async resolveProxy() { return 'DIRECT'; },
      cookies: { async get() { return []; }, async flushStore() {} },
    });
    return sessions.get(name);
  };
  const electron = {
    app: { getAppPath: () => folder, getPath: () => folder, isPackaged: false },
    protocol: { registerSchemesAsPrivileged() {} },
    net: overrides.net || {},
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
    __dirname: path.dirname(mainPath), Buffer, URL, AbortSignal, AbortController,
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

function tokenLoginHarness(t, { redirect = '/', cookies = true, serviceOk = true, requestError = false } = {}) {
  const submissions = [], credentialCalls = [];
  const oldCookie = { name: 'sid', value: 'previous-session', domain: 'paratranz.cn', path: '/', hostOnly: true, secure: true, httpOnly: true, session: true, sameSite: 'lax' };
  const newCookie = { ...oldCookie, value: 'new-session', session: false, expirationDate: 2_000_000_000 };
  const cookieJar = initial => {
    let values = initial;
    return {
      async get() { return values; }, async flushStore() {},
      async remove(_url, name) { values = values.filter(cookie => cookie.name !== name); },
      async set(details) {
        values = values.filter(cookie => cookie.name !== details.name);
        values.push({ ...details, domain: details.domain || 'paratranz.cn', hostOnly: !details.domain, session: !details.expirationDate });
      },
    };
  };
  const h = harness(t, { net: { request(options) {
    options.session.cookies = cookieJar([]);
    const request = new EventEmitter();
    const submission = { options, headers: {}, body: '', followed: false, aborted: false };
    submissions.push(submission);
    request.setHeader = (name, value) => { submission.headers[name] = value; };
    request.abort = () => { submission.aborted = true; };
    request.followRedirect = () => {
      submission.followed = true;
      const response = new EventEmitter(); response.statusCode = 200;
      request.emit('response', response);
      response.emit('data', Buffer.from('<html>ParaTranz</html>'));
      response.emit('end');
    };
    request.end = body => {
      submission.body = body;
      queueMicrotask(async () => {
        if (requestError) return request.emit('error', new Error('test network failure'));
        if (cookies) {
          await options.session.cookies.set(newCookie);
          await options.session.cookies.set({ ...newCookie, name: 'unrelated', value: 'excluded' });
        }
        request.emit('redirect', 302, 'GET', new URL(redirect, 'https://paratranz.cn').href, {});
      });
    };
    return request;
  } } });
  const liveCookies = cookieJar([oldCookie]);
  h.sessions.set('persist:paratranz', { cookies: liveCookies });
  h.context.recordCredentialCall = (endpoint, body) => {
    credentialCalls.push({ endpoint, body });
    return serviceOk ? { ok: true, data: { authenticated: true, mode: 'session', user: { id: 2 } } } : { ok: false, status: 401, message: 'Not authenticated' };
  };
  h.run(`serviceRequest = async (endpoint, method, body) => recordCredentialCall(endpoint, body); validateSender = () => {}; registerIpc()`);
  return { ...h, submissions, credentialCalls, liveCookies, oldCookie, newCookie };
}

test('Token login submits the website form, follows redirects and connects using the resulting Cookie', async t => {
  const h = tokenLoginHarness(t);
  const token = '0123456789abcdefghijklmnopqrstuv';
  h.run(`saveTranslationSettings({ ...defaultTranslationSettings(), proxy: { mode: 'socks5', host: '127.0.0.1', port: 10808 } })`);
  const result = await h.ipcHandlers.get('sc:connect')({}, token, true, 0);
  assert.equal(result.ok, true);
  assert.equal(result.data.mode, 'session');
  assert.equal(h.submissions.length, 1);
  const submitted = h.submissions[0];
  assert.equal(submitted.options.url, 'https://paratranz.cn/oauth/token');
  assert.equal(submitted.options.method, 'POST');
  assert.equal(submitted.options.redirect, 'manual');
  assert.equal(submitted.options.credentials, 'include');
  assert.equal(submitted.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(submitted.body, `token=${token}`);
  assert.equal(submitted.followed, true);
  assert.equal(submitted.options.session.storageCleared, true);
  assert.equal(submitted.options.session.proxy.proxyRules, 'socks5://127.0.0.1:10808');
  assert.equal([...h.sessions.keys()].find(name => name.startsWith('paratranz-token-')).startsWith('persist:'), false);
  assert.equal(h.credentialCalls.length, 1);
  assert.equal(h.credentialCalls[0].endpoint, '/credentials');
  assert.equal(h.credentialCalls[0].body.cookie, 'sid=new-session');
  assert.equal('token' in h.credentialCalls[0].body, false);
  assert.equal((await h.liveCookies.get())[0].expirationDate, h.newCookie.expirationDate);
  assert.equal(fs.readFileSync(path.join(h.folder, 'credentials.bin'), 'utf8').includes(token), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.folder, 'connection.json'), 'utf8')).mode, 'token');
});

test('manual Token login waits for startup connection restoration before submitting', async t => {
  const h = tokenLoginHarness(t);
  h.run('connectionRestoration = new Promise(resolve => { globalThis.finishRestoration = resolve; })');
  const pending = h.ipcHandlers.get('sc:connect')({}, '0'.repeat(32), false, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.submissions.length, 0);
  assert.equal(h.credentialCalls.length, 0);
  h.run('finishRestoration()');
  assert.equal((await pending).ok, true);
  assert.equal(h.submissions.length, 1);
  assert.equal(h.credentialCalls[0].body.cookie, 'sid=new-session');
});

test('a rejected Token cannot reuse or overwrite an existing login or saved Token', async t => {
  const h = tokenLoginHarness(t, { redirect: '/login?fail=1&message=Token%20error', cookies: false });
  fs.writeFileSync(path.join(h.folder, 'credentials.bin'), 'previous archive');
  fs.writeFileSync(path.join(h.folder, 'connection.json'), '{"mode":"session"}');
  const result = await h.ipcHandlers.get('sc:connect')({}, '0'.repeat(32), true, 0);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(h.submissions[0].followed, false);
  assert.equal(h.credentialCalls.length, 0);
  assert.deepEqual(await h.liveCookies.get(), [h.oldCookie]);
  assert.equal(fs.readFileSync(path.join(h.folder, 'credentials.bin'), 'utf8'), 'previous archive');
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.folder, 'connection.json'), 'utf8')).mode, 'session');
});

test('missing Cookie, network failures and external redirects never connect', async t => {
  for (const options of [{ cookies: false }, { requestError: true }, { redirect: 'https://example.test/' }]) {
    const h = tokenLoginHarness(t, options);
    const result = await h.ipcHandlers.get('sc:connect')({}, '0'.repeat(32), false, 0);
    assert.equal(result.ok, false);
    assert.equal(h.credentialCalls.length, 0);
    assert.deepEqual(await h.liveCookies.get(), [h.oldCookie]);
    assert.equal(h.run('tokenLoginInFlight'), false);
  }
});

test('account verification failure restores the previous Cookie and keeps saved credentials', async t => {
  const h = tokenLoginHarness(t, { serviceOk: false });
  fs.writeFileSync(path.join(h.folder, 'credentials.bin'), 'previous archive');
  const result = await h.ipcHandlers.get('sc:connect')({}, '0'.repeat(32), true, 0);
  assert.equal(result.status, 401);
  assert.equal(h.credentialCalls.length, 1);
  assert.equal((await h.liveCookies.get())[0].value, 'previous-session');
  assert.equal(fs.readFileSync(path.join(h.folder, 'credentials.bin'), 'utf8'), 'previous archive');
});

test('saved Bearer Tokens migrate through the website login and unremembered Tokens are removed', async t => {
  const h = tokenLoginHarness(t);
  const saved = h.electron.safeStorage.encryptString(JSON.stringify({ token: `Bearer ${'0'.repeat(32)}`, projectId: 8340 }));
  fs.writeFileSync(path.join(h.folder, 'credentials.bin'), saved);
  fs.writeFileSync(path.join(h.folder, 'connection.json'), '{"mode":"token"}');
  assert.equal((await h.run('restoreConnection()')).ok, true);
  assert.equal(h.submissions[0].body, `token=${'0'.repeat(32)}`);
  assert.equal(h.credentialCalls[0].body.projectId, 0);
  await h.ipcHandlers.get('sc:connect')({}, '1'.repeat(32), false, 0);
  assert.equal(fs.existsSync(path.join(h.folder, 'credentials.bin')), false);
  assert.equal((await h.run('restoreConnection()')).ok, false);
  assert.equal(h.submissions.length, 2);
});

test('invalid Token format and concurrent logins are rejected before issuing network requests', async t => {
  const h = tokenLoginHarness(t);
  for (const token of [null, '', 'short', '0'.repeat(31), '0'.repeat(33), '0'.repeat(31) + '\n', '0'.repeat(30) + '\n0']) {
    assert.equal((await h.ipcHandlers.get('sc:connect')({}, token, false, 0)).ok, false);
  }
  assert.equal(h.submissions.length, 0);
  h.run('tokenLoginInFlight = true');
  assert.equal((await h.ipcHandlers.get('sc:connect')({}, '0'.repeat(32), false, 0)).ok, false);
  assert.equal((await h.run('login(0)')).ok, false);
  assert.equal(h.submissions.length, 0);
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

test('proxy change rolls settings back when service restoration fails', async t => {
  const h = harness(t);
  h.run(`validateSender = () => {}; globalThis.restartCount = 0;
    configureGlobalProxy = async settings => { globalThis.lastProxy = settings.proxy.mode; };
    restartService = async () => { if (++restartCount === 1) throw new Error('simulated restart failure'); };
    registerIpc()`);
  const result = await h.ipcHandlers.get('sc:translation-settings:save')({}, {
    ...h.run('defaultTranslationSettings()'), proxy: { mode: 'direct' },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /已恢复原设置/);
  assert.equal(h.run('readTranslationSettings().proxy.mode'), 'system');
  assert.equal(h.run('lastProxy'), 'system');
  assert.equal(h.run('restartCount'), 2);
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

test('translation request rejects when a response disconnects before its body completes', async t => {
  const h = harness(t);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
    response.write('{"partial":');
    setTimeout(() => response.destroy(), 10);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const target = new URL(`http://127.0.0.1:${server.address().port}/`);
  await assert.rejects(
    Promise.race([
      h.context.postTranslationJson(target, {}, {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('request remained pending')), 1000)),
    ]),
    /翻译服务响应中途断开/,
  );
});

test('canceling one list request aborts it without affecting another sender', async t => {
  const signals = [];
  const h = harness(t, {
    fetch: (_url, options) => new Promise(resolve => {
      signals.push(options.signal);
      options.signal.addEventListener('abort', () => resolve({ ok: false, status: 499, json: async () => ({ message: 'canceled' }) }), { once: true });
    }),
  });
  h.run('validateSender = () => {}; serviceUrl = "http://127.0.0.1:12345"; registerIpc()');
  const request = h.ipcHandlers.get('sc:request');
  const cancel = h.ipcHandlers.get('sc:request-cancel');
  const first = request({ sender: { id: 1 } }, 'strings', { page: 1 }, 'list-1');
  const second = request({ sender: { id: 2 } }, 'strings', { page: 1 }, 'list-1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signals.length, 2);
  assert.equal(cancel({ sender: { id: 1 } }, 'list-1').ok, true);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.equal((await first).status, 499);
  cancel({ sender: { id: 2 } }, 'list-1');
  assert.equal((await second).status, 499);
});
