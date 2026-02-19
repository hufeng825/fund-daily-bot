export const sma = (values, period) => {
  if (values.length < period) return [];
  const res = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) res.push(sum / period);
  }
  return res;
};

export const ema = (values, period) => {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const res = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const next = i === 0 ? v : v * k + prev * (1 - k);
    res.push(next);
    prev = next;
  }
  return res;
};

export const std = (values, period) => {
  if (values.length < period) return [];
  const res = [];
  for (let i = period - 1; i < values.length; i += 1) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    res.push(Math.sqrt(variance));
  }
  return res;
};

export const stdSimple = (values) => {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

export const rsi = (values, period = 14) => {
  if (values.length < period + 1) return [];
  const gains = [];
  const losses = [];
  for (let i = 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }
  const res = [];
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  res.push(100 - 100 / (1 + avgGain / (avgLoss || 1)));
  for (let i = period; i < gains.length; i += 1) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    res.push(100 - 100 / (1 + avgGain / (avgLoss || 1)));
  }
  return res;
};

export const maxDrawdown = (values) => {
  if (!values.length) return 0;
  let peak = values[0];
  let maxDD = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > peak) peak = values[i];
    const dd = (values[i] - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return Math.abs(maxDD);
};

export const annualizedReturn = (values) => {
  if (values.length < 2) return null;
  const total = values[values.length - 1] / values[0] - 1;
  const years = (values.length - 1) / 252;
  return (1 + total) ** (1 / years) - 1;
};

export const annualizedVol = (returns) => {
  if (!returns.length) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
};

export const sharpeRatio = (annRet, annVol) => {
  if (annRet === null || annVol === null || annVol === 0) return null;
  return annRet / annVol;
};

export const correlation = (a, b) => {
  if (!a.length || !b.length) return null;
  const n = Math.min(a.length, b.length);
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = xs[i] - meanX;
    const vy = ys[i] - meanY;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const denom = Math.sqrt(dx * dy);
  if (!denom) return 0;
  return num / denom;
};
