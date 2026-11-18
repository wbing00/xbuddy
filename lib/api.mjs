import {action,benchmarks,createThread,problem,registry,step,subjects} from './harness.mjs';

const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const MAX_LEASE=90000;
async function input(request){
  if(!request.headers.get('content-type')?.includes('application/json'))throw problem('需要 JSON 请求',415);
  const raw=await request.text();if(raw.length>4096)throw problem('内容过长',413);
  try{const v=JSON.parse(raw||'{}');if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{throw problem('JSON 格式无效');}
}
function summary(t){const {id,title,mode,status,updatedAt,createdAt,symbol,benchmark,days,goal}=t;return {id,title,mode,status,updatedAt,createdAt,symbol,benchmark,days,goal};}
function view(t){const {lease,...rest}=t;return rest;}
function followup(t,q){
  const facts=t.report?.facts||[];const c=t.evidence.find(x=>x.id==='C1');
  if(/建议|买|卖|预测|目标价/.test(q))return {answer:'当前简报只核查历史数据。交易建议和预测超出了研究范围。',refs:[]};
  if(/样本|分母|覆盖|成分|普涨/.test(q))return {answer:'这条线程查询的是指数收盘点位。没有成分股明细，也没有普涨率分母，无法核查上涨覆盖面。',refs:c?['E1','E2']:[]};
  if(/时点|窗口|交易日|多少天|起止|日期/.test(q)&&c)return {answer:'区间从 '+c.raw.start+' 到 '+c.raw.end+'，共 '+t.days+' 个收益间隔，包含期初在内有 '+(t.days+1)+' 个收盘点位。',refs:['E1','E2','C1']};
  const key=/回撤|风险|跌幅/.test(q)?'回撤':/前一|上期|上一/.test(q)?'前一':/收益|比较|基准|相对/.test(q)?'百分点':null;
  const match=key&&facts.find(f=>f.text.includes(key));
  return match?{answer:match.text,refs:match.refs}:{answer:'现有证据无法回答这个问题。可以追问区间收益、回撤、样本范围或上一窗口。',refs:[]};
}
export async function api(request,env,store){
  const path=new URL(request.url).pathname;
  try{
    if(request.method==='POST'&&request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw problem('请求来源无效',403);
    const prefsKey='preferences',prefs=(await store.get(prefsKey))?.value||{benchmark:'000300.SH',days:5};
    if(path==='/api/meta'&&request.method==='GET')return json({subjects,benchmarks,modes:['demo','live'],preferences:prefs,registry});
    if(path==='/api/threads'&&request.method==='GET'){
      const threads=(await store.list('thread/')).map(summary).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));return json({threads});
    }
    if(path==='/api/threads'&&request.method==='POST'){
      const v=await input(request);const t=createThread(v);t.revision=1;
      if(!(await store.put('thread/'+t.id,t,null)))throw problem('创建冲突',409);
      if(v.remember===true)await store.put(prefsKey,{benchmark:t.benchmark,days:t.days});
      return json(view(t),201);
    }
    const m=path.match(/^\/api\/threads\/([a-f0-9-]{36})(?:\/(\w+))?$/);
    if(!m)throw problem('页面或工具不存在',404);
    const key='thread/'+m[1],entry=await store.get(key);if(!entry)throw problem('线程不存在',404);
    const t=entry.value;
    if(!m[2]&&request.method==='GET')return json(view(t));
    if(request.method!=='POST')throw problem('请求方式不支持',405);
    const v=await input(request);
    if(m[2]==='followup'){if(!String(v.question||'').trim())throw problem('请输入问题');return json(followup(t,String(v.question)));}
    if(t.lease&&t.lease.until>Date.now())throw problem('当前工具仍在执行，稍后可继续',409);
    if(v.revision!==undefined&&v.revision!==t.revision)throw problem('线程已更新，请读取最新检查点',409);
    if(m[2]==='step'){
      if(t.status!=='running')throw problem('线程未在运行',409);
      t.lease={until:Date.now()+MAX_LEASE};const locked=await store.put(key,t,entry.tag);
      if(!locked)throw problem('线程正由另一窗口执行',409);
      await step(t,env);delete t.lease;t.revision++;t.updatedAt=new Date().toISOString();
      if(!await store.put(key,t,locked))throw problem('执行权已更新，请刷新',409);
    }else{
      action(t,m[2]);delete t.lease;t.revision++;
      if(!await store.put(key,t,entry.tag))throw problem('线程已更新',409);
    }
    return json(view(t));
  }catch(e){return json({error:e.status?e.message:'服务暂时不可用，请稍后再试。'},e.status||503);}
}
