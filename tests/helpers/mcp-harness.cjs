const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { mapLimit } = require('../../electron/mcp-batch.cjs');
const mainPath = path.resolve(__dirname, '../../electron/main.cjs');
const requireFromMain = createRequire(mainPath);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createMcpHarness({ legacy = false, latency = 0, count = 25 } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsar-mcp-test-'));
  const sourcePath = legacy ? path.resolve(__dirname, '../../audit/mcp-performance-before/electron--main.cjs') : mainPath;
  const source = fs.readFileSync(sourcePath, 'utf8').split('if (!smoke && !app.requestSingleInstanceLock())')[0];
  const counts = { remote: 0, session: 0, projects: 0, stringReads: 0, draftReads: 0, fullDraftReads: 0,
    draftPersistence: 0, puts: 0, batchPuts: 0, activeReads: 0, maxReads: 0 };
  const state = { account: 1, epoch: 0, drafts: {}, strings: new Map(), rejected: new Set(), refreshFailures: new Set(), onRead: null, onDraftRead: null, onSession: null, listPayloads: [] };
  for (let id = 1; id <= count; id++) state.strings.set(id, { id, project: 8340, fileId: 20, stage: 0,
    original: `source ${id}`, translation: '', updatedAt: `v${id}`, key: `KEY_${id}`, context: '' });
  const remoteDelay = async () => { counts.remote++; if (latency) await delay(latency); };
  async function readString(id) {
    counts.stringReads++; counts.activeReads++; counts.maxReads = Math.max(counts.maxReads, counts.activeReads);
    try {
      await remoteDelay();
      if (state.onRead) await state.onRead(id);
      if (state.refreshFailures.has(id)) throw new Error('mock refresh failure');
      const item = state.strings.get(id);
      if (!item) throw new Error('词条不存在');
      return { ...item };
    } finally { counts.activeReads--; }
  }
  function draftMatches(body, draft) {
    return [['expectedDraftUpdatedAt','updatedAt'],['expectedDraftTranslation','translation'],['expectedDraftStage','stage']]
      .every(([expected,field]) => body[expected] === undefined || body[expected] === (draft?.[field] ?? null));
  }
  function remoteMatches(body, item) {
    return [['expectedUpdatedAt','updatedAt'],['expectedTranslation','translation'],['expectedStage','stage'],['expectedOriginal','original']]
      .every(([expected,field]) => body[expected] === (item[field] ?? null));
  }
  function validConnection(body) {
    return body.expectedConnectionEpoch === undefined || body.expectedConnectionEpoch === state.epoch;
  }
  function saveDraft(body, account = body.accountId, project = body.projectId) {
    const key = `${project}/${body.stringId}`, draft = state.drafts[key];
    if (account !== state.account || !validConnection(body)) return { stringId: body.stringId, saved: false, message: '连接已变更' };
    if (!draftMatches(body, draft)) return { stringId: body.stringId, saved: false, message: '草稿冲突' };
    if (body.remove) delete state.drafts[key];
    else state.drafts[key] = { translation: body.translation, stage: body.stage, updatedAt: body.updatedAt };
    return { stringId: body.stringId, saved: true };
  }
  async function handle(endpoint, method, body) {
    if (endpoint === '/internal/mcp-operation') return { registered: true, applied: true, finished: true, cancelled: true };
    if (endpoint === '/credentials') {
      if (state.onCredentials) await state.onCredentials();
      state.account = method === 'DELETE' ? null : body.mockAccount ?? 1; state.epoch++;
      return { authenticated: Boolean(state.account), user: state.account ? {id:state.account} : undefined };
    }
    if (endpoint === '/rpc/session') {
      counts.session++; await remoteDelay(); if (state.onSession) await state.onSession();
      return { authenticated: Boolean(state.account), user: state.account ? { id: state.account } : undefined, connectionEpoch: state.epoch };
    }
    if (endpoint === '/rpc/projects') { counts.projects++; await remoteDelay(); await remoteDelay(); return [{id:8340,name:'Mock project'}]; }
    if (endpoint === '/rpc/string') return readString(body.stringId);
    if (endpoint === '/rpc/strings') { state.listPayloads.push(body); return { results: [], rowCount: 0, page: 1 }; }
    if (endpoint === '/rpc/terms') return [{ term: 'source', translation: '原文' }];
    if (endpoint === '/rpc/suggestions') return [{ original: 'source', translation: '原文' }];
    if (endpoint === '/rpc/drafts') {
      counts.draftReads++; if (state.onDraftRead) await state.onDraftRead();
      if (body.accountId !== state.account) throw Object.assign(new Error('草稿账号不一致'),{status:403});
      if (!body.stringIds) { counts.fullDraftReads++; return { ...state.drafts }; }
      return Object.fromEntries(body.stringIds.map(id=>`${body.projectId}/${id}`).filter(key=>state.drafts[key]).map(key=>[key,state.drafts[key]]));
    }
    if (endpoint === '/rpc/draft') {
      const result=saveDraft(body); if (!result.saved) throw Object.assign(new Error(result.message),{status:409});
      counts.draftPersistence++; return {saved:true};
    }
    if (endpoint === '/rpc/draftBatch') {
      if (!validConnection(body) || body.accountId !== state.account) throw Object.assign(new Error('连接已变更'),{status:409});
      const results=body.items.map(item=>saveDraft({...item,expectedConnectionEpoch:body.expectedConnectionEpoch},body.accountId,body.projectId));
      if(results.some(result=>result.saved))counts.draftPersistence++;
      return {results};
    }
    if (endpoint === '/rpc/save') {
      if (legacy) await remoteDelay();
      const current=await readString(body.stringId);
      if (!validConnection(body) || body.expectedUserId !== state.account || !remoteMatches(body,current)) throw Object.assign(new Error('词条版本冲突'),{status:409});
      if (!draftMatches(body,state.drafts[`${body.projectId}/${body.stringId}`])) throw Object.assign(new Error('草稿冲突'),{status:409});
      await remoteDelay(); counts.puts++;
      const saved={...current,translation:body.translation,stage:body.stage,updatedAt:`saved-${body.stringId}`};
      state.strings.set(body.stringId,saved); return saved;
    }
    if (endpoint === '/rpc/saveBatch') {
      if(!validConnection(body)||body.expectedUserId!==state.account)throw Object.assign(new Error('连接已变更'),{status:409});
      const checked=await mapLimit(body.items,4,async item=>{
        const current=await readString(item.stringId);
        return {item,current,valid:remoteMatches(item,current)&&draftMatches(item,state.drafts[`${body.projectId}/${item.stringId}`])};
      });
      if(!validConnection(body))throw Object.assign(new Error('连接已变更'),{status:409});
      const valid=checked.filter(row=>row.valid);
      if(valid.length){await remoteDelay();counts.puts++;counts.batchPuts++;}
      return {results:checked.map(({item,current,valid})=>{
        const saved=valid&&!state.rejected.has(item.stringId);
        if(saved)state.strings.set(item.stringId,{...current,translation:item.translation,stage:item.stage,updatedAt:`saved-${item.stringId}`});
        return {stringId:item.stringId,saved,message:!valid?'词条版本冲突':saved?undefined:'ParaTranz 未接受此词条'};
      })};
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  }
  const session = { async setProxy(){},async closeAllConnections(){},async clearStorageData(){},async resolveProxy(){return 'DIRECT';},cookies:{async get(){return [];},async flushStore(){}} };
  const ipcHandlers=new Map();
  const electron={app:{getPath:()=>folder,getAppPath:()=>folder,setPath(){},isPackaged:false},
    protocol:{registerSchemesAsPrivileged(){}},net:{},session:{defaultSession:session,fromPartition:()=>session},
    ipcMain:{handle:(name,callback)=>ipcHandlers.set(name,callback),on(){}},
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}};
  const context=vm.createContext({require(name){
    if(name==='electron')return electron;
    if(name==='electron-updater')return {autoUpdater:Object.assign(new EventEmitter(),{async checkForUpdates(){}})};
    if(name==='./presence.cjs')return ()=>({stop(){}});
    return requireFromMain(name);
  },process:{argv:[],env:{},platform:'win32'},__dirname:path.dirname(mainPath),Buffer,URL,AbortController,AbortSignal,setTimeout,clearTimeout,
    fetch:async(url,options)=>{
      try {const data=await handle(new URL(url).pathname,options.method,options.body?JSON.parse(options.body):{});return {ok:true,status:200,json:async()=>data};}
      catch(error){return {ok:false,status:error.status||502,json:async()=>({message:error.message})};}
    }});
  vm.runInContext(source,context,{filename:mainPath});
  const run=expression=>vm.runInContext(expression,context);
  run(`serviceUrl='http://127.0.0.1:9999';persistMcpSettings({...defaultMcpSettings(),enabled:true,permissions:{...defaultMcpSettings().permissions,saveToParaTranz:true,saveStages:[0,1,2,3,5],overwriteExistingTranslations:true}})`);
  const call=(name,args)=>{context.callArgs=args;return run(`${name}(callArgs)`);};
  return {context,run,call,state,counts,ipcHandlers,folder,cleanup:()=>fs.rmSync(folder,{recursive:true,force:true})};
}

module.exports={createMcpHarness,delay};
