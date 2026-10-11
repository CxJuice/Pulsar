const { app, BrowserWindow, ipcMain, protocol, session, net, safeStorage, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'sckit', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const devUrl = process.env.SCKIT_DEV_URL;
const appIcon = path.join(app.getAppPath(), app.isPackaged ? '.output/public' : 'public', 'icon.png');
const smoke = process.argv.includes('--smoke');
// Diagnostics use a separate profile and can run while the user's editor stays open.
if (smoke) {
  const smokeFolder = process.env.SCKIT_SMOKE_PATH || path.join(app.getAppPath(), 'artifacts');
  fs.mkdirSync(path.join(smokeFolder, 'profile'), { recursive: true });
  app.setPath('userData', path.join(smokeFolder, 'profile'));
}
const serviceKey = randomBytes(32).toString('hex');
let mainWindow, loginWindow, sidecar, serviceUrl, closing = false;
const actions = new Set(['session', 'projects', 'project', 'updateProject', 'files', 'file', 'renameFile', 'strings', 'string', 'suggestions', 'memory', 'terms', 'projectTerms', 'term', 'createTerm', 'updateTerm', 'deleteTerm', 'history', 'save', 'drafts', 'draft']);
const credentialFile = () => path.join(app.getPath('userData'), 'credentials.bin');
const connectionPreferenceFile = () => path.join(app.getPath('userData'), 'connection.json');
function rememberConnectionMethod(mode) {
  try { fs.writeFileSync(connectionPreferenceFile(), JSON.stringify({ mode })); }
  catch { log('Connection method preference could not be saved'); }
}
const presence = require('./presence.cjs')({
  credentials: presenceCredentials,
  resolveProxy: async () => {
    const resolved = await session.defaultSession.resolveProxy('https://paratranz.cn');
    const proxy = resolved.split(';').map(value => value.trim()).find(value => /^(PROXY|HTTPS|SOCKS5?|SOCKS) /.test(value));
    if (!proxy) return '';
    const [kind, address] = proxy.split(' ');
    return `${kind.startsWith('SOCKS') ? 'socks5h' : kind === 'HTTPS' ? 'https' : 'http'}://${address}`;
  },
  publish: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sc:presence-state', state); },
  log,
});

function log(message) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.appendFileSync(path.join(app.getPath('userData'), 'app.log'), `${new Date().toISOString()} ${message}\n`);
}
function validateSender(event) {
  const url = event.senderFrame?.url || '';
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame || !(url.startsWith('sckit://app/') || (devUrl && new URL(url).origin === new URL(devUrl).origin))) {
    throw new Error('无效的应用请求来源');
  }
}
async function serviceRequest(endpoint, method = 'POST', body) {
  try {
    const response = await fetch(`${serviceUrl}${endpoint}`, {
      method, headers: { 'X-ScKit-Key': serviceKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    const counts = endpoint === '/rpc/strings' && response.ok
      ? ` rows=${data.results?.length || 0} total=${data.rowCount} page=${data.page}` : '';
    const authentication = endpoint === '/credentials' && response.ok
      ? ` authenticated=${Boolean(data.authenticated)} mode=${data.mode}` : '';
    log(`Service ${method} ${endpoint} status=${response.status}${counts}${authentication}`);
    return response.ok ? { ok: true, data } : { ok: false, status: response.status, message: data.message || '服务请求失败' };
  } catch (error) {
    return { ok: false, status: 502, message: '本地翻译服务连接失败，请重新启动应用' };
  }
}
async function startService() {
  const serviceName = process.platform === 'win32' ? 'sctranslate-service.exe' : 'sctranslate-service';
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'service', serviceName)
    : path.join(app.getAppPath(), 'service', 'target', devUrl ? 'debug' : 'release', serviceName);
  if (!fs.existsSync(executable)) throw new Error('找不到 Rust 服务，请先运行 npm run build（开发模式运行 npm run dev）。');
  const env = { ...process.env, SCKIT_SECRET: serviceKey, SCKIT_DATA_DIR: app.getPath('userData') };
  const proxy = await session.defaultSession.resolveProxy('https://paratranz.cn');
  const first = proxy.split(';')[0].trim();
  if (/^PROXY /.test(first)) env.SCKIT_PROXY = `http://${first.slice(6)}`;
  else if (/^SOCKS5? /.test(first)) env.SCKIT_PROXY = `socks5h://${first.replace(/^SOCKS5? /, '')}`;
  sidecar = spawn(executable, [], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Rust 服务启动超时')), 20000);
    sidecar.once('error', error => { clearTimeout(timer); reject(error); });
    sidecar.once('exit', code => { clearTimeout(timer); reject(new Error(`Rust 服务退出（${code}）`)); });
    sidecar.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const line = buffer.split('\n')[0];
      try {
        const ready = JSON.parse(line);
        if (ready.status === 'ready' && Number.isInteger(ready.port)) {
          serviceUrl = `http://127.0.0.1:${ready.port}`;
          clearTimeout(timer); resolve();
        }
      } catch { /* wait for a complete readiness line */ }
    });
    sidecar.stderr.on('data', () => log('Rust service emitted an error; no credentials recorded.'));
  });
  sidecar.on('exit', code => {
    if (!closing) { log(`Rust service unexpectedly exited: ${code}`); dialog.showErrorBox('翻译服务已停止', '请重新启动 ScTranslateKit。已保存的本地草稿会保留。'); }
  });
  log('Rust service ready');
}
async function cookieConnection(project = 0) {
  const cookies = await session.fromPartition('persist:paratranz').cookies.get({ url: 'https://paratranz.cn' });
  const allowed = cookies.filter(cookie => ['sid', 'user', 'permissionsHash', 'locale'].includes(cookie.name));
  if (!allowed.some(cookie => cookie.name === 'sid')) return { ok: false, message: '尚未完成 ParaTranz 登录' };
  return serviceRequest('/credentials', 'POST', { cookie: allowed.map(c => `${c.name}=${c.value}`).join('; '), projectId: project });
}
async function presenceCredentials() {
  const cookies = await session.fromPartition('persist:paratranz').cookies.get({ url: 'https://paratranz.cn' });
  const allowed = cookies.filter(cookie => ['sid', 'user', 'permissionsHash', 'locale'].includes(cookie.name));
  return serviceRequest('/internal/presence', 'POST', { cookie: allowed.some(cookie => cookie.name === 'sid') ? allowed.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') : '' });
}
async function presenceLoginConnection() {
  const result = await presenceCredentials();
  // Authentication headers stay in the main process, including login results.
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}
async function restoreConnection() {
  let preferred;
  try { preferred = JSON.parse(fs.readFileSync(connectionPreferenceFile(), 'utf8')).mode; } catch { /* Keep legacy saved connections. */ }
  if (preferred === 'session') return cookieConnection();
  if (safeStorage.isEncryptionAvailable() && fs.existsSync(credentialFile())) {
    try {
      const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile())));
      return await serviceRequest('/credentials', 'POST', { token: saved.token, projectId: 0 });
    } catch { log('Saved token could not be restored'); }
  }
  return preferred === 'token' ? { ok: false, message: '请重新输入未记住的 API Token' } : cookieConnection();
}
function allowLoginNavigation(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && ['paratranz.cn', 'github.com'].includes(parsed.hostname); }
  catch { return false; }
}
async function login(project, presenceOnly = false) {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.focus(); return { ok: false, message: '请先完成已打开的登录窗口' }; }
  const checkConnection = () => presenceOnly ? presenceLoginConnection() : cookieConnection(project);
  const existing = await checkConnection();
  if (existing.ok) return existing;
  const loginSession = session.fromPartition('persist:paratranz');
  loginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  loginWindow = new BrowserWindow({ width: 1100, height: 820, parent: mainWindow, title: '登录 ParaTranz · 完成后关闭此窗口', autoHideMenuBar: true, icon: appIcon,
    webPreferences: { partition: 'persist:paratranz', nodeIntegration: false, contextIsolation: true, sandbox: true } });
  loginWindow.webContents.on('will-navigate', (event, url) => { if (!allowLoginNavigation(url)) event.preventDefault(); });
  loginWindow.webContents.setWindowOpenHandler(({ url }) => allowLoginNavigation(url)
    ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: appIcon, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:paratranz' } } }
    : { action: 'deny' });
  let checking = false, success;
  const check = async () => {
    if (checking || !loginWindow || loginWindow.isDestroyed()) return;
    checking = true;
    const result = await checkConnection();
    checking = false;
    if (result.ok && loginWindow && !loginWindow.isDestroyed()) { success = result; loginWindow.close(); }
  };
  loginWindow.webContents.on('did-finish-load', check);
  const cookieChanged = (_event, cookie, _cause, removed) => { if (!removed && cookie.name === 'user') check(); };
  loginSession.cookies.on('changed', cookieChanged);
  return new Promise(resolve => {
    loginWindow.once('closed', async () => { loginWindow = undefined; loginSession.cookies.removeListener('changed', cookieChanged); resolve(success || await checkConnection()); });
    loginWindow.loadURL(project ? `https://paratranz.cn/projects/${project}/strings` : 'https://paratranz.cn/login').catch(() => { if (loginWindow) loginWindow.close(); });
  });
}
function registerIpc() {
  ipcMain.handle('sc:presence-login', async (event, project) => {
    validateSender(event);
    if (!Number.isSafeInteger(project) || project <= 0 || project > 2147483647) return { ok: false, message: '项目 ID 无效' };
    presence.stop();
    return login(project, true);
  });
  ipcMain.handle('sc:presence', async (event, target) => {
    validateSender(event);
    if (!target || !Number.isSafeInteger(target.projectId) || target.projectId < 0 || target.projectId > 2147483647 ||
      (target.stringId !== null && (!Number.isSafeInteger(target.stringId) || target.stringId <= 0 || target.stringId > 2147483647))) return { ok: false, message: '占用参数无效' };
    return { ok: true, data: await presence.set(target) };
  });
  ipcMain.handle('sc:request', async (event, action, payload) => {
    validateSender(event);
    if (!actions.has(action) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, message: '无效的服务操作' };
    return serviceRequest(`/rpc/${action}`, 'POST', payload);
  });
  ipcMain.handle('sc:connect', async (event, token, remember, project) => {
    validateSender(event);
    if (typeof token !== 'string' || !token.trim() || token.length > 16384 || /[\r\n]/.test(token) || !Number.isSafeInteger(project) || project < 0 || project > 2147483647) return { ok: false, message: 'Token 或项目 ID 无效' };
    const result = await serviceRequest('/credentials', 'POST', { token: token.trim(), projectId: project });
    if (result.ok) {
      if (remember && safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(credentialFile(), safeStorage.encryptString(JSON.stringify({ token: token.trim(), projectId: project })));
      } else if (fs.existsSync(credentialFile())) fs.unlinkSync(credentialFile());
      rememberConnectionMethod('token');
    }
    return result;
  });
  ipcMain.handle('sc:login', async (event, project) => {
    validateSender(event);
    if (!Number.isSafeInteger(project) || project < 0 || project > 2147483647) return { ok: false, message: '项目 ID 无效' };
    const result = await login(project);
    if (result.ok) rememberConnectionMethod('session');
    return result;
  });
  ipcMain.handle('sc:disconnect', async event => {
    validateSender(event);
    presence.stop();
    if (fs.existsSync(credentialFile())) fs.unlinkSync(credentialFile());
    if (fs.existsSync(connectionPreferenceFile())) fs.unlinkSync(connectionPreferenceFile());
    await session.fromPartition('persist:paratranz').clearStorageData({ storages: ['cookies', 'localstorage'] });
    return serviceRequest('/credentials', 'DELETE');
  });
  ipcMain.handle('sc:external', async (event, url) => {
    validateSender(event);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['paratranz.cn', 'nuxt.com', 'www.electronjs.org'].includes(parsed.hostname)) throw new Error('此链接不受支持');
    await shell.openExternal(parsed.href);
  });
  ipcMain.handle('sc:export', async (event, content, defaultName) => {
    validateSender(event);
    if (typeof content !== 'string' || content.length > 20_000_000 || typeof defaultName !== 'string') throw new Error('导出内容无效');
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: path.basename(defaultName), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, content, 'utf8'); return true;
  });
  ipcMain.on('sc:window', (event, action) => { validateSender(event); if (action === 'minimize') mainWindow.minimize(); else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); else if (action === 'close') mainWindow.close(); });
}
async function registerProtocol() {
  const root = path.join(app.getAppPath(), '.output', 'public');
  protocol.handle('sckit', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
    const pageRoute = pathname.match(/^\/(projects|editor|settings)\/?$/);
    const routePath = pageRoute ? `/${pageRoute[1]}/index.html` : pathname;
    const filename = path.resolve(root, `.${routePath === '/' ? '/index.html' : routePath}`);
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(filename).href);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");
    return new Response(response.body, { status: response.status, headers });
  });
}
async function smokeCapture() {
  const folder = process.env.SCKIT_SMOKE_PATH || path.join(app.getAppPath(), 'artifacts');
  fs.mkdirSync(folder, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await mainWindow.webContents.executeJavaScript('Boolean(document.querySelector(".string-row"))')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const status = await serviceRequest('/health', 'GET');
  const ui = await mainWindow.webContents.executeJavaScript('({title:document.title,rows:document.querySelectorAll(".string-row").length,bridge:!!window.scKit,source:document.querySelector(".source-content")?.innerText})');
  const ipc = await mainWindow.webContents.executeJavaScript(`(async () => {
    const session = await window.scKit.request('session', {});
    const draft = await window.scKit.request('draft', {projectId:1,stringId:1,translation:'diagnostic draft',stage:1,updatedAt:new Date().toISOString()});
    const drafts = await window.scKit.request('drafts', {});
    const removed = await window.scKit.request('draft', {projectId:1,stringId:1,translation:'',stage:0,remove:true});
    return {session,draftStored:draft.ok && drafts.data?.['1/1']?.translation === 'diagnostic draft',draftRemoved:removed.ok};
  })()`);
  const network = process.argv.includes('--network-check')
    ? await serviceRequest('/credentials', 'POST', {token:'sckit-invalid-diagnostic-token',projectId:8340}) : null;
  fs.writeFileSync(path.join(folder, 'electron-smoke.json'), JSON.stringify({ status, ui, ipc, network, packaged: app.isPackaged }, null, 2));
  mainWindow.showInactive();
  await mainWindow.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await mainWindow.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  fs.writeFileSync(path.join(folder, 'electron-preview.png'), image.toPNG());
  log(`Smoke capture: ${ui.rows} rows, bridge=${ui.bridge}`);
  closing = true; sidecar?.kill();
  app.exit(ui.rows === 7 && ui.bridge && status.ok && ipc.session.ok && ipc.draftStored && ipc.draftRemoved && (!network || (!network.ok && network.status === 401)) ? 0 : 1);
}

function revealEditor() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  log(`Editor window revealed: visible=${mainWindow.isVisible()} minimized=${mainWindow.isMinimized()}`);
}

if (!smoke && !app.requestSingleInstanceLock()) {
  log(`Launch handed to existing instance: pid=${process.pid} version=${app.getVersion()}`);
  app.quit();
}
else {
  app.on('second-instance', () => {
    log('Second launch requested; revealing editor');
    revealEditor();
  });
  app.whenReady().then(async () => {
    log(`Starting ${smoke ? 'diagnostic' : 'editor'}: pid=${process.pid} version=${app.getVersion()} packaged=${app.isPackaged}`);
    if (devUrl && new URL(devUrl).hostname !== '127.0.0.1') throw new Error('开发服务器必须位于 127.0.0.1');
    await registerProtocol();
    await startService();
    if (!smoke) await restoreConnection();
    mainWindow = new BrowserWindow({ width: 1600, height: 1000, minWidth: 1100, minHeight: 720, frame: false, backgroundColor: '#ffffff', show: !smoke, icon: appIcon,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: !smoke } });
    mainWindow.setMenu(null);
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, url) => { if (!(url.startsWith('sckit://app/') || (devUrl && new URL(url).origin === new URL(devUrl).origin))) event.preventDefault(); });
    mainWindow.webContents.on('console-message', (_event, _level, message) => { if (/error|failed/i.test(message)) log(`Renderer: ${message.substring(0, 500)}`); });
    registerIpc();
    await mainWindow.loadURL(devUrl || 'sckit://app/');
    if (smoke) await smokeCapture();
    else revealEditor();
    log('Editor window loaded');
  }).catch(error => {
    log(`${smoke ? 'Diagnostic' : 'Startup'} failed: ${error.message}`);
    if (smoke) { closing = true; sidecar?.kill(); process.stderr.write(`Diagnostic failed: ${error.message}\n`); app.exit(1); }
    else { dialog.showErrorBox('ScTranslateKit 启动失败', error.message); app.quit(); }
  });
}
app.on('before-quit', () => { presence.stop(); closing = true; if (sidecar) sidecar.kill(); });
app.on('will-quit', () => { if (sidecar) sidecar.kill(); });
app.on('window-all-closed', () => app.quit());
