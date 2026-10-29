const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createStore,latest}=require('../orbit/state-store');
const temp=()=>fs.mkdtempSync(path.join(require('node:os').tmpdir(),'orbit-state-test-'));
test('Windows rename is never used, Unicode snapshots survive restart',()=>{const dir=temp(),store=createStore(dir,{io:{...fs,renameSync(){throw Object.assign(Error('EPERM'),{code:'EPERM'});}}});for(let i=0;i<40;i++)store.save({tick:i,note:'Сохранение состояния',padding:'т'.repeat(40000)});assert.deepEqual(createStore(dir).load(),{tick:39,note:'Сохранение состояния',padding:'т'.repeat(40000)});});
test('partial and corrupt last writes recover the last complete verified snapshot',()=>{const dir=temp(),store=createStore(dir);store.save({tick:1});store.save({tick:2});fs.appendFileSync(store.file,'\n{"format":1,"sha256":"wrong","payload":"{}"}\n{"broken":');assert.deepEqual(latest(store.file),{tick:2});store.save({tick:3});assert.deepEqual(createStore(dir).load(),{tick:3});});
test('existing state.json is migrated without replacing or renaming it',()=>{const dir=temp(),legacy=path.join(dir,'state.json');fs.writeFileSync(legacy,JSON.stringify({tick:7}));const store=createStore(dir);assert.equal(store.load().tick,7);store.save({tick:8});assert.equal(store.load().tick,8);assert.equal(JSON.parse(fs.readFileSync(legacy)).tick,7);});
test('transient EPERM opening journal is retried locally with no model requests',()=>{const dir=temp();let attempts=0;const store=createStore(dir,{io:{...fs,openSync(...args){if(attempts++<2)throw Object.assign(Error('locked'),{code:'EPERM'});return fs.openSync(...args);}}});store.save({tick:9});assert.equal(attempts,3);assert.equal(store.load().tick,9);});
test('failed append retains earlier completed checkpoint',()=>{const dir=temp();createStore(dir).save({tick:1});const store=createStore(dir,{io:{...fs,writeSync(fd,b,offset,length){fs.writeSync(fd,b,offset,Math.min(12,length));throw Object.assign(Error('disk failure'),{code:'EIO'});}}});assert.throws(()=>store.save({tick:2}));assert.equal(createStore(dir).load().tick,1);});

test('compact moves an oversized journal to archive and keeps the latest checkpoint readable, even after a crash between renames',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createStore}=require('../orbit/state-store.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-compact-'));const store=createStore(dir);for(let i=1;i<=5;i++)store.save({version:1,n:i,pad:'x'.repeat(2000)});
 assert.equal(store.compact(1e9),null);const before=fs.statSync(store.file).size;const archived=store.compact(1000);
 assert.ok(archived&&fs.existsSync(archived));assert.equal(fs.statSync(archived).size,before);assert.ok(fs.statSync(store.file).size<before/3);assert.equal(store.load().n,5);
 store.save({version:1,n:6,pad:''});assert.equal(createStore(dir).load().n,6);
 // Crash between the two renames: the journal is gone, only the synced .tmp remains.
 fs.renameSync(store.file,store.file+'.tmp');assert.equal(createStore(dir).load().n,6);
});
