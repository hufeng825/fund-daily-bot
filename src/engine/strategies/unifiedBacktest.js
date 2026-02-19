import { rsi, sma } from '../analytics.js';

const addSample = (store, key, ret, side, rule, maxDrawdown = 0) => {
  if (!store[key]) {
    store[key] = { key, name: key, side, rule, wins: 0, sample: 0, sumRet: 0, sumDrawdown: 0 };
  }
  const bucket = store[key];
  bucket.sample += 1;
  bucket.sumRet += ret;
  bucket.sumDrawdown += maxDrawdown;
  if ((side === 'buy' && ret > 0) || (side === 'sell' && ret < 0)) bucket.wins += 1;
};

const groupOf = (key) => {
  if (/低估值|高估值/.test(key)) return 'valuation';
  if (/回撤/.test(key)) return 'drawdown';
  if (/九转/.test(key)) return 'td';
  if (/波段/.test(key)) return 'swing';
  if (/RSI/.test(key)) return 'rsi';
  if (/强势带|弱势带/.test(key)) return 'trend';
  return 'other';
};

export const calcUnifiedBacktest = (history, lookahead = 20, minSample = 20) => {
  if (!Array.isArray(history) || history.length < Math.max(60, lookahead + 10)) {
    return { items: [], map: {}, minSample };
  }
  const values = history.map((p) => p.value).filter((v) => Number.isFinite(v));
  if (values.length < Math.max(60, lookahead + 10)) {
    return { items: [], map: {}, minSample };
  }
  const ma20 = sma(values, 20);
  const ma60 = sma(values, 60);
  const rsi14 = rsi(values, 14);
  const offset20 = values.length - ma20.length;
  const offset60 = values.length - ma60.length;
  const offsetRsi = values.length - rsi14.length;
  const min = Math.min(...values);
  const max = Math.max(...values);

  let upCount = 0;
  let downCount = 0;
  let peak = values[0];
  let lastSwing = null;
  let lastTrend = null;
  const store = {};

  for (let i = 4; i < values.length - lookahead; i += 1) {
    const v = values[i];
    const prev = values[i - 1];
    const ret = (values[i + lookahead] - v) / v;
    const windowEnd = Math.min(values.length - 1, i + lookahead);
    let minWin = v;
    for (let j = i + 1; j <= windowEnd; j += 1) {
      if (values[j] < minWin) minWin = values[j];
    }
    const maxDrawdown = v ? (minWin - v) / v : 0;

    if (v > prev) { upCount += 1; downCount = 0; }
    else if (v < prev) { downCount += 1; upCount = 0; }

    if (upCount >= 9) addSample(store, '九转卖', ret, 'sell', '连续上涨计数≥9', maxDrawdown);
    if (downCount >= 9) addSample(store, '九转买', ret, 'buy', '连续下跌计数≥9', maxDrawdown);

    if (downCount >= 3 && v > prev) addSample(store, '神奇反转', ret, 'buy', '连续下跌后转强', maxDrawdown);
    if (upCount >= 3 && v < prev) addSample(store, '神奇转弱', ret, 'sell', '连续上涨后转弱', maxDrawdown);

    if (v > peak) peak = v;
    const dd = peak ? (v - peak) / peak : 0;
    if (dd <= -0.1) addSample(store, '回撤抄底', ret, 'buy', '回撤≤-10%', maxDrawdown);

    const ma20v = ma20[i - offset20];
    const ma60v = ma60[i - offset60];
    const prev20 = ma20[i - offset20 - 1];
    const prev60 = ma60[i - offset60 - 1];
    if (Number.isFinite(ma20v) && Number.isFinite(ma60v) && Number.isFinite(prev20) && Number.isFinite(prev60)) {
      if (prev20 <= prev60 && ma20v > ma60v) {
        addSample(store, '波段多', ret, 'buy', 'MA20上穿MA60', maxDrawdown);
        lastSwing = '多';
      }
      if (prev20 >= prev60 && ma20v < ma60v) {
        addSample(store, '波段空', ret, 'sell', 'MA20下穿MA60', maxDrawdown);
        lastSwing = '空';
      }
      if (!lastSwing) lastSwing = ma20v > ma60v ? '多' : '空';
    }

    const rsiVal = rsi14[i - offsetRsi];
    if (Number.isFinite(rsiVal) && rsiVal <= 30) addSample(store, 'RSI超卖', ret, 'buy', 'RSI≤30', maxDrawdown);
    if (Number.isFinite(rsiVal) && rsiVal >= 70) addSample(store, 'RSI超买', ret, 'sell', 'RSI≥70', maxDrawdown);

    const pos = max === min ? 0.5 : (v - min) / (max - min);
    if (pos <= 0.2) addSample(store, '低估值', ret, 'buy', '历史分位≤20%', maxDrawdown);
    if (pos >= 0.8) addSample(store, '高估值', ret, 'sell', '历史分位≥80%', maxDrawdown);

    if (Number.isFinite(ma20v) && Number.isFinite(ma60v)) {
      const slope = Number.isFinite(prev20) ? (ma20v - prev20) / Math.max(1e-6, prev20) : 0;
      const gap = (ma20v - ma60v) / Math.max(1e-6, ma60v);
      const bull = v > ma20v && ma20v > ma60v && slope > 0;
      const bear = v < ma20v && ma20v < ma60v && slope < 0;
      const strength = Math.abs(gap) >= 0.03 ? '强' : Math.abs(gap) >= 0.015 ? '中' : '弱';
      const tag = bull ? `强势带·${strength}` : bear ? `弱势带·${strength}` : '';
      if (tag && tag !== lastTrend) {
        addSample(store, tag, ret, bull ? 'buy' : 'sell', '趋势强弱带切换', maxDrawdown);
        lastTrend = tag;
      }
    }
  }

  const items = Object.values(store).map((it) => {
    const winRate = it.sample ? it.wins / it.sample : null;
    const avgRet = it.sample ? it.sumRet / it.sample : null;
    const maxDrawdown = it.sample ? (it.sumDrawdown / it.sample) : null;
    return { ...it, winRate, avgRet, maxDrawdown, group: groupOf(it.key) };
  });
  const map = items.reduce((acc, it) => {
    acc[it.key] = it;
    return acc;
  }, {});
  const groupStore = {};
  items.forEach((it) => {
    const g = it.group || 'other';
    if (!groupStore[g]) {
      groupStore[g] = { group: g, name: g, wins: 0, sample: 0, sumRet: 0, sumDrawdown: 0 };
    }
    const bucket = groupStore[g];
    bucket.sample += it.sample || 0;
    bucket.wins += it.wins || 0;
    bucket.sumRet += it.sumRet || 0;
    bucket.sumDrawdown += it.sumDrawdown || 0;
  });
  const groups = Object.values(groupStore).reduce((acc, g) => {
    const winRate = g.sample ? g.wins / g.sample : null;
    const avgRet = g.sample ? g.sumRet / g.sample : null;
    const maxDrawdown = g.sample ? g.sumDrawdown / g.sample : null;
    acc[g.group] = { ...g, winRate, avgRet, maxDrawdown };
    return acc;
  }, {});
  return { items, map, groups, minSample };
};
