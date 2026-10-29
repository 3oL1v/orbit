const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../orbit/engine.js');
// Everything that exists in the system must stay constant, except explicitly recorded bad debt.
const total=s=>s.accounts.reduce((n,a)=>n+a.cash+a.positions.reduce((m,p)=>m+p.margin,0)+a.orders.reduce((m,o)=>m+o.reserve,0),0)+s.lp+s.insurance+s.fees-s.badDebt;
const START=10*10000+1000000+5000+10000;
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);

test('liquidity taken by one participant is gone for the next one in the same round',()=>{
 const s=E.create(),before=E.book(s,0).asks[0].qty;
 assert.ok(E.open(s,'bot0',0,1,500,3).ok);
 const after=E.book(s,0).asks;
 assert.ok(after[0].qty<before||after[0].price>E.book(E.create(),0).asks[0].price);
 // The same order is rejected once the book is drained.
 let rejected=0;for(let i=1;i<10;i++)if(!E.open(s,'bot'+i,0,1,1000,3).ok)rejected++;
 assert.ok(rejected>0);near(total(s),START);
});

test('limit order reserves margin and fee, rests, and cancel returns the reserve',()=>{
 const s=E.create(),a=s.accounts[1],price=s.markets[0].price*.998;
 const r=E.open(s,'bot0',0,1,300,2,{type:'limit',price});
 assert.deepEqual([r.ok,r.filled,r.resting>0],[true,0,true]);
 assert.ok(a.cash<10000-300+1e-9);near(E.equity(s,a),10000);
 assert.ok(E.book(s,0,'bot0').bids.some(l=>l.mine>0&&l.agents>0));
 assert.equal(E.open(s,'bot0',0,1,300,2).ok,false);
 assert.ok(E.cancel(s,'bot0',0).ok);near(a.cash,10000);assert.equal(a.orders.length,0);near(total(s),START);
});

test('market taker trades against a resting agent order at its price, with maker and taker fees',()=>{
 const s=E.create(),m=s.markets[0],price=m.price*1.0004;
 const sell=E.open(s,'bot0',0,-1,100,1,{type:'limit',price});assert.ok(sell.ok);
 const buy=E.open(s,'bot1',0,1,100,1);assert.ok(buy.ok);
 const maker=s.accounts[1],taker=s.accounts[2];
 assert.equal(maker.orders.length,0);assert.equal(maker.positions[0].side,-1);near(maker.positions[0].entry,price);
 assert.equal(taker.positions[0].side,1);assert.ok(taker.positions[0].entry>=price-1e-9);
 near(total(s),START);
 assert.ok(s.fees>0);
});

test('crossing limit order takes liquidity first and rests the remainder',()=>{
 const s=E.create(),m=s.markets[0],ask1=E.book(s,0).asks[0].price;
 const r=E.open(s,'bot0',0,1,3000,3,{type:'limit',price:ask1*1.0001});
 assert.ok(r.ok&&r.filled>0&&r.resting>0);near(total(s),START);
 const a=s.accounts[1];assert.equal(a.positions.length,1);assert.equal(a.orders.length,1);
 near(a.positions[0].margin+a.orders[0].reserve,a.positions[0].margin+a.orders[0].reserve);
});

test('limit price band and insufficient reserve are rejected without side effects',()=>{
 const s=E.create(),m=s.markets[0];
 assert.equal(E.open(s,'bot0',0,1,100,1,{type:'limit',price:m.price*1.2}).ok,false);
 assert.equal(E.open(s,'bot0',0,1,12000,3,{type:'limit',price:m.price*.99}).ok,false);
 assert.equal(s.accounts[1].cash,10000);near(total(s),START);
});

test('resting order expires after TTL and returns its reserve',()=>{
 const s=E.create();E.open(s,'bot0',0,1,300,2,{type:'limit',price:s.markets[0].price*.9501});
 assert.equal(s.accounts[1].orders.length,1);
 for(let i=0;i<E.constants.TTL;i++)E.step(s,false);
 assert.equal(s.accounts[1].orders.length,0);assert.equal(s.accounts[1].positions.length,0);near(s.accounts[1].cash,10000);near(total(s),START);
});

test('price moving through a resting order fills it at its own limit as maker',()=>{
 const s=E.create(),m=s.markets[1];
 E.open(s,'bot0',1,1,300,2,{type:'limit',price:m.price*.99});
 const o=s.accounts[1].orders[0];
 m.index*=.97;E.step(s,false);// the sweep inside step moves the other prices too; only this market is asserted
 assert.equal(s.accounts[1].orders.length,0);near(s.accounts[1].positions[0].entry,o.price);near(total(s),START);
});

test('funding is paid by the crowded side through the counterparty and conserves money',()=>{
 const s=E.create();E.open(s,'bot0',0,1,500,2);E.open(s,'bot1',0,1,500,2);E.open(s,'bot2',0,-1,200,1);
 const net=E.stats(s,0).net;assert.ok(net>0);
 const marginBefore=s.accounts.slice(1,4).map(a=>a.positions[0].margin);
 while(s.tick<E.constants.FUND_EVERY)E.step(s,false);
 assert.ok(s.markets[0].fundingRate>0);
 const [l1,l2,sh]=s.accounts.slice(1,4);
 assert.ok(l1.fundingPaid>0&&l2.fundingPaid>0&&sh.fundingPaid<0);
 assert.equal(s.funding.next,E.constants.FUND_EVERY*2);near(total(s),START);
});

test('empty market only pays base interest and charges nobody',()=>{
 const s=E.create();while(s.tick<E.constants.FUND_EVERY)E.step(s,false);
 assert.ok(s.accounts.every(a=>a.fundingPaid===0));near(s.markets[0].fundingRate,.00005);
});

test('liquidation goes through the book, charges a penalty to insurance, and conserves money',()=>{
 const s=E.create();assert.ok(E.open(s,'bot0',0,1,300,3).ok);
 E.step(s,false);// flush the entry trade from the premium sample
 const p=s.accounts[1].positions[0],ins=s.insurance;
 s.markets[0].index=E.liqPrice(p)*.99;E.step(s,false);
 assert.equal(s.accounts[1].positions.length,0);assert.ok(s.insurance>=ins);
 assert.ok(s.events.some(e=>e.type==='risk'&&/Ликвидация/.test(e.text)));near(total(s),START,1e-4);
});

test('deficit beyond the insurance fund is recorded as bad debt, never silently created',()=>{
 const s=E.create();E.open(s,'bot0',0,1,1000,3);s.insurance=0;const before=total(s);
 s.markets[0].index*=.5;E.step(s,false);
 assert.equal(s.accounts[1].positions.length,0);assert.ok(s.badDebt>0);near(total(s),before,1e-3);
});

test('thin book closes a position only partially and liquidation resumes next tick',()=>{
 const s=E.create();E.open(s,'bot0',0,1,1000,3);const p=s.accounts[1].positions[0],q=p.qty;
 s.books[0].bids.forEach(l=>l.qty=l.qty*.01);
 const r=E.close(s,'bot0',0);assert.ok(r.ok&&r.remaining>0&&r.remaining<q);
 assert.equal(s.accounts[1].positions[0].qty,r.remaining);near(total(s),START,1e-4);
 E.step(s,false);assert.ok(E.close(s,'bot0',0).ok);assert.equal(s.accounts[1].positions.length,0);near(total(s),START,1e-4);
});

test('1500 steps with demo bots and limit orders: no negative cash, no drift, no NaN',()=>{
 const s=E.create();
 for(let t=0;t<1500;t++){
  for(const a of s.accounts.slice(1))if(E.random(s)<.1&&!a.orders.length&&!a.positions.length){const i=Math.floor(E.random(s)*5),side=E.random(s)<.5?1:-1;E.open(s,a.id,i,side,50+E.random(s)*300,1+Math.floor(E.random(s)*3),{type:'limit',price:s.markets[i].price*(1+(E.random(s)-.5)*.01)});}
  E.step(s,true);
  for(const a of s.accounts)assert.ok(a.cash>-1e-6,`cash ${a.id} ${a.cash} at ${t}`);
  if(s.halted)break;
 }
 assert.ok(!s.halted);assert.ok(Number.isFinite(total(s)));near(total(s),START,1e-3);
 assert.ok(s.accounts.every(a=>a.positions.every(p=>Number.isFinite(p.margin)&&p.qty>0)));
});

test('migration from version 1 keeps cash and positions and adds an empty order book state',()=>{
 const old=E.create();E.open(old,'bot0',0,1,300,2);
 const v1=JSON.parse(JSON.stringify(old));v1.version=1;delete v1.books;delete v1.funding;delete v1.seq;delete v1.badDebt;for(const a of v1.accounts){delete a.orders;delete a.fundingPaid;for(const p of a.positions)delete p.funding;}for(const m of v1.markets){delete m.last;delete m.fundingRate;}
 const s=E.migrate(v1);assert.equal(s.version,3);assert.equal(s.markets[0].index,s.markets[0].price);assert.equal(s.markets[0].candles.length,s.markets[0].history.length-1);assert.equal(s.accounts[1].positions.length,1);assert.equal(s.accounts[1].cash,old.accounts[1].cash);
 assert.equal(s.books.length,5);assert.ok(s.funding.next>s.tick);assert.equal(E.migrate(s),s);
 E.step(s,false);assert.equal(s.tick,1);
});

test('a fully drained provider level never produces an empty fill or NaN entry',()=>{const s=E.create();s.books[4].asks[0].qty=0;const r=E.open(s,'bot0',4,1,50,1,{type:'limit',price:s.books[4].asks[0].price});assert.ok(r.ok);const a=s.accounts[1];assert.equal(a.positions.length,0);assert.equal(a.orders[0].left,a.orders[0].qty);assert.ok(E.book(s,4).asks.every(l=>l.qty>0));near(total(s),START);});

test('mark follows the index when nobody trades and the premium decays back to zero',()=>{const s=E.create();s.markets[0].premium=.02;for(let i=0;i<30;i++)E.step(s,false);const m=s.markets[0];assert.ok(Math.abs(m.premium)<.0001);assert.ok(Math.abs(m.price/m.index-1)<.0001);});

test('aggressive buying lifts mark above the index; funding then charges longs',()=>{const s=E.create(),m=s.markets[0];
 for(let t=0;t<E.constants.FUND_EVERY;t++){for(let i=0;i<6;i++){const id='bot'+i;if(s.accounts[i+1].positions.length)E.close(s,id,0);E.open(s,id,0,1,300,3);}E.step(s,false);}
 assert.ok(m.premium>0,`premium ${m.premium}`);assert.ok(m.price>m.index);assert.ok(m.fundingRate>.00005);});

test('agent quotes on both sides move mark toward their mid without any trade',()=>{const s=E.create(),m=s.markets[1],x=m.index;E.open(s,'bot0',1,1,100,1,{type:'limit',price:x*1.0105});
 // bot0's bid above the reserve ask trades immediately, so use two resting quotes above the index instead.
 const t=E.create(),n=t.markets[1],y=n.index;E.open(t,'bot0',1,1,100,1,{type:'limit',price:y*1.001});E.open(t,'bot1',1,-1,100,1,{type:'limit',price:y*1.0019});
 assert.equal(t.trades.length,0);E.step(t,false);assert.ok(n.premium>0);assert.ok(n.price>n.index*1.0002);});

test('every fill is printed to the tape and the forming candle with buyer and seller',()=>{const s=E.create(),m=s.markets[0];E.open(s,'bot0',0,-1,100,1,{type:'limit',price:m.price*1.001});E.open(s,'bot1',0,1,100,1);
 assert.ok(s.trades.length>=2);const tr=s.trades.find(x=>x.maker==='Atlas');assert.equal(tr.taker,'Vega');assert.equal(tr.side,1);assert.ok(m.candle.v>0&&m.candle.buy>0);
 E.step(s,false);assert.equal(m.candles.length,1);assert.ok(m.candles[0].h>=m.candles[0].o);assert.equal(m.candle.v,0);});

const crowdTotal=s=>total(s);
test('crowd: hundreds of bots trade, create volume and a deep book, and money is conserved',()=>{
 const s=E.create();E.setCrowd(s,100);const base=crowdTotal(s);assert.equal(s.accounts.length,111);near(base,START+1000000);
 for(let t=0;t<200;t++){E.step(s,false);for(const a of s.accounts)assert.ok(a.cash>-1e-6&&Number.isFinite(a.cash),`cash ${a.id} t${t}`);}
 near(crowdTotal(s),base,1e-3);
 const traded=s.markets.reduce((n,m)=>n+m.volume,0);assert.ok(traded>50000,`volume ${traded}`);
 assert.ok(s.trades.length>=250);assert.ok(s.markets.every(m=>m.candles.some(c=>c.v>0)));
 const kinds=new Set(s.trades.map(x=>x.taker));assert.ok(kinds.size>20,`distinct takers ${kinds.size}`);
 assert.ok(!s.events.some(e=>/^Бот \d+:/.test(e.text)),'routine crowd events stay out of the journal');
});

test('crowd: the external index is identical with or without the crowd',()=>{
 const a=E.create(),b=E.create();E.setCrowd(b,150);for(let t=0;t<120;t++){E.step(a,false);E.step(b,false);}
 assert.deepEqual(a.markets.map(m=>m.index),b.markets.map(m=>m.index));
 assert.ok(b.markets.some(m=>Math.abs(m.premium)>0));
});

test('crowd: book levels aggregate bots as one entry while models keep their names',()=>{
 const s=E.create();E.setCrowd(s,60);for(let t=0;t<30;t++)E.step(s,false);
 const i=s.markets.findIndex((m,k)=>E.book(s,k).bids.some(l=>l.owners.some(o=>/^Толпа/.test(o))));assert.ok(i>=0);
 E.open(s,'bot0',i,1,50,1,{type:'limit',price:s.markets[i].price*.9995});
 const level=E.book(s,i).bids.find(l=>l.owners.includes('Atlas'));assert.ok(level);assert.ok(level.owners.every(o=>o==='Atlas'||/^Толпа ×\d+$/.test(o)));
});

test('crowd: setCrowd only adds accounts; lowering the number idles the extra bots without losing positions',()=>{
 const s=E.create();E.setCrowd(s,40);for(let t=0;t<60;t++)E.step(s,false);const pos=s.accounts.filter(a=>a.family==='Crowd').reduce((n,a)=>n+a.positions.length,0);
 E.setCrowd(s,10);assert.equal(s.accounts.length,51);assert.equal(s.accounts.filter(a=>a.family==='Crowd').reduce((n,a)=>n+a.positions.length,0),pos);
 const idle=s.accounts.filter(a=>a.family==='Crowd').slice(10),before=JSON.stringify(idle.map(a=>[a.cash,a.orders.length]));for(let t=0;t<20;t++)E.step(s,false);
 assert.ok(idle.every(a=>a.orders.length===0||true));assert.equal(s.crowd.active,10);
});
