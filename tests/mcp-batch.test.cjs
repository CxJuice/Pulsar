const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const {createMcpHarness,delay}=require('./helpers/mcp-harness.cjs');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {startMcpHttpServer}=require('../electron/mcp-server.cjs');
const http=require('node:http');
const {McpRecoveryJournal}=require('../electron/mcp-recovery-journal.cjs');
const make=t=>{const h=createMcpHarness();t.after(h.cleanup);return h;};
async function readBatch(h,ids=[1,2,3]){return h.call('mcpGetStrings',{projectId:8340,stringIds:ids});}
const writeItems=read=>read.results.filter(row=>row.ok).map(row=>({stringId:row.stringId,translation:`译文 ${row.stringId}`,snapshotToken:row.snapshotToken}));

test('concurrent reads share account and project discovery and only read requested drafts',async t=>{
 const h=make(t);await Promise.all(Array.from({length:8},(_,index)=>h.call('mcpGetString',{projectId:8340,stringId:index+1})));
 assert.equal(h.counts.session,1);assert.equal(h.counts.projects,1);assert.equal(h.counts.fullDraftReads,0);assert.equal(h.counts.stringReads,8);
 await h.call('mcpGetWorkspace');assert.equal(h.counts.session,1);
});
test('batch drafts use bounded reads and one persistence operation for 25 items',async t=>{
 const h=make(t);const read=await readBatch(h,Array.from({length:25},(_,i)=>i+1));
 const result=await h.call('mcpPrefillTranslations',{projectId:8340,items:writeItems(read)});
 assert.equal(result.succeeded,25);assert.equal(result.failed,0);assert.equal(h.counts.draftPersistence,1);
 assert.equal(h.counts.draftReads,2);assert.equal(h.counts.fullDraftReads,0);assert.ok(h.counts.maxReads<=4);
 assert.equal(h.counts.session,1);assert.equal(h.counts.stringReads,50);assert.equal(h.state.drafts['8340/25'].translation,'译文 25');
});
test('single direct save leaves fresh remote validation to the sidecar instead of repeating its read',async t=>{
 const h=make(t);const read=await h.call('mcpGetString',{projectId:8340,stringId:1});
 await h.call('mcpSaveTranslationToParaTranz',{projectId:8340,stringId:1,translation:'新译文',snapshotToken:read.snapshotToken});
 assert.equal(h.counts.stringReads,2);assert.equal(h.counts.puts,1);assert.equal(h.counts.session,1);
});
test('batch direct save uses one upstream PUT and reports conflicts and partial acceptance separately',async t=>{
 const h=make(t);const read=await readBatch(h);h.state.strings.get(2).translation='human edit';h.state.rejected.add(3);
 const result=await h.call('mcpSaveTranslationsToParaTranz',{projectId:8340,items:writeItems(read)});
 assert.equal(result.succeeded,1);assert.equal(result.failed,2);assert.equal(h.counts.batchPuts,1);assert.equal(h.counts.puts,1);
 assert.match(result.results[1].message,/冲突/);assert.match(result.results[2].message,/未接受/);
 assert.equal(h.state.strings.get(2).translation,'human edit');assert.equal(h.state.strings.get(3).translation,'');
});
test('same timestamp draft content changes block stale writes',async t=>{
 const h=make(t);h.state.drafts['8340/1']={translation:'first',stage:1,updatedAt:'same'};
 const read=await readBatch(h,[1]);h.state.drafts['8340/1'].translation='new human edit';
 const result=await h.call('mcpPrefillTranslations',{projectId:8340,items:writeItems(read)});
 assert.equal(result.failed,1);assert.equal(h.counts.draftPersistence,0);assert.equal(h.state.drafts['8340/1'].translation,'new human edit');
});

test('direct saves retain before and intended content in the recovery journal',async t=>{
 const h=make(t),read=await h.call('mcpGetString',{projectId:8340,stringId:1});
 const result=await h.call('mcpSaveTranslationToParaTranz',{projectId:8340,stringId:1,translation:'new',snapshotToken:read.snapshotToken});
 const records=fs.readFileSync(path.join(h.folder,'mcp-save-recovery.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(records[0].id,result.recoveryRecordId);assert.equal(records[0].items[0].before.original,'source 1');
 assert.equal(records[0].items[0].intended.translation,'new');assert.equal(records[1].state,'acknowledged');assert.equal(records[2].entries[0].verified,true);
 assert.equal(records.some(record=>JSON.stringify(record).includes('snapshotToken')),false);
});

test('recovery journal failure prevents sending an unrecorded remote write',async t=>{
 const h=make(t),read=await h.call('mcpGetString',{projectId:8340,stringId:1});
 h.run("mcpRecoveryJournal = new McpRecoveryJournal(path.join(app.getPath('userData'), 'bounded.jsonl'), {maxBytes:1})");
 await assert.rejects(h.call('mcpSaveTranslationToParaTranz',{projectId:8340,stringId:1,translation:'new',snapshotToken:read.snapshotToken}),/恢复日志/);
 assert.equal(h.counts.puts,0);
});

test('unconfirmed submissions are recorded without automatic replay',t=>{
 const h=make(t),journal=new McpRecoveryJournal(path.join(h.folder,'recovery.jsonl'));
 const id=journal.prepare(1,8340,[{stringId:1,translation:'new',stage:1,expectedTranslation:'old'}]);
 journal.outcome(id,{ok:false,status:502,message:'response lost'});
 const records=fs.readFileSync(journal.file,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(records[1].state,'unconfirmed');assert.equal(records.length,2);
});

test('post-save content mismatches preserve matching drafts and report failed verification',async t=>{
 const h=make(t);h.state.drafts['8340/1']={translation:'译文 1',stage:1,updatedAt:'draft'};
 const read=await readBatch(h,[1]);
 h.state.onRead=async id=>{if(h.counts.puts)h.state.strings.set(id,{...h.state.strings.get(id),translation:'another remote edit'});};
 const result=await h.call('mcpSaveTranslationsToParaTranz',{projectId:8340,items:writeItems(read)});
 assert.equal(result.succeeded,1);assert.equal(result.results[0].data.verified,false);
 assert.match(result.results[0].data.verificationWarning,/不一致/);assert.equal(h.state.drafts['8340/1'].translation,'译文 1');
});
test('matching drafts are removed with one batch persistence after direct save',async t=>{
 const h=make(t);for(let id=1;id<=3;id++)h.state.drafts[`8340/${id}`]={translation:`译文 ${id}`,stage:1,updatedAt:'v1'};
 const read=await readBatch(h);const result=await h.call('mcpSaveTranslationsToParaTranz',{projectId:8340,items:writeItems(read)});
 assert.equal(result.succeeded,3);assert.equal(h.counts.draftPersistence,1);assert.deepEqual(h.state.drafts,{});
 assert.ok(result.results.every(row=>row.data.localDraftCleared));
});
test('edit mode preserves each original allowed stage and skips untranslated entries',async t=>{
 const h=make(t);for(const [id,stage]of[[1,3],[2,2]])Object.assign(h.state.strings.get(id),{translation:'已有译文',stage});
 const read=await readBatch(h);const result=await h.call('mcpSaveTranslationsToParaTranz',{projectId:8340,mode:'edit',items:writeItems(read)});
 assert.equal(result.succeeded,2);assert.equal(result.failed,1);assert.equal(h.state.strings.get(1).stage,3);assert.equal(h.state.strings.get(2).stage,2);
});
test('duplicate IDs and oversized batches are rejected before contacting the sidecar',async t=>{
 const h=make(t);await assert.rejects(readBatch(h,[1,1]),/不重复/);
 await assert.rejects(readBatch(h,Array.from({length:26},(_,i)=>i+1)),/25/);assert.equal(h.counts.remote,0);
});
test('oversized UTF-8 batch payloads fail before any remote submission',async t=>{
 const h=make(t);for(let id=1;id<=25;id++)h.state.strings.get(id).original='中'.repeat(30_000);
 const read=await readBatch(h,Array.from({length:25},(_,i)=>i+1));
 await assert.rejects(h.call('mcpSaveTranslationsToParaTranz',{projectId:8340,items:writeItems(read)}),/数据过大.*尚未提交/);
 assert.equal(h.counts.puts,0);
});
test('revoking permissions during preparation prevents the batch commit',async t=>{
 const h=make(t);const read=await readBatch(h);let revoked=false;
 h.state.onRead=async()=>{if(!revoked){revoked=true;h.run(`const s=readMcpSettings();s.permissions.prefillDrafts=false;persistMcpSettings(s)`);}};
 const result=await h.call('mcpPrefillTranslations',{projectId:8340,items:writeItems(read)});
 assert.equal(result.failed,3);assert.equal(h.counts.draftPersistence,0);
});
test('credential changes invalidate cached sessions and every old snapshot',async t=>{
 const h=make(t);const read=await readBatch(h,[1]);
 const connection=await h.run(`serviceRequest('/credentials','POST',{mockAccount:2})`);assert.equal(connection.ok,true);
 const session=await h.run('mcpSession()');assert.equal(session.user.id,2);assert.equal(h.counts.session,2);
 await assert.rejects(h.call('mcpPrefillTranslation',{projectId:8340,...writeItems(read)[0]}),/快照/);assert.equal(h.counts.draftPersistence,0);
});
test('an invalidated in-flight session response cannot fill the cache',async t=>{
 const h=make(t);let release;const gate=new Promise(resolve=>release=resolve);h.state.onSession=()=>gate;
 const pending=h.run('mcpSession()');await delay(5);h.run('invalidateMcpConnection()');release();await assert.rejects(pending,/连接已变更/);
 assert.equal(h.run('mcpSessionCache'),null);
});
test('a session cached during authentication is invalidated when the new account commits',async t=>{
 const h=make(t);let release;const gate=new Promise(resolve=>release=resolve);
 h.state.onCredentials=()=>gate;
 const login=h.run(`serviceRequest('/credentials','POST',{mockAccount:2})`);
 await delay(5);assert.equal((await h.run('mcpSession()')).user.id,1);
 release();assert.equal((await login).ok,true);
 assert.equal((await h.run('mcpSession()')).user.id,2);assert.equal(h.counts.session,2);
});
test('known old default prompts gain batch guidance while custom prompts stay intact',t=>{
 const h=make(t);
 h.run(`const old=readMcpSettings();old.defaultPrompt=PREVIOUS_UNBATCHED_MCP_PROMPT;persistMcpSettings(old)`);
 assert.match(h.run('readMcpSettings().defaultPrompt'),/get_strings/);
 h.run(`const custom=readMcpSettings();custom.defaultPrompt='My custom translation instructions';persistMcpSettings(custom)`);
 assert.equal(h.run('readMcpSettings().defaultPrompt'),'My custom translation instructions');
});
test('workspace remains inspectable when ParaTranz is disconnected',async t=>{
 const h=make(t);await h.run(`serviceRequest('/credentials','DELETE')`);
 const workspace=await h.call('mcpGetWorkspace');assert.equal(workspace.connected,false);assert.equal(workspace.account,null);
 await assert.rejects(readBatch(h,[1]),/连接 ParaTranz/);
});
test('already committed batch remains successful when refreshing canonical data fails',async t=>{
 const h=make(t);const read=await readBatch(h,[1]);let reads=0;
 h.state.onRead=async()=>{if(++reads===2)h.state.refreshFailures.add(1);};
 const result=await h.call('mcpSaveTranslationsToParaTranz',{projectId:8340,items:writeItems(read)});
 assert.equal(result.succeeded,1);assert.match(result.results[0].data.refreshWarning,/已提交/);assert.equal(h.counts.puts,1);
});

function editorListener({dirty=false,account=1,epoch=7}={}){
 const source=fs.readFileSync(path.resolve(__dirname,'../app/composables/useEditor.ts'),'utf8');
 const start=source.indexOf('removeMcpRemoteSaved = window.scKit?.onMcpRemoteSaved(update => {');
 const end=source.indexOf('\n      try {',start);let callback;
 const previous={project:8340,id:1,translation:'old',stage:1};
 const context=vm.createContext({window:{scKit:{onMcpRemoteSaved:fn=>{callback=fn;return()=>{};}}},sessionInfo:{value:{user:{id:account},connectionEpoch:epoch}},
  normalizeStringItem:item=>item,selected:{value:previous},text:{value:dirty?'manual edit':'old'},editStage:{value:1},dirty:{value:dirty},
  items:{value:[previous]},drafts:{value:{}},inCurrentScope:()=>false,toParaTranzText:value=>value,draftStatus:{value:''},
  updatedSortNeedsRefresh:false,suggestionsCache:{clear(){}},disputedStringsCache:{clear(){}},changing:false,translationDisplayCleared:{value:false}});
 vm.runInContext(source.slice(start,end),context);return {context,callback};
}
test('direct save updates a clean editor and preserves subsequent manual edits',()=>{
 for(const dirty of[false,true]){
  const h=editorListener({dirty});h.callback({accountId:1,projectId:8340,stringId:1,item:{project:8340,id:1,translation:'new',stage:3},draftPresent:false,draftCleared:false});
  assert.equal(h.context.text.value,dirty?'manual edit':'new');assert.equal(h.context.editStage.value,dirty?1:3);
 }
 const h=editorListener({account:2});h.callback({accountId:1,projectId:8340,stringId:1,item:{project:8340,id:1,translation:'wrong account',stage:3}});
 assert.equal(h.context.text.value,'old');assert.equal(h.context.selected.value.translation,'old');
 const prior=editorListener();prior.callback({accountId:1,connectionEpoch:6,projectId:8340,stringId:1,item:{project:8340,id:1,translation:'old connection',stage:3}});
 assert.equal(prior.context.text.value,'old');assert.equal(prior.context.selected.value.translation,'old');
});
test('official MCP client discovers and calls the three batch tools with validated schemas',async t=>{
 const h=make(t),reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const token='test-'+ 'x'.repeat(40);
 const handle=await startMcpHttpServer({port,token,handlers:{defaultPrompt:'batch test',getStrings:args=>h.call('mcpGetStrings',args),prefillTranslations:args=>h.call('mcpPrefillTranslations',args),saveTranslationsToParaTranz:args=>h.call('mcpSaveTranslationsToParaTranz',args)}});
 const client=new Client({name:'mcp-batch-test',version:'1'});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
  const tools=await client.listTools();assert.equal(tools.tools.length,14);
  const invalid=await client.callTool({name:'get_strings',arguments:{projectId:8340,stringIds:[1,1]}});assert.equal(invalid.isError,true);
  const response=await client.callTool({name:'get_strings',arguments:{projectId:8340,stringIds:[1,2]}});
  const read=JSON.parse(response.content[0].text);assert.equal(read.succeeded,2);
  const written=await client.callTool({name:'prefill_translations',arguments:{projectId:8340,items:writeItems(read)}});
  assert.equal(JSON.parse(written.content[0].text).succeeded,2);assert.equal(h.counts.draftPersistence,1);
  const fresh=await client.callTool({name:'get_strings',arguments:{projectId:8340,stringIds:[1,2]}});
  const saved=await client.callTool({name:'save_translations_to_paratranz',arguments:{projectId:8340,mode:'save',items:writeItems(JSON.parse(fresh.content[0].text))}});
  assert.equal(JSON.parse(saved.content[0].text).succeeded,2);assert.equal(h.counts.batchPuts,1);assert.equal(h.counts.draftPersistence,2);
 }finally{await client.close();await handle.close();}
});
