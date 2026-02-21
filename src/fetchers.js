import { jitter, sleep } from './utils.js';

const fetchText = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

const parseJsonp = (text) => {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end < 0) throw new Error('JSONP parse fail');
  return JSON.parse(text.slice(start + 1, end));
};

const parseTable = (html) => {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const list = [];
  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>(.*?)<\/td>/gi) || [])
      .map((c) => c.replace(/<[^>]+>/g, '').trim());
    if (cells.length >= 2) {
      const date = cells[0];
      const val = parseFloat(cells[1]);
      if (date && Number.isFinite(val)) list.push({ date, value: val });
    }
  }
  return list.reverse();
};

export const fetchGszPrimary = async (code) => {
  const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
  const text = await fetchText(url);
  return parseJsonp(text);
};

export const fetchGszFallback = async (code) => {
  // Eastmoney pingzhongdata: use latest net value if gsz missing
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
  const text = await fetchText(url);
  // naive parse: gsz is not directly available, return empty
  return { code, gsz: null, dwjz: null, gztime: null, _fallback: true };
};

export const fetchFundProfileLite = async (code) => {
  const url = `https://fundf10.eastmoney.com/jbgk_${code}.html`;
  const html = await fetchText(url);
  const pick = (label) => {
    const re = new RegExp(`${label}[:：]?\\s*([^<\\n]+)`);
    const m = html.match(re);
    return m ? m[1].trim() : '';
  };
  const type = pick('基金类型') || pick('基金类型/运作方式');
  const benchmark = pick('业绩比较基准');
  const establish = pick('成立日期') || pick('成立时间');
  return { type, benchmark, establish };
};

export const fetchGszWithRetry = async (code, retries = 2) => {
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      await jitter();
      const data = await fetchGszPrimary(code);
      return { ...data, _source: 'fundgz' };
    } catch (err) {
      lastErr = err;
      await sleep(300 + i * 200);
    }
  }
  const fallback = await fetchGszFallback(code);
  return { ...fallback, _source: 'fallback', _error: lastErr?.message || 'fetch-failed' };
};

export const fetchHistory = async (code, days = 200) => {
  const per = Math.min(200, Math.max(60, days));
  const url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${code}&page=1&per=${per}&sdate=&edate=`;
  const html = await fetchText(url);
  return parseTable(html);
};

export const fetchHistoryDeep = async (code, targetDays = 720, maxPages = 12, establishDate = '') => {
  const per = 200;
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    await jitter(120, 260);
    const url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${code}&page=${page}&per=${per}&sdate=&edate=`;
    const html = await fetchText(url);
    const batch = parseTable(html);
    if (!batch.length) break;
    all.push(...batch);
    if (all.length >= targetDays) break;
    const earliest = batch[0]?.date || '';
    if (establishDate && earliest && earliest <= establishDate) break;
  }
  // de-dup by date and sort asc
  const map = new Map();
  all.forEach((it) => {
    if (it?.date && Number.isFinite(it.value)) map.set(it.date, it.value);
  });
  const list = Array.from(map.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return list;
};
