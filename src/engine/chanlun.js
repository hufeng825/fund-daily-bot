const toPoints = (series) => series.map((p, idx) => ({ idx, date: p.date || p.t, price: p.value ?? p.v }));

export const buildChanlun = ({ series = [], minGap = 5, minPct = 0.01 }) => {
  const points = toPoints(series).filter((p) => Number.isFinite(p.price));
  if (points.length < 10) return { strokes: [], centers: [], signals: [], trend: { direction: '震荡', strength: 0, completion: 0 } };
  const pivots = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (curr.price >= prev.price && curr.price >= next.price) pivots.push({ ...curr, type: 'top' });
    if (curr.price <= prev.price && curr.price <= next.price) pivots.push({ ...curr, type: 'bottom' });
  }
  const strokes = [];
  let last = null;
  for (const p of pivots) {
    if (!last) { last = p; continue; }
    if (p.type === last.type) {
      if (p.type === 'top' && p.price >= last.price) last = p;
      if (p.type === 'bottom' && p.price <= last.price) last = p;
      continue;
    }
    const gap = p.idx - last.idx;
    const pct = Math.abs(p.price - last.price) / Math.max(1e-6, last.price);
    if (gap >= minGap && pct >= minPct) {
      strokes.push({ from: last, to: p, side: p.type === 'top' ? 'up' : 'down' });
      last = p;
    }
  }
  const centers = [];
  for (let i = 2; i < strokes.length; i += 1) {
    const a = strokes[i - 2];
    const b = strokes[i - 1];
    const c = strokes[i];
    const highs = [a.from.price, a.to.price, b.from.price, b.to.price, c.from.price, c.to.price];
    const high = Math.min(Math.max(...highs), Math.max(a.from.price, a.to.price, b.from.price, b.to.price, c.from.price, c.to.price));
    const low = Math.max(Math.min(...highs), Math.min(a.from.price, a.to.price, b.from.price, b.to.price, c.from.price, c.to.price));
    if (low <= high) centers.push({ idx: i, high, low, center: (high + low) / 2, range: high - low });
  }
  const lastPrice = points[points.length - 1]?.price;
  const lastCenter = centers[centers.length - 1];
  const pricePos = lastCenter && Number.isFinite(lastPrice)
    ? lastPrice > lastCenter.high ? '上轨上方'
      : lastPrice < lastCenter.low ? '下轨下方'
        : '中枢内'
    : '未知';
  const signals = [];
  if (strokes.length >= 3 && lastCenter) {
    const lastStroke = strokes[strokes.length - 1];
    const prevStroke = strokes[strokes.length - 2];
    const prev2 = strokes[strokes.length - 3];
    if (lastStroke.side === 'down' && lastStroke.to.price <= lastCenter.low * 1.01) signals.push({ type: '一买', side: 'buy', strength: '强', date: lastStroke.to.date });
    if (prevStroke.side === 'up' && lastStroke.side === 'down' && lastStroke.to.price >= lastCenter.low && lastStroke.to.price <= lastCenter.center) signals.push({ type: '二买', side: 'buy', strength: '中', date: lastStroke.to.date });
    if (prev2.side === 'up' && prevStroke.side === 'down' && lastStroke.side === 'up' && lastStroke.to.price > lastCenter.high) signals.push({ type: '三买', side: 'buy', strength: '中', date: lastStroke.to.date });
    if (lastStroke.side === 'up' && lastStroke.to.price >= lastCenter.high * 0.99) signals.push({ type: '一卖', side: 'sell', strength: '强', date: lastStroke.to.date });
    if (lastStroke.side === 'up' && lastStroke.to.price > lastCenter.high * 1.02) signals.push({ type: '三卖', side: 'sell', strength: '强', date: lastStroke.to.date });
  }
  const trend = (() => {
    if (strokes.length < 2) return { direction: '震荡', strength: 0, completion: 0 };
    const lastTwo = strokes.slice(-2);
    const dir = lastTwo[1].side === 'up' ? '上涨' : lastTwo[1].side === 'down' ? '下跌' : '震荡';
    const len1 = Math.abs(lastTwo[0].to.price - lastTwo[0].from.price);
    const len2 = Math.abs(lastTwo[1].to.price - lastTwo[1].from.price);
    const strength = Math.min(100, Math.round((len2 / Math.max(1e-6, len1)) * 50));
    const avgLen = strokes.slice(-5).reduce((s, st) => s + Math.abs(st.to.price - st.from.price), 0) / Math.max(1, Math.min(5, strokes.length));
    const completion = Math.min(100, Math.round((len2 / Math.max(1e-6, avgLen)) * 100));
    return { direction: dir, strength, completion };
  })();
  return { strokes, centers, signals, trend, lastCenter, pricePos };
};

export const mergeChanlunSignals = ({ baseAction, chanlun, fundTypeConf }) => {
  const typeKey = fundTypeConf?.type_key || '';
  const isIndexLike = /指数|ETF|QDII|联接/.test(fundTypeConf?.type_name || '') || typeKey.startsWith('index_') || typeKey.startsWith('qdii_');
  const weightBase = isIndexLike ? 0.6 : 0.7;
  const weightChan = isIndexLike ? 0.4 : 0.3;
  const buySignals = chanlun.signals.filter((s) => s.side === 'buy');
  const sellSignals = chanlun.signals.filter((s) => s.side === 'sell');
  let action = baseAction;
  let confidenceBoost = 0;
  if (buySignals.length && baseAction === '加仓') confidenceBoost = 0.2;
  if (sellSignals.length && baseAction === '减仓') confidenceBoost = 0.2;
  if (sellSignals.some((s) => s.type === '三卖')) action = '减仓';
  return { action, weightBase, weightChan, confidenceBoost, buySignals, sellSignals, isIndexLike };
};
