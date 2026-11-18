import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../lib/api.mjs';
const payload={goal:'比较白酒概念的表现，核查前一期是否延续',mode:'demo',symbol:'886042.TI',benchmark:'000300.SH',days:20,remember:true};
function client(){
  const rows=new Map(),env={};let tag=0;
  const store={async get(k){return structuredClone(rows.get(k));},async list(p){return [...rows].filter(([k])=>k.startsWith(p)).map(([,v])=>v.value);},async put(k,value,expected){
    if(expected!==undefined&&(rows.get(k)?.tag??null)!==expected)return null;
    rows.set(k,{value:structuredClone(value),tag:String(++tag)});return String(tag);}};
  async function call(path,body){
    const r=await api(new Request('https://test.invalid/api/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,store);
    return [r.status,await r.json()];
  }
  return {call,env};
}
test('reviewer flow checkpoints, resumes, asks approval, cites reproducible numbers and recalls preferences',async()=>{
  const {call}=client();let [s,t]=await call('threads',payload);assert.equal(s,201);const path='threads/'+t.id;
  async function go(a){[s,t]=await call(path+'/'+a,{revision:t.revision});assert.equal(s,200);}
  await go('step');await go('step');const first=t.evidence[0];await go('stop');
  assert.equal((await call(path))[1].status,'paused');await go('resume');
  assert.deepEqual(t.evidence[0],first);await go('step');await go('step');await go('step');
  assert.equal(t.status,'approval');assert.equal(t.evidence.length,3);assert.equal(t.metrics.calls,2);
  await go('approve');await go('step');await go('step');assert.equal(t.status,'complete');
  assert.equal(t.evidence.length,6);assert.equal(t.metrics.calls,4);
  const c=t.evidence.find(e=>e.id==='C1').raw;assert.equal(c.series.length,21);
  assert.equal(t.evidence.find(e=>e.id==='C2').raw.end,c.start);
  for(const f of t.report.facts)for(const id of f.refs)assert.ok(t.evidence.some(e=>e.id===id));
  assert.deepEqual((await call('meta'))[1].preferences,{benchmark:payload.benchmark,days:20});
  assert.match((await call(path+'/followup',{question:'有多少个交易日？'}))[1].answer,/21 个收盘/);
});
test('a failed live query never substitutes synthetic data; retry limit and partial report are enforced',async()=>{
  const {call}=client();let t=(await call('threads',{...payload,mode:'live'}))[1];const path='threads/'+t.id;
  const go=async a=>(t=(await call(path+'/'+a,{revision:t.revision}))[1]);
  await go('step');assert.ok(t.events.some(e=>e.text.includes('模型规划不可用')));
  for(let i=0;i<3;i++){if(i)await go('retry');await go('step');assert.equal(t.status,'failed');}
  assert.equal((await call(path+'/retry',{}))[0],400);
  await go('finish');assert.equal(t.status,'partial');assert.deepEqual(t.report.facts,[]);assert.equal(t.evidence.length,0);
});
test('concurrent step cannot consume a checkpoint twice, stale revisions rejected',async()=>{
  const {call}=client();const t=(await call('threads',payload))[1],path='threads/'+t.id+'/step';
  const results=await Promise.all([call(path,{revision:1}),call(path,{revision:1})]);
  assert.deepEqual(results.map(x=>x[0]).sort(),[200,409]);assert.equal((await call(path,{revision:1}))[0],409);
});
test('trade directive terminates with zero external calls; invalid choices rejected',async()=>{
  const {call}=client();const t=(await call('threads',{...payload,goal:'告诉我该买哪只股票'}))[1];
  assert.equal(t.status,'partial');assert.equal(t.metrics.calls,0);
  assert.equal((await call('threads',{...payload,symbol:payload.benchmark}))[0],400);
});
test('skipping optional expansion preserves the original research scope and data',async()=>{
  const {call}=client();let t=(await call('threads',payload))[1],url='threads/'+t.id;
  for(const act of ['step','step','step','step','step','skip','step'])t=(await call(url+'/'+act,{revision:t.revision}))[1];
  assert.equal(t.status,'complete');assert.equal(t.metrics.calls,2);assert.equal(t.report.facts.length,2);
});
