import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../lib/api.mjs';
const payload={goal:'比较白酒概念的表现，核查前一期是否延续',mode:'live',symbol:'886042.TI',benchmark:'000300.SH',days:20,remember:true};
function client(env={}){
  const rows=new Map();let tag=0;
  const store={async get(k){return structuredClone(rows.get(k));},async list(p){return [...rows].filter(([k])=>k.startsWith(p)).map(([,v])=>v.value);},async put(k,value,expected){
    if(expected!==undefined&&(rows.get(k)?.tag??null)!==expected)return null;
    rows.set(k,{value:structuredClone(value),tag:String(++tag)});return String(tag);}};
  async function call(path,body){
    const r=await api(new Request('https://test.invalid/api/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,store);
    return [r.status,await r.json()];
  }
  return {call,env,store};
}
// Network boundary only: the tests run the same calendar and price adapters as the product.
function marketEnv(){
  return {FUYAO_API_KEY:'test-only',DEEPSEEK_API_KEY:'test-only',async fetch(input,options){
    if(new URL(input).hostname==='api.deepseek.com'){
      const plan=JSON.parse(options.body).messages[0].content.includes('"supported"');
      const content=JSON.stringify(plan?{supported:true,focus:'relative'}:{next:'extend'});
      return Response.json({model:'test',choices:[{finish_reason:'stop',message:{content}}]});
    }
    const url=new URL(input),params=url.searchParams;
    const calendar=url.pathname.endsWith('/trading-days');
    const dateParam=name=>Date.parse(params.get(name).replace(/^(....)(..)(..)$/,'$1-$2-$3')+'T00:00:00+08:00');
    const start=calendar?dateParam('start_date'):Number(params.get('start'));
    const end=calendar?dateParam('end_date'):Number(params.get('end'));
    const item=[];
    for(let ms=start;ms<=end;ms+=86400000){
      const d=new Date(ms+8*3600000);
      if([0,6].includes(d.getUTCDay()))continue;
      const date=d.toISOString().slice(0,10).replaceAll('-','');
      item.push(calendar?{date}:{date_ms:ms,close_price:100+ms/8640000000});
    }
    return Response.json({code:0,data:{item},request_id:'test-request'});
  }};
}
test('reviewer flow checkpoints, resumes, asks approval, cites reproducible numbers and recalls preferences',async()=>{
  const {call}=client(marketEnv());let [s,t]=await call('threads',payload);assert.equal(s,201);const path='threads/'+t.id;
  async function go(a){[s,t]=await call(path+'/'+a,{revision:t.revision});assert.equal(s,200);}
  await go('step');await go('step');const first=t.evidence[0];await go('stop');
  assert.equal((await call(path))[1].status,'paused');await go('resume');
  assert.deepEqual(t.evidence[0],first);await go('step');await go('step');await go('step');
  assert.equal(t.status,'approval');assert.equal(t.evidence.length,3);assert.equal(t.metrics.calls,4);
  await go('approve');await go('step');await go('step');assert.equal(t.status,'complete');
  assert.equal(t.evidence.length,6);assert.equal(t.metrics.calls,6);
  const c=t.evidence.find(e=>e.id==='C1').raw;assert.equal(c.series.length,21);
  assert.equal(t.evidence.find(e=>e.id==='C2').raw.end,c.start);
  for(const f of t.report.facts)for(const id of f.refs)assert.ok(t.evidence.some(e=>e.id===id));
  assert.deepEqual((await call('meta'))[1].preferences,{benchmark:payload.benchmark,days:20});
  assert.equal(first.raw.requestId,'test-request');
});
test('a failed live query never substitutes synthetic data; retry limit and partial report are enforced',async()=>{
  const env=marketEnv(); delete env.FUYAO_API_KEY;
  const {call}=client(env);let t=(await call('threads',{...payload,mode:'live'}))[1];const path='threads/'+t.id;
  const go=async a=>(t=(await call(path+'/'+a,{revision:t.revision}))[1]);
  await go('step');assert.equal(t.tasks[0].status,'done');
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
  assert.equal((await call('threads',{...payload,goal:'核查沪深300最近的表现',symbol:payload.benchmark}))[0],400);
});
test('skipping optional expansion preserves the original research scope and data',async()=>{
  const {call}=client(marketEnv());let t=(await call('threads',payload))[1],url='threads/'+t.id;
  for(const act of ['step','step','step','step','step','skip','step'])t=(await call(url+'/'+act,{revision:t.revision}))[1];
  assert.equal(t.status,'complete');assert.equal(t.metrics.calls,4);assert.equal(t.report.facts.length,2);
});

test('live follow-ups use thread evidence and retain context; invalid citations fail',async()=>{
  const {call,env,store}=client();
  const [,thread]=await call('threads',{...payload,mode:'live'});
  thread.report={facts:[],title:'历史复盘'};
  thread.status='complete';
  thread.evidence=[{id:'E1',raw:{points:[{date:'2025-03-21',close:100}]}}];
  const path='threads/'+thread.id;
  await store.put('thread/'+thread.id,thread);
  env.DEEPSEEK_API_KEY='test-only';
  const contexts=[];
  let ref='E1';
  env.fetch=async(_url,options)=>{
    contexts.push(JSON.parse(JSON.parse(options.body).messages[1].content));
    const content=JSON.stringify({status:'answered',answer:'该点位来自收盘序列。',refs:[ref]});
    return Response.json({model:'test-model',usage:{total_tokens:12},choices:[{finish_reason:'stop',message:{content}}]});
  };
  assert.equal((await call(path+'/followup',{question:'这条曲线最左端代表什么？'}))[0],200);
  assert.deepEqual(contexts[0].evidence,thread.evidence);
  ref='E999';
  assert.equal((await call(path+'/followup',{question:'那个点的依据呢？'}))[0],502);
  assert.equal(contexts[1].history.length,1);
  const [,saved]=await call(path);
  assert.equal(saved.followups.length,1);
  assert.equal(saved.metrics.calls,2);
});

test('production API only offers real data and rejects explicit fixture requests',async()=>{
  const {call}=client({});
  assert.deepEqual((await call('meta'))[1].modes,['live']);
  assert.equal((await call('threads',{...payload,mode:'demo'}))[0],400);
  const [status,thread]=await call('threads',{...payload,mode:'live'});
  assert.equal(status,201);
  assert.equal(thread.mode,'live');
});

test('archived sample threads are excluded from the workspace and cannot be resumed',async()=>{
  const {call,store}=client();
  const id=crypto.randomUUID();
  await store.put('thread/'+id,{id,mode:'demo',status:'running'});
  assert.deepEqual((await call('threads'))[1].threads,[]);
  assert.equal((await call('threads/'+id))[0],410);
  assert.equal((await call('threads/'+id+'/step',{}))[0],410);
});

test('free text determines the research subject before any market query',async()=>{
  const {call}=client(marketEnv());
  const [s,error]=await call('threads',{...payload,goal:'分析黄金最近的表现'});
  assert.equal(s,400);
  assert.match(error.error,/黄金/);
  assert.equal((await call('threads'))[1].threads.length,0);
  const [,t]=await call('threads',{...payload,goal:'分析上证指数最近的表现'});
  assert.equal(t.symbol,'000001.SH');
  const path='threads/'+t.id+'/step';
  await call(path,{});
  const [,next]=await call(path,{});
  assert.equal(next.evidence[0].raw.symbol,'000001.SH');
});
test('planner failure cannot advance to a market query for an unconfirmed target',async()=>{
  const {call}=client();
  const [,t]=await call('threads',{...payload,goal:'分析原油最近的表现'});
  const [,next]=await call('threads/'+t.id+'/step',{});
  assert.equal(next.status,'failed');
  assert.equal(next.evidence.length,0);
});
