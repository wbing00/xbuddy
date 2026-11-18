'use strict';

const byId = (id) => document.getElementById(id);
const main = byId('main');
const labels = { clarification:'等待澄清', running: '执行中', approval: '等待审批', paused: '已暂停', failed: '执行失败', partial: '阶段性完成', complete: '已完成', pending: '待执行', completed: '已完成', done: '已完成', waiting: '等待中', skipped: '已跳过', stopped: '已停止', active: '执行中', queued: '待执行', blocked:'待处理' };
const state = {meta:null, threads:[], thread:null, tab:'tasks', auto:false, timer:0, epoch:0, busy:false, stepping:false, pendingStop:false, chatDrafts:new Map(), fieldDraft:null, toastTimer:0};
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
const e = escapeHtml;
function formatDate(value, short=false) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',...(!short && {year:'numeric'}),hour:'2-digit',minute:'2-digit', hour12:false}).format(d);
}
function statusPill(status) {
  const mood = ({failed:'error',paused:'warn',approval:'warn',partial:'warn',running:'running'})[status] || '';
  return '<span class="pill '+mood+'">'+e(labels[status] || status || '未知')+'</span>';
}
function showNotice(message) {
  clearTimeout(state.toastTimer);
  const el = byId('notice');
  el.textContent= message; el.hidden=false;
  state.toastTimer=setTimeout(()=>el.hidden=true,6000);
}
async function request(path, body) {
  const options = {headers:{Accept:'application/json'},cache:'no-store'};
  if(body!==undefined){options.method='POST'; options.headers['Content-Type']='application/json'; options.body=JSON.stringify(body);}
  let res;
  try {res=await fetch('/api/'+path,options);}
  catch {throw new Error('无法连接工作台，请检查网络连接后重试。');}
  let data;
  try{data=await res.json();}catch{throw new Error('工作台返回了无法读取的响应（HTTP '+res.status+'）。');}
  if(!res.ok){const err=new Error(typeof data.error==='string' ? data.error : (data.message || '请求未完成（HTTP '+res.status+'）'));err.status=res.status;throw err;}
  return data;
}
function closeDrawer(){byId('rail').classList.remove('open');byId('menu').setAttribute('aria-expanded','false');byId('shade').hidden=true;}
function pageHeading(title, description='') {
  return '<div class="heading"><div><h1>'+e(title)+'</h1>'+(description ? '<p>'+e(description)+'</p>':'')+'</div></div>';
}
function showFatal(message) {
  main.innerHTML=pageHeading('研究工作台')+'<div class="box box-inner"><h3>工作区暂时无法打开</h3><p class="message error" role="alert">'+e(message)+'</p><button class="secondary" id="reload">重新载入</button></div>';
  byId('reload').onclick=()=>location.reload();
}
function threadLink(t){
  return '<button class="thread" data-thread="'+e(t.id)+'" aria-current="'+(state.thread?.id===t.id)+'"><span class="thread-icon" aria-hidden="true">▤</span><span class="title"><strong>'+e(t.title||t.goal)+'</strong><small>'+e(labels[t.status]||t.status)+' · '+e(formatDate(t.updatedAt,true))+'</small></span></button>';
}
function sidebar(){
  byId('thread-count').textContent=state.threads.length;
  byId('threads').innerHTML=state.threads.length ? state.threads.map(threadLink).join('') : '<p class="rail-empty">发起研究后，线程会保存在这里。</p>';
}
function saveThread(t){
  state.thread=t;
  state.threads= [t,...state.threads.filter(item=>item.id!==t.id)].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  sidebar();
}
function menuClick(id){const next=id ? '#thread/'+encodeURIComponent(id) : '#new'; if(location.hash===next){route();}else{location.hash=next;}}
function stopClock(){state.auto=false;clearTimeout(state.timer);}
function options(items,selected){return items.map(o=>'<option value="'+e(o.symbol)+'" '+(o.symbol===selected?'selected':'')+'>'+e(o.name)+' · '+e(o.symbol)+'</option>').join('');}
const examples=[
  '分析黄金最近的表现，先帮我明确适合的报价口径。',
  '比较上证综指和沪深300最近五个交易日的表现，哪个回撤更大？',
  '贵州茅台（600519.SH）最新行情和主力资金快照分别说明什么？'
];
function setTemplate(index){if(examples[index]){byId('goal').value=examples[index];byId('goal').focus();}}
function compose(){
  const draft=state.fieldDraft||{},prefs=state.meta.preferences;
  byId('breadcrumb').textContent='研究工作台';
  main.innerHTML=pageHeading('投资研究工作台','提出研究问题，查看调查过程与原始证据。')+
    '<div class="home-grid"><section class="box compose"><form class="form-body" id="composer">'+
    '<label class="field"><span>你想研究什么？</span><textarea id="goal" maxlength="500" required rows="4" placeholder="输入标的、想了解的问题或时间范围">'+e(draft.goal||'')+'</textarea></label>'+
    '<details><summary>默认研究偏好</summary><div class="fields"><label class="field">观察窗口<select id="days">'+[5,10,20].map(d=>'<option value="'+d+'" '+(d===(draft.days||prefs.days)?'selected':'')+'>'+d+' 个交易日</option>').join('')+'</select></label><label class="field">比较时的基准<select id="benchmark">'+options(state.meta.benchmarks,draft.benchmark||prefs.benchmark)+'</select></label></div><label class="remember"><input id="remember" type="checkbox">记住偏好</label></details>'+
    '<div id="form-error" role="alert"></div><div class="btn-row end"><button class="primary" id="run">开始研究 →</button></div></form></section>'+
    '<aside class="box box-inner"><h3>试试这些问题</h3>'+examples.map((q,i)=>'<button class="template" data-template="'+i+'">'+e(q)+'</button>').join('')+'</aside></div>';
  byId('composer').addEventListener('submit',createThread);
}
async function createThread(ev){
  ev.preventDefault();
  if(state.busy)return;
  const payload={goal:byId('goal').value.trim(),mode:'live',benchmark:byId('benchmark').value,days:Number(byId('days').value),remember:byId('remember').checked};
  const error=byId('form-error');
  function fail(message){error.className='message error';error.textContent=message;}
  if(!payload.goal)return fail('请输入研究目标。');
  state.busy=true;byId('run').disabled=true;byId('run').textContent='正在创建…';state.fieldDraft=payload;
  try{
    const t=await request('threads',payload);
    if(payload.remember)state.meta.preferences={benchmark:payload.benchmark,days:payload.days};
    history.pushState(null,'','#thread/'+encodeURIComponent(t.id));state.fieldDraft=null;state.epoch++;state.tab=t.report?'report':'tasks';saveThread(t);state.auto=t.status==='running';detail();schedule();
  }catch(err){if(error.isConnected)fail(err.message);}
  finally{state.busy=false;const btn=byId('run');if(btn){btn.disabled=false;btn.textContent='开始研究 →';}}
}
function toolbutton(action,text,kind='secondary'){return '<button type="button" class="'+kind+'" data-action="'+action+'">'+text+'</button>';}
function actions(t){
  if(t.status==='clarification')return '<form id="clarification" class="message warn"><label class="field"><strong>需要明确研究口径</strong><span>'+e(t.question)+'</span><input id="clarify-answer" maxlength="500" required></label><button class="primary">继续调查</button></form>';
  if(t.status==='approval')return '<div class="message warn" role="status"><strong>研究范围需要确认</strong><p>'+e(t.approval||'是否允许执行下一项扩展调查？')+'</p><div class="btn-row">'+toolbutton('approve','批准并继续','primary')+toolbutton('skip','跳过扩展调查')+toolbutton('finish','交付阶段简报','quiet')+'</div></div>';
  if(t.status==='failed')return '<div class="message error"><strong>步骤未完成</strong><p>'+e(t.error||'请检查调用记录。')+'</p><div class="btn-row">'+toolbutton('retry','重试失败步骤','primary')+toolbutton('finish','生成阶段性结果')+'</div></div>';
  if(t.status==='paused')return '<div class="message"><strong>已保存检查点</strong><p>恢复后会复用此前已完成的步骤。</p><div class="btn-row">'+toolbutton('resume','恢复研究','primary')+toolbutton('finish','生成阶段性结果')+'</div></div>';
  if(t.status==='running'&&state.pendingStop)return '<span class="pill warn" role="status">当前工具完成后暂停</span>';
  if(t.status==='running')return '<div class="btn-row">'+(state.auto?'':toolbutton('continue','从检查点继续','primary'))+toolbutton('stop','暂停研究')+'</div>';
  return '';
}
function renderTasks(t){return '<div class="section-head"><h2>执行计划</h2><small>'+e((t.tasks||[]).length)+' 项任务</small></div>'+((t.tasks||[]).map((task,i)=>'<div class="step"><span class="num '+(['done','complete','completed'].includes(task.status)?'done':'')+'">'+String(i+1).padStart(2,'0')+'</span><div class="step-content"><div class="row wrap"><strong>'+e(task.label)+'</strong>'+statusPill(task.status)+'</div>'+(task.detail?'<p>'+e(task.detail)+'</p>':'')+'</div></div>').join('')||'<div class="empty">等待生成执行计划。</div>');}
function safeUrl(value){try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}
function kv(key,value){return '<div class="kv"><span>'+e(key)+'</span><strong>'+e(value??'—')+'</strong></div>';}
function evidenceSection(t){
  return '<div class="section-head"><h2>研究证据</h2><small>'+e(t.evidence.length)+' 项</small></div>'+(t.evidence.length?t.evidence.map(ev=>{
    const url=safeUrl(ev.url);
    return '<details class="record" data-evidence="'+e(ev.id)+'"><summary><span class="mono">'+e(ev.id)+'</span> · '+e(ev.label)+'</summary>'+kv('来源',ev.source)+(ev.raw?.requestId?kv('请求编号',ev.raw.requestId):'')+kv('数据时点',ev.asOf)+kv('单位',ev.unit)+kv('口径',ev.method)+(url?'<a href="'+e(url)+'" target="_blank" rel="noopener noreferrer">打开来源 ↗</a>':'')+'<p>原始字段或计算输入</p><pre class="raw">'+e(JSON.stringify(ev.raw,null,2))+'</pre></details>';
  }).join(''):'<p class="empty">成功取数后，这里会保存来源、时点、单位和原始字段。</p>');
}
function reportEvidence(t){return t.reportEvidenceCount===undefined?t.evidence:t.evidence.slice(0,t.reportEvidenceCount);}
function exportReport(t){
  const r=t.report;if(!r)return;
  const lines=['# '+r.title,'','模式：在线查询','',t.goal,'','## 事实',...r.facts.map(f=>'- '+f.text+' '+(f.refs||[]).map(id=>'['+id+']').join(' ')),'','## 解读',...r.interpretation.map(v=>'- '+v),'','## 待验证',...r.unknowns.map(v=>'- '+v),'','## 证据索引',...reportEvidence(t).flatMap(v=>['- '+v.id+' '+v.label+'｜'+v.source+'｜'+v.asOf+'｜'+v.unit+'｜'+v.method,...(safeUrl(v.url)?['  '+safeUrl(v.url)]:[])])];
  const objectUrl=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=objectUrl;a.download='研究简报-'+t.id+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
}
function reportSection(t){
  if(!t.report)return '<div class="section-head"><h2>研究简报</h2></div><div class="empty">研究完成或阶段性结束后，在这里查看简报。</div>';
  const r=t.report;
  function block(title,items){return '<section class="report-block"><h3>'+title+'</h3>'+(items.length?'<ul>'+items.map(x=>'<li>'+x+'</li>').join('')+'</ul>':'<p class="muted">暂无记录。</p>')+'</section>';}
  return '<div class="section-head"><h2>'+e(r.title)+'</h2><button class="secondary" id="download">下载简报 ↓</button></div>'+chartMarkup(t)+block('已核实事实',r.facts.map(f=>e(f.text)+' '+(f.refs||[]).map(id=>'<button class="ref" data-ref="'+e(id)+'">'+e(id)+'</button>').join(' ')))+block('研究解读',r.interpretation.map(e))+block('仍待验证',r.unknowns.map(e))+((t.previousReports||[]).length?'<details><summary>此前研究简报</summary>'+t.previousReports.map(r=>'<h3>'+e(r.title)+'</h3>'+block('事实',r.facts.map(f=>e(f.text)))).join('')+'</details>':'')+followupMarkup(t);
}
function chartMarkup(t){
  const comparison=reportEvidence(t).findLast(item=>item.tool==='compare'||item.id==='C1');
  const c=comparison?.raw;if(!c?.series?.length)return '';
  const format=n=>Number.isFinite(n)?(n>0?'+':'')+n.toFixed(2):'—';
  return '<figure class="chart"><figcaption><strong>区间累计收益</strong><small>'+e(c.start)+' — '+e(c.end)+'</small></figcaption>'+
    '<div class="chart-legend"><span><i></i>'+e(t.symbol?nameOf(t.symbol):comparison.label.split(' 对比 ')[0])+' <b>'+format(c.targetPct)+'%</b></span><span><i></i>'+e(t.benchmark?nameOf(t.benchmark):comparison.label.split(' 对比 ')[1])+' <b>'+format(c.benchmarkPct)+'%</b></span></div>'+
    '<canvas id="returns-chart" role="img" aria-label="研究指数与基准相对期初的累计收益折线，原始数据见下方证据 C1"></canvas>'+
    '<div class="chart-foot"><span>相对期初收盘 · 单位 %</span><button data-ref="'+e(comparison.id)+'" class="ref">查看计算依据 '+e(comparison.id)+'</button></div></figure>';
}
function paintChart(t){
  const canvas=byId('returns-chart'); if(!canvas)return;
  const series=reportEvidence(t).findLast(item=>item.tool==='compare'||item.id==='C1')?.raw.series||[];
  const ctx=canvas.getContext('2d'); if(series.length<2||!ctx)return;
  const values=series.flatMap(row=>[row.targetPct,row.benchmarkPct]);if(!values.every(Number.isFinite))return;
  const w=Math.max(220,canvas.clientWidth),h=150,scale=Math.min(window.devicePixelRatio||1,2);
  canvas.width=w*scale;canvas.height=h*scale;ctx.scale(scale,scale);
  const min=Math.min(0,...values), max=Math.max(0,...values), pad=Math.max((max-min)*.12,.02);
  const low=min-pad,high=max+pad, left=42,right=w-12,top=12,bottom=h-22;
  const px=i=>left+(right-left)*i/(series.length-1), py=n=>bottom-(bottom-top)*(n-low)/(high-low);
  ctx.font='10px monospace';ctx.textBaseline='middle';ctx.fillStyle='#596c62';
  for(const n of [...new Set([max,0,min])]){
    const y=py(n);ctx.fillText(n.toFixed(1)+'%',0,y);ctx.beginPath();ctx.strokeStyle=n===0?'#a0afa0':'#dce2d8';ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
  }
  function line(key,color){
    ctx.beginPath();series.forEach((row,i)=>{if(i)ctx.lineTo(px(i),py(row[key]));else ctx.moveTo(px(i),py(row[key]));});
    ctx.lineJoin='round';ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
    ctx.beginPath();ctx.arc(right,py(series.at(-1)[key]),3,0,2*Math.PI);ctx.fillStyle=color;ctx.fill();
  }
  line('benchmarkPct','#a2854e');line('targetPct','#226354');
  ctx.fillStyle='#596c62';ctx.fillText(String(series[0].date).slice(5),left,h-7);ctx.textAlign='right';ctx.fillText(String(series.at(-1).date).slice(5),right,h-7);
}
function followupMarkup(t){
  const messages=t.chat??(t.followups||[]).flatMap(x=>[{role:'user',text:x.question},{role:'assistant',text:x.answer,refs:x.refs}]);
  const rows=messages.map(m=>'<div class="chat-message '+(m.role==='user'?'user':'assistant')+'"><strong>'+ (m.role==='user'?'你':'研究助手')+'</strong><p>'+e(m.text)+'</p>'+(m.refs||[]).map(id=>'<button class="ref" data-ref="'+e(id)+'">'+e(id)+'</button>').join(' ')+'</div>').join('');
  const run=t.chatRun;
  let progress='';
  if(run?.status==='approval'){
    progress='<div class="message warn"><strong>需要补查资料</strong><p>'+e(run.pending.detail)+'</p><p>'+e(run.pending.id)+' · '+e(JSON.stringify(run.pending.args))+'</p>'+toolbutton('approve','允许补查')+' '+toolbutton('skip','只用现有资料回答')+'</div>';
  }else if(run){
    progress='<p role="status">'+e(run.pending?'正在补查：'+run.pending.detail:'正在整理回复…')+'</p>'+(state.auto?'':toolbutton('continue','继续回复'));
  }
  const disabled=run?' disabled':'';
  return '<section class="brief-chat" aria-label="简报对话"><h3>讨论这份简报</h3><div class="chat-history" role="log" aria-live="polite">'+rows+'</div>'+progress+
    '<form class="chat-composer" id="followup"><label class="field"><span>你的消息</span><textarea rows="2" id="question" required maxlength="500" placeholder="哪里没看懂？也可以接着问。"'+disabled+'>'+e(state.chatDrafts.get(t.id)||'')+'</textarea></label><button class="primary" type="submit"'+disabled+'>发送</button></form></section>';
}
document.addEventListener('input',ev=>{
  if(ev.target.id==='question'&&state.thread)state.chatDrafts.set(state.thread.id,ev.target.value);
});
document.addEventListener('submit',async ev=>{
  if(ev.target.id==='clarification'){
    ev.preventDefault();await action('clarify',{question:byId('clarify-answer').value});return;
  }
  if(ev.target.id!=='followup')return;
  ev.preventDefault();
  const question=byId('question').value.trim();
  if(question&&!state.busy&&!state.thread?.chatRun)await action('chat',{question});
});
function activity(t){return t?.chatRun?.status||t?.status;}
let resizeTimer;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.thread)paintChart(state.thread);},100);});
function eventSection(t){return '<div class="section-head"><h2>运行记录</h2></div>'+([...(t.events||[])].reverse().map(ev=>'<div class="event"><time>'+e(formatDate(ev.at,true))+'</time><div>'+e(ev.text)+'</div></div>').join('')||'<div class="empty">暂无运行记录。</div>');}
function nameOf(symbol){return [...state.meta.subjects,...state.meta.benchmarks].find(x=>x.symbol===symbol)?.name||symbol;}
function registryMarkup(t){
  const registry=state.meta.registry;
  if(!registry||!Object.keys(registry).length)return '';
  const permissions={model:'模型调用',read:'只读查询',compute:'本地计算',approval:'需额外批准'};
  if(t.version===2)return '';
  return '<details class="tools-list"><summary>查看工具与权限</summary>'+t.tasks.filter(task=>registry[task.id]).map(task=>{
    const tool=registry[task.id];return kv(tool.label,permissions[tool.permission]||tool.permission);
  }).join('')+'</details>';
}
function detail(){
  const t=state.thread;if(!t)return;
  const open=new Set([...main.querySelectorAll('details[open][data-evidence]')].map(d=>d.dataset.evidence));
  byId('breadcrumb').textContent='研究线程';
  const tm=t.metrics||{};
  const views={tasks:renderTasks,evidence:evidenceSection,report:reportSection,events:eventSection};
  main.innerHTML=pageHeading(t.title||'研究线程')+'<section class="box detail-hero"><div class="row wrap"><span class="label">研究目标</span>'+statusPill(t.status)+'</div><p class="goal">'+e(t.currentGoal||t.goal)+'</p>'+actions(t)+'</section>'+
    '<div class="detail-grid"><div class="box box-inner"><nav class="tabs" aria-label="线程视图">'+Object.entries({tasks:'任务',evidence:'证据 '+t.evidence.length,report:'简报',events:'日志'}).map(([key,label])=>'<button data-tab="'+key+'" aria-pressed="'+(key===state.tab)+'">'+e(label)+'</button>').join('')+'</nav><div id="view">'+views[state.tab](t)+'</div></div><aside class="side-stack"><section class="box box-inner"><div class="section-head"><h3>研究口径</h3></div>'+(t.version===2?kv('研究时点',t.asOf)+kv('当前问题',t.currentGoal||t.goal):kv('研究指数',nameOf(t.symbol))+kv('比较基准',nameOf(t.benchmark)))+'</section><section class="box box-inner"><div class="section-head"><h3>执行用量</h3></div>'+kv('调用次数',(tm.calls??0)+' / '+(tm.limit??'—'))+kv('累计耗时',((tm.elapsedMs||0)/1000).toFixed(1)+' s')+kv('模型 Token',tm.tokens??0)+registryMarkup(t)+'</section>'+(t.summary?'<section class="box box-inner"><div class="section-head"><h3>压缩上下文</h3></div><p class="context">'+e(t.summary)+'</p></section>':'')+'</aside></div>';
  if(state.tab==='evidence') main.querySelectorAll('[data-evidence]').forEach(d=>{if(open.has(d.dataset.evidence))d.open=true;});
  paintChart(t);
  if(state.busy&&t.status!=='running')main.querySelectorAll('[data-action]').forEach(b=>b.disabled=true);
}
function schedule(){
  clearTimeout(state.timer);
  if(state.auto&&activity(state.thread)==='running')state.timer=setTimeout(step,500);
}
async function syncThread(id,epoch){
  const t=await request('threads/'+encodeURIComponent(id));if(epoch!==state.epoch)return;saveThread(t);detail();
}
async function step(){
  const t=state.thread;
  if(!state.auto||!t||activity(t)!=='running'||state.stepping)return;
  const epoch=state.epoch;state.stepping=true;
  try{
    const next=await request('threads/'+encodeURIComponent(t.id)+'/step',{revision:t.revision});
    if(epoch!==state.epoch)return;
    if(activity(next)!=='running')stopClock();
    if(next.report&&!t.report)state.tab='report';
    saveThread(next);detail();
    if(t.chatRun&&!next.chatRun&&state.tab==='report')byId('question')?.focus({preventScroll:true});
  }catch(err){
    if(epoch!==state.epoch)return;
    stopClock(); showNotice(err.message);
    try{await syncThread(t.id,epoch);}catch{detail();}
  }finally{
    state.stepping=false;
    if(state.pendingStop&&epoch===state.epoch){state.pendingStop=false;if(state.thread.status==='running'){await action('stop');return;}detail();}
    schedule();
  }
}
async function action(name,input={}){
  const t=state.thread;if(!t||state.busy)return;
  if(name==='stop'&&state.stepping){stopClock();state.pendingStop=true;detail();return;}
  if(name==='continue'){state.auto=true;detail();schedule();return;}
  stopClock();const epoch=++state.epoch;state.busy=true;
  main.querySelectorAll('[data-action]').forEach(el=>el.disabled=true);
  try{
    const next=await request('threads/'+encodeURIComponent(t.id)+'/'+encodeURIComponent(name),{...input,revision:t.revision});
    if(epoch!==state.epoch)return;
    if(name==='chat')state.chatDrafts.delete(t.id);
    state.auto=activity(next)==='running'&&name!=='stop';if(next.report&&!t.report)state.tab='report';if(!next.report&&t.report)state.tab='tasks';saveThread(next);
  }catch(err){if(epoch===state.epoch){showNotice(err.message);try{await syncThread(t.id,epoch);}catch{}}}
  finally{state.busy=false;if(epoch===state.epoch){detail();schedule();}}
}
async function route(){
  const epoch=++state.epoch;stopClock();state.pendingStop=false;closeDrawer();
  const match=location.hash.match(/^#thread\/(.+)$/);
  if(!match){state.thread=null;sidebar();compose();return;}
  let id;
  try{id=decodeURIComponent(match[1]);const t=await request('threads/'+encodeURIComponent(id));if(epoch!==state.epoch)return;state.tab=t.report?'report':'tasks';saveThread(t);detail();}
  catch(err){if(epoch!==state.epoch)return;state.thread=null;sidebar();showFatal(err.message);}
}
document.addEventListener('click',ev=>{
  const btn=ev.target.closest('button');if(!btn)return;
  if(btn.dataset.thread!==undefined){closeDrawer();menuClick(btn.dataset.thread);return;}
  if(btn.dataset.template!==undefined){setTemplate(Number(btn.dataset.template));return;}
  if(btn.dataset.tab){state.tab=btn.dataset.tab;detail();main.querySelector('[data-tab="'+state.tab+'"]')?.focus();return;}
  if(btn.dataset.action){action(btn.dataset.action);return;}
  if(btn.dataset.ref){state.tab='evidence';detail();const el=[...main.querySelectorAll('[data-evidence]')].find(item=>item.dataset.evidence===btn.dataset.ref);if(el){el.open=true;el.querySelector('summary').focus();el.scrollIntoView({block:'center'});}return;}
  if(btn.id==='download')exportReport(state.thread);
});
async function init(){
  byId('today').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'short',day:'numeric',weekday:'short'}).format(new Date());
  byId('menu').onclick=()=>{byId('rail').classList.add('open');byId('shade').hidden=false;byId('menu').setAttribute('aria-expanded','true');byId('close-menu').focus();};
  byId('shade').onclick=closeDrawer;byId('close-menu').onclick=()=>{closeDrawer();byId('menu').focus();};document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&byId('rail').classList.contains('open')){closeDrawer();byId('menu').focus();}});
  byId('new-thread').onclick=()=>{state.fieldDraft=null;closeDrawer();if(state.meta)menuClick(null);};
  main.innerHTML=pageHeading('研究工作台')+'<p class="muted" role="status">正在载入工作区…</p>';
  try{
    const meta=await request('meta');const history=await request('threads');state.meta=meta;state.threads=history.threads;sidebar();window.addEventListener('hashchange',route);await route();
  }catch(err){showFatal(err.message);}
}
init();
