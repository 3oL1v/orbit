/* Price chart, order book, depth and trade tape for the selected market.
   Uses globals from app.js at call time: state, selected, range, fmt, price, qty, signed, bots. */
let chartType='candles',bookTab='book',hoverX=null,geo=null;
const overlays={index:true,trades:true,orders:true};
const COL={grid:'#161d2a',axis:'#8a95a8',up:'#2fd39a',down:'#ff6b81',upFill:'rgba(47,211,154,.85)',downFill:'rgba(255,107,129,.85)',index:'#c7cfdc',agent:'#7c9cff',bg:'#07090d'};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const deal=t=>`${esc(t.taker)} ${t.side===1?'купил у':'продал'} ${esc(t.maker)} ${qty(t.qty)} по ${price(t.price)}`;
// Closed candles plus the one still forming in the current tick (its close is the live mark).
function candlesFor(m){const live={...m.candle,c:m.price,i:m.index,h:Math.max(m.candle.h,m.price),l:Math.min(m.candle.l,m.price),live:true};return [...m.candles,live].slice(-range);}

function renderChart(){
 const el=$('#chart'),m=state.markets[selected];if(!m.candle)return;
 const W=Math.max(300,el.clientWidth),H=Math.max(220,el.clientHeight),cs=candlesFor(m),n=cs.length,t0=cs[0].t;
 const L=6,R=76,T=10,AX=22,VOL=Math.round(H*.17),G=10,PH=H-T-AX-VOL-G,w=W-L-R,step=w/n,bw=Math.max(1,Math.min(16,step*.64)),cx=k=>L+step*(k+.5),VY=T+PH+G;
 const trades=overlays.trades?state.trades.filter(x=>x.market===selected&&x.tick>=t0):[];
 const orders=overlays.orders?models().flatMap(a=>a.orders.filter(o=>o.market===selected).map(o=>({a,o}))):[];
 const prices=cs.flatMap(c=>[c.h,c.l]).concat(overlays.index?cs.map(c=>c.i??c.c):[],trades.map(x=>x.price),orders.map(x=>x.o.price));
 let lo=Math.min(...prices),hi=Math.max(...prices);const pad=Math.max((hi-lo)*.08,m.price*.002);lo-=pad;hi+=pad;
 const y=p=>T+(hi-p)/(hi-lo)*PH,f=v=>v.toFixed(1),vmax=Math.max(0,...cs.map(c=>c.v));
 let grid='';
 for(let k=0;k<5;k++){const v=lo+(hi-lo)*k/4,yy=y(v);grid+=`<line x1="${L}" x2="${L+w}" y1="${f(yy)}" y2="${f(yy)}" stroke="${COL.grid}"/><text x="${L+w+8}" y="${f(yy+4)}" fill="${COL.axis}" font-size="11">${price(v)}</text>`;}
 const marks=Math.min(6,n);for(let k=0;k<marks;k++){const idx=Math.round((n-1)*k/Math.max(1,marks-1)),xx=cx(idx);grid+=`<line x1="${f(xx)}" x2="${f(xx)}" y1="${T}" y2="${VY+VOL}" stroke="${COL.grid}" stroke-dasharray="2 4"/><text x="${f(xx)}" y="${H-6}" fill="${COL.axis}" font-size="11" text-anchor="middle">${cs[idx].t}</text>`;}
 // Volume pane: buy-initiated volume green at the bottom, sell-initiated red on top.
 let vol=`<line x1="${L}" x2="${L+w}" y1="${VY+VOL}" y2="${VY+VOL}" stroke="${COL.grid}"/>`;
 if(vmax>0){cs.forEach((c,k)=>{if(!c.v)return;const hb=c.buy/vmax*VOL,hs=c.sell/vmax*VOL,x0=f(cx(k)-bw/2);vol+=`<rect x="${x0}" y="${f(VY+VOL-hb)}" width="${f(bw)}" height="${f(hb)}" fill="${COL.up}" opacity=".55"/><rect x="${x0}" y="${f(VY+VOL-hb-hs)}" width="${f(bw)}" height="${f(hs)}" fill="${COL.down}" opacity=".55"/>`;});vol+=`<text x="${L+w+8}" y="${VY+11}" fill="${COL.axis}" font-size="10">${fmt(vmax,0)} U</text>`;}
 else vol+=`<text x="${f(L+w/2)}" y="${f(VY+VOL/2+4)}" fill="${COL.axis}" font-size="11" text-anchor="middle">В этом окне сделок не было</text>`;
 let body='';
 if(chartType==='candles')cs.forEach((c,k)=>{const up=c.c>=c.o,col=up?COL.up:COL.down,x=cx(k),yo=y(c.o),yc=y(c.c);body+=`<line x1="${f(x)}" x2="${f(x)}" y1="${f(y(c.h))}" y2="${f(y(c.l))}" stroke="${col}"/><rect x="${f(x-bw/2)}" y="${f(Math.min(yo,yc))}" width="${f(bw)}" height="${f(Math.max(1,Math.abs(yc-yo)))}" fill="${up?COL.upFill:COL.downFill}"${c.live?' opacity=".55"':''}/>`;});
 else{const pts=cs.map((c,k)=>`${f(cx(k))},${f(y(c.c))}`).join(' ');body=`<defs><linearGradient id="lf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.color}" stop-opacity=".25"/><stop offset="1" stop-color="${m.color}" stop-opacity="0"/></linearGradient></defs><polygon points="${f(cx(0))},${T+PH} ${pts} ${f(cx(n-1))},${T+PH}" fill="url(#lf)"/><polyline points="${pts}" fill="none" stroke="${m.color}" stroke-width="2" stroke-linejoin="round"/>`;}
 const indexLine=overlays.index?`<polyline points="${cs.map((c,k)=>`${f(cx(k))},${f(y(c.i??c.c))}`).join(' ')}" fill="none" stroke="${COL.index}" stroke-width="1.3" stroke-dasharray="4 4" opacity=".7"/>`:'';
 // Resting bot orders: a dashed level from the tick it was placed, labelled with the owner.
 const levels=orders.map(({a,o})=>{const yy=f(y(o.price)),col=o.side===1?COL.up:COL.down;return `<line x1="${f(cx(Math.max(0,o.placed-t0)))}" x2="${L+w}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-dasharray="6 3" opacity=".8"/><text x="${L+w-4}" y="${+yy-4}" fill="${col}" font-size="10" text-anchor="end">${esc(a.name)} · ${o.side===1?'покупка':'продажа'} ${qty(o.left)}</text>`;}).join('');
 const tmax=Math.max(1,...trades.map(x=>x.price*x.qty));
 const prints=trades.map(x=>{const k=x.tick-t0;if(k<0||k>=n)return '';const xx=cx(k),yy=y(x.price),r=3+Math.sqrt(x.price*x.qty/tmax)*4,pts=x.side===1?`${f(xx)},${f(yy-r)} ${f(xx-r)},${f(yy+r*.8)} ${f(xx+r)},${f(yy+r*.8)}`:`${f(xx)},${f(yy+r)} ${f(xx-r)},${f(yy-r*.8)} ${f(xx+r)},${f(yy-r*.8)}`;return `<polygon points="${pts}" fill="${x.side===1?COL.up:COL.down}" stroke="${COL.bg}"><title>Такт ${x.tick}: ${deal(x)}</title></polygon>`;}).join('');
 const tag=(yy,txt,bg,fg)=>`<rect x="${L+w+3}" y="${f(yy-10)}" width="${R-5}" height="20" rx="4" fill="${bg}"/><text x="${L+w+8}" y="${f(yy+4)}" fill="${fg}" font-size="11" font-weight="600">${txt}</text>`,mY=y(m.price);
 let axis=`<line x1="${L}" x2="${L+w}" y1="${f(mY)}" y2="${f(mY)}" stroke="${m.color}" stroke-dasharray="2 3" opacity=".7"/>`+tag(mY,price(m.price),m.color,COL.bg);
 if(overlays.index&&Math.abs(y(m.index)-mY)>20)axis+=tag(y(m.index),price(m.index),'#2a3346',COL.index);
 el.innerHTML=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${grid}${vol}${indexLine}${body}${levels}${prints}${axis}<line id="xhair" x1="0" x2="0" y1="${T}" y2="${VY+VOL}" stroke="#5f6a7d" stroke-dasharray="3 3" visibility="hidden"/></svg><div id="chart-tip" class="chart-tip" hidden></div>`;
 geo={L,T,W,step,n,cs,trades:state.trades.filter(x=>x.market===selected&&x.tick>=t0)};if(hoverX!=null)hover(hoverX);
}
function hover(mx){if(!geo)return;const tip=$('#chart-tip'),line=$('#xhair'),k=Math.floor((mx-geo.L)/geo.step);if(k<0||k>=geo.n){tip.hidden=true;line.setAttribute('visibility','hidden');return;}
 const c=geo.cs[k],x=geo.L+geo.step*(k+.5),tr=geo.trades.filter(t=>t.tick===c.t),ch=(c.c/c.o-1)*100;line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('visibility','visible');
 tip.innerHTML=`<b>Такт ${c.t}${c.live?' · формируется':''}</b><span>Открытие ${price(c.o)}</span><span>Макс. ${price(c.h)} · мин. ${price(c.l)}</span><span>Закрытие ${price(c.c)} <i class="${ch>=0?'up':'down'}">${ch>=0?'+':''}${ch.toFixed(2)}%</i></span><span>Индекс ${price(c.i??c.c)}</span><span>Объём ${fmt(c.v,0)} U · сделок ${tr.length}</span>${tr.slice(0,3).map(t=>`<small>${deal(t)}</small>`).join('')}`;
 tip.hidden=false;const tw=tip.offsetWidth;tip.style.left=(x+14+tw>geo.W?x-14-tw:x+14)+'px';tip.style.top=geo.T+6+'px';}

// Book rows name the bots behind each price; provider reserve rows are dimmed so the agents' book reads first.
function renderBook(){const m=state.markets[selected],book=E.book(state,selected),all=[...book.asks,...book.bids],max=Math.max(1,...all.map(l=>l.qty*l.price)),row=(l,buy)=>{const who=l.owners.length?l.owners.join(', ')+(l.reserve?' + резерв':''):'резерв поставщика';return `<div class="book-row ${l.agents>0?'agents':'reserve'}" style="--depth:${Math.max(4,l.qty*l.price/max*100).toFixed(1)}%;--tint:${buy?'rgba(47,211,154,.13)':'rgba(255,107,129,.13)'}" title="${esc(who)} · ${fmt(l.qty*l.price,0)} U"><span class="${buy?'up':'down'}">${price(l.price)}</span><span>${qty(l.qty)}</span><span class="who">${esc(who)}</span></div>`;};
 $('#asks').innerHTML=[...book.asks].reverse().map(l=>row(l,false)).join('');$('#bids').innerHTML=book.bids.map(l=>row(l,true)).join('');$('#book-price').textContent=price(m.price);
 $('#spread').textContent=book.asks[0]&&book.bids[0]?'Спред '+((book.asks[0].price/book.bids[0].price-1)*100).toFixed(2)+'%':'Нет встречных заявок';$('#book-index').textContent=`индекс ${price(m.index)} · премия ${(m.premium*100).toFixed(3)}%`;
 const count=bots().reduce((n,a)=>n+a.orders.filter(o=>o.market===selected).length,0);$('#book-count').textContent=count?`Заявок ботов: ${count}`:'Заявок ботов нет';
 if(bookTab==='depth')renderDepth();if(bookTab==='tape')renderTape();}

// Cumulative depth: how much notional sits on each side up to a given price.
function renderDepth(){const el=$('#depth');if(!el.clientWidth)return;const m=state.markets[selected],b=E.book(state,selected),W=el.clientWidth,H=Math.max(180,el.clientHeight),L=8,R=8,T=14,B=24,f=v=>v.toFixed(1);
 const cum=ls=>{let s=0;return ls.map(l=>({p:l.price,v:s+=l.qty*l.price,owners:l.owners,agents:l.agents}));},bids=cum(b.bids),asks=cum(b.asks);
 if(!bids.length&&!asks.length){el.innerHTML='<p class="muted pad">Стакан пуст</p>';$('#depth-stats').innerHTML='';return;}
 const ps=[...bids,...asks].map(x=>x.p).concat(m.price,m.index),lo=Math.min(...ps),hi=Math.max(...ps),pad=(hi-lo)*.05||m.price*.001,x=p=>L+(p-lo+pad)/(hi-lo+2*pad)*(W-L-R),vmax=Math.max(1,...bids.map(q=>q.v),...asks.map(q=>q.v)),y=v=>T+(1-v/vmax)*(H-T-B);
 const side=(pts,edge,col)=>{if(!pts.length)return '';let d=`M${f(x(pts[0].p))},${f(y(0))}`,prev=0;for(const q of pts){d+=` L${f(x(q.p))},${f(y(prev))} L${f(x(q.p))},${f(y(q.v))}`;prev=q.v;}d+=` L${edge},${f(y(prev))} L${edge},${f(y(0))} Z`;return `<path d="${d}" fill="${col}" fill-opacity=".16" stroke="${col}" stroke-width="1.5"/>`;};
 const dots=[...bids.map(q=>({...q,col:COL.up})),...asks.map(q=>({...q,col:COL.down}))].filter(q=>q.agents>0).map(q=>`<circle cx="${f(x(q.p))}" cy="${f(y(q.v))}" r="4" fill="${COL.agent}" stroke="${COL.bg}" stroke-width="1.5"><title>${esc(q.owners.join(', '))} · ${price(q.p)}</title></circle>`).join('');
 const vline=(p,col,dash,label,anchor,dy=0)=>`<line x1="${f(x(p))}" x2="${f(x(p))}" y1="${T}" y2="${H-B}" stroke="${col}" ${dash?'stroke-dasharray="3 3"':''} opacity=".8"/><text x="${f(x(p))}" y="${T-3+dy}" fill="${col}" font-size="10" text-anchor="${anchor}">${label}</text>`;
 el.innerHTML=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" stroke="${COL.grid}"/>${side(bids,L,COL.up)}${side(asks,W-R,COL.down)}${vline(m.price,m.color,false,'mark','end')}${vline(m.index,COL.index,true,'индекс','start',14)}${dots}<text x="${L}" y="${H-7}" fill="${COL.axis}" font-size="10">${price(lo)}</text><text x="${W-R}" y="${H-7}" fill="${COL.axis}" font-size="10" text-anchor="end">${price(hi)}</text><text x="${L+2}" y="${T+10}" fill="${COL.axis}" font-size="10">${fmt(vmax,0)} U</text></svg>`;
 const sum=ls=>ls.length?ls[ls.length-1].v:0,agentU=[...b.bids,...b.asks].reduce((s,l)=>s+l.agents*l.price,0),totalU=sum(bids)+sum(asks);
 $('#depth-stats').innerHTML=`<div><span>Лучший bid</span><strong class="up">${b.bids[0]?price(b.bids[0].price):'—'}</strong></div><div><span>Лучший ask</span><strong class="down">${b.asks[0]?price(b.asks[0].price):'—'}</strong></div><div><span>Глубина bid / ask</span><strong>${fmt(sum(bids),0)} / ${fmt(sum(asks),0)} U</strong></div><div><span>Доля ботов</span><strong>${totalU?(agentU/totalU*100).toFixed(1):'0.0'}%</strong></div>`;}

function renderTape(){const list=state.trades.filter(t=>t.market===selected).slice(0,80);
 $('#tape').innerHTML=list.length?list.map(t=>`<div class="tape-row" title="${deal(t)}"><span>${t.tick}</span><span class="${t.side===1?'up':'down'}">${price(t.price)}</span><span>${t.qty>=1000?fmt(t.qty,0):qty(t.qty)}</span><span class="who">${esc(t.taker)} → ${esc(t.maker)}</span></div>`).join(''):'<div class="empty"><strong>Сделок пока нет</strong><p>Здесь появятся все сделки по активу: цена, объём, инициатор и встречная сторона.</p></div>';}

function setBookTab(tab){bookTab=tab;for(const name of ['book','depth','tape'])$('#tab-'+name).hidden=name!==tab;document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('selected',b.dataset.tab===tab);b.setAttribute('aria-selected',b.dataset.tab===tab);});if(tab==='depth')renderDepth();if(tab==='tape')renderTape();}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.tab)setBookTab(b.dataset.tab);
 if(b.dataset.ctype){chartType=b.dataset.ctype;document.querySelectorAll('[data-ctype]').forEach(x=>x.classList.toggle('selected',x===b));renderChart();}
 if(b.dataset.overlay){const k=b.dataset.overlay;overlays[k]=!overlays[k];b.classList.toggle('on',overlays[k]);b.setAttribute('aria-pressed',overlays[k]);renderChart();}});
// This file loads before app.js, so setup uses the DOM API directly instead of app.js's $ helper.
const chartEl=document.getElementById('chart');
chartEl.addEventListener('mousemove',e=>{hoverX=e.clientX-chartEl.getBoundingClientRect().left;hover(hoverX);});
chartEl.addEventListener('mouseleave',()=>{hoverX=null;document.getElementById('chart-tip').hidden=true;document.getElementById('xhair')?.setAttribute('visibility','hidden');});
if(window.ResizeObserver)new ResizeObserver(()=>{if(typeof state==='undefined'||!state)return;renderChart();if(bookTab==='depth')renderDepth();}).observe(chartEl);
