/* Local executor for a cloud exchange. Runs on your computer, uses your Codex and Claude Code sign-ins, and talks to the server only
   over HTTPS: it takes prompts from a queue and returns the models' answers. A job never contains a command line: this file always
   starts the CLIs itself with the fixed flags from agent-cli.js, for the two pinned models only. */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cli=require('./agent-cli.js');
const PROMPT_LIMIT=300000,sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function execute(job,{run=cli.runProcess,signal}={}){
 if(!job||!['GPT','Claude'].includes(job.provider))throw Error('Недопустимое семейство модели в задании.');
 const model=job.provider==='GPT'?cli.PINNED.codexModel:cli.PINNED.claudeModel;
 if(job.model!==model)throw Error(`Недопустимая модель ${String(job.model).slice(0,60)}: разрешена только ${model}.`);
 if(typeof job.prompt!=='string'||!job.prompt||job.prompt.length>PROMPT_LIMIT)throw Error('Недопустимый текст запроса.');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-job-'));
 try{
  const schemaFile=path.join(dir,'schema.json'),outputFile=path.join(dir,'last.json');fs.writeFileSync(schemaFile,JSON.stringify(cli.schema));
  const result=await run(job.provider==='GPT'?'codex':'claude',cli.buildArgs(job.provider,{model,schemaFile,outputFile}),{cwd:dir,input:job.prompt,timeout:Math.min(120000,Number(job.timeout)||120000),signal});
  return {code:result.code,out:result.out,err:result.err,overflow:!!result.overflow,lastMessage:job.provider==='GPT'&&fs.existsSync(outputFile)?fs.readFileSync(outputFile,'utf8'):null};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

function startWorker({url,token,run=cli.runProcess,authFn=cli.authentication,fetchFn=fetch,log=()=>{},slots=10}){
 const base=String(url).replace(/\/+$/,''),headers={Authorization:'Basic '+Buffer.from('worker:'+token).toString('base64'),'Content-Type':'application/json','X-Orbit-Worker':'1'};
 const running=new Map();let stopped=false,auth=null,authAt=0;
 const post=async(route,body,ms=40000)=>{const r=await fetchFn(base+route,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(ms)}),text=await r.text();let json={};try{json=JSON.parse(text);}catch{}if(!r.ok)throw Object.assign(Error(json.error||'HTTP '+r.status),{status:r.status});return json;};
 async function refreshAuth(){if(auth&&Date.now()-authAt<300000)return;try{auth=await authFn();}catch(error){auth={codex:{ok:false,detail:error.message},claude:{ok:false,detail:error.message}};}authAt=Date.now();log(`Вход: GPT ${auth.codex.ok?'✓':'✗ '+auth.codex.detail}, Claude ${auth.claude.ok?'✓':'✗ '+auth.claude.detail}`);}
 const providers=()=>[...(auth?.codex?.ok?['GPT']:[]),...(auth?.claude?.ok?['Claude']:[])];
 async function handle(job){const ac=new AbortController();running.set(job.id,ac);let payload;
  try{payload={id:job.id,...await execute(job,{run,signal:ac.signal})};}catch(error){payload={id:job.id,error:error.message};}finally{running.delete(job.id);}
  if(ac.signal.aborted)return;// cancelled by the server or by stop(): nothing to report
  log(`Ответ готов: ${job.provider}${payload.error?' · ошибка: '+payload.error:''}`);
  try{await post('/api/worker/result',payload,60000);}catch(error){log('Не удалось отправить ответ: '+error.message);}}
 async function loop(){let delay=1000,online=false;
  while(!stopped){try{await refreshAuth();const r=await post('/api/worker/poll',{auth,providers:providers(),free:slots-running.size});if(!online){online=true;log('Подключено к бирже.');}delay=1000;
    for(const id of r.cancel||[])running.get(id)?.abort();for(const job of r.jobs||[]){log(`Задание: ${job.provider}`);handle(job);}}
   catch(error){online=false;if(stopped)break;if(error.status===401||error.status===403){log('Сервер не принял доступ. Проверьте адрес и пароль.');await sleep(10000);}else{log(`Нет связи (${error.message}). Повтор через ${delay/1000} с.`);await sleep(delay);delay=Math.min(delay*2,15000);}}}}
 const done=loop();
 return {done,running,stop(){stopped=true;for(const ac of running.values())ac.abort();}};
}

module.exports={execute,startWorker};

if(require.main===module){
 const url=process.env.ORBIT_URL,token=process.env.ORBIT_TOKEN;
 if(!url||!token){console.error('Задайте переменные окружения ORBIT_URL (адрес биржи) и ORBIT_TOKEN (пароль) или запустите «Запустить исполнителя моделей.cmd».');process.exit(1);}
 const stamp=()=>new Date().toLocaleTimeString('ru-RU');
 console.log(`ORBIT: локальный исполнитель моделей\nБиржа: ${url}\nМодели: ${cli.PINNED.codexModel} (Codex), ${cli.PINNED.claudeModel} (Claude Code)\nОкно должно оставаться открытым. Остановка: Ctrl+C.\n`);
 const w=startWorker({url,token,log:message=>console.log(`[${stamp()}] ${message}`)});
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{w.stop();setTimeout(()=>process.exit(0),500).unref();});
}
