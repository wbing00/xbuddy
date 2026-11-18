// Drive the production research steps without a browser or an approval grant.
import {createThread, step} from '../lib/harness.mjs';

const thread = createThread({
  goal: '核查上证综指最近五个交易日相对沪深300的区间表现，并判断是否需要前一期数据。',
  mode: 'live', symbol: '000001.SH', benchmark: '000300.SH', days: 5,
});

let logged = 0;
while (thread.status === 'running') {
  await step(thread, process.env);
  for (const event of thread.events.slice(logged)) console.log(event.text);
  logged = thread.events.length;
}

for (const item of thread.evidence) {
  console.log(item.id, item.label, item.source, item.asOf, item.raw.requestId || '');
}

const modelDecisions = thread.events.filter(event => event.text.startsWith('模型 ') &&
  (event.text.includes(' 返回计划：') || event.text.includes(' 后选择 ')));
const hasEvidence = ['E1', 'E2', 'C1'].every(id => thread.evidence.some(item => item.id === id));
if (modelDecisions.length === 2 && hasEvidence && ['approval', 'complete'].includes(thread.status)) {
  console.log('真实链路验证通过。线程状态：', thread.status);
} else {
  console.error('真实链路未通过。线程状态：', thread.status, thread.error);
  process.exitCode = 1;
}
