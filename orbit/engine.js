(function(root){
const specs=[
 {symbol:'NOVA',name:'Nova Compute',sector:'Вычислительная мощность',price:128.40,vol:.012,color:'#8da9ff',icon:'✳',description:'Рынок вычислений. Умеренный риск, чувствительность к технологическому спросу.'},
 {symbol:'FLUX',name:'Flux Energy',sector:'Энергия',price:42.75,vol:.009,color:'#f2bd70',icon:'ϟ',description:'Энергетический актив. Более спокойные колебания и глубокая ликвидность.'},
 {symbol:'AQUA',name:'Aqua Reserve',sector:'Водные резервы',price:8.62,vol:.006,color:'#61c7d4',icon:'≈',description:'Защитный ресурс. Самая низкая волатильность в этом эксперименте.'},
 {symbol:'ORE',name:'Orbit Minerals',sector:'Редкие минералы',price:316.80,vol:.015,color:'#c8a1e8',icon:'◈',description:'Дефицитный ресурс. Высокая цена единицы и повышенные колебания.'},
 {symbol:'MIME',name:'Mime Network',sector:'Спекулятивный актив',price:.0842,vol:.027,color:'#ee94b0',icon:'〰',description:'Спекулятивная монета. Максимальный риск, низкая доступная глубина.'}
];
const TAKER=.0005,MAKER=.0002,MAINT=.05,LIQ_FEE=.005,TTL=3,FUND_EVERY=4,BAND=.05,DEPTH=8,FEE_RESERVE=TAKER*1.1,RESERVE_GAP=.002,RESERVE_SIZE=[1.5,3];
const quiet=a=>a.family==='Crowd';
const PREMIUM_W=.3,PREMIUM_CAP=.03,TRADES=300,CANDLES=160;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x)),dust=(x,of)=>x<=of*1e-9,candle=(t,p)=>({t,o:p,h:p,l:p,c:p,v:0,buy:0,sell:0});
function create(){const s={version:3,trades:[],crowd:{active:0,seed:918273},seed:74129,tick:0,fees:0,lp:1000000,insurance:5000,badDebt:0,halted:false,seq:0,funding:{every:FUND_EVERY,next:FUND_EVERY},markets:specs.map(s=>({...s,initial:s.price,history:[s.price],volume:0,last:s.price,fundingRate:0,index:s.price,premium:0,premSum:0,premN:0,candles:[],candle:candle(0,s.price),flow:{qty:0,notional:0}})),accounts:[{id:'you',name:'Ваш портфель',cash:10000,positions:[],orders:[],fundingPaid:0,realized:0},...Array.from({length:10},(_,i)=>({id:'bot'+i,name:['Atlas','Vega','Kepler','Lyra','Zenith','Echo','Sage','Prism','Pulse','Rook'][i],family:i<5?'GPT':'Claude',cash:10000,positions:[],orders:[],fundingPaid:0,realized:0}))],books:[],events:[]};requoteAll(s);return s;}
// Version 1 snapshots had one stateless artificial book and no funding; version 2 had mark equal to the index and no candles.
// Positions and cash always carry over unchanged; candles are rebuilt from the stored mark history.
function migrate(s){if(s.version>=3)return s;
 if(s.version<2){s.version=2;s.badDebt=0;s.seq=0;s.funding={every:FUND_EVERY,next:(Math.floor(s.tick/FUND_EVERY)+1)*FUND_EVERY};for(const m of s.markets){m.last=m.price;m.fundingRate=0;}for(const a of s.accounts){a.orders=[];a.fundingPaid=0;for(const p of a.positions)p.funding=0;}}
 s.version=3;s.trades=[];for(const m of s.markets){const h=m.history;m.index=m.price;m.premium=0;m.premSum=0;m.premN=0;m.candles=h.slice(1).map((c,k)=>({t:s.tick-h.length+1+k,o:h[k],h:Math.max(h[k],c),l:Math.min(h[k],c),c,i:c,v:0,buy:0,sell:0}));m.candle=candle(s.tick,m.price);m.flow={qty:0,notional:0};}
 s.books=[];requoteAll(s);return s;}
function random(s){s.seed=(Math.imul(1664525,s.seed)+1013904223)>>>0;return s.seed/4294967296;}
function equity(s,a){return a.cash+a.positions.reduce((sum,p)=>sum+p.margin+pnl(s,p),0)+a.orders.reduce((sum,o)=>sum+o.reserve,0);}
function pnl(s,p){return (s.markets[p.market].price-p.entry)*p.qty*p.side;}
function liqPrice(p){return p.side===1?(p.entry*p.qty-p.margin)/(p.qty*(1-MAINT)):(p.margin+p.entry*p.qty)/(p.qty*(1+MAINT));}
function stats(s,i){const price=s.markets[i].price;let long=0,short=0;for(const a of s.accounts)for(const p of a.positions)if(p.market===i){if(p.side===1)long+=p.qty*price;else short+=p.qty*price;}return {long,short,net:long-short};}
// The book belongs to the agents. The liquidity provider keeps only a thin reserve around the external index, acting as the
// arbitrageur that pulls the exchange back to it; it is also the clearing counterparty and leans the reserve against net open interest.
function requote(s,i){const m=s.markets[i],unit=1000/(m.index*(i===4?3:1)),mid=m.index*(1+clamp(stats(s,i).net/20000*.002,-.003,.003)),levels=dir=>RESERVE_SIZE.map((size,k)=>({price:mid*(1+dir*RESERVE_GAP*(k+1)),qty:unit*size}));s.books[i]={asks:levels(1),bids:levels(-1)};}
// ---------- Crowd: cheap programmatic traders with their own random stream, so the external index never depends on them.
const KINDS=[['maker-bid','Маркет-мейкер · покупка'],['maker-ask','Маркет-мейкер · продажа'],['trend','Трендовый'],['contrarian','Контртрендовый'],['noise','Шумовой'],['arb','Арбитражёр премии']];
function crand(s){s.crowd.seed=(Math.imul(1664525,s.crowd.seed)+1013904223)>>>0;return s.crowd.seed/4294967296;}
// Accounts are only ever added, never removed: a smaller number just leaves the extra bots idle with their positions intact.
function setCrowd(s,n){s.crowd=s.crowd||{active:0,seed:918273};let have=s.accounts.filter(quiet).length;while(have<n){const k=have++,r=()=>crand(s);s.accounts.push({id:'crowd'+k,name:'Бот '+String(k+1).padStart(3,'0'),family:'Crowd',kind:KINDS[k%KINDS.length][0],act:.1+r()*.3,hold:2+Math.floor(r()*8),take:.002+r()*.01,stop:.003+r()*.012,edge:.0004+r()*.0014,thr:.002+r()*.006,size:40+r()*220,lev:1+Math.floor(r()*3),fav:r()<.4?Math.floor(r()*s.markets.length):-1,cash:10000,positions:[],orders:[],fundingPaid:0,realized:0});}s.crowd.active=n;return s;}
function crowdStep(s){const crowd=s.accounts.filter(quiet).slice(0,s.crowd.active);if(!crowd.length)return;const off=s.tick%crowd.length;
 for(let n=0;n<crowd.length;n++){const a=crowd[(n+off)%crowd.length];
  for(const p of [...a.positions]){const mk=s.markets[p.market],ret=(mk.price/p.entry-1)*p.side;if(ret>=a.take||ret<=-a.stop||s.tick-(p.opened??s.tick)>=a.hold)close(s,a.id,p.market);}
  if(a.positions.length>=2||a.orders.length>=2||crand(s)>a.act)continue;
  const i=a.fav>=0&&crand(s)<.6?a.fav:Math.floor(crand(s)*s.markets.length),mk=s.markets[i];
  if(a.positions.some(p=>p.market===i)||a.orders.some(o=>o.market===i))continue;
  const h=mk.history,mv=mk.price/h[Math.max(0,h.length-7)]-1,margin=a.size*(.5+crand(s));let side,price=null;
  if(a.kind==='maker-bid'){side=1;price=mk.price*(1-a.edge);}
  else if(a.kind==='maker-ask'){side=-1;price=mk.price*(1+a.edge);}
  else if(a.kind==='trend'){if(Math.abs(mv)<a.thr)continue;side=Math.sign(mv);if(crand(s)<.5)price=mk.price*(1-side*a.edge);}
  else if(a.kind==='contrarian'){if(Math.abs(mv)<a.thr*1.5)continue;side=-Math.sign(mv);price=mk.price*(1-side*a.edge*.5);}
  else if(a.kind==='noise'){side=crand(s)<.5?1:-1;if(crand(s)<.5)price=mk.price*(1-side*a.edge*crand(s)*2);}
  else{if(Math.abs(mk.premium)<.0008)continue;side=mk.premium>0?-1:1;}
  if(a.cash<margin*1.15)continue;
  open(s,a.id,i,side,Math.max(10,margin),a.lev,price==null?{}:{type:'limit',price});}}
function requoteAll(s){for(let i=0;i<s.markets.length;i++)requote(s,i);}
// One shared book: liquidity-provider levels plus resting agent orders. Price-time priority; agents beat the provider at equal prices.
function entries(s,i,name){const sellers=name==='asks',list=s.books[i][name].filter(l=>l.qty>1e-12).map(l=>({kind:'lp',price:l.price,qty:l.qty,level:l}));for(const a of s.accounts)for(const o of a.orders)if(o.market===i&&o.side===(sellers?-1:1)&&o.left>0)list.push({kind:'agent',price:o.price,qty:o.left,order:o,account:a,seq:o.seq});return list.sort((x,y)=>(sellers?x.price-y.price:y.price-x.price)||(x.kind==='lp')-(y.kind==='lp')||(x.seq||0)-(y.seq||0));}
function book(s,i,viewer){const out={};for(const name of ['asks','bids']){const levels=[];for(const e of entries(s,i,name)){const key=Number(e.price.toPrecision(8));let l=levels.find(x=>x.key===key);if(!l){if(levels.length===DEPTH)break;l={key,price:e.price,qty:0,agents:0,mine:0,reserve:0,owners:[]};levels.push(l);}l.qty+=e.qty;if(e.kind==='agent'){l.agents+=e.qty;if(quiet(e.account))l.crowd=(l.crowd||0)+1;else if(!l.owners.includes(e.account.name))l.owners.push(e.account.name);if(e.account.id===viewer)l.mine+=e.qty;}else l.reserve+=e.qty;}out[name]=levels.map(({key,...l})=>({...l,owners:l.crowd?[...l.owners,`Толпа ×${l.crowd}`]:l.owners}));}return out;}
function event(s,text,type='trade'){s.events.unshift({tick:s.tick,text,type});s.events=s.events.slice(0,200);}
function sweep(s,i,takerSide,want,limit,takerId){const fills=[];let left=want,notional=0;for(const e of entries(s,i,takerSide===1?'asks':'bids')){if(left<=0)break;if(e.kind==='agent'&&e.account.id===takerId)continue;if(limit!=null&&(takerSide===1?e.price>limit:e.price<limit))break;const q=Math.min(left,e.qty);if(q<=1e-12)continue;fills.push({e,price:e.price,qty:q});notional+=q*e.price;left-=q;}return {fills,filled:want-left,left,notional};}
function fillOrder(s,a,o,qty,price,rate){const unit=o.price/o.leverage+o.price*FEE_RESERVE,margin=qty*o.price/o.leverage,fee=qty*price*rate;o.reserve-=qty*unit;o.left-=qty;a.cash+=qty*unit-margin-fee;s.fees+=fee;let p=a.positions.find(p=>p.market===o.market);if(!p){p={market:o.market,side:o.side,qty:0,entry:0,margin:0,leverage:o.leverage,funding:0,opened:s.tick};a.positions.push(p);}p.entry=(p.entry*p.qty+price*qty)/(p.qty+qty);p.qty+=qty;p.margin+=margin;if(dust(o.left,o.qty)){a.cash+=o.reserve;o.reserve=0;o.left=0;a.orders=a.orders.filter(x=>x!==o);}}
function print(s,i,price,qty,side,taker,maker){const m=s.markets[i],c=m.candle,n=price*qty;m.volume+=n;m.last=price;m.flow.qty+=qty;m.flow.notional+=n;c.h=Math.max(c.h,price);c.l=Math.min(c.l,price);c.v+=n;if(side===1)c.buy+=n;else c.sell+=n;s.trades.unshift({tick:s.tick,market:i,price,qty,side,taker,maker});if(s.trades.length>TRADES)s.trades.length=TRADES;}
function consume(s,i,fills,taker,who){const m=s.markets[i];for(const f of fills){if(f.e.kind==='lp')f.e.level.qty-=f.qty;else{fillOrder(s,f.e.account,f.e.order,f.qty,f.price,MAKER);if(!quiet(f.e.account))event(s,`${f.e.account.name}: заявка ${m.symbol} исполнена · ${f.qty.toFixed(4)} по ${f.price.toFixed(4)}`);}if(taker)fillOrder(s,taker.account,taker.order,f.qty,f.price,TAKER);print(s,i,f.price,f.qty,who.side,who.name,f.e.kind==='lp'?'резерв':f.e.account.name);}}
function open(s,id,index,side,margin,leverage,opts={}){
 const a=s.accounts.find(a=>a.id===id),m=s.markets[index],limit=opts.type==='limit';
 if(s.halted||!a||!m||![1,-1].includes(side)||!Number.isFinite(margin)||margin<10||![1,2,3].includes(leverage))return {ok:false,error:'Проверьте параметры заявки. Минимальная маржа — 10 U.'};
 if(a.positions.some(p=>p.market===index))return {ok:false,error:'Сначала закройте существующую позицию по этому активу.'};
 if(a.orders.some(o=>o.market===index))return {ok:false,error:'Сначала отмените активную заявку по этому активу.'};
 if(limit)return place(s,a,index,side,margin,leverage,opts.price);
 const target=margin*leverage/m.price,r=sweep(s,index,side,target,null,id);
 if(!dust(r.left,target))return {ok:false,error:'Недостаточно глубины стакана. Уменьшите маржу или плечо.'};
 const total=r.notional,fee=total*TAKER,entry=total/target,required=total/leverage;
 if(required+fee>a.cash)return {ok:false,error:'Недостаточно свободных средств с учётом комиссии и проскальзывания.'};
 const p={market:index,side,qty:target,entry,margin:required,leverage,funding:0,opened:s.tick};
 if(required+pnl(s,p)<=total*MAINT)return {ok:false,error:'Недостаточный запас маржи.'};
 consume(s,index,r.fills,null,{name:a.name,side});a.cash-=required+fee;a.positions.push(p);s.fees+=fee;if(!quiet(a))event(s,`${a.name}: ${side===1?'лонг':'шорт'} ${m.symbol} · ${leverage}× · ${total.toFixed(0)} U`);return {ok:true,filled:target,resting:0};}
// Limit order: margin and worst-case fee are reserved up front, the crossing part takes liquidity, the rest rests for TTL ticks.
function place(s,a,index,side,margin,leverage,price){
 const m=s.markets[index];
 if(!Number.isFinite(price)||price<=0||Math.abs(price/m.price-1)>BAND)return {ok:false,error:'Лимитная цена должна быть в пределах 5% от mark.'};
 const qty=margin*leverage/price,reserve=qty*(price/leverage+price*FEE_RESERVE);
 if(reserve>a.cash)return {ok:false,error:'Недостаточно свободных средств для резерва заявки.'};
 a.cash-=reserve;const o={id:++s.seq,seq:s.seq,market:index,side,price,qty,left:qty,leverage,reserve,placed:s.tick,expires:s.tick+TTL};
 const r=sweep(s,index,side,qty,price,a.id);a.orders.push(o);consume(s,index,r.fills,{account:a,order:o},{name:a.name,side});
 const resting=a.orders.includes(o)?o.left:0;if(!quiet(a))event(s,`${a.name}: лимит ${side===1?'покупка':'продажа'} ${m.symbol} · ${price.toFixed(4)} · ${leverage}×${resting?` · в стакане ${resting.toFixed(4)}`:''}`);return {ok:true,filled:qty-resting,resting};}
function cancel(s,id,index,note='отменена'){const a=s.accounts.find(a=>a.id===id),o=a?.orders.find(o=>o.market===index);if(!o)return {ok:false,error:'Активной заявки по этому активу нет.'};a.cash+=o.reserve;a.orders=a.orders.filter(x=>x!==o);if(!quiet(a))event(s,`${a.name}: заявка ${s.markets[index].symbol} ${note}, резерв возвращён`);return {ok:true};}
// Closing and liquidation take liquidity from the book, so a thin book can close a position only partially.
function close(s,id,index,liquidation=false){const a=s.accounts.find(a=>a.id===id),p=a?.positions.find(p=>p.market===index);if(!p)return {ok:false};
 const r=sweep(s,index,-p.side,p.qty,null,id);if(dust(r.filled,p.qty))return {ok:false,error:'В стакане нет ликвидности для закрытия.'};
 const q=r.filled,part=p.margin*q/p.qty,profit=(r.notional/q-p.entry)*q*p.side,fee=r.notional*TAKER,penalty=liquidation?Math.min(r.notional*LIQ_FEE,Math.max(0,part+profit-fee)):0,net=part+profit-fee-penalty,deficit=Math.max(0,-net);
 if(s.lp-profit<0){s.halted=true;event(s,'Расчёты остановлены: недостаточно средств контрагента.','risk');return {ok:false};}
 consume(s,index,r.fills,null,{name:a.name,side:-p.side});s.lp-=profit;s.fees+=fee;s.insurance+=penalty;const covered=Math.min(s.insurance,deficit);s.insurance-=covered;
 if(deficit>covered){s.badDebt+=deficit-covered;event(s,`Страховой фонд исчерпан: безнадёжный долг ${(deficit-covered).toFixed(2)} U`,'risk');}
 a.cash+=Math.max(0,net);a.realized+=profit-fee-penalty;p.qty-=q;p.margin-=part;const done=dust(p.qty,q+p.qty);if(done)a.positions=a.positions.filter(x=>x!==p);else p.liquidating=liquidation;
 if(liquidation||!quiet(a))event(s,`${liquidation?'Ликвидация':'Закрытие'}: ${a.name} · ${s.markets[index].symbol} · ${profit>=0?'+':''}${profit.toFixed(2)} U${done?'':' · частично, остаток '+p.qty.toFixed(4)}`,liquidation?'risk':'trade');return {ok:true,closed:q,remaining:done?0:p.qty};}
function expire(s){for(const a of s.accounts)for(const o of [...a.orders])if(o.expires<=s.tick)cancel(s,a.id,o.market,'истекла');}
// A price move can put the new provider quotes through a resting order; it then trades at its own limit as maker.
function crossResting(s){const orders=s.accounts.flatMap(a=>a.orders.map(o=>({a,o}))).sort((x,y)=>x.o.seq-y.o.seq);for(const {a,o} of orders){const buy=o.side===1,levels=s.books[o.market][buy?'asks':'bids'];for(const l of levels){if(o.left<=0||(buy?l.price>o.price:l.price<o.price))break;const q=Math.min(o.left,l.qty);if(q<=0)continue;l.qty-=q;fillOrder(s,a,o,q,o.price,MAKER);print(s,o.market,o.price,q,-o.side,'резерв',a.name);if(!quiet(a))event(s,`${a.name}: заявка ${s.markets[o.market].symbol} исполнена при движении цены · ${q.toFixed(4)} по ${o.price.toFixed(4)}`);}}}
// Funding as on real perpetuals: the average premium of the exchange over the index plus base interest, capped per interval.
// A premium means longs pay shorts, which rewards whoever brings the exchange back to the index.
function funding(s){for(let i=0;i<s.markets.length;i++){const m=s.markets[i],st=stats(s,i),oi=st.long+st.short,rate=clamp((m.premN?m.premSum/m.premN:0)+.00005,-.002,.002);m.premSum=0;m.premN=0;m.fundingRate=rate;if(!oi)continue;for(const a of s.accounts)for(const p of a.positions)if(p.market===i){const pay=p.side*p.qty*m.price*rate;p.margin-=pay;p.funding=(p.funding||0)+pay;a.fundingPaid+=pay;s.lp+=pay;}event(s,`Funding ${m.symbol}: ${(rate*100).toFixed(4)}% · ${rate>=0?'лонги платят шортам':'шорты платят лонгам'}`,'funding');}s.funding.next=s.tick+s.funding.every;}
// Where the exchange traded relative to the index during the tick that just ended: trade VWAP and the agents' own mid, if both exist.
function basis(s,i){const m=s.markets[i],ask=entries(s,i,'asks').find(e=>e.kind==='agent'),bid=entries(s,i,'bids').find(e=>e.kind==='agent'),samples=[];if(m.flow.qty>0)samples.push(m.flow.notional/m.flow.qty);if(ask&&bid)samples.push((ask.price+bid.price)/2);return samples.length?clamp(samples.reduce((a,b)=>a+b)/samples.length/m.index-1,-.05,.05):0;}
// Index = external random process (like spot prices on other venues). Mark = index × (1 + smoothed premium); the premium comes
// from the agents' trades and quotes and decays to zero when nobody trades, so mark follows the bots but stays anchored.
function step(s,demo=true){if(s.halted)return;const samples=s.markets.map((m,i)=>basis(s,i));s.tick++;const common=(random(s)-.5)*.008;
 s.markets.forEach((m,i)=>{m.index=Math.max(m.initial*.01,m.index*Math.exp(common+(random(s)-.5)*m.vol));m.premium=clamp(m.premium*(1-PREMIUM_W)+samples[i]*PREMIUM_W,-PREMIUM_CAP,PREMIUM_CAP);m.premSum+=m.premium;m.premN++;m.price=m.index*(1+m.premium);m.history.push(m.price);if(m.history.length>CANDLES)m.history.shift();
  const c=m.candle;c.c=m.price;c.i=m.index;c.h=Math.max(c.h,c.c);c.l=Math.min(c.l,c.c);m.candles.push(c);if(m.candles.length>CANDLES)m.candles.shift();m.candle=candle(s.tick,m.price);m.flow={qty:0,notional:0};});
 expire(s);requoteAll(s);crossResting(s);if(s.tick>=s.funding.next)funding(s);
 for(const a of s.accounts)for(const p of [...a.positions])if(p.margin+pnl(s,p)<=s.markets[p.market].price*p.qty*MAINT){const r=close(s,a.id,p.market,true);if(r.error)event(s,`Ликвидация ${a.name} · ${s.markets[p.market].symbol} ждёт ликвидности`,'risk');}
 if(s.crowd?.active&&!s.halted)crowdStep(s);
 if(s.halted||!demo)return;
 for(let i=1;i<s.accounts.length;i++){const a=s.accounts[i];if(random(s)>.24)continue;if(a.positions.length&&random(s)<.45){close(s,a.id,a.positions[0].market);continue;}if(a.orders.length&&random(s)<.3){cancel(s,a.id,a.orders[0].market);continue;}const index=Math.floor(random(s)*5),m=s.markets[index],h=m.history;const trend=m.price-h[Math.max(0,h.length-6)];let side=random(s)>.5?1:-1;if(i%3===0)side=trend>=0?1:-1;if(i%3===1)side=trend>=0?-1:1;
 // Demo traders mostly quote passively near the index, so the book is built from their orders.
 const margin=100+random(s)*250,leverage=1+(i%3);if(random(s)<.7)open(s,a.id,index,side,margin,leverage,{type:'limit',price:m.price*(1-side*random(s)*.004)});else open(s,a.id,index,side,margin,leverage);}
}
const constants={TAKER,MAKER,MAINT,LIQ_FEE,TTL,FUND_EVERY,BAND,DEPTH,RESERVE_GAP,PREMIUM_W,PREMIUM_CAP};
const api={specs,create,migrate,setCrowd,KINDS,requoteAll,random,equity,pnl,book,open,close,cancel,step,event,stats,liqPrice,constants};if(typeof module!=='undefined')module.exports=api;root.OrbitEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
