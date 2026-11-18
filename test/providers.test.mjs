import test from 'node:test';
import assert from 'node:assert/strict';
import { compareIndices, getIndexHistory, modelJSON } from '../lib/providers.mjs';

const dates = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14'];
const symbol = '886042.TI';
function sampleEnv(transform = rows => rows) {
  return {
    FUYAO_API_KEY: 'test-only',
    fetch: async (url, init) => {
      assert.equal(init.headers['X-api-key'], 'test-only');
      const isCalendar = url.pathname.endsWith('/trading-days');
      const rows = dates.map((date, i) => ({
        date_ms: Date.parse(date + 'T00:00:00+08:00'), close_price: 100 + 2 * i,
      }));
      return Response.json({
        code: 0, request_id: isCalendar ? 'calendar-request' : 'history-request',
        data: { item: isCalendar ? dates.map(date => ({ date: date.replaceAll('-', '') })) : transform(rows) },
      });
    },
  };
}

test('five full return intervals use six Shanghai dates and retain original fields', async () => {
  const index = await getIndexHistory({ symbol, asOf: dates.at(-1), days: 5 }, sampleEnv());
  assert.deepEqual(index.points.map(p => p.date), dates);
  assert.equal(index.points[0].date_ms, Date.parse('2026-09-06T16:00:00Z'));
  assert.equal(index.points.at(-1).close_price, 110);
  assert.equal(index.calendar.requestId, 'calendar-request');
  const base = { days: 5, points: dates.map(date => ({ date, close: 200 })) };
  const result = compareIndices(index, base);
  assert.ok(Math.abs(result.excessPp - 10) < 1e-10);
  assert.equal(result.series.length, 6);
});

test('missing interior days, null or conflicting prices never produce a return', async () => {
  for (const [change, code] of [
    [rows => rows.filter((_, i) => i !== 3), 'MISSING_CLOSE'],
    [rows => rows.map((r, i) => i === 1 ? { ...r, close_price: null } : r), 'MISSING_CLOSE'],
    [rows => [...rows, rows[0]], 'CONFLICT'],
  ]) {
    await assert.rejects(getIndexHistory({ symbol, asOf: dates.at(-1) }, sampleEnv(change)), { code });
  }
});

test('valid HTTP responses may still deny permission or contain unusable model output', async () => {
  await assert.rejects(getIndexHistory({ symbol, asOf: dates.at(-1) }, {
    FUYAO_API_KEY: 'test-only', fetch: async () => Response.json({ code: 2003 }),
  }), { code: 'FUYAO_2003' });
  await assert.rejects(modelJSON({ system: 'a', user: 'b' }, {
    DEEPSEEK_API_KEY: 'test-only',
    fetch: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
  }), { code: 'MODEL_INCOMPLETE' });
});

test('comparison rejects unequal observation dates even when lengths match', () => {
  const baseline = { days: 1, points: [{ date: dates[0], close: 10 }, { date: dates[1], close: 12 }] };
  const other = { days: 1, points: [baseline.points[0], { date: dates[2], close: 15 }] };
  assert.throws(() => compareIndices(baseline, other), { code: 'DATE_MISMATCH' });
});
