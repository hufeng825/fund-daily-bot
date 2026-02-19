import { QUANT_THRESHOLDS, INDICATOR_CONFIG, FACTOR_WEIGHTS } from './config.js';
import { correlation, maxDrawdown, rsi, sma, std, stdSimple, ema } from './analytics.js';
import { mapFundTypeToQuantKey } from './fundType.js';

const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));

export const computeQuantMetrics = ({ metricPoints, longHistory, indexHistory, profile, fund, managerStats, fundTypeConf }) => {
  const values = metricPoints.map(p => p.v).filter(v => Number.isFinite(v));
  if (values.length < INDICATOR_CONFIG.minRsiDays) {
    return {
      last: values[values.length - 1] || 0,
      lastRsi: 0,
      lastRsi6: 0,
      bbPos: 0,
      vol: 0,
      annVol: 0,
      var5: 0,
      mdd: 0,
      gridPos: 0,
      trendScore: 0,
      oversoldScore: 0,
      sentimentScore: 0,
      riskScore: 0,
      flowScore: 0,
      liquidityScore: null,
      consistencyScore: null,
      linkageScore: null,
      totalScore: 0,
      factorScores: [],
      factorWeights: null,
      factorContrib: null,
      tdUp: 0,
      tdDown: 0,
      magicReversal: '暂无明显信号',
      swingSignal: '暂无明显信号',
      drawdownSignal: '暂无明显信号',
      rsi14: [],
      insufficient: true,
      confidence: '低'
    };
  }
  const returns = values.slice(1).map((v, i) => (v - values[i]) / values[i]).filter(v => Number.isFinite(v));
  const ma5 = sma(values, 5);
  const ma20 = sma(values, 20);
  const ma60 = sma(values, 60);
  const rsi6 = rsi(values, 6);
  const rsi14 = rsi(values, 14);
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = ema12.map((v, i) => v - (ema26[i] ?? v));
  const macdSignal = ema(macdLine, 9);
  const macdHist = macdLine.map((v, i) => v - (macdSignal[i] ?? 0));
  const bbStd = std(values, 20);
  const bbMid = sma(values, 20);
  const last = values[values.length - 1];
  const lastMa5 = ma5.length ? ma5[ma5.length - 1] : last;
  const lastMa20 = ma20.length ? ma20[ma20.length - 1] : last;
  const lastMa60 = ma60.length ? ma60[ma60.length - 1] : lastMa20;
  const lastRsi = rsi14.length ? rsi14[rsi14.length - 1] : 50;
  const lastRsi6 = rsi6.length ? rsi6[rsi6.length - 1] : lastRsi;
  const lastMacd = macdLine.length ? macdLine[macdLine.length - 1] : 0;
  const lastMacdSignal = macdSignal.length ? macdSignal[macdSignal.length - 1] : 0;
  const lastMacdHist = macdHist.length ? macdHist[macdHist.length - 1] : 0;
  const lastBbMid = bbMid.length ? bbMid[bbMid.length - 1] : last;
  const lastBbStd = bbStd.length ? bbStd[bbStd.length - 1] : 0;
  const upper = lastBbMid + 2 * lastBbStd;
  const lower = lastBbMid - 2 * lastBbStd;
  const bbPos = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  const vol = returns.length ? stdSimple(returns) : 0;
  const annVol = vol ? vol * Math.sqrt(252) : 0;
  const var5 = returns.length ? returns.slice().sort((a, b) => a - b)[Math.floor(returns.length * 0.05)] : 0;
  const mdd = maxDrawdown(values);
  const rangeMin = Math.min(...values);
  const rangeMax = Math.max(...values);
  const gridPos = (last - rangeMin) / (rangeMax - rangeMin || 1);

  const valuationPos = rangeMax === rangeMin ? 50 : ((last - rangeMin) / (rangeMax - rangeMin)) * 100;
  const trendStrength = (lastMa5 > lastMa20 ? 1 : 0) + (lastMa20 > lastMa60 ? 1 : 0) + (last > lastMa5 ? 1 : 0);
  const trendScore = clamp(50 + 0.4 * (valuationPos - 50) + 12 * trendStrength);
  const oversoldScore = clamp(0.6 * (100 - valuationPos) + 2 * (50 - lastRsi6));
  const winRate = returns.length ? returns.filter(r => r > 0).length / returns.length : 0;
  const typeKey = mapFundTypeToQuantKey(fundTypeConf?.type_key);
  const volTarget = QUANT_THRESHOLDS.targetVol[typeKey] || 0.15;
  const sentimentScore = clamp(winRate * 60 + (1 - Math.min(annVol / (volTarget * 2), 1)) * 25 + (trendStrength / 3) * 15);

  const managerPenalty = managerStats?.commitment === '低' ? 10 : managerStats?.commitment === '中' ? 5 : 0;
  const volNorm = annVol ? Math.min(annVol / (volTarget * 1.6), 1) : 0;
  const mddNorm = Math.min(mdd / 0.3, 1);
  const riskScore = clamp(100 - volNorm * 45 - mddNorm * 45 - managerPenalty);

  const momentum = values.length > 21 ? (last - values[values.length - 21]) / values[values.length - 21] : 0;
  const gsz = profile?.latest?.gsz ?? fund?.gsz;
  const dwjz = profile?.latest?.dwjz ?? fund?.dwjz;
  const premium = Number.isFinite(fund?.marketPremium)
    ? fund.marketPremium
    : (Number.isFinite(gsz) && Number.isFinite(dwjz) ? (gsz - dwjz) / dwjz : 0);
  const flowScore = clamp(50 + momentum * 200 + premium * 200);

  const liquidityScore = null;

  const netChange = profile?.latest?.zzl ?? profile?.latest?.jzzzl ?? fund?.jzzzl;
  const intraday = fund?.gszzl ?? profile?.latest?.gszzl;
  const consistencyScore = Number.isFinite(netChange) && Number.isFinite(intraday)
    ? clamp(100 - Math.abs(netChange - intraday) * 25)
    : 60;

  let linkageScore = null;
  if (Array.isArray(indexHistory) && indexHistory.length >= 30 && longHistory.length >= 30) {
    const indexMap = new Map(indexHistory.map(it => [it.date, it.close]));
    const aligned = longHistory.filter(it => indexMap.has(it.date)).slice(-120);
    if (aligned.length >= 30) {
      const fundVals = aligned.map(it => it.value);
      const idxVals = aligned.map(it => indexMap.get(it.date));
      const fundRet = fundVals.slice(1).map((v, i) => (v - fundVals[i]) / fundVals[i]).filter(v => Number.isFinite(v));
      const idxRet = idxVals.slice(1).map((v, i) => (v - idxVals[i]) / idxVals[i]).filter(v => Number.isFinite(v));
      const corr = correlation(fundRet, idxRet);
      if (Number.isFinite(corr)) linkageScore = clamp((corr + 1) * 50);
    }
  }

  const factorScores = [
    { key: 'trend', name: '趋势因子', value: trendScore },
    { key: 'oversold', name: '超卖因子', value: oversoldScore },
    { key: 'sentiment', name: '情绪因子', value: sentimentScore },
    { key: 'risk', name: '风险因子', value: riskScore },
    { key: 'fund_flow', name: '资金因子', value: flowScore },
    { key: 'liquidity', name: '流动性因子', value: Number.isFinite(liquidityScore) ? liquidityScore : 50 },
    { key: 'consistency', name: '一致性因子', value: Number.isFinite(consistencyScore) ? consistencyScore : 50 },
    { key: 'linkage', name: '联动因子', value: Number.isFinite(linkageScore) ? linkageScore : 50 }
  ];

  const baseWeights = FACTOR_WEIGHTS.base;
  const appliedWeights = {};
  let sumWeight = 0;
  factorScores.forEach((f) => {
    const base = baseWeights[f.key] || 0;
    const adjusted = base * (FACTOR_WEIGHTS.tiltBase + (f.value || 50) / FACTOR_WEIGHTS.tiltDiv);
    appliedWeights[f.key] = adjusted;
    sumWeight += adjusted;
  });
  if (sumWeight > 0) {
    Object.keys(appliedWeights).forEach((k) => {
      appliedWeights[k] = appliedWeights[k] / sumWeight;
    });
  }
  const totalScore = factorScores.reduce((acc, f) => acc + f.value * (appliedWeights[f.key] || 0), 0);
  const factorContrib = factorScores.reduce((acc, f) => {
    acc[f.key] = (appliedWeights[f.key] || 0);
    return acc;
  }, {});

  const tdUp = values.slice(-10).reduce((acc, v, i, arr) => {
    if (i === 0) return 0;
    return v > arr[i - 1] ? acc + 1 : 0;
  }, 0);
  const tdDown = values.slice(-10).reduce((acc, v, i, arr) => {
    if (i === 0) return 0;
    return v < arr[i - 1] ? acc + 1 : 0;
  }, 0);

  const kdj = (() => {
    const period = 9;
    if (values.length < period) return { k: null, d: null, j: null };
    let k = 50;
    let d = 50;
    for (let i = period - 1; i < values.length; i += 1) {
      const slice = values.slice(i - period + 1, i + 1);
      const low = Math.min(...slice);
      const high = Math.max(...slice);
      const rsv = high === low ? 50 : ((values[i] - low) / (high - low)) * 100;
      k = (2 / 3) * k + (1 / 3) * rsv;
      d = (2 / 3) * d + (1 / 3) * k;
    }
    const j = 3 * k - 2 * d;
    return { k, d, j };
  })();

  const magicReversal = returns.slice(-4).every(r => r > 0) && returns[returns.length - 1] < 0
    ? '连续上涨后转弱'
    : returns.slice(-4).every(r => r < 0) && returns[returns.length - 1] > 0
      ? '连续下跌后反弹'
      : '暂无明显信号';

  const swingSignal = (lastMa20 > lastMa60 && lastRsi > 50)
    ? '偏多信号'
    : '偏空或震荡';

  const drawdownSignal = mdd > 0.15 ? '深度回撤抄底机会' : '回撤可控';

  const confidence = values.length >= INDICATOR_CONFIG.minSignalDays ? '高' : values.length >= 30 ? '中' : '低';

  return {
    last,
    lastRsi,
    lastRsi6,
    macd: lastMacd,
    macdSignal: lastMacdSignal,
    macdHist: lastMacdHist,
    kdjK: kdj.k,
    kdjD: kdj.d,
    kdjJ: kdj.j,
    bbPos,
    vol,
    annVol,
    var5,
    mdd,
    gridPos,
    trendScore,
    oversoldScore,
    sentimentScore,
    riskScore,
    flowScore,
    liquidityScore,
    consistencyScore,
    linkageScore,
    totalScore,
    factorScores,
    factorWeights: { base: baseWeights, applied: appliedWeights },
    factorContrib,
    tdUp,
    tdDown,
    magicReversal,
    swingSignal,
    drawdownSignal,
    rsi14,
    insufficient: values.length < INDICATOR_CONFIG.minSignalDays,
    confidence
  };
};
