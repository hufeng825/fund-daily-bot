import { sma } from '../analytics.js';

export const calcSignalBacktest = (values, lookahead = 20) => {
  if (!Array.isArray(values) || values.length < 2) {
    return { tdWin: null, tdSample: 0, swingWin: null, swingSample: 0, ddWin: null, ddSample: 0 };
  }
  const calcWinRate = (idxs) => {
    if (!idxs.length) return { winRate: null, sample: 0 };
    let wins = 0;
    idxs.forEach((idx) => {
      const entry = values[idx];
      const exit = values[idx + lookahead] || values[values.length - 1];
      if (exit > entry) wins += 1;
    });
    return { winRate: wins / idxs.length, sample: idxs.length };
  };

  const tdDownIdx = [];
  for (let i = 9; i < values.length - lookahead; i += 1) {
    const slice = values.slice(i - 9, i + 1);
    let down = 0;
    for (let j = 1; j < slice.length; j += 1) {
      if (slice[j] < slice[j - 1]) down += 1;
      else break;
    }
    if (down >= 7) tdDownIdx.push(i);
  }

  const ma20 = sma(values, 20);
  const ma60 = sma(values, 60);
  const swingIdx = [];
  for (let i = 60; i < values.length - lookahead; i += 1) {
    const ma20v = ma20[i - (values.length - ma20.length)];
    const ma60v = ma60[i - (values.length - ma60.length)];
    if (ma20v && ma60v && ma20v > ma60v) swingIdx.push(i);
  }

  const mddIdx = [];
  let peak = values[0];
  for (let i = 1; i < values.length - lookahead; i += 1) {
    if (values[i] > peak) peak = values[i];
    const dd = (values[i] - peak) / peak;
    if (dd < -0.1) mddIdx.push(i);
  }

  const td = calcWinRate(tdDownIdx);
  const swing = calcWinRate(swingIdx);
  const dd = calcWinRate(mddIdx);
  return {
    tdWin: td.winRate,
    tdSample: td.sample,
    swingWin: swing.winRate,
    swingSample: swing.sample,
    ddWin: dd.winRate,
    ddSample: dd.sample
  };
};
