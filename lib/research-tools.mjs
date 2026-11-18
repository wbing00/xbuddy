import {fuyao,getIndexHistory,compareIndices} from './providers.mjs';
import {subjects} from './harness.mjs';

export const researchTools={
  index_history:'扶摇指数日线。参数 symbol, days(1–60), asOf(可选，YYYY-MM-DD)。使用已知指数代码或用户给出的代码。',
  futures_lookup:'扶摇国内期货主连目录。参数 keyword，中文品种名或英文品种代码，如沪金或 AU。只用于识别合约。',
  futures_daily:'扶摇国内期货日K。参数 symbol（必须来自 futures_lookup）、days(1–60)。收益采用最近已结束日期的观测值，注意主连换月。',
  stock_snapshot:'扶摇A股行情快照。参数 symbol，用户提供的完整股票代码。',
  stock_flow:'扶摇A股主力资金快照。参数 symbol，用户提供的完整股票代码。',
  compare:'比较两份指数日线。参数 left, right，为相同窗口且交易日对齐的证据编号。'
};
function fail(message){throw new Error(message);}
function windowSize(n){if(!Number.isInteger(n)||n<1||n>60)fail('观察窗口需为1至60个收益间隔');return n;}
function date(ms){if(!Number.isSafeInteger(ms)||ms<=0)fail('数据缺少有效时间戳');return new Date(ms+28800000).toISOString().slice(0,10);}
function observation(label,unit,method,raw,asOf){
  return {label,source:'扶摇 · 同花顺金融数据',unit,method,asOf,url:raw.url,raw};
}
function stats(points){
  const first=points[0],last=points.at(-1);
  let peak=first.close,maxDrawdownPct=0;
  for(const p of points){peak=Math.max(peak,p.close);maxDrawdownPct=Math.max(maxDrawdownPct,(1-p.close/peak)*100);}
  return {start:first.date,end:last.date,startClose:first.close,endClose:last.close,returnPct:(last.close/first.close-1)*100,maxDrawdownPct};
}
export async function queryResearchTool(tool,args,t,env){
  const {symbol}=args;
  if(tool==='compare'){
    const rows=[args.left,args.right].map(id=>t.evidence.find(e=>e.id===id&&e.tool==='index_history'));
    if(rows.some(x=>!x)||args.left===args.right)fail('比较需要两份不同的指数行情证据');
    const raw=compareIndices(rows[0].raw,rows[1].raw);
    return {label:rows.map(e=>e.label).join(' 对比 '),source:args.left+'、'+args.right,unit:'% / 百分点',asOf:raw.end,method:'比较区间两指数收盘涨幅之差',raw};
  }
  if(tool==='index_history'){
    const named=subjects.find(s=>s.symbol===symbol);
    const aliases={'000001.SH':['上证指数','沪指'],'399001.SZ':['深成指'],'000300.SH':['CSI300'],'886042.TI':['白酒']};
    const explicit=[symbol,named?.name,...(aliases[symbol]||[])].filter(Boolean).some(name=>t.messages.filter(m=>m.role==='user').some(m=>m.text.replace(/\s/g,'').toUpperCase().includes(name)));
    if(!explicit&&!(symbol===t.preferences.benchmark&&t.messages.some(m=>/基准|跑赢大盘/.test(m.text))))fail('研究问题中未确认该指数，请澄清标的');
    const raw=await getIndexHistory({symbol,days:windowSize(args.days),asOf:args.asOf||t.asOf},env);
    raw.metrics=stats(raw.points);
    return observation(symbol+' 指数收盘序列','指数点；收益和回撤为 %',raw.method,raw,raw.end);
  }
  if(tool==='futures_lookup'){
    const q=String(args.keyword||'').trim().toUpperCase();
    if(!q||q.length>24)fail('需要明确期货品种名或代码');
    const res=await fuyao('/api/futures/contracts/main-continuous-list',{},env);
    const matches=res.data.item.filter(r=>[r.name,r.variety_name,r.variety_code,r.thscode].some(x=>String(x||'').toUpperCase().includes(q))).slice(0,12);
    if(!matches.length)fail('期货目录没有匹配品种：'+q);
    return observation(q+' 主连目录','合约标识','按品种代码或名称检索主连目录',{matches,requestId:res.requestId,url:res.url},date(res.data.timestamp));
  }
  if(tool==='futures_daily'){
    const match=t.evidence.flatMap(e=>e.tool==='futures_lookup'?e.raw.matches:[]).find(r=>r.thscode===symbol);
    if(!match)fail('必须先在期货目录确认合约代码');
    const n=windowSize(args.days);
    const res=await fuyao('/api/futures/prices/daily',{thscode:symbol,time_period:'day_1'},env);
    if(res.data.thscode!==symbol||res.data.interval!=='1d')fail('日线响应合约或周期与请求不一致');
    const rows=res.data.item.map(r=>({date:date(r.timestamp),close:r.close_price,timestamp:r.timestamp})).filter(p=>p.date<t.asOf).sort((a,b)=>a.date.localeCompare(b.date)).slice(-n-1);
    if(rows.length!==n+1||new Set(rows.map(p=>p.date)).size!==rows.length||rows.some(p=>!Number.isFinite(p.close)||p.close<=0))fail('期货日线覆盖不足、重复或缺少有效收盘价');
    const end=rows.at(-1).date;
    if(Date.parse(t.asOf)-Date.parse(end)>12*86400000)fail('最新期货日线已过期');
    return observation(match.name+' '+symbol,match.variety_code==='AU'?'元/克；收益为 %':'合约报价；收益为 %','截至前一自然日的最近有效日线观测；主连可能换月，未校验缺失交易日。',{symbol,points:rows,metrics:stats(rows),url:res.url,requestId:res.requestId},end);
  }
  if(!['stock_snapshot','stock_flow'].includes(tool))fail('未注册的工具');
  if(!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)||!t.messages.some(m=>m.text.toUpperCase().includes(symbol)))fail('需要用户提供完整的股票代码');
  const snapshot=tool==='stock_snapshot';
  const res=await fuyao(snapshot?'/api/a-share/prices/snapshot':'/api/a-share/capital-flow/snapshot',snapshot?{thscodes:symbol}:{thscode:symbol},env);
  const asOf=date(res.data.timestamp);
  if(asOf>t.asOf||Date.parse(t.asOf)-Date.parse(asOf)>12*86400000)fail('快照时点无效或过期');
  if(!snapshot){
    const groups=['super_large','large','medium','small'];
    if(!groups.some(k=>Number.isFinite(res.data[k]?.net_amount)))fail('资金流向快照缺少净额');
    return observation(symbol+' 资金快照','人民币元','超大、大、中、小单分别统计；缺值不可视为零。',{symbol,rows:res.data,requestId:res.requestId,url:res.url},asOf);
  }
  if(!res.data.item.length||res.data.item.some(r=>r.thscode&&r.thscode!==symbol))fail('快照为空或标的不符');
  return observation(symbol+(snapshot?' 行情快照':' 主力资金快照'),'参见字段口径','单时点上游原始字段；没有明确单位的数值不得换算或作金额结论。',{symbol,rows:res.data.item,requestId:res.requestId,url:res.url},date(res.data.timestamp));
}
