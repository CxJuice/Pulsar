const { io } = require('socket.io-client');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ParaTranz's /editing namespace, using the official Socket.IO client.
module.exports = function createPresence({ credentials, resolveProxy, publish, log }) {
  let socket, generation = 0, heartbeat, desired = { projectId: 0, stringId: null };
  let state = { projectId: 0, status: 'idle', editors: [], userId: null, sessionId: null, message: '' };
  let pending = false, claiming = false;
  const update = patch => { state = { ...state, ...patch }; publish(state); };
  function stop() {
    ++generation; pending = false; claiming = false; clearInterval(heartbeat);
    if (socket) { socket.emit('leave'); socket.disconnect(); socket.removeAllListeners(); socket = undefined; }
    update({ projectId: 0, status: 'idle', editors: [], userId: null, sessionId: null, message: '' });
  }
  function editors(value) {
    if (!Array.isArray(value)) return;
    update({ editors: value.filter(e => e && Number.isSafeInteger(e.id) && Number.isSafeInteger(e.editing)
      && typeof e.username === 'string' && typeof e.editorSessionId === 'string').slice(0, 5000)
      .map(e => ({ id: e.id, username: e.username, editing: e.editing, editStartedAt: e.editStartedAt,
        editorSessionId: e.editorSessionId })) });
    log(`Presence snapshot: project=${state.projectId} editors=${state.editors.length} currentOccupied=${state.editors.some(e => e.editing === desired.stringId && e.id !== state.userId)}`);
  }
  function claim() {
    if (!socket?.connected || claiming) return;
    const target = desired.stringId;
    const other = state.editors.find(e => e.editing === target && e.id !== state.userId);
    if (!target || other) { socket.emit('leave'); return; }
    const connection = socket, revision = generation;
    claiming = true;
    socket.timeout(10000).emit('edit', target, (error, list) => {
      if (revision !== generation || connection !== socket) return;
      claiming = false;
      if (target !== desired.stringId) { claim(); return; }
      if (error) { update({ status: 'reconnecting', editors: [], message: '占用确认超时，正在重新连接…' }); connection.disconnect().connect(); }
      else { editors(list); update({ status: 'connected', message: '' }); }
    });
  }
  async function set(target) {
    desired = target;
    if (!target.projectId) { stop(); return state; }
    if (state.projectId === target.projectId && (socket || pending)) { claim(); return state; }
    stop(); desired = target; pending = true;
    const revision = generation;
    update({ projectId: target.projectId, status: 'connecting', message: '正在同步词条占用…' });
    try {
      const auth = await credentials();
      const proxy = await resolveProxy();
      if (revision !== generation) return state;
      if (!auth.ok) { update({ status: 'unavailable', editors: [], message: auth.message || '占用同步需要网页登录' }); return state; }
      const agent = /^socks/i.test(proxy) ? new SocksProxyAgent(proxy) : proxy ? new HttpsProxyAgent(proxy) : undefined;
      update({ userId: auth.data.userId });
      socket = io('https://paratranz.cn/editing', { forceNew: true, transports: ['websocket'],
        auth: { project: target.projectId }, query: { uid: auth.data.userId }, extraHeaders: auth.data.headers,
        agent, timeout: 20000, reconnectionDelay: 1000, reconnectionDelayMax: 10000 });
      const current = socket;
      current.on('connect', () => {
        if (current !== socket) return;
        update({ status: 'connected', editors: [], sessionId: current.id, message: '' });
        log(`Presence connected: project=${target.projectId}`);
      });
      current.on('editors', value => {
        if (current !== socket) return;
        editors(value);
        if (desired.stringId && !state.editors.some(e => e.editing === desired.stringId && (e.id !== state.userId || e.editorSessionId === current.id))) claim();
      });
      current.on('disconnect', () => { if (current === socket) { claiming = false; update({ status: 'reconnecting', editors: [], sessionId: null, message: '占用连接已断开，正在重新连接…' }); } });
      current.on('connect_error', error => {
        if (current !== socket) return;
        const denied = error?.data === 'notLogin' || !current.active;
        update({ status: denied ? 'unavailable' : 'reconnecting', editors: [], sessionId: null,
          message: denied ? '网页登录会话已过期，请登录以同步占用' : '占用连接暂不可用，正在重试…' });
        log(`Presence connection unavailable: project=${target.projectId} authentication=${denied}`);
      });
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (socket?.connected && desired.stringId && state.editors.some(e => e.editing === desired.stringId && e.editorSessionId === socket.id)) socket.emit('heartbeat', desired.stringId);
      }, 300000);
    } catch {
      if (revision === generation) update({ status: 'unavailable', editors: [], message: '无法同步占用，请重新连接 ParaTranz' });
    } finally { if (revision === generation) pending = false; }
    return state;
  }
  return { set, stop, snapshot: () => state };
};
