import { jitter } from '../utils.js';

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

export const fetchIndexHistory = async (secid, days = 180) => {
  if (!secid) return [];
  await jitter(100, 300);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5&fields2=f51,f52&klt=101&fqt=1&lmt=${days}&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  const text = await fetchText(url);
  const json = parseJsonp(text);
  const klines = json?.data?.klines || [];
  return klines.map((line) => {
    const parts = line.split(',');
    return { date: parts[0], close: Number(parts[1]) };
  }).filter((it) => Number.isFinite(it.close));
};
