const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, net, safeStorage, dialog, shell, screen } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

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
let mainWindow, loginWindow, dictionaryView, translatorView, auxCustomizationWindow, sidecar, serviceUrl, closing = false;
let windowStateTimer, windowWasMaximized = false, dictionaryLookupRequest = 0;
let translatorProxySignature = '', translatorViewRequest = 0, translatorLastFilledText = '';
let auxCustomizationWindowLoaded = false, auxCustomizationState = { visible: false, mode: 'customize', bounds: null, items: [], theme: {}, draggedPanel: null, groupId: null };
const actions = new Set(['session', 'projects', 'project', 'updateProject', 'files', 'file', 'renameFile', 'strings', 'string', 'suggestions', 'memory', 'terms', 'projectTerms', 'term', 'createTerm', 'updateTerm', 'deleteTerm', 'history', 'save', 'drafts', 'draft']);
const credentialFile = () => path.join(app.getPath('userData'), 'credentials.bin');
const connectionPreferenceFile = () => path.join(app.getPath('userData'), 'connection.json');
const translationSettingsFile = () => path.join(app.getPath('userData'), 'translation-settings.bin');
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function defaultTranslationSettings() {
  return { provider: 'google', mode: 'web', deeplPlan: 'free', proxy: { mode: 'system', host: '127.0.0.1', port: 7890 }, googleApiKey: '', deeplApiKey: '' };
}
function readTranslationSettings() {
  if (!safeStorage.isEncryptionAvailable()) return defaultTranslationSettings();
  try {
    const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(translationSettingsFile())));
    const defaults = defaultTranslationSettings();
    return {
      ...defaults,
      provider: stored.provider === 'deepl' ? 'deepl' : 'google',
      mode: stored.mode === 'api' ? 'api' : 'web',
      deeplPlan: stored.deeplPlan === 'pro' ? 'pro' : 'free',
      proxy: { ...defaults.proxy, ...(stored.proxy || {}) },
      googleApiKey: typeof stored.googleApiKey === 'string' ? stored.googleApiKey : '',
      deeplApiKey: typeof stored.deeplApiKey === 'string' ? stored.deeplApiKey : '',
    };
  } catch { return defaultTranslationSettings(); }
}
function publicTranslationSettings(settings = readTranslationSettings()) {
  return {
    provider: settings.provider, mode: settings.mode, deeplPlan: settings.deeplPlan,
    proxy: settings.proxy, googleConfigured: Boolean(settings.googleApiKey), deeplConfigured: Boolean(settings.deeplApiKey),
  };
}
function validateProxyHost(value) {
  const host = typeof value === 'string' ? value.trim() : '';
  if (!host || host.length > 255 || (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) && !/^\[[0-9a-f:.]+\]$/i.test(host))) return '';
  try {
    const candidate = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    const parsed = new URL(`http://${candidate}`);
    return parsed.hostname && !parsed.port && !parsed.username && !parsed.password && parsed.pathname === '/' ? host : '';
  } catch { return ''; }
}
function persistTranslationSettings(settings) {
  const target = translationSettingsFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, safeStorage.encryptString(JSON.stringify(settings)));
  fs.renameSync(`${target}.tmp`, target);
}
function saveTranslationSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('翻译设置无效');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统没有可用的安全存储，无法保存翻译 API 密钥');
  const previous = readTranslationSettings();
  const provider = input.provider;
  const mode = input.mode === undefined ? previous.mode : input.mode;
  const deeplPlan = input.deeplPlan;
  if (!['google', 'deepl'].includes(provider) || !['web', 'api'].includes(mode) || !['free', 'pro'].includes(deeplPlan)) throw new Error('翻译服务选择无效');
  const proxy = input.proxy;
  if (!proxy || typeof proxy !== 'object' || !['system', 'direct', 'http', 'socks5'].includes(proxy.mode)) throw new Error('代理模式无效');
  const host = validateProxyHost(proxy.host);
  const port = Number(proxy.port);
  if (['http', 'socks5'].includes(proxy.mode) && (!host || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('请输入有效的代理主机和端口');
  const settings = {
    provider, mode, deeplPlan,
    proxy: { mode: proxy.mode, host: host || '127.0.0.1', port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 7890 },
    googleApiKey: previous.googleApiKey,
    deeplApiKey: previous.deeplApiKey,
  };
  for (const [field, clearField] of [['googleApiKey', 'clearGoogleApiKey'], ['deeplApiKey', 'clearDeepLApiKey']]) {
    if (input[clearField] === true) settings[field] = '';
    else if (input[field] !== undefined && input[field] !== null) {
      if (typeof input[field] !== 'string' || input[field].length > 4096 || /[\r\n]/.test(input[field])) throw new Error('API 密钥格式无效');
      if (input[field].trim()) settings[field] = input[field].trim();
    }
  }
  persistTranslationSettings(settings);
  return publicTranslationSettings(settings);
}
function saveTranslationSelection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('翻译方式设置无效');
  if (input.mode !== undefined && !['web', 'api'].includes(input.mode)) throw new Error('翻译方式无效');
  if (input.provider !== undefined && !['google', 'deepl'].includes(input.provider)) throw new Error('翻译网站无效');
  if (input.mode === undefined && input.provider === undefined) throw new Error('没有可保存的翻译选择');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统没有可用的安全存储，无法保存翻译设置');
  const settings = readTranslationSettings();
  if (input.mode !== undefined) settings.mode = input.mode;
  if (input.provider !== undefined) settings.provider = input.provider;
  persistTranslationSettings(settings);
  return publicTranslationSettings(settings);
}
function translationProxyAgent(proxyUrl) {
  return /^socks/i.test(proxyUrl) ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
}
async function resolveTranslationAgent(targetUrl, proxy) {
  if (proxy.mode === 'direct') return undefined;
  const proxyHost = proxy.host.includes(':') && !proxy.host.startsWith('[') ? `[${proxy.host}]` : proxy.host;
  if (proxy.mode === 'http') return translationProxyAgent(`http://${proxyHost}:${proxy.port}`);
  if (proxy.mode === 'socks5') return translationProxyAgent(`socks5h://${proxyHost}:${proxy.port}`);
  const directives = (await session.defaultSession.resolveProxy(targetUrl)).split(';').map(value => value.trim()).filter(Boolean);
  const directive = directives.find(value => /^(PROXY|HTTPS|SOCKS4|SOCKS5?|SOCKS)\s/i.test(value));
  if (!directive) return undefined;
  const match = directive.match(/^(PROXY|HTTPS|SOCKS4|SOCKS5?|SOCKS)\s+([^\s]+)$/i);
  if (!match) throw new Error('系统代理配置无法用于翻译请求');
  const scheme = /^SOCKS/i.test(match[1]) ? (match[1].toLowerCase() === 'socks4' ? 'socks4a' : 'socks5h') : match[1].toLowerCase() === 'https' ? 'https' : 'http';
  return translationProxyAgent(`${scheme}://${match[2]}`);
}
function postTranslationJson(target, headers, payload, agent) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method: 'POST', agent, timeout: 30000,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        responseBody += chunk;
        if (responseBody.length > 2_000_000) request.destroy(new Error('翻译服务响应过大'));
      });
      response.on('end', () => {
        let data;
        try { data = JSON.parse(responseBody); } catch { data = null; }
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
          const message = data?.error?.message || data?.message;
          reject(new Error(typeof message === 'string' && message.length < 500 ? message : `翻译服务返回 HTTP ${response.statusCode || 500}`));
        } else if (!data) reject(new Error('翻译服务返回了无效响应'));
        else resolve(data);
      });
    });
    request.on('timeout', () => request.destroy(new Error('翻译请求超时')));
    request.on('error', reject);
    request.end(body);
  });
}
async function translateToChinese(text) {
  if (typeof text !== 'string') throw new Error('翻译文本无效');
  const source = text;
  if (!source.trim()) throw new Error('没有可翻译的文本');
  if ([...source].length > 30000 || Buffer.byteLength(source, 'utf8') > 120000) throw new Error('单次翻译最多支持 30,000 个字符');
  const settings = readTranslationSettings();
  const key = settings.provider === 'google' ? settings.googleApiKey : settings.deeplApiKey;
  if (!key) throw new Error(`请先在「设置 → 翻译服务」配置${settings.provider === 'google' ? 'Google Cloud Translation' : 'DeepL API'} 密钥`);
  let target, headers, payload;
  if (settings.provider === 'google') {
    target = new URL('https://translation.googleapis.com/language/translate/v2');
    headers = { 'X-Goog-Api-Key': key };
    payload = { q: [source], source: 'en', target: 'zh-CN', format: 'text' };
  } else {
    target = new URL(`${settings.deeplPlan === 'free' ? 'https://api-free.deepl.com' : 'https://api.deepl.com'}/v2/translate`);
    headers = { Authorization: `DeepL-Auth-Key ${key}` };
    payload = { text: [source], source_lang: 'EN', target_lang: 'ZH-HANS' };
  }
  const agent = await resolveTranslationAgent(target.href, settings.proxy);
  const data = await postTranslationJson(target, headers, payload, agent);
  const translated = settings.provider === 'google' ? data.data?.translations?.[0]?.translatedText : data.translations?.[0]?.text;
  if (typeof translated !== 'string' || !translated.trim()) throw new Error('翻译服务没有返回译文');
  return { text: translated, provider: settings.provider };
}
function restoredWindowState() {
  let stored;
  if (!smoke) {
    try { stored = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')); }
    catch { /* Use the initial layout when no usable preference exists. */ }
  }
  const saved = stored?.bounds;
  const valid = saved && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(saved[key])) && saved.width > 0 && saved.height > 0;
  const area = (valid ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay()).workArea;
  const minWidth = Math.min(1100, area.width), minHeight = Math.min(720, area.height);
  const width = Math.max(minWidth, Math.min(valid ? saved.width : 1600, area.width));
  const height = Math.max(minHeight, Math.min(valid ? saved.height : 1000, area.height));
  const x = valid ? Math.max(area.x, Math.min(saved.x, area.x + area.width - width)) : area.x + Math.round((area.width - width) / 2);
  const y = valid ? Math.max(area.y, Math.min(saved.y, area.y + area.height - height)) : area.y + Math.round((area.height - height) / 2);
  return { bounds: { x, y, width, height }, minWidth, minHeight, maximized: valid && stored.maximized === true };
}
function rememberWindowState() {
  clearTimeout(windowStateTimer);
  if (smoke || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const state = { bounds: mainWindow.getNormalBounds(), maximized: windowWasMaximized };
    const target = windowStateFile();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(state));
    fs.renameSync(`${target}.tmp`, target);
  } catch { log('Window layout preference could not be saved'); }
}
function scheduleWindowState() {
  clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(rememberWindowState, 300);
}
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
function isTrustedAppUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'sckit:' && url.hostname === 'app') || Boolean(devUrl && url.origin === new URL(devUrl).origin);
  } catch { return false; }
}
function canReadLocalFonts(webContents, url, isMainFrame) {
  return webContents === mainWindow?.webContents && isMainFrame !== false && isTrustedAppUrl(url);
}
function cambridgePageUrl(query) {
  if (typeof query !== 'string') throw new Error('剑桥词典查询词无效');
  const input = query.replace(/\s+/g, ' ').trim();
  if (!input || input.length > 100 || !/^[\p{Script=Latin}\p{M}\p{N}'’.,!?;:()\- ]+$/u.test(input) || !/\p{Script=Latin}/u.test(input)) {
    throw new Error('请输入英文单词或短语');
  }
  const word = input.replace(/^[^\p{Script=Latin}\p{N}]+|[^\p{Script=Latin}\p{N}]+$/gu, '');
  return `https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(word)}`;
}
function readCambridgePage() {
  const readText = (element, limit = 600) => String(element?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  const entries = Array.from(document.querySelectorAll('.entry-body__el')).slice(0, 8).map(entry => {
    const header = entry.querySelector('.pos-header');
    const senses = Array.from(entry.querySelectorAll('.dsense')).slice(0, 16).map(sense => {
      const definitions = Array.from(sense.querySelectorAll('.ddef_block')).slice(0, 16).map(block => {
        const body = block.querySelector('.def-body');
        const translatedDefinition = body && Array.from(body.children).find(child => child.classList.contains('trans'));
        const examples = Array.from(body?.querySelectorAll('.examp') || []).slice(0, 4).map(example => ({
          english: readText(example.querySelector('.eg')),
          chinese: readText(example.querySelector('.trans')),
        })).filter(example => example.english || example.chinese);
        return {
          level: readText(block.querySelector('.ddef-info .epp-xref'), 24),
          definition: readText(block.querySelector('.ddef_d')),
          translation: readText(translatedDefinition),
          examples,
        };
      }).filter(definition => definition.definition || definition.translation);
      return {
        guideWord: readText(sense.querySelector('.dsense_gw'), 100).replace(/^\(|\)$/g, ''),
        partOfSpeech: readText(sense.querySelector('.dsense_pos'), 50),
        grammar: readText(sense.querySelector('.dsense_h .dgram'), 50),
        definitions,
      };
    }).filter(sense => sense.definitions.length);
    return {
      headword: readText(header?.querySelector('.hw'), 100),
      partOfSpeech: readText(header?.querySelector('.posgram .pos'), 50),
      grammar: readText(header?.querySelector('.posgram .gram'), 50),
      senses,
    };
  }).filter(entry => entry.headword && entry.senses.length);
  return {
    word: entries[0]?.headword || readText(document.querySelector('h1'), 100),
    url: location.href,
    ukPronunciation: readText(document.querySelector('.pos-header .uk .ipa'), 100),
    usPronunciation: readText(document.querySelector('.pos-header .us .ipa'), 100),
    entries,
  };
}
function cambridgeViewBounds(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) return null;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const left = Math.max(0, value.x), top = Math.max(0, value.y);
  const right = Math.min(contentWidth, value.x + value.width), bottom = Math.min(contentHeight, value.y + value.height);
  const bounds = {
    x: Math.ceil(left), y: Math.ceil(top),
    width: Math.floor(right) - Math.ceil(left), height: Math.floor(bottom) - Math.ceil(top),
  };
  if (bounds.width < 120 || bounds.height < 120) return null;
  return bounds;
}
const auxCustomizationTabs = new Map([
  ['suggestions', '建议'], ['history', '历史'], ['terms', '术语'], ['quality', 'QA'], ['comments', '评论'], ['dictionary', '翻译'],
]);
const auxCustomizationZones = new Set(['center', 'left', 'right', 'top', 'bottom']);
const auxCustomizationThemeKeys = ['bg', 'text', 'border', 'accent', 'accent-soft', 'muted', 'secondary', 'shadow', 'font-family', 'font-size'];
function updateAuxCustomizationWindowBounds() {
  if (!auxCustomizationWindow || auxCustomizationWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed() || !auxCustomizationState.visible || !auxCustomizationState.bounds) return;
  const content = mainWindow.getContentBounds();
  const bounds = auxCustomizationState.bounds;
  auxCustomizationWindow.setBounds({ x: content.x + bounds.x, y: content.y + bounds.y, width: bounds.width, height: bounds.height });
}
function broadcastAuxCustomizationState() {
  if (!auxCustomizationWindow || auxCustomizationWindow.isDestroyed() || !auxCustomizationWindowLoaded) return;
  auxCustomizationWindow.webContents.send('sc:aux-customization-state', {
    mode: auxCustomizationState.mode,
    items: auxCustomizationState.items,
    theme: auxCustomizationState.theme,
    draggedPanel: auxCustomizationState.draggedPanel,
    groupId: auxCustomizationState.groupId,
  });
}
function createAuxCustomizationWindow() {
  if (auxCustomizationWindow && !auxCustomizationWindow.isDestroyed()) return auxCustomizationWindow;
  const view = new BrowserWindow({
    x: 0, y: 0, width: 300, height: 300, parent: mainWindow, frame: false, transparent: true, backgroundColor: '#00000000',
    show: false, resizable: false, movable: false, minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'aux-customize-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const pageUrl = pathToFileURL(path.join(__dirname, 'aux-customize-overlay.html')).href;
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event, url) => { if (url !== pageUrl) event.preventDefault(); });
  view.on('close', event => {
    if (auxCustomizationState.visible && mainWindow && !mainWindow.isDestroyed()) {
      event.preventDefault();
      mainWindow.webContents.send('sc:aux-customization-action', { type: 'close' });
    }
  });
  view.webContents.on('did-finish-load', () => {
    if (view !== auxCustomizationWindow) return;
    auxCustomizationWindowLoaded = true;
    broadcastAuxCustomizationState();
    if (auxCustomizationState.visible && mainWindow && !mainWindow.isDestroyed()) {
      updateAuxCustomizationWindowBounds();
      if (auxCustomizationState.mode === 'dock') view.showInactive();
      else view.show();
    }
  });
  view.on('closed', () => {
    if (view !== auxCustomizationWindow) return;
    auxCustomizationWindow = undefined;
    auxCustomizationWindowLoaded = false;
  });
  auxCustomizationWindow = view;
  view.loadFile(path.join(__dirname, 'aux-customize-overlay.html')).catch(error => log(`Sidebar overlay could not be loaded: ${error.message}`));
  return view;
}
function setAuxCustomizationOverlay(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return;
  if (state.visible !== true) {
    auxCustomizationState = { visible: false, mode: 'customize', bounds: null, items: [], theme: {}, draggedPanel: null, groupId: null };
    auxCustomizationWindow?.hide();
    return;
  }
  const bounds = cambridgeViewBounds(state.bounds);
  if (!bounds || !Array.isArray(state.items)) {
    auxCustomizationState = { visible: false, mode: 'customize', bounds: null, items: [], theme: {}, draggedPanel: null, groupId: null };
    auxCustomizationWindow?.hide();
    return;
  }
  const mode = state.mode === 'dock' ? 'dock' : 'customize';
  const draggedPanel = mode === 'dock' && auxCustomizationTabs.has(state.draggedPanel) ? state.draggedPanel : null;
  const groupId = mode === 'dock' && typeof state.groupId === 'string' && state.groupId.length <= 128 ? state.groupId : null;
  if (mode === 'dock' && (!draggedPanel || !groupId)) {
    auxCustomizationState = { visible: false, mode: 'customize', bounds: null, items: [], theme: {}, draggedPanel: null, groupId: null };
    auxCustomizationWindow?.hide();
    return;
  }
  const items = mode === 'customize' ? state.items.slice(0, auxCustomizationTabs.size).flatMap(item => {
    if (!item || typeof item !== 'object' || !auxCustomizationTabs.has(item.id)) return [];
    return [{ id: item.id, label: auxCustomizationTabs.get(item.id), checked: item.checked === true, disabled: item.disabled === true, first: item.first === true, last: item.last === true }];
  }) : [];
  const theme = {};
  for (const key of auxCustomizationThemeKeys) {
    const value = state.theme?.[key];
    if (typeof value === 'string' && value.length <= 200) theme[key] = value;
  }
  auxCustomizationState = { visible: true, mode, bounds, items, theme, draggedPanel, groupId };
  const view = createAuxCustomizationWindow();
  updateAuxCustomizationWindowBounds();
  broadcastAuxCustomizationState();
  if (auxCustomizationWindowLoaded && !view.isVisible()) {
    if (mode === 'dock') view.showInactive();
    else view.show();
  }
}
function handleAuxCustomizationAction(event, action) {
  if (!auxCustomizationWindow || event.sender !== auxCustomizationWindow.webContents || !mainWindow || mainWindow.isDestroyed()) return;
  if (!action || typeof action !== 'object' || Array.isArray(action)) return;
  if (action.type === 'close') mainWindow.webContents.send('sc:aux-customization-action', { type: 'close' });
  else if (action.type === 'toggle' && auxCustomizationTabs.has(action.id)) mainWindow.webContents.send('sc:aux-customization-action', { type: 'toggle', id: action.id });
  else if (action.type === 'move' && auxCustomizationTabs.has(action.id) && [-1, 1].includes(action.direction)) mainWindow.webContents.send('sc:aux-customization-action', { type: 'move', id: action.id, direction: action.direction });
  else if (action.type === 'reorder' && auxCustomizationTabs.has(action.id) && auxCustomizationTabs.has(action.targetId)) mainWindow.webContents.send('sc:aux-customization-action', { type: 'reorder', id: action.id, targetId: action.targetId });
  else if (action.type === 'dock' && auxCustomizationTabs.has(action.panel) && typeof action.groupId === 'string' && action.groupId.length <= 128 && auxCustomizationZones.has(action.zone)) {
    mainWindow.webContents.send('sc:aux-customization-action', { type: 'dock', panel: action.panel, groupId: action.groupId, zone: action.zone });
  }
}
function createCambridgeView() {
  if (dictionaryView && !dictionaryView.webContents.isDestroyed()) return dictionaryView;
  const view = new WebContentsView({ webPreferences: { partition: 'persist:cambridge', nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const isCambridgePage = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'dictionary.cambridge.org'; }
    catch { return false; }
  };
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event, url) => { if (!isCambridgePage(url)) event.preventDefault(); });
  view.webContents.on('will-redirect', (event, url) => { if (!isCambridgePage(url)) event.preventDefault(); });
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  dictionaryView = view;
  return view;
}
function translationPageUrl(provider, text = '') {
  if (!['google', 'deepl'].includes(provider) || typeof text !== 'string') throw new Error('翻译网页参数无效');
  const source = text;
  if ([...source].length > 30000 || Buffer.byteLength(source, 'utf8') > 120000) throw new Error('单次翻译最多支持 30,000 个字符');
  if (provider === 'deepl') {
    return 'https://www.deepl.com/en/translator#en/zh';
  }
  const target = new URL('https://translate.google.com/');
  target.searchParams.set('sl', 'en');
  target.searchParams.set('tl', 'zh-CN');
  target.searchParams.set('op', 'translate');
  if (source) target.searchParams.set('text', source);
  return target.href;
}
function isSameTranslationPage(provider, currentUrl, targetUrl) {
  try {
    const current = new URL(currentUrl), target = new URL(targetUrl);
    if (provider === 'deepl') return current.origin === target.origin && current.pathname === target.pathname;
    return current.href === target.href;
  } catch { return false; }
}
async function fillDeepLSource(view, text, request) {
  const editorSelector = 'd-textarea[data-testid="translator-source-input"] [contenteditable="true"], d-textarea[name="source"] [contenteditable="true"]';
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (request !== translatorViewRequest || view.webContents.isDestroyed()) return false;
    try {
      ready = await view.webContents.executeJavaScript(`(() => { const editor = document.querySelector(${JSON.stringify(editorSelector)}); return Boolean(editor && editor.getAttribute('aria-disabled') !== 'true' && editor.isContentEditable); })()`);
    } catch { ready = false; }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready || request !== translatorViewRequest || view.webContents.isDestroyed()) return false;
  const contents = view.webContents;
  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  try {
    await contents.executeJavaScript(`document.querySelector(${JSON.stringify(editorSelector)})?.focus()`);
    if (request !== translatorViewRequest || contents.isDestroyed()) return false;
    contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [modifier] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [modifier] });
    if (request !== translatorViewRequest || contents.isDestroyed()) return false;
    const normalizedText = text.replace(/\r\n?/g, '\n');
    const lines = normalizedText.split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (request !== translatorViewRequest || contents.isDestroyed()) return false;
      if (lines[index]) await contents.insertText(lines[index]);
      if (request !== translatorViewRequest || contents.isDestroyed()) return false;
      if (index < lines.length - 1) {
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      }
    }
    if (request !== translatorViewRequest || contents.isDestroyed()) return false;
    const inserted = await contents.executeJavaScript(`(() => { const editor = document.querySelector(${JSON.stringify(editorSelector)}); return editor ? editor.innerText.replace(/\\u00a0/g, ' ') : ''; })()`);
    if (inserted.replace(/\r\n?/g, '\n').trim() === normalizedText.trim()) return true;
  } catch (error) {
    log(`DeepL source text could not be inserted: ${error.message}`);
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.focus();
  }
  return false;
}
function isTranslationSite(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['translate.google.com', 'deepl.com', 'www.deepl.com'].includes(url.hostname);
  } catch { return false; }
}
function createTranslatorView() {
  if (translatorView && !translatorView.webContents.isDestroyed()) return translatorView;
  const view = new WebContentsView({ webPreferences: { partition: 'persist:translation-web', nodeIntegration: false, contextIsolation: true, sandbox: true } });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event, url) => { if (!isTranslationSite(url)) event.preventDefault(); });
  view.webContents.on('will-redirect', (event, url) => { if (!isTranslationSite(url)) event.preventDefault(); });
  view.webContents.on('did-finish-load', () => {
    try { log(`Embedded translator page loaded: ${new URL(view.webContents.getURL()).hostname}`); }
    catch { log('Embedded translator page loaded'); }
  });
  view.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) log(`Embedded translator page failed to load: ${code}`); });
  mainWindow.contentView.addChildView(view);
  translatorView = view;
  return view;
}
async function prepareTranslatorSession() {
  const translatorSession = session.fromPartition('persist:translation-web');
  const settings = readTranslationSettings();
  let proxyConfig;
  if (settings.proxy.mode === 'system') proxyConfig = { mode: 'system' };
  else if (settings.proxy.mode === 'direct') proxyConfig = { mode: 'direct' };
  else {
    const host = settings.proxy.host.includes(':') && !settings.proxy.host.startsWith('[') ? `[${settings.proxy.host}]` : settings.proxy.host;
    const proxyScheme = settings.proxy.mode === 'socks5' ? 'socks5' : 'http';
    proxyConfig = { mode: 'fixed_servers', proxyRules: `${proxyScheme}://${host}:${settings.proxy.port}` };
  }
  const signature = JSON.stringify(proxyConfig);
  if (signature !== translatorProxySignature) {
    await translatorSession.setProxy(proxyConfig);
    await translatorSession.closeAllConnections();
    translatorProxySignature = signature;
  }
  translatorSession.setPermissionCheckHandler(() => false);
  translatorSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  return translatorSession;
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
  ipcMain.handle('sc:cambridge-lookup', async (event, query) => {
    validateSender(event);
    let target;
    try { target = cambridgePageUrl(query); }
    catch (error) { return { ok: false, message: error.message }; }
    const request = ++dictionaryLookupRequest;
    const view = createCambridgeView();
    translatorViewRequest++;
    translatorView?.setVisible(false);
    view.setVisible(false);
    try {
      if (view.webContents.getURL() !== target || view.webContents.isLoadingMainFrame()) await view.webContents.loadURL(target);
      if (request !== dictionaryLookupRequest) return { ok: false, message: '词典查询已更新' };
      const data = await view.webContents.executeJavaScript(`(${readCambridgePage.toString()})()`);
      if (request !== dictionaryLookupRequest) return { ok: false, message: '词典查询已更新' };
      return { ok: true, data };
    } catch (error) {
      if (request !== dictionaryLookupRequest) return { ok: false, message: '词典查询已更新' };
      log(`Cambridge Dictionary lookup failed: ${error.message}`);
      return { ok: false, message: '无法读取剑桥词典页面，请检查网络连接后重试' };
    }
  });
  ipcMain.handle('sc:cambridge-open-original', async (event, query) => {
    validateSender(event);
    await shell.openExternal(cambridgePageUrl(query));
  });
  ipcMain.on('sc:aux-customization-overlay', (event, state) => {
    try { validateSender(event); } catch { return; }
    setAuxCustomizationOverlay(state);
  });
  ipcMain.on('sc:aux-customization-action', handleAuxCustomizationAction);
  ipcMain.on('sc:translator-view', (event, state) => {
    try { validateSender(event); } catch { log('Rejected an invalid translation web view request'); return; }
    if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.visible !== 'boolean') return;
    if (!state.visible) { translatorViewRequest++; translatorView?.setVisible(false); return; }
    const bounds = cambridgeViewBounds(state.bounds);
    if (!bounds) { translatorViewRequest++; translatorView?.setVisible(false); return; }
    let target;
    try { target = translationPageUrl(state.provider, state.text); }
    catch (error) { log(`Rejected an invalid translation web view request: ${error.message}`); translatorView?.setVisible(false); return; }
    const request = ++translatorViewRequest;
    const view = createTranslatorView();
    dictionaryView?.setVisible(false);
    view.setBounds(bounds);
    view.setVisible(true);
    prepareTranslatorSession().then(async () => {
      if (request !== translatorViewRequest || view.webContents.isDestroyed()) return;
      const samePage = isSameTranslationPage(state.provider, view.webContents.getURL(), target);
      if (!samePage) {
        await view.webContents.loadURL(target);
        if (request !== translatorViewRequest || view.webContents.isDestroyed()) return;
        translatorLastFilledText = '';
      }
      if (state.provider === 'deepl' && typeof state.text === 'string' && state.text.trim() && (state.forceText === true || translatorLastFilledText !== state.text)) {
        const inserted = await fillDeepLSource(view, state.text, request);
        if (request !== translatorViewRequest || view.webContents.isDestroyed()) return;
        if (inserted) translatorLastFilledText = state.text;
        else log('DeepL translator input was unavailable; source text was not inserted');
      }
    }).catch(error => log(`Embedded translator could not be prepared: ${error.message}`));
  });
  ipcMain.handle('sc:translation-settings:get', event => {
    validateSender(event);
    return { ok: true, data: publicTranslationSettings() };
  });
  ipcMain.handle('sc:translation-settings:save', (event, settings) => {
    validateSender(event);
    try { return { ok: true, data: saveTranslationSettings(settings) }; }
    catch (error) { return { ok: false, message: error.message }; }
  });
  ipcMain.handle('sc:translation-selection:save', (event, selection) => {
    validateSender(event);
    try { return { ok: true, data: saveTranslationSelection(selection) }; }
    catch (error) { return { ok: false, message: error.message }; }
  });
  ipcMain.handle('sc:translate-to-chinese', async (event, text) => {
    validateSender(event);
    try { return { ok: true, data: await translateToChinese(text) }; }
    catch (error) { return { ok: false, message: error.message }; }
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
    const restored = restoredWindowState();
    windowWasMaximized = restored.maximized;
    mainWindow = new BrowserWindow({ ...restored.bounds, minWidth: restored.minWidth, minHeight: restored.minHeight, frame: false, backgroundColor: '#ffffff', show: false, icon: appIcon,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: !smoke } });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
      permission === 'local-fonts' && canReadLocalFonts(webContents, requestingOrigin, details?.isMainFrame));
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
      callback(permission === 'local-fonts' && canReadLocalFonts(webContents, details?.requestingUrl || webContents.getURL(), details?.isMainFrame)));
    mainWindow.on('resize', () => { scheduleWindowState(); updateAuxCustomizationWindowBounds(); });
    mainWindow.on('move', () => { scheduleWindowState(); updateAuxCustomizationWindowBounds(); });
    mainWindow.on('maximize', () => { windowWasMaximized = true; scheduleWindowState(); });
    mainWindow.on('unmaximize', () => { windowWasMaximized = false; scheduleWindowState(); });
    mainWindow.on('close', rememberWindowState);
    mainWindow.on('closed', () => {
      if (auxCustomizationWindow && !auxCustomizationWindow.isDestroyed()) auxCustomizationWindow.destroy();
      auxCustomizationWindow = undefined;
      auxCustomizationWindowLoaded = false;
      if (dictionaryView && !dictionaryView.webContents.isDestroyed()) dictionaryView.webContents.destroy();
      dictionaryView = undefined;
    });
    mainWindow.setMenu(null);
    if (!smoke) createAuxCustomizationWindow();
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, url) => { if (!(url.startsWith('sckit://app/') || (devUrl && new URL(url).origin === new URL(devUrl).origin))) event.preventDefault(); });
    mainWindow.webContents.on('console-message', (_event, _level, message) => { if (/error|failed/i.test(message)) log(`Renderer: ${message.substring(0, 500)}`); });
    registerIpc();
    await mainWindow.loadURL(devUrl || 'sckit://app/');
    if (smoke) await smokeCapture();
    else { if (restored.maximized) mainWindow.maximize(); revealEditor(); }
    log('Editor window loaded');
  }).catch(error => {
    log(`${smoke ? 'Diagnostic' : 'Startup'} failed: ${error.message}`);
    if (smoke) { closing = true; sidecar?.kill(); process.stderr.write(`Diagnostic failed: ${error.message}\n`); app.exit(1); }
    else { dialog.showErrorBox('ScTranslateKit 启动失败', error.message); app.quit(); }
  });
}
app.on('before-quit', () => { rememberWindowState(); presence.stop(); closing = true; if (sidecar) sidecar.kill(); if (dictionaryView && !dictionaryView.webContents.isDestroyed()) dictionaryView.webContents.destroy(); });
app.on('will-quit', () => { if (sidecar) sidecar.kill(); });
app.on('window-all-closed', () => app.quit());
