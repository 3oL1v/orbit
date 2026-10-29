const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const C=require('../orbit/coordinator.js');
const TOKEN='correct-horse-battery';
const call=(port,{method='GET',path='/',headers={},body}={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,method,path,headers},res=>{let t='';res.on('data',d=>t+=d);res.on('end',()=>resolve({status:res.statusCode,text:t,json:()=>JSON.parse(t)}));});req.on('error',reject);req.end(body);});
const basic=p=>({Authorization:'Basic '+Buffer.from('w:'+p).toString('base64')});
async function boot(cfg,opts){const coordinator=C.createCoordinator({load:false,secondMs:5,...opts}),server=C.createServer(coordinator,cfg);await new Promise(r=>server.listen(0,'127.0.0.1',r));cfg.port=server.address().port;return {coordinator,server,port:cfg.port,close:()=>new Promise(r=>server.close(r))};}

test('readConfig: ORBIT_OPEN allows a public bind, but an executor channel without a password is refused',()=>{
 const cfg=C.readConfig({ORBIT_HOST:'0.0.0.0',ORBIT_OPEN:'1',ORBIT_TOKEN:TOKEN,ORBIT_MODELS:'remote'});assert.equal(cfg.open,true);assert.equal(cfg.remote,true);
 assert.equal(C.readConfig({ORBIT_HOST:'0.0.0.0',ORBIT_OPEN:'1',ORBIT_MODELS:'off'}).open,true);
 assert.throws(()=>C.readConfig({ORBIT_HOST:'0.0.0.0',ORBIT_OPEN:'1',ORBIT_MODELS:'remote'}),/ORBIT_TOKEN/);
 assert.throws(()=>C.readConfig({ORBIT_HOST:'0.0.0.0'}),/ORBIT_OPEN/);
 assert.equal(C.readConfig({ORBIT_HOST:'0.0.0.0',ORBIT_TOKEN:TOKEN}).open,false);
});

test('open mode: the site and the crowd need no password, the executor channel still does',async()=>{
 const cfg={host:'0.0.0.0',port:0,token:TOKEN,local:false,open:true,models:true,remote:true},s=await boot(cfg,{models:true,remote:true});
 try{
  for(const path of ['/','/app.js','/api/state','/api/auth','/health'])assert.equal((await call(s.port,{path})).status,200,path);
  assert.match((await call(s.port,{path:'/'})).text,/"open":true/);
  const post=(path,obj,headers={})=>call(s.port,{method:'POST',path,body:JSON.stringify(obj),headers:{'Content-Type':'application/json','X-Orbit-Request':'1',Origin:`http://127.0.0.1:${s.port}`,...headers}});
  // Browser calls still need the same Origin as the page (cross-site requests are refused), but no password.
  assert.equal((await post('/api/start',{mode:'free',gpt:0,claude:0,crowd:20,minutes:1,tickSeconds:5},{Origin:'https://evil.example'})).status,403);
  const run=await post('/api/start',{mode:'free',gpt:0,claude:0,crowd:20,minutes:1,tickSeconds:5});assert.equal(run.status,200);await s.coordinator.wait();assert.ok(s.coordinator.snapshot().market.tick>=5);
  // Model runs are refused while no executor is connected, so a stranger cannot spend anything.
  const models=await post('/api/start',{mode:'rounds',gpt:1,claude:1,rounds:1});assert.equal(models.status,400);assert.match(models.json().error,/исполнитель не подключён/i);
  // The executor channel stays protected: no password, wrong password and missing header are all refused.
  const poll={method:'POST',path:'/api/worker/poll',body:'{}'};
  assert.equal((await call(s.port,poll)).status,401);
  assert.equal((await call(s.port,{...poll,headers:{...basic('wrong-password'),'X-Orbit-Worker':'1'}})).status,401);
  assert.equal((await call(s.port,{...poll,headers:basic(TOKEN)})).status,403);
  assert.equal((await call(s.port,{...poll,headers:{...basic(TOKEN),'X-Orbit-Worker':'1','Content-Type':'application/json'}})).status,200);
 }finally{await s.close();}
});

test('open mode: wrong executor passwords are throttled, and ordinary visitors are never counted',async()=>{
 const cfg={host:'0.0.0.0',port:0,token:TOKEN,local:false,open:true,models:true,remote:true},s=await boot(cfg,{models:true,remote:true});
 try{
  for(let i=0;i<20;i++)assert.equal((await call(s.port,{path:'/api/state'})).status,200);
  const poll={method:'POST',path:'/api/worker/poll',body:'{}'};
  for(let i=0;i<5;i++)assert.equal((await call(s.port,{...poll,headers:{...basic('bad-'+i),'X-Orbit-Worker':'1'}})).status,401);
  assert.equal((await call(s.port,{...poll,headers:{...basic(TOKEN),'X-Orbit-Worker':'1'}})).status,429);
  assert.equal((await call(s.port,{path:'/api/state'})).status,200,'the site itself stays reachable while the executor channel is locked');
 }finally{await s.close();}
});
