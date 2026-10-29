const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const C=require('../orbit/coordinator.js');
const TOKEN='correct-horse-battery';
// Real HTTP against an ephemeral port; the Host header can only be forged with node:http, not fetch.
const call=(port,{method='GET',path='/',headers={},body}={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,method,path,headers},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));});req.on('error',reject);req.end(body);});
const basic=pass=>({Authorization:'Basic '+Buffer.from('user:'+pass).toString('base64')});
const post=(port,path,obj,headers={})=>call(port,{method:'POST',path,body:JSON.stringify(obj),headers:{'Content-Type':'application/json','X-Orbit-Request':'1',Origin:`http://127.0.0.1:${port}`,...headers}});
async function boot(cfg,opts={}){const coordinator=C.createCoordinator({load:false,secondMs:5,...opts}),server=C.createServer(coordinator,cfg);await new Promise(r=>server.listen(0,'127.0.0.1',r));cfg.port=server.address().port;return {coordinator,server,port:cfg.port,close:()=>new Promise(r=>server.close(r))};}

test('readConfig: loopback needs no password, a public bind refuses to start without a strong one',()=>{
 assert.deepEqual(C.readConfig({}),{host:'127.0.0.1',port:8766,token:'',local:true,open:false,models:true,remote:false});assert.deepEqual([C.readConfig({ORBIT_MODELS:'remote'}).models,C.readConfig({ORBIT_MODELS:'remote'}).remote],[true,true]);
 assert.equal(C.readConfig({PORT:'3000',ORBIT_HOST:'0.0.0.0',ORBIT_TOKEN:TOKEN,ORBIT_MODELS:'off'}).models,false);
 assert.equal(C.readConfig({PORT:'3000',ORBIT_HOST:'0.0.0.0',ORBIT_TOKEN:TOKEN}).port,3000);
 assert.throws(()=>C.readConfig({ORBIT_HOST:'0.0.0.0'}),/ORBIT_TOKEN/);
 assert.throws(()=>C.readConfig({ORBIT_HOST:'0.0.0.0',ORBIT_TOKEN:'short'}),/короткий/);
 assert.throws(()=>C.readConfig({PORT:'abc'}),/порт/);
});

test('local mode keeps the strict Host and Origin checks',async()=>{
 const s=await boot({host:'127.0.0.1',port:0,token:'',local:true,models:true});
 try{
  assert.equal((await call(s.port,{path:'/api/state'})).status,200);
  assert.equal((await call(s.port,{path:'/api/state',headers:{Host:'evil.example'}})).status,403);
  assert.equal((await post(s.port,'/api/stop',{},{Origin:'http://evil.example'})).status,403);
  assert.equal((await post(s.port,'/api/stop',{},{'X-Orbit-Request':'0'})).status,403);
  assert.equal((await post(s.port,'/api/stop',{})).status,200);
  assert.equal((await call(s.port,{path:'/'})).headers['x-frame-options'],'DENY');
 }finally{await s.close();}
});

test('public mode: everything except /health needs the password, wrong guesses are throttled',async()=>{
 const cfg={host:'0.0.0.0',port:0,token:TOKEN,local:false,models:false},s=await boot(cfg,{models:false});
 try{
  assert.deepEqual((await call(s.port,{path:'/health'})).json(),{ok:true});
  for(const path of ['/','/api/state','/app.js','/engine.js']){const r=await call(s.port,{path});assert.equal(r.status,401,path);assert.match(r.headers['www-authenticate'],/Basic/);assert.doesNotMatch(r.text,/accounts|function/);}
  assert.equal((await post(s.port,'/api/start',{},{})).status,401);
  const ok=await call(s.port,{path:'/api/state',headers:basic(TOKEN)});assert.equal(ok.status,200);assert.ok(ok.json().market.accounts.length>=11);
  const page=await call(s.port,{path:'/',headers:basic(TOKEN)});assert.match(page.text,/ORBIT_CONFIG=\{"models":false,"cloud":true,"remote":false,"open":false\}/);
  // Five wrong passwords lock the client out, even with the right one afterwards.
  for(let i=0;i<5;i++)assert.equal((await call(s.port,{path:'/api/state',headers:basic('wrong-'+i)})).status,401);
  const locked=await call(s.port,{path:'/api/state',headers:basic(TOKEN)});assert.equal(locked.status,429);assert.equal(locked.headers['retry-after'],'60');
 }finally{await s.close();}
});

test('public mode: Origin must match the Host header, models are rejected, the crowd runs',async()=>{
 const cfg={host:'0.0.0.0',port:0,token:TOKEN,local:false,models:false},s=await boot(cfg,{models:false}),auth=basic(TOKEN);
 try{
  const start={mode:'free',gpt:0,claude:0,crowd:30,minutes:1,tickSeconds:5};
  assert.equal((await post(s.port,'/api/start',start,{...auth,Origin:'https://evil.example'})).status,403);
  assert.equal((await post(s.port,'/api/start',start,{...auth,Origin:''})).status,403);
  const withModels=await post(s.port,'/api/start',{...start,gpt:1},auth);assert.equal(withModels.status,400);assert.match(withModels.json().error,/отключены/);
  const ai=await call(s.port,{path:'/api/auth',headers:auth});assert.equal(ai.json().codex.ok,false);assert.match(ai.json().codex.detail,/Отключено/);
  const ok=await post(s.port,'/api/start',start,auth);assert.equal(ok.status,200);assert.equal(ok.json().control.mode,'free');
  await s.coordinator.wait();const state=(await call(s.port,{path:'/api/state',headers:auth})).json();assert.equal(state.control.phase,'Завершено');assert.ok(state.market.tick>=5);assert.equal(state.control.calls,0);
 }finally{await s.close();}
});

test('long crowd-only runs are allowed, long model runs are not',()=>{
 assert.equal(C.settings({mode:'free',gpt:0,claude:0,crowd:100,minutes:1440,tickSeconds:10}).minutes,1440);
 assert.throws(()=>C.settings({mode:'free',gpt:0,claude:0,crowd:100,minutes:1441,tickSeconds:10}));
 assert.throws(()=>C.settings({mode:'free',gpt:1,claude:0,crowd:100,minutes:181,tickSeconds:10}));
});
