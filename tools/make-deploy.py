"""Builds ./deploy: only the files Railway needs. orbit/runtime (state, logs) is never copied."""
import json, os, shutil
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src=os.path.join(root,'orbit'); dst=os.path.join(root,'deploy')
files=['coordinator.js','agent-cli.js','engine.js','chart.js','app.js','live.js','state-store.js','index.html','style.css']
if os.path.exists(dst): shutil.rmtree(dst)
os.makedirs(dst)
for f in files: shutil.copy(os.path.join(src,f),os.path.join(dst,f))
def write(name,obj): open(os.path.join(dst,name),'w',encoding='utf8',newline='\n').write(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
write('package.json',{"name":"orbit-exchange","version":"0.3.0","private":True,"description":"ORBIT: fictional perpetual-futures exchange for trading bots","engines":{"node":">=20"},"scripts":{"start":"node coordinator.js"}})
write('railway.json',{"$schema":"https://railway.com/railway.schema.json","deploy":{"startCommand":"node coordinator.js","healthcheckPath":"/health","healthcheckTimeout":60,"restartPolicyType":"ON_FAILURE","restartPolicyMaxRetries":5}})
open(os.path.join(dst,'.gitignore'),'w',newline='\n').write('runtime/\nnode_modules/\n')
print('deploy:',sorted(os.listdir(dst)))
