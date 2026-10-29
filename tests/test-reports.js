const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../orbit/coordinator.js');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const decision={action:'hold',market:'NOVA',side:'long',margin:10,leverage:1,orderType:'market',limitPrice:0,reason:'Нет сигнала на входе',memory:'м'};
const answer=d=>({code:0,out:JSON.stringify({subtype:'success',is_error:false,structured_output:d,modelUsage:{'claude-haiku-5-5':{}}}),err:''});
const auth=async()=>({codex:{ok:true},claude:{ok:true}});

test('a model card keeps its last decision while the next request is in flight, and counts decisions',async()=>{
 let n=0,release;const gate=new Promise(r=>release=r);
 const c=C.createCoordinator({load:false,auth,runner:async()=>{n++;if(n===2)await gate;return answer(decision);}});
 await c.start({gpt:0,claude:1,rounds:2});
 for(let i=0;i<200&&n<2;i++)await delay(5);assert.equal(n,2,'second request started');
 const mid=c.snapshot().reports.bot5;
 assert.equal(mid.status,'Думает');assert.equal(mid.thinking,true);assert.equal(mid.reason,decision.reason,'previous reason stays visible');assert.equal(mid.action,'hold');assert.equal(mid.meta.requestedModel,'claude-haiku-5-5');assert.equal(mid.count,1);assert.equal(mid.error,undefined);
 release();await c.wait();const end=c.snapshot().reports.bot5;assert.equal(end.count,2);assert.notEqual(end.status,'Думает');assert.equal(end.thinking,undefined);
});

test('an error keeps the last good decision next to the error message',async()=>{
 let n=0;const c=C.createCoordinator({load:false,auth,runner:async()=>{n++;return n===1?answer(decision):{code:1,out:JSON.stringify({result:'rate limit'}),err:''};}});
 await c.start({gpt:0,claude:1,rounds:2});await c.wait();const r=c.snapshot().reports.bot5;
 assert.equal(r.status,'Ошибка');assert.match(r.error,/CLI завершился/);assert.equal(r.reason,decision.reason);assert.equal(r.count,1);assert.equal(r.thinking,false);
});
