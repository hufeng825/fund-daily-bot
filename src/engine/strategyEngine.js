import { THRESHOLDS, INDICATOR_CONFIG, HISTORY_WINDOWS, STRATEGY_WINDOW, UI_THRESHOLDS, FACTOR_WEIGHTS } from './config.js';
import { stdSimple, sma, maxDrawdown } from './analytics.js';
import { computeValuationExplain } from './derive.js';
import { computeQuantMetrics } from './quantModel.js';
import { computeRisk } from './risk.js';
import { calcUnifiedBacktest } from './strategies/unifiedBacktest.js';
import { calcSignalBacktest } from './strategies/signalBacktest.js';
import { detectFundType, mapFundTypeToCategory } from './fundType.js';

export const buildStrategy = ({ history, gsz, dwjz, name = '', code = '', indexHistory = [] }) => {
  const longHistory = Array.isArray(history) ? history : [];
  const metricWindow = STRATEGY_WINDOW.days;
  const fundTypeConf = detectFundType({ fundName: name, fundCode: code });
  const fundCategory = mapFundTypeToCategory(fundTypeConf?.type_key);
  const categoryWindow = fundCategory === 'money' ? 300 : fundCategory === 'bond' ? 600 : fundCategory === 'qdii' ? 1500 : 1800;
  const signalWindow = Math.max(metricWindow, HISTORY_WINDOWS.signalDays || 0);
  const metricHistory = signalWindow ? longHistory.slice(-Math.min(signalWindow, categoryWindow)) : longHistory.slice(-categoryWindow);
  const metricPoints = metricHistory.map((it) => ({ t: it.date, v: it.value }));

  const profile = { latest: { gsz, dwjz } };
  const fund = { gsz, dwjz };

  const metrics = computeQuantMetrics({ metricPoints, longHistory, indexHistory, profile, fund, managerStats: {}, fundTypeConf });
  const valuationExplain = computeValuationExplain({
    values: metricHistory.map((p) => p.value).filter((v) => Number.isFinite(v)),
    metrics,
    profile,
    fund,
    thresholds: THRESHOLDS,
    stdSimple
  });

  const riskHistory = longHistory.slice(-Math.min(STRATEGY_WINDOW.days, categoryWindow));
  const perfStats = computeRisk({ metricPoints, history: riskHistory, metrics });

  const lookahead = fundCategory === 'money' ? 10 : fundCategory === 'bond' ? 20 : fundCategory === 'qdii' ? 60 : INDICATOR_CONFIG.lookaheadDays;
  const baseMin = INDICATOR_CONFIG.backtestMinSample || 60;
  const adaptiveMin = Math.max(30, Math.min(baseMin, Math.floor(categoryWindow * 0.25)));
  const unifiedBacktest = calcUnifiedBacktest(longHistory.slice(-categoryWindow), lookahead, adaptiveMin);

  const signalBacktest = calcSignalBacktest(metricHistory.map((it) => it.value).filter((v) => Number.isFinite(v)), lookahead);

  const trendBand = (() => {
    if (!longHistory.length) return { level: 'neutral', strength: '弱', label: '中性' };
    const values = longHistory.map((it) => it.value).filter((v) => Number.isFinite(v));
    const ma20 = sma(values, 20);
    const ma60 = sma(values, 60);
    const m20 = ma20.length ? ma20[ma20.length - 1] : null;
    const m60 = ma60.length ? ma60[ma60.length - 1] : null;
    const prev20 = ma20.length > 1 ? ma20[ma20.length - 2] : null;
    if (!Number.isFinite(m20) || !Number.isFinite(m60)) return { level: 'neutral', strength: '弱', label: '中性' };
    const slope = Number.isFinite(prev20) ? (m20 - prev20) / Math.max(1e-6, prev20) : 0;
    const gap = (m20 - m60) / Math.max(1e-6, m60);
    const strength = Math.abs(gap) >= 0.03 ? '强' : Math.abs(gap) >= 0.015 ? '中' : '弱';
    if (m20 > m60 && slope > 0) return { level: 'strong', strength, label: `强势带·${strength}` };
    if (m20 < m60 && slope < 0) return { level: 'weak', strength, label: `弱势带·${strength}` };
    return { level: 'neutral', strength, label: '中性' };
  })();

  const signalDowngrade = (() => {
    const map = {};
    const items = unifiedBacktest?.items || [];
    const histLen = Math.max(1, longHistory.length);
    const rateOf = (key) => {
      if (/低估值|高估值/.test(key)) return 0.18;
      if (/回撤/.test(key)) return 0.08;
      if (/九转/.test(key)) return 0.06;
      if (/波段/.test(key)) return 0.04;
      if (/RSI/.test(key)) return 0.08;
      if (/强势带|弱势带/.test(key)) return 0.02;
      return 0.05;
    };
    const sampleMeta = (key, sample, groupSample = 0) => {
      const expected = Math.max(8, Math.round(histLen * rateOf(key)));
      const effectiveSample = Math.max(sample, Math.round(groupSample * 0.6));
      const minSoft = Math.max(6, Math.min(30, Math.round(expected * 0.3)));
      const minHard = Math.max(4, Math.min(15, Math.round(expected * 0.15)));
      const level = effectiveSample >= expected * 0.6 ? '高' : effectiveSample >= expected * 0.3 ? '中' : '低';
      return { expected, minSoft, minHard, level, effectiveSample };
    };
    items.forEach((it) => {
      const groupSample = unifiedBacktest?.groups?.[it.group]?.sample || 0;
      const meta = sampleMeta(it.key, it.sample || 0, groupSample);
      const lowSample = meta.effectiveSample < meta.minSoft;
      const veryLowSample = meta.effectiveSample < meta.minHard;
      const lowWin = Number.isFinite(it.winRate) && it.winRate < (INDICATOR_CONFIG.winRateStrict || 0.55);
      const trendFilter = it.side === 'buy'
        ? trendBand.level !== 'strong'
        : it.side === 'sell'
          ? trendBand.level !== 'weak'
          : false;
      const drawdownBad = Number.isFinite(it.maxDrawdown) && it.maxDrawdown <= -0.2;
      map[it.key] = {
        ...it,
        lowSample,
        veryLowSample,
        sampleLevel: meta.level,
        sampleExpected: meta.expected,
        sampleMin: meta.minSoft,
        sampleEffective: meta.effectiveSample,
        groupSample,
        lowWin,
        downgraded: !lowSample && lowWin,
        confirmRequired: !lowSample && lowWin,
        trendFiltered: trendFilter,
        drawdownBad
      };
    });
    return map;
  })();

  const bestSignal = (() => {
    const items = unifiedBacktest?.items || [];
    if (!items.length) return null;
    const primary = new Set(['低估值', '高估值', '回撤抄底']);
    const secondary = new Set(['九转买', '九转卖', '波段多', '波段空', '强势带·强', '强势带·中', '弱势带·强', '弱势带·中']);
    const blockList = new Set(['神奇反转', '神奇转弱', 'RSI超卖', 'RSI超买']);
    const candidates = items.filter((it) => (primary.has(it.key) || secondary.has(it.key)) && !blockList.has(it.key));
    const usable = (tier) => candidates.filter((it) => {
      const meta = signalDowngrade?.[it.key];
      if (meta?.downgraded || meta?.trendFiltered) return false;
      if (tier === 'primary' && meta?.veryLowSample) return false;
      if (tier === 'secondary' && meta?.sampleEffective < Math.max(4, meta?.minHard || 4)) return false;
      return Number.isFinite(it.winRate);
    });
    const usablePrimary = usable('primary').filter((it) => primary.has(it.key));
    const usableSecondary = usable('secondary').filter((it) => secondary.has(it.key));
    if (!usablePrimary.length && !usableSecondary.length) return null;
    const weightOf = (key) => {
      if (key.includes('估值') || key.includes('回撤')) return 1.3;
      if (key.includes('强势带') || key.includes('弱势带')) return 0.9;
      if (key.includes('波段') || key.includes('九转')) return 0.8;
      return 0.7;
    };
    const score = (it) => {
      const win = it.winRate || 0;
      const avg = it.avgRet || 0;
      const dd = Number.isFinite(it.maxDrawdown) ? Math.abs(it.maxDrawdown) : 0.25;
      return (win * 0.6 + avg * 1.2 - dd * 0.6) * weightOf(it.key);
    };
    const pool = usablePrimary.length ? usablePrimary : usableSecondary;
    const bestBuy = pool.filter((it) => it.side === 'buy').sort((a, b) => (score(b) - score(a)) || (b.avgRet - a.avgRet))[0];
    const bestSell = pool.filter((it) => it.side === 'sell').sort((a, b) => (score(b) - score(a)) || (b.avgRet - a.avgRet))[0];
    if (bestBuy && bestSell) return score(bestBuy) >= score(bestSell) ? bestBuy : bestSell;
    return bestBuy || bestSell || null;
  })();

  const bestSignalTier = bestSignal
    ? (['低估值', '高估值', '回撤抄底'].includes(bestSignal.key) ? 'primary' : 'secondary')
    : null;

  const decision = (() => {
    if (!metrics || !perfStats || !Number.isFinite(perfStats.mdd)) return null;
    const score = metrics.totalScore;
    const risk = perfStats.mdd;
    const stance = score >= 70 && risk < 0.2 ? '偏多' : score >= 50 ? '中性' : '谨慎';
    const trend = metrics.trendScore >= 70 ? '趋势偏强' : metrics.trendScore >= 50 ? '趋势中性' : '趋势偏弱';
    const oversold = metrics.lastRsi < 30 ? '超卖' : metrics.lastRsi > 70 ? '超买' : '中性';
    const riskLevel = risk < 0.15 ? '低' : risk < 0.3 ? '中' : '高';
    const groups = unifiedBacktest?.groups || {};
    const groupScores = {
      valuation: groups.valuation?.winRate ?? null,
      drawdown: groups.drawdown?.winRate ?? null,
      td: groups.td?.winRate ?? null,
      swing: groups.swing?.winRate ?? null,
      rsi: groups.rsi?.winRate ?? null,
      trend: groups.trend?.winRate ?? null
    };
    const voteWeight = { valuation: 1.6, drawdown: 1.4, td: 0.7, swing: 0.6, rsi: 0.7, trend: 0.4 };
    let buy = 0;
    let sell = 0;
    Object.keys(groupScores).forEach((k) => {
      const w = voteWeight[k] || 0.6;
      const v = groupScores[k];
      if (!Number.isFinite(v)) return;
      if (v >= 0.56) buy += w * v;
      if (v <= 0.44) sell += w * (1 - v);
    });
    const groupBias = buy > sell ? '偏买' : sell > buy ? '偏卖' : '中性';
    return {
      stance,
      trend,
      oversold,
      riskLevel,
      groupBias,
      groupScores,
      explain: `趋势${trend}，RSI${oversold}，最大回撤${(risk * 100).toFixed(2)}%，组回测${groupBias}`
    };
  })();

  const marketType = (() => {
    if (/联接/.test(name)) return 'linked';
    if (/QDII/i.test(name)) return 'qdii';
    if (fundTypeConf?.type_key?.startsWith('commodity_')) return 'commodity';
    if (fundTypeConf?.type_key === 'reits') return 'reits';
    if (/ETF/i.test(name) || /^(5|1|6|9)\d{5}$/.test(code)) return 'etf';
    return 'otc';
  })();

  const premium = Number.isFinite(gsz) && Number.isFinite(dwjz) ? (gsz - dwjz) / dwjz : null;
  const premiumGate = (() => {
    const th = QUANT_THRESHOLDS.premiumThreshold || {};
    const base = th.default ?? 0.01;
    if (marketType === 'linked') return th.linked ?? base;
    if (marketType === 'qdii') return th.qdii ?? base;
    if (marketType === 'commodity') return th.commodity ?? base;
    if (marketType === 'reits') return th.reits ?? base;
    if (marketType === 'etf') return th.etf ?? base;
    if (marketType === 'otc') return th.otc ?? base;
    return base;
  })();

  const riskHigh = fundCategory === 'bond' ? 0.2 : fundCategory === 'qdii' ? 0.35 : 0.3;

  const executionPlan = (() => {
    if (!metrics || !perfStats) return { action: '观望', reasons: ['数据不足'] };
    const groupBias = decision?.groupBias || '中性';
    const preferred = groupBias === '偏买' ? '加仓' : groupBias === '偏卖' ? '减仓' : null;
    let action = preferred || (decision?.stance === '偏多' && valuationExplain.level !== 'bad' ? '加仓'
      : decision?.stance === '谨慎' || valuationExplain.level === 'bad' ? '减仓'
      : '观望');
    const reasons = [];
    if (decision?.groupBias) reasons.push(`组回测倾向：${decision.groupBias}`);
    if (bestSignal?.name && Number.isFinite(bestSignal.winRate)) {
      reasons.push(`回测最优：${bestSignal.name}（胜率 ${(bestSignal.winRate * 100).toFixed(1)}% / 样本 ${bestSignal.sample || 0}）`);
    }
    reasons.push(`趋势：${decision?.trend || '—'}`);
    reasons.push(`估值：${valuationExplain.label}`);
    if (Number.isFinite(premium)) reasons.push(`溢价：${(premium * 100).toFixed(2)}%`);
    if (Number.isFinite(perfStats.mdd)) reasons.push(`回撤：${(perfStats.mdd * 100).toFixed(2)}%`);
    if (metrics.lastRsi) reasons.push(`RSI：${metrics.lastRsi.toFixed(0)}`);
    if (Number.isFinite(perfStats.mdd) && perfStats.mdd >= riskHigh) {
      action = '减仓';
      reasons.push(`风控：回撤≥${(riskHigh * 100).toFixed(0)}%`);
    }
    if (Number.isFinite(premium) && premium > premiumGate && valuationExplain.level !== 'good') {
      action = action === '加仓' ? '观望' : '减仓';
      reasons.push(`溢价门槛：>${(premiumGate * 100).toFixed(2)}%`);
    }
    return { action, reasons };
  })();

  const values = metricHistory.map((it) => it.value).filter((v) => Number.isFinite(v));
  const signalBacktestSimple = calcSignalBacktest(values, lookahead);

  return {
    metrics,
    perfStats,
    valuationExplain,
    decision,
    executionPlan,
    bestSignal,
    bestSignalTier,
    signalBacktest: signalBacktestSimple,
    unifiedBacktest,
    fundTypeConf,
    marketType,
    premium,
    premiumGate,
    riskHigh
  };
};
