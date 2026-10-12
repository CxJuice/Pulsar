(() => {
  const copy = x => JSON.parse(JSON.stringify(x));
  const ok = data => ({ok:true,data:copy(data)});
  const pause = ms => new Promise(r => setTimeout(r,ms));
  const project = {id:4242,name:'审计测试项目',source:'en',dest:'zh-CN',desc:'本地模拟响应；没有连接真实 ParaTranz。'};
  const files = [{id:42420,name:'audit.strings',project:4242,total:60,translated:20,disputed:1,checked:0,reviewed:0,hidden:0,locked:1,words:600}];
  const strings = Array.from({length:60},(_,i)=>({id:101+i,key:'KEY_'+String(60-i).padStart(3,'0'),original:i===0?'Search for a project, file, or translated string':i===1?'Go back to the previous screen':i===2?'Value: ~amount(10) <EM4>account</EM4>\\nNext line':'Audit entry '+String(i+1).padStart(2,'0'),translation:i<20?'测试译文 '+(i+1):'',stage:i===10?9:i<20?1:0,project:4242,fileId:42420,file:{id:42420,name:'audit.strings',project:4242},context:'Audit fixture '+(i+1),words:5,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z'}));
  const terms=[{id:1,term:'account',translation:'账户/账号',pos:'noun',variants:[],caseSensitive:false,project:4242,uid:1,updatedAt:'2026-10-10T00:00:00Z'},
    {id:2,term:'Avenger',translation:'复仇者',project:4242}, {id:3,term:'Red',translation:'红色',project:4242}, {id:4,term:'Blue',translation:'蓝色',project:4242},
    {id:5,term:'Carbon Fiber',translation:'碳纤维',project:4242}];
  const drafts={}; let authenticated=true; let settings={provider:'google',mode:'api',deeplPlan:'free',proxy:{mode:'direct',host:'127.0.0.1',port:7890},googleConfigured:true,deeplConfigured:false,llmRequestUrl:'',llmModel:'',llmPrefixPrompt:'',llmConfigured:false,llmContext:{key:true,recommendations:true,recommendationCount:1,terms:true,notes:true},clearAfterSaveNext:true,useTermTranslations:true};
  const calls=[]; const record=(action,payload)=>{calls.push({action,payload:copy(payload||{}),at:Date.now()});document.documentElement.dataset.auditCalls=JSON.stringify(calls);};
  const translationRequests = new Map();
  const translationResultCache = new window.__auditTranslationResultCache();
  let translationConfig = { delay: 150, failOnceText: '', slowAfterFirst: false, timeouts: {} };
  let translationStats = { active: 0, maximum: 0, started: 0, canceled: 0, attempts: {} };
  window.__auditConfigureTranslation = config => {
    if (translationRequests.size) throw new Error('Synthetic translations are still active');
    translationConfig = { delay: 150, failOnceText: '', slowAfterFirst: false, timeouts: {}, ...config };
    translationStats = { active: 0, maximum: 0, started: 0, canceled: 0, attempts: {} };
  };
  window.__auditTranslationStats = () => copy(translationStats);
  window.__auditDrafts = () => copy(drafts);
  window.__auditSetTerm = (term, translation) => {
    const row = terms.find(item => item.term === term);
    if (!row) throw new Error('Unknown synthetic term');
    row.translation = translation;
  };
  window.__auditAddFile = (file, entries) => {
    if (files.some(item => item.id === file.id) || entries.some(entry => strings.some(item => item.id === entry.id))) throw new Error('Duplicate synthetic file or entry');
    files.push(copy(file));
    strings.push(...copy(entries).map(entry => ({ context: '', words: 5, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', ...entry, project: file.project, fileId: file.id, file: { id: file.id, name: file.name, project: file.project } })));
  };
  window.__auditSetOriginal = (id, source) => {
    const row = strings.find(item => item.id === id);
    if (!row) throw new Error('Unknown synthetic item');
    row.original = source;
  };
  window.__auditSetRemote = (id, translation) => {
    const row = strings.find(item => item.id === id);
    if (!row) throw new Error('Unknown synthetic item');
    row.translation = translation;
    row.updatedAt = new Date().toISOString();
  };
  const session=()=>({authenticated,mode:authenticated?'session':'none',user:authenticated?{id:1,username:'audit',nickname:'本地审计账户'}:null});
  window.scKit={
    async request(action,p={}) {
      record(action,p); await pause(action==='save'?500:30);
      if(action==='session') return ok(session());
      if(action==='projects') return ok([{id:4242,name:project.name,permission:3}]);
      if(action==='project') return ok(project);
      if(action==='files') return ok(files);
      if(action==='drafts') return ok(drafts);
      if(action==='legacyDrafts') return ok({count:0});
      if(action==='claimLegacyDrafts') return ok({imported:0});
      if(action==='draft'){const k=p.projectId+'/'+p.stringId;if(p.remove)delete drafts[k];else drafts[k]={translation:p.translation,stage:p.stage,updatedAt:p.updatedAt};return ok({saved:true});}
      if(action==='strings'){let rows=strings.filter(s=>(!p.fileId||s.fileId===p.fileId)&&(p.stage==null||s.stage===p.stage));const q=(p.text||'').toLowerCase();if(q)rows=rows.filter(s=>(p.searchMode==='text'?[s.original,s.translation,s.key].join(' '):String(s[p.searchMode]||'')).toLowerCase().includes(q));const size=p.pageSize||50;const count=Math.max(1,Math.ceil(rows.length/size));const page=Math.max(1,Math.min(p.page||1,count));return ok({results:rows.slice((page-1)*size,page*size),rowCount:rows.length,pageCount:count,page,pageSize:size});}
      if(action==='string') return ok(strings.find(s=>s.id===p.stringId));
      if(action==='save'){const row=strings.find(s=>s.id===p.stringId);const overwroteConflict=row.translation!==p.expectedTranslation||row.updatedAt!==p.expectedUpdatedAt;Object.assign(row,{translation:p.translation,stage:p.stage,updatedAt:new Date().toISOString()});return ok({...row,overwroteConflict});}
      if(action==='suggestions')return ok([{id:9001,key:'REFERENCE',original:'Avenger Combat Helmet Red',translation:'复仇者战斗头盔 红色',matching:.9,project:{id:4242,name:project.name},file:{id:42420,name:'audit.strings'}}]);
      if(action==='terms')return ok(terms.filter(t=>(strings.find(s=>s.id===p.stringId)?.original||'').includes(t.term)));
      if(action==='projectTerms')return ok({results:terms,page:1,pageSize:800,pageCount:1,rowCount:terms.length});
      if(action==='history')return ok([]);
      if(action==='memory')return ok({results:[],rowCount:0,page:1,pageSize:50});
      if(action==='term')return ok(terms[0]);
      return {ok:false,message:'本地审计未模拟操作：'+action};
    },
    async presence(target){return ok({projectId:target.projectId,status:'connected',editors:[],userId:1,sessionId:'fixture',message:''});},onPresence(){return ()=>{};},
    async connect(){authenticated=true;return ok(session());},async login(){authenticated=true;return ok(session());},async disconnect(){authenticated=false;return ok(null);},
    async getTranslationSettings(){return ok(settings);},async saveTranslationSettings(value){settings={...settings,...copy(value)};translationResultCache.clear();return ok(settings);},async saveTranslationSelection(value){settings={...settings,...value};translationResultCache.clear();return ok(settings);},
    async testProxy(proxy){return ok({proxy,ok:true,results:[]});},
    async translateToChinese(text,context,id){
      record('translate',{text,context,id});
      const startedAt = Date.now(), generation = translationResultCache.generation;
      const { bypassCache, ...cacheContext } = context || {};
      const cacheKey = JSON.stringify([settings,text,cacheContext]);
      if (!bypassCache) {
        const cached = translationResultCache.read(cacheKey);
        if (cached) return ok({...cached,localCacheHit:true,elapsedMs:Date.now()-startedAt});
      }
      const controller = new AbortController();
      translationRequests.set(id, () => { translationStats.canceled++; controller.abort(); });
      try {
        const result = await window.__auditRetryTranslation(() => {
          translationStats.started++;
          translationStats.attempts[text] = (translationStats.attempts[text] || 0) + 1;
          translationStats.maximum = Math.max(translationStats.maximum, ++translationStats.active);
          const delay = translationConfig.delay * (translationConfig.slowAfterFirst && translationStats.started > 1 ? 10 : 1);
          return new Promise((resolve,reject) => {
            let settled = false;
            const finish = (callback,result) => {
              if (settled) return;
              settled = true; clearTimeout(timer);
              controller.signal.removeEventListener('abort', abort);
              translationStats.active--; callback(result);
            };
            const abort = () => finish(reject,new Error('翻译已取消'));
            const timer = setTimeout(() => {
              if (translationConfig.timeouts[text] > 0) { translationConfig.timeouts[text]--; finish(reject,Object.assign(new Error('翻译请求超时'),{status:504})); }
              else if (text === translationConfig.failOnceText) { translationConfig.failOnceText = ''; finish(reject,new Error('本地模拟翻译失败')); }
              else finish(resolve,{text:'本地模拟译文：'+text,provider:settings.provider});
            }, delay);
            controller.signal.addEventListener('abort',abort,{once:true});
            if (controller.signal.aborted) abort();
          });
        },controller.signal);
        if (controller.signal.aborted) throw new Error('翻译已取消');
        translationResultCache.write(cacheKey,result,generation);
        return ok({...result,localCacheHit:false,elapsedMs:Date.now()-startedAt});
      } catch(error) { return {ok:false,message:error.message}; }
      finally { translationRequests.delete(id); }
    },
    async cancelTranslation(id){record('cancelTranslation',{id});translationRequests.get(id)?.();return ok(null);},
    async fetchCommunityTranslationCandidates(){return ok({entries:[],warnings:[],fetchedAt:new Date().toISOString()});},
    async openExternal(){},async exportData(){return true;},window(){},translatorView(){},onAuxCustomizationAction(){return ()=>{};},onBeforeClose(){return ()=>{};},closeResponse(){},onSessionRestored(){return ()=>{};},async getBuildInfo(){return null;},
    async lookupCambridge(query){return ok({word:query,url:'https://dictionary.cambridge.org/',ukPronunciation:'',usPronunciation:'',entries:[]});},async openCambridgeOriginal(){}
  };
})();
