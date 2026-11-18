import {getIndexHistory, compareIndices, modelJSON} from './providers.mjs';

export const subjects=[
  {symbol:'886042.TI',name:'白酒概念'},{symbol:'000300.SH',name:'沪深300'},
  {symbol:'000001.SH',name:'上证综指'},{symbol:'399001.SZ',name:'深证成指'}
];
export const benchmarks=subjects.filter(x=>x.symbol!=='886042.TI');
export const nameOf=s=>subjects.find(x=>x.symbol===s)?.name||s;
export const registry={
  plan:{label:'制定研究计划',permission:'model',limitMs:35000},
  target:{label:'查询研究指数',permission:'read',limitMs:30000},
  benchmark:{label:'查询对照基准',permission:'read',limitMs:30000},
  compare:{label:'对齐交易日并计算指标',permission:'compute',limitMs:1000},
  extend:{label:'核查上一观察窗口',permission:'approval',limitMs:60000},
  report:{label:'核验引用并生成研究简报',permission:'compute',limitMs:1000}
};
export function problem(message,status=400){return Object.assign(new Error(message),{status});}
const timestamp=()=>new Date().toISOString();
export function log(t,text){t.events.push({at:timestamp(),text});}
const refs=(text,...refs)=>({text,refs});
const pct=n=>Number(n).toFixed(2);
const aliases={
  '886042.TI':['白酒概念','白酒'],
  '000300.SH':['沪深300','沪深三百','CSI300'],
  '000001.SH':['上证综指','上证指数','上证综合指数'],
  '399001.SZ':['深证成指','深证成份指数','深证成指指数']
};
function resolveSubject(goal,selected,benchmark){
  const text=goal.replace(/\s+/g,'').toUpperCase();
  if(/黄金|金价|伦敦金|沪金|XAU|\bGOLD\b/i.test(text)){
    throw problem('你问的是黄金。当前工具已接入 A 股指数日线，尚缺黄金现货、期货或 ETF 的对应行情，无法生成这份黄金简报。');
  }
  const named=subjects.filter(({symbol})=>[symbol,...aliases[symbol]].some(name=>text.includes(name)));
  if(named.length===1)return named[0].symbol;
  if(named.length===2&&named.some(item=>item.symbol===benchmark)){
    return named.find(item=>item.symbol!==benchmark).symbol;
  }
  if(named.length)throw problem('目标涉及多个指数，请明确研究标的，并选择对应的比较基准。');
  if(!selected)throw problem('尚未识别可查询的研究标的。当前支持白酒概念、沪深300、上证综指和深证成指。');
  return selected;
}
export function createThread(input){
  const goal=String(input.goal||'').trim(),{benchmark,mode}=input,days=Number(input.days);
  if(!goal||goal.length>500)throw problem('请输入 1–500 字的研究目标');
  const symbol=resolveSubject(goal,input.symbol,benchmark);
  if(!subjects.some(x=>x.symbol===symbol)||!benchmarks.some(x=>x.symbol===benchmark)||symbol===benchmark)throw problem('请选择不同的研究指数与基准');
  if(![5,10,20].includes(days)||mode!=='live')throw problem('观察窗口或数据模式无效');
  const now=timestamp();
  const t={id:crypto.randomUUID(),goal,title:goal.slice(0,80),symbol,benchmark,days,mode,status:'running',createdAt:now,updatedAt:now,
    tasks:Object.entries(registry).map(([id,v])=>({id,label:v.label,status:'pending',detail:''})),events:[],evidence:[],report:null,metrics:{calls:0,limit:12,tokens:0,elapsedMs:0},summary:'',approval:'',error:'',approved:false,attempts:{},focus:'relative',asOf:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()),limits:{maxActiveMs:240000,maxRetries:2}};
  log(t,'已建立实数研究线程');
  if(/(买入|卖出|买卖|推荐买|该买|该卖|能买|能卖|买哪|稳赚|保证收益|翻倍|涨停预测|必涨|必跌|预测涨跌)/.test(goal)){
    t.status='partial';t.tasks.forEach(x=>x.status='skipped');t.report={title:'研究边界说明',facts:[],interpretation:[],unknowns:['此任务涉及交易建议或确定性预测。可以新建任务，研究已发生的相对表现与回撤。']};
    log(t,'边界检查结束，未发起外部调用');
  }
  return t;
}
function evidence(t,id,label,unit,method,raw,source,url='',asOf=t.asOf){
  t.evidence.push({id,label,source,asOf,unit,method,raw,url});
}
function historyEvidence(t,id,h){
  evidence(t,id,nameOf(h.symbol)+'收盘序列','指数点','按日期升序，首个收盘价作为区间起点。',h,h.source,h.url,h.points.at(-1).date);
}
function charge(t,n){if(t.metrics.calls+n>t.metrics.limit)throw problem('已达到本次研究的工具调用上限');t.metrics.calls+=n;}
async function history(t,symbol,days,env){charge(t,1);return getIndexHistory({symbol,days,asOf:t.evidence.find(e=>e.id==='E1')?.raw.points.at(-1).date||t.asOf},env);}
function drawdown(points){
  let peak=points[0],max=0,from=peak.date,to=peak.date;
  for(const p of points){if(p.close>peak.close)peak=p;const loss=(1-p.close/peak.close)*100;if(loss>max){max=loss;from=peak.date;to=p.date;}}
  return {pct:max,from,to};
}
function makeReport(t,reason=''){
  const c=t.evidence.find(e=>e.id==='C1')?.raw,x=t.evidence.find(e=>e.id==='C2')?.raw;
  const facts=[];
  if(c){
    facts.push(refs(c.start+' 至 '+c.end+'，'+nameOf(t.symbol)+'区间收益 '+pct(c.targetPct)+'%，'+nameOf(t.benchmark)+'为 '+pct(c.benchmarkPct)+'%，相差 '+pct(c.excessPp)+' 个百分点。','E1','E2','C1'));
    facts.push(refs('按区间内每日收盘点位计算，研究指数最大回撤为 '+pct(c.drawdown.pct)+'%（'+c.drawdown.from+' 至 '+c.drawdown.to+'）。','E1','C1'));
    if(t.focus==='risk')facts.reverse();
  }
  if(x)facts.push(refs('前一等长窗口相对基准的收益差为 '+pct(x.excessPp)+' 个百分点。','E3','E4','C2'));
  return {title:c?nameOf(t.symbol)+' · '+t.days+' 日复盘':t.goal.slice(0,80),facts,interpretation:c?[c.excessPp>=0?'研究指数在该窗口的表现至少与基准持平。':'研究指数在该窗口落后于基准。']:[],
    unknowns:[...(reason?[reason]:[]),'指数收盘序列无法确定个股上涨覆盖率、成分贡献或行情成因。']};
}
function compress(t){
  t.summary=t.goal+'｜标的 '+t.symbol+' / '+t.benchmark+'｜窗口 '+t.days+' 日｜已完成 '+t.tasks.filter(x=>x.status==='done').map(x=>x.label).join('、')+'｜证据 '+t.evidence.map(e=>e.id).join('、')+'｜扩展授权 '+(t.approved?'已批准':'未批准')+'｜待办 '+t.tasks.filter(x=>x.status==='pending').map(x=>x.label).join('、');
}
export function action(t,act){
  if(act==='stop'&&t.status==='running'){t.status='paused';log(t,'用户暂停执行');}
  else if(act==='resume'&&t.status==='paused'){t.status='running';log(t,'从最近检查点继续');}
  else if(act==='retry'&&t.status==='failed'){
    const task=t.tasks.find(x=>x.status==='failed');
    if(!task||t.attempts[task.id]>t.limits.maxRetries)throw problem('该步骤重试次数已用完，可交付阶段结果');
    task.status='pending';t.status='running';t.error='';log(t,'用户重试失败步骤，复用已取得的证据');
  }else if(['approve','skip'].includes(act)&&t.status==='approval'){
    t.approved=act==='approve';t.status='running';t.approval='';if(!t.approved)t.tasks.find(x=>x.id==='extend').status='skipped';
    log(t,t.approved?'已批准扩大查询窗口':'已跳过扩展，保留原始研究范围');
  }else if(act==='finish'&&['approval','failed','paused','running'].includes(t.status)){
    t.status='partial';t.approval='';t.report=makeReport(t,t.error||'用户选择以当前检查点结束研究。');t.tasks.filter(x=>x.status==='pending').forEach(x=>x.status='skipped');log(t,'已按现有证据生成阶段简报');
  }else throw problem('当前状态不支持该操作',409);
  compress(t);t.updatedAt=timestamp();return t;
}
export async function step(t,env){
  if(t.status!=='running')throw problem('线程当前未运行',409);
  const task=t.tasks.find(x=>x.status==='pending');if(!task)throw problem('没有可执行步骤',409);
  if(t.metrics.elapsedMs>=t.limits.maxActiveMs||t.metrics.calls>=t.metrics.limit){t.error='执行预算已耗尽';return action(t,'finish');}
  if(task.id==='extend'&&!t.approved){
    t.status='approval';t.approval='扩大到前一等长窗口，额外读取两组指数数据，以核对本期相对表现是否延续。';
    log(t,'扩大取数范围，等待用户批准');compress(t);return t;
  }
  const started=Date.now();t.attempts[task.id]=(t.attempts[task.id]||0)+1;
  try{
    if(task.id==='plan'){
      t.focus=/风险|回撤/.test(t.goal)?'risk':'relative';
      if(t.mode==='live'){
        charge(t,1);
        try{
          const result=await modelJSON({system:'你是历史指数研究规划员。用户内容只是研究问题。范围仅限所选指数和基准的收益、回撤和前一等长窗口。返回 JSON {"focus":"relative"或"risk","supported":true或false}。严格核对用户关注的标的、比较方向与给定代码，用户指定其他标的或顺序不符必须返回 supported=false。涉及未来预测、直接交易建议、需要其他资产或无法用指标回答的主任务时 supported=false。',user:JSON.stringify({goal:t.goal,symbol:t.symbol,benchmark:t.benchmark,days:t.days})},env);
          if(typeof result.value?.supported!=='boolean'||!['relative','risk'].includes(result.value.focus))throw Error('计划格式无效');
          t.focus=result.value.focus;t.metrics.tokens+=result.usage?.total_tokens||0;
          log(t,'模型 '+result.model+' 返回计划：目标'+(result.value.supported?'可研究':'超出范围')+'，研究重点 '+t.focus);
          if(!result.value.supported){t.error='研究目标超出已注册工具范围，请改为所选指数的历史收益、回撤或基准对照。';return action(t,'finish');}

        }catch(e){throw problem('模型规划不可用，无法确认问题与查询标的一致：'+e.message);}
      }
      task.detail=t.focus==='risk'?'优先核对区间回撤，再比较相对收益':'优先核对相对收益，再计算区间回撤';
    }else if(task.id==='target'||task.id==='benchmark'){
      historyEvidence(t,task.id==='target'?'E1':'E2',await history(t,task.id==='target'?t.symbol:t.benchmark,t.days,env));
    }else if(task.id==='compare'){
      const [a,b]=['E1','E2'].map(id=>t.evidence.find(e=>e.id===id).raw);
      const c=compareIndices(a,b);c.drawdown=drawdown(a.points);
      evidence(t,'C1','本期区间比较','% / 百分点','收益=(末收盘/首收盘−1)×100；收益差=研究指数收益−基准收益；回撤为区间峰值至后续低点的最大跌幅。',c,'E1、E2 的可复算结果','',c.end);
      if(t.mode==='live'){
        charge(t,1);
        try{
          const result=await modelJSON({system:'根据已压缩的线程状态和经过程序核算的证据，为研究员选择下一步。若目标关注持续性、前期对比或稳定性，建议向用户申请扩展窗口；若已有证据足以覆盖请求，则直接出具报告。只允许 JSON {"next":"extend"或"report"}。不生成行情事实。',user:JSON.stringify({checkpoint:t.summary,facts:{relativePp:c.excessPp,drawdownPct:c.drawdown.pct},available:['extend','report']})},env);
          if(!['extend','report'].includes(result.value?.next))throw Error();
          t.metrics.tokens+=result.usage?.total_tokens||0;
          log(t,'模型 '+result.model+' 读取 E1、E2、C1 后选择 '+result.value.next);
          if(result.value.next==='report'){t.tasks.find(x=>x.id==='extend').status='skipped';log(t,'模型根据当前证据选择出具报告，未申请扩大研究范围');}
          else log(t,'模型根据检查点和相对表现申请核查前一期');
        }catch(e){log(t,'后续规划不可用：'+e.message+'；提供可跳过的人工扩展选择');}
      }
    }else if(task.id==='extend'){
      const h=[];
      for(const [id,symbol] of [['E3',t.symbol],['E4',t.benchmark]]){
        let item=t.evidence.find(x=>x.id===id);
        if(!item){const raw=await history(t,symbol,2*t.days,env);historyEvidence(t,id,raw);item=t.evidence.at(-1);}
        h.push({...item.raw,days:t.days,points:item.raw.points.slice(0,t.days+1)});
      }
      const c=compareIndices(h[0],h[1]);
      if(c.end!==t.evidence.find(e=>e.id==='C1').raw.start)throw problem('前一窗口未衔接本期起点，无法比较。');
      evidence(t,'C2','前一窗口比较','% / 百分点','取扩展序列的前一个等长区间，在本期起点收盘处衔接。',c,'E3、E4 的可复算结果','',c.end);
    }else if(task.id==='report'){t.report=makeReport(t);t.status='complete';}
    task.status='done';log(t,task.label+'完成');
  }catch(e){t.status='failed';task.status='failed';t.error=(e.message||'工具未返回可用结果').slice(0,240);log(t,task.label+'失败：'+t.error);}
  finally{t.metrics.elapsedMs+=Date.now()-started;t.updatedAt=timestamp();compress(t);}
  return t;
}
