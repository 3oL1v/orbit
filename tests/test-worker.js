const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const C=require('../orbit/coordinator.js'),W=require('../orbit/worker.js'),cli=require('../orbit/agent-cli.js');
const TOKEN='correct-horse-battery',delay=ms=>new Promise(r=>setTimeout(r,ms));
const hold={action:'hold',market:'NOVA',side:'long',margin:10,leverage:1,orderType:'market',limitPrice:0,reason:'Нет преимущества',memory:'Моя заметка'};
const openOrder={...hold,action:'open',market:'FLUX',side:'short',margin:100,leverage:2,orderType:'market',limitPrice:0,reason:'Тест'};
const authOk=async()=>({codex:{ok:true,detail:'ok'},claude:{ok:true,detail:'ok'}});
// A fake CLI: GPT answers through the --output-last-message file, Claude through its JSON envelope on stdout.
const fakeRun=(log,answer=()=>hold)=>async(cmd,args,{input,signal,cwd})=>{log.push({cmd,args,input,cwd});const d=answer(cmd,input);if(cmd==='codex'){fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(d));return {code:0,out:'{"type":"turn.completed","usage":{"input_tokens":10}}\n',err:'',overflow:false};}return {code:0,out:JSON.stringify({subtype:'success',is_error:false,structured_output:d,modelUsage:{[cli.PINNED.claudeModel]:{}}}),err:'',overflow:false};};
async function boot({remote=true}={}){const cfg={host:'0.0.0.0',port:0,token:TOKEN,local:false,models:true,remote},coordinator=C.createCoordinator({load:false,secondMs:5,models:true,remote}),server=C.createServer(coordinator,cfg);await new Promise(r=>server.listen(0,'127.0.0.1',r));cfg.port=server.address().port;return {coordinator,server,url:'http://127.0.0.1:'+cfg.port,close:()=>new Promise(r=>server.close(r))};}
const raw=(url,{path='/',method='GET',headers={},body})=>new Promise((resolve,reject)=>{const u=new URL(url),req=http.request({host:u.hostname,port:u.port,path,method,headers},res=>{let t='';res.on('data',d=>t+=d);res.on('end',()=>resolve({status:res.statusCode,text:t}));});req.on('error',reject);req.end(body);});
const basic={Authorization:'Basic '+Buffer.from('me:'+TOKEN).toString('base64')};
// Workers started by a test are always stopped afterwards, even when an assertion fails, so a red test can never hang the runner.
const workers=[],startW=opts=>{const w=W.startWorker(opts);workers.push(w);return w;};
test.afterEach(()=>{for(const w of workers.splice(0))w.stop();});
const online=async s=>{for(let i=0;i<100&&!s.coordinator.snapshot().workers?.connected;i++)await delay(10);};

test('execute: only the two pinned models, fixed flags, the prompt travels on stdin and never on the command line',async()=>{
 const log=[];const gpt=await W.execute({provider:'GPT',model:cli.PINNED.codexModel,prompt:'СЕКРЕТНЫЙ-ТЕКСТ'},{run:fakeRun(log)});
 assert.equal(log[0].cmd,'codex');assert.equal(log[0].input,'СЕКРЕТНЫЙ-ТЕКСТ');assert.ok(!log[0].args.some(a=>a.includes('СЕКРЕТНЫЙ')));
 for(const flag of ['--sandbox','read-only','features.shell_tool=false','--ephemeral','--ignore-user-config'])assert.ok(log[0].args.includes(flag),flag);
 assert.ok(log[0].args.includes('--model')&&log[0].args.includes(cli.PINNED.codexModel));assert.equal(JSON.parse(gpt.lastMessage).action,'hold');assert.equal(fs.existsSync(log[0].cwd),false,'temp dir removed');
 const cl=await W.execute({provider:'Claude',model:cli.PINNED.claudeModel,prompt:'x'},{run:fakeRun(log)});assert.equal(log[1].cmd,'claude');const k=log[1].args.indexOf('--tools');assert.deepEqual(log[1].args.slice(k,k+2),['--tools','']);assert.equal(JSON.parse(cl.out).structured_output.action,'hold');
});

test('execute refuses anything that is not exactly a pinned-model prompt, and ignores extra fields such as args or command',async()=>{
 let started=0;const run=async()=>{started++;return {code:0,out:'',err:''};};
 for(const job of [null,{provider:'Bash',model:'x',prompt:'rm -rf /'},{provider:'GPT',model:'gpt-6-astra',prompt:'x'},{provider:'GPT',model:cli.PINNED.claudeModel,prompt:'x'},{provider:'Claude',model:cli.PINNED.claudeModel,prompt:''},{provider:'Claude',model:cli.PINNED.claudeModel,prompt:'x'.repeat(300001)},{provider:'Claude',model:cli.PINNED.claudeModel,prompt:{a:1}}])await assert.rejects(()=>W.execute(job,{run}));
 assert.equal(started,0);
 const log=[];await W.execute({provider:'GPT',model:cli.PINNED.codexModel,prompt:'x',args:['--dangerously-bypass-approvals-and-sandbox'],command:'powershell'},{run:fakeRun(log)});
 assert.equal(log[0].cmd,'codex');assert.ok(!log[0].args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('worker channel: password and the worker header are both required; it does not exist on a non-remote server',async()=>{
 const s=await boot();try{
  const poll={method:'POST',path:'/api/worker/poll',body:'{}'};
  assert.equal((await raw(s.url,poll)).status,401);
  assert.equal((await raw(s.url,{...poll,headers:{...basic,'Content-Type':'application/json'}})).status,403);
  assert.equal((await raw(s.url,{...poll,headers:{...basic,'X-Orbit-Worker':'1','Content-Type':'application/json'}})).status,200);
 }finally{await s.close();}
 const l=await boot({remote:false});try{assert.equal((await raw(l.url,{method:'POST',path:'/api/worker/poll',body:'{}',headers:{...basic,'X-Orbit-Worker':'1'}})).status,404);}finally{await l.close();}
});

test('cloud + local worker: no worker means a clear error; with a worker the rounds run, decisions apply, memory and counters update',async()=>{
 const s=await boot();try{
  await assert.rejects(()=>s.coordinator.start({gpt:1,claude:1,rounds:1}),/исполнитель не подключён/i);
  const log=[],w=startW({url:s.url,token:TOKEN,run:fakeRun(log,cmd=>cmd==='codex'?openOrder:hold),authFn:authOk});await online(s);
  const info=s.coordinator.snapshot().workers;assert.equal(info.connected,true);assert.deepEqual(info.providers.slice().sort(),['Claude','GPT']);assert.equal((await s.coordinator.auth()).codex.ok,true);
  await s.coordinator.start({gpt:1,claude:1,rounds:2});await s.coordinator.wait();const st=s.coordinator.snapshot();
  assert.equal(st.control.error,null);assert.equal(st.market.tick,2);assert.equal(st.control.calls,4);assert.equal(log.length,4);
  assert.equal(st.reports.bot0.meta.requestedModel,cli.PINNED.codexModel);assert.equal(st.reports.bot5.meta.requestedModel,cli.PINNED.claudeModel);assert.equal(st.memories.bot0.note,'Моя заметка');
  assert.ok(st.market.accounts[1].orders.length+st.market.accounts[1].positions.length>=1,'the GPT order reached the exchange');
  assert.ok(log.every(x=>x.input.includes('Снимок такта')));w.stop();await w.done;
 }finally{await s.close();}
});

test('cloud + local worker: free trading works through the queue and stop cancels the running CLI on the worker',async()=>{
 const s=await boot();try{
  let aborted=0;const log=[];const run=async(cmd,args,o)=>{log.push(cmd);if(log.length>2)return new Promise((_,reject)=>o.signal.addEventListener('abort',()=>{aborted++;reject(Error('cancelled'));},{once:true}));return fakeRun([])(cmd,args,o);};
  const w=startW({url:s.url,token:TOKEN,run,authFn:authOk});await online(s);
  await s.coordinator.start({mode:'free',gpt:1,claude:1,crowd:20,minutes:5,tickSeconds:5,wake:'event',idleTicks:3,movePct:10});
  for(let i=0;i<300&&log.length<4;i++)await delay(10);assert.ok(log.length>=4,`calls ${log.length}`);
  s.coordinator.stop();const finished=await Promise.race([s.coordinator.wait().then(()=>true),delay(3000).then(()=>false)]);assert.equal(finished,true,'stop did not finish');
  for(let i=0;i<100&&w.running.size;i++)await delay(10);assert.equal(w.running.size,0);assert.ok(aborted>=1,'worker killed the in-flight CLI');
  assert.equal(s.coordinator.snapshot().control.active,false);w.stop();await w.done;
 }finally{await s.close();}
});

test('a worker that signed in to only one family makes the other family unavailable',async()=>{
 const s=await boot();try{
  const w=startW({url:s.url,token:TOKEN,run:fakeRun([]),authFn:async()=>({codex:{ok:true},claude:{ok:false,detail:'Нужен вход'}})});await online(s);
  await assert.rejects(()=>s.coordinator.start({gpt:0,claude:1,rounds:1}),/не готов к выбранному семейству/);
  await s.coordinator.start({gpt:1,claude:0,rounds:1});await s.coordinator.wait();assert.equal(s.coordinator.snapshot().market.tick,1);w.stop();await w.done;
 }finally{await s.close();}
});
