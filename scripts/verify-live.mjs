// Verify the same orchestration used by newly created web threads.
import {newResearch,advanceResearch} from '../lib/agent.mjs';
const goal=process.env.RESEARCH_QUESTION||'上证综指最近5个交易日的收益和最大回撤分别是多少？';
const t=newResearch({goal});
let printed=0;
while(t.status==='running'){
  await advanceResearch(t,process.env);
  for(const e of t.events.slice(printed))console.log(e.text);
  printed=t.events.length;
}
for(const e of t.evidence)console.log(e.id,e.label,e.source,e.asOf,e.raw.requestId||'');
console.log('线程状态',t.status,t.question||t.approval||t.error||'');
if(t.report)console.log(t.report);
if(t.status!=='complete'||!t.evidence.length)process.exitCode=1;
