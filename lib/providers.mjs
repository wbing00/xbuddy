const DAY = 86_400_000;
const SHANGHAI_OFFSET = 8 * 3_600_000;
const FUYAO = 'https://fuyao.aicubes.cn';
const HISTORY = '/api/a-share-index/prices/historical';
const CALENDAR = '/api/a-share/calendar/trading-days';

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function requireKey(value, provider) {
  if (!value) fail('NOT_CONFIGURED', provider + ' 的服务端密钥尚未配置。');
  return value;
}

async function requestJSON(url, options, provider, env, timeout = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await (env.fetch || fetch)(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) fail('HTTP_' + response.status, provider + ' 返回 HTTP ' + response.status + '。');
    try {
      return await response.json();
    } catch {
      fail('INVALID_RESPONSE', provider + ' 的响应无法解析。');
    }
  } catch (error) {
    if (controller.signal.aborted) fail('TIMEOUT', provider + ' 响应超时。');
    if (error.code && typeof error.code === 'string' && error.code.match(/^(HTTP_\d+|INVALID_RESPONSE)$/)) throw error;
    fail('NETWORK', '无法连接' + provider + '，请检查服务端网络。');
  } finally {
    clearTimeout(timer);
  }
}

async function fuyao(path, params, env) {
  const key = requireKey(env.FUYAO_API_KEY, '扶摇');
  const url = new URL(path, FUYAO);
  url.search = new URLSearchParams(params).toString();
  const payload = await requestJSON(url, { headers: { 'X-api-key': key } }, '扶摇', env);
  if (!Number.isInteger(payload?.code)) fail('INVALID_RESPONSE', '扶摇响应缺少业务状态码。');
  if (payload.code !== 0) {
    const reasons = { 2001: '认证失败', 2003: '当前账号无此工具权限', 4001: '请求受到限流' };
    fail('FUYAO_' + payload.code, '扶摇' + (reasons[payload.code] || '查询失败') + '（' + payload.code + '）。');
  }
  if (!Array.isArray(payload.data?.item)) fail('INVALID_RESPONSE', '扶摇响应缺少 data.item 数组。');
  return { data: payload.data, requestId: payload.request_id || null, url: url.href };
}

function shDate(ms) {
  return new Date(ms + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}

function dateStart(date) {
  const ms = Date.parse(date + 'T00:00:00+08:00');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(ms) || shDate(ms) !== date) {
    fail('BAD_DATE', '截止日必须是有效的 YYYY-MM-DD 日期。');
  }
  return ms;
}

export async function getIndexHistory({ symbol, days = 5, asOf }, env = {}) {
  if (!/^\d{6}\.(SH|SZ|TI)$/.test(symbol)) fail('BAD_SYMBOL', '指数代码格式无效。');
  if (!Number.isInteger(days) || days < 1 || days > 120) fail('BAD_WINDOW', '交易日数应在 1 至 120 之间。');
  const now = Date.now();
  const today = shDate(now);
  const requestedDate = asOf || today;
  if (dateStart(requestedDate) > dateStart(today)) fail('BAD_DATE', '截止日不能晚于今天。');
  const cutoff = requestedDate === today && now < dateStart(today) + 15 * 3_600_000
    ? shDate(dateStart(today) - DAY) : requestedDate;
  const from = shDate(dateStart(cutoff) - (days * 2 + 25) * DAY);
  const calendar = await fuyao(CALENDAR, {
    start_date: from.replaceAll('-', ''), end_date: cutoff.replaceAll('-', ''),
  }, env);
  const allDates = calendar.data.item.map(row => {
    const compact = String(row?.date || '');
    if (!/^\d{8}$/.test(compact)) fail('INVALID_CALENDAR', '交易日历缺少日期。');
    const date = compact.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    dateStart(date);
    if (date < from || date > cutoff) fail('INVALID_CALENDAR', '交易日历返回区间外日期。');
    return date;
  });
  if (new Set(allDates).size !== allDates.length) fail('INVALID_CALENDAR', '交易日历包含重复日期。');
  const dates = allDates.sort().slice(-days - 1);
  if (dates.length !== days + 1) fail('INSUFFICIENT_DATA', '交易日历覆盖不足，无法确定完整比较区间。');
  if (dateStart(cutoff) - dateStart(dates.at(-1)) > 12 * DAY) fail('STALE', '交易日历明显滞后于请求截止日。');
  const result = await fuyao(HISTORY, {
    thscode: symbol, interval: '1d', start: dateStart(dates[0]), end: dateStart(dates.at(-1)) + DAY - 1,
  }, env);
  const records = new Map();
  for (const row of result.data.item) {
    if (!Number.isSafeInteger(row?.date_ms) || Math.abs(row.date_ms) > 8e15) fail('INVALID_DATA', '指数日线缺少有效时间戳。');
    const date = shDate(row.date_ms);
    if (records.has(date)) fail('CONFLICT', '同一交易日有多条指数日线，需核查。');
    records.set(date, row);
  }
  const points = dates.map(date => {
    const row = records.get(date);
    if (!Number.isFinite(row?.close_price) || row.close_price <= 0) fail('MISSING_CLOSE', symbol + ' 缺失有效收盘点位：' + date);
    return { date, close: row.close_price, date_ms: row.date_ms, close_price: row.close_price };
  });
  return {
    symbol, days, asOf: requestedDate, start: dates[0], end: dates.at(-1), points,
    source: '扶摇 · 同花顺金融数据', requestId: result.requestId, url: result.url,
    retrievedAt: new Date().toISOString(), unit: '指数点', field: 'data.item[].close_price',
    calendar: { url: calendar.url, requestId: calendar.requestId, cutoff, dates },
    method: '上海交易日历；收盘点位；含期初基准日。实际末日 ' + dates.at(-1) + '。',
  };
}

export function compareIndices(target, benchmark) {
  const n = target.days;
  if (!Number.isInteger(n) || n < 1 || n !== benchmark.days || target.points?.length !== n + 1 ||
      benchmark.points?.length !== n + 1) fail('MISSING_CLOSE', '区间首尾及中间交易日数据不完整。');
  const series = target.points.map((point, i) => {
    const base = benchmark.points[i];
    if (point.date !== base.date || (i && target.points[i - 1].date >= point.date)) {
      fail('DATE_MISMATCH', '两组日线的日期未对齐或存在重复。');
    }
    if (![point.close, base.close].every(v => Number.isFinite(v) && v > 0)) fail('INVALID_DATA', '收盘值必须是有效正数。');
    return {
      date: point.date, targetClose: point.close, benchmarkClose: base.close,
      targetPct: (point.close / target.points[0].close - 1) * 100,
      benchmarkPct: (base.close / benchmark.points[0].close - 1) * 100,
    };
  });
  const last = series.at(-1);
  return {
    start: series[0].date, end: last.date, targetPct: last.targetPct, benchmarkPct: last.benchmarkPct,
    excessPp: last.targetPct - last.benchmarkPct, series,
  };
}

export async function modelJSON({ system, user }, env = {}) {
  const key = requireKey(env.DEEPSEEK_API_KEY, 'DeepSeek');
  const model = env.DEEPSEEK_MODEL || 'deepseek-flash';
  const response = await requestJSON('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model, messages: [
        { role: 'system', content: system + '\n只返回一个 JSON 对象。' },
        { role: 'user', content: typeof user === 'string' ? user : JSON.stringify(user) },
      ],
      response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 900, stream: false,
    }),
  }, 'DeepSeek', env, 22_000);
  const choice = response?.choices?.[0];
  if (choice?.finish_reason !== 'stop') fail('MODEL_INCOMPLETE', '模型未正常完成结构化输出。');
  let value;
  try { value = JSON.parse(choice.message.content); } catch { fail('MODEL_FORMAT', '模型未返回有效 JSON。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('MODEL_FORMAT', '模型结果应为 JSON 对象。');
  return { value, model: response.model || model, usage: response.usage || null };
}
