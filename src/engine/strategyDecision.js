import { STRATEGY_DECISION_V2, STRATEGY_GATES, UI_THRESHOLDS, QUANT_THRESHOLDS } from './config.js';
import { evaluateDecisionKernel, normalizeBias } from './decisionKernel.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const mapTypeKeyToRiskClass = (typeKey = '') => {
  if (typeKey.startsWith('money') || typeKey.startsWith('bond')) return 'bond';
  if (typeKey.startsWith('qdii') || typeKey.startsWith('commodity')) return 'qdii';
  return 'equity';
};

const resolveCostPenalty = (typeKey) => {
  const riskClass = mapTypeKeyToRiskClass(typeKey);
  if (riskClass === 'bond') return 0.0008;
  if (riskClass === 'qdii') return 0.0018;
  return 0.0012;
};

const resolveCostProfile = ({ typeKey, costs, marketState }) => {
  const cls = typeKey.startsWith('money')
    ? 'money'
    : typeKey.startsWith('bond')
      ? 'bond'
      : (typeKey.startsWith('qdii') || typeKey.startsWith('commodity'))
        ? 'qdii'
        : 'equity';
  const feeBps = Number(costs?.feeBps?.[cls] ?? costs?.feeBps?.equity ?? 12);
  const slippageBps = Number(costs?.slippageBps?.[cls] ?? costs?.slippageBps?.equity ?? 5);
  const timingBps = Number(costs?.timingBps?.[marketState === 'trading' ? 'intraday' : 'close'] ?? 2);
  const totalBps = feeBps + slippageBps + timingBps;
  return { cls, feeBps, slippageBps, timingBps, totalBps, totalPenalty: totalBps / 10000 };
};

const resolveBacktestMinSample = ({ typeKey }) => {
  const base = STRATEGY_GATES?.minBacktestSample || 40;
  if ((typeKey || '').startsWith('money')) return Math.max(20, Math.floor(base * 0.5));
  if ((typeKey || '').startsWith('bond')) return Math.max(24, Math.floor(base * 0.6));
  if ((typeKey || '').startsWith('qdii') || (typeKey || '').startsWith('commodity')) return Math.max(20, Math.floor(base * 0.5));
  return Math.max(30, Math.floor(base * 0.7));
};

const resolveWinGate = ({ typeKey, vol }) => {
  let gate = STRATEGY_GATES?.minBacktestWin || 0.53;
  if ((typeKey || '').startsWith('bond') || (typeKey || '').startsWith('money')) gate -= 0.03;
  if ((typeKey || '').startsWith('qdii') || (typeKey || '').startsWith('commodity')) gate += 0.01;
  if (Number.isFinite(vol)) {
    if (vol >= 0.03) gate += 0.02;
    if (vol <= 0.015) gate -= 0.01;
  }
  return clamp(gate, 0.5, 0.62);
};

export const computeStrategyDecision = ({
  executionPlan,
  decision,
  signalVote,
  signalBacktest,
  recentMomentum,
  metrics,
  valuationExplain,
  mddValue,
  dataQuality,
  confidence,
  dataCoverage,
  fundTypeConf,
  tuning,
  bestSignal,
  cooldownBlock,
  premium
}) => {
  const typeKey = fundTypeConf?.type_key || '';
  const coverage = Number(dataCoverage?.coverage || 0);
  const inconsistent = Boolean(dataQuality?.inconsistent || dataQuality?.message === '数据源不一致');
  const lowCoverageHard = coverage < (STRATEGY_DECISION_V2?.hardGuards?.minCoverageHard ?? 0.25);
  const hardBlock = inconsistent || lowCoverageHard;
  const qualitySoft = dataQuality?.level === 'low' || ((confidence?.level || '低') === '低');
  const sampleRaw = Number(bestSignal?.sample || 0);
  const sampleEffective = Number(bestSignal?.sampleEffective || 0);
  const sample = sampleEffective || sampleRaw;
  const minSample = resolveBacktestMinSample({ typeKey });
  const winRate = Number.isFinite(bestSignal?.winRate) ? bestSignal.winRate : null;
  const winGate = resolveWinGate({ typeKey, vol: metrics?.vol });
  const avgRet = Number.isFinite(bestSignal?.avgRet) ? bestSignal.avgRet : null;
  const maxDrawdown = Number.isFinite(bestSignal?.maxDrawdown) ? Math.abs(bestSignal.maxDrawdown) : null;
  const fallbackCostPenalty = resolveCostPenalty(typeKey);
  const costProfile = resolveCostProfile({
    typeKey,
    costs: STRATEGY_DECISION_V2?.costs,
    marketState: 'close'
  });
  const costPenalty = Number.isFinite(costProfile.totalPenalty) ? costProfile.totalPenalty : fallbackCostPenalty;
  const expectancy = Number.isFinite(avgRet) ? avgRet - costPenalty : null;
  const edgeScore = Number.isFinite(winRate) ? ((winRate - winGate) * 1.4 + (Number.isFinite(expectancy) ? expectancy * 16 : 0) - (Number.isFinite(maxDrawdown) ? maxDrawdown * 0.8 : 0)) : -0.1;
  const riskClass = mapTypeKeyToRiskClass(typeKey);
  const targetVol = Number(QUANT_THRESHOLDS?.targetVol?.[riskClass]);
  const volValue = Number.isFinite(metrics?.vol) ? metrics.vol : null;
  const volTargetBreach = Number.isFinite(volValue) && Number.isFinite(targetVol) && targetVol > 0
    ? volValue > (targetVol * 1.1)
    : false;
  const volTargetExtreme = Number.isFinite(volValue) && Number.isFinite(targetVol) && targetVol > 0
    ? volValue > (targetVol * 1.35)
    : false;
  const premiumGate = QUANT_THRESHOLDS?.premiumThreshold?.default ?? 0.01;
  const momentumValue = Number.isFinite(recentMomentum?.change) ? recentMomentum.change : null;
  const trendLevel = Number.isFinite(metrics?.trendScore)
    ? (metrics.trendScore >= UI_THRESHOLDS.scoreGood ? 'good' : metrics.trendScore >= UI_THRESHOLDS.scoreWarn ? 'warn' : 'bad')
    : 'neutral';
  const indicatorBias = normalizeBias(signalVote?.side || decision?.stance || executionPlan?.action);
  const backtestBias = normalizeBias(bestSignal?.side || signalVote?.side);
  const aiBias = normalizeBias(tuning?.bias);
  const tieScore = (() => {
    let score = 0;
    if (Number.isFinite(momentumValue)) {
      if (momentumValue <= -0.015) score += 1;
      if (momentumValue >= 0.02) score -= 1;
    }
    if (trendLevel === 'good') score += 0.7;
    if (trendLevel === 'bad') score -= 0.7;
    if (Number.isFinite(mddValue) && mddValue >= UI_THRESHOLDS.riskHigh) score -= 0.8;
    return score;
  })();
  const tieBreakerSide = tieScore >= 0.6 ? 'buy' : tieScore <= -0.6 ? 'sell' : 'neutral';
  const voteSides = [normalizeBias(executionPlan?.action), indicatorBias, backtestBias, aiBias].filter((x) => x === 'buy' || x === 'sell');
  const buyVotes = voteSides.filter((x) => x === 'buy').length;
  const sellVotes = voteSides.filter((x) => x === 'sell').length;
  const voteConflict = buyVotes > 0 && sellVotes > 0;
  const dominantSide = buyVotes === sellVotes
    ? 'neutral'
    : buyVotes > sellVotes
      ? 'buy'
      : 'sell';

  const input = {
    planSide: normalizeBias(executionPlan?.action),
    quality: { hardBlock, softBlock: qualitySoft, cooldown: Boolean(cooldownBlock), inconsistent },
    risk: {
      highRisk: Number.isFinite(mddValue) && mddValue >= UI_THRESHOLDS.riskHigh,
      highRiskExtreme: Number.isFinite(mddValue) && mddValue >= UI_THRESHOLDS.riskHigh * 1.35,
      premiumRisk: Number.isFinite(premium) && premium > premiumGate,
      premiumRiskExtreme: Number.isFinite(premium) && premium >= premiumGate * 1.8,
      volTargetBreach,
      volTargetExtreme,
      targetVol,
      volValue
    },
    valuation: { level: valuationExplain?.level || 'neutral', premium: Number.isFinite(premium) ? premium : null, premiumGate },
    momentum: { value: momentumValue, intradayPct: Number.isFinite(metrics?.intradayPct) ? metrics.intradayPct : null },
    trend: { level: trendLevel },
    biases: {
      indicator: indicatorBias,
      backtest: backtestBias,
      ai: aiBias
    },
    backtest: {
      rawSample: sampleRaw,
      effectiveSample: sampleEffective,
      sample,
      minSample,
      softSampleOk: sample >= Math.max(8, Math.floor(minSample * 0.2)),
      hardSampleOk: sample >= minSample,
      winRate,
      winGate,
      softWinOk: Number.isFinite(winRate) ? winRate >= winGate - 0.02 : false,
      hardWinOk: Number.isFinite(winRate) ? winRate >= winGate : false,
      avgRet,
      maxDrawdown,
      expectancy,
      edgeScore,
      buyDominant: backtestBias === 'buy' && Number.isFinite(winRate) && winRate >= winGate + 0.06
    },
    tuning: { lowWin: Boolean(tuning?.lowWin), bias: tuning?.bias || 'neutral' },
    context: {
      tieBreakerSide,
      swingDominantBuy: false,
      planTier: executionPlan?.actionTier || 'normal',
      consensus: {
        buyVotes,
        sellVotes,
        conflict: voteConflict,
        dominantSide
      },
      distribution: null,
      portfolio: null,
      marketState: null
    },
    metrics: { trendScore: metrics?.trendScore, vol: metrics?.vol, mddValue },
    costs: costProfile,
    config: STRATEGY_DECISION_V2
  };
  const kernel = evaluateDecisionKernel(input);
  const trendLayer = (() => {
    let pass = 0;
    let total = 0;
    const trendScore = Number.isFinite(input?.metrics?.trendScore) ? input.metrics.trendScore : null;
    if (Number.isFinite(trendScore)) {
      total += 2;
      if (trendScore >= 60) pass += 1;
      if (trendScore >= 70) pass += 1;
    }
    const m = Number.isFinite(input?.momentum?.value) ? input.momentum.value : null;
    if (Number.isFinite(m)) {
      total += 1;
      if (m >= -0.01) pass += 1;
    }
    if (Number.isFinite(input?.risk?.volValue) && Number.isFinite(input?.risk?.targetVol) && input.risk.targetVol > 0) {
      total += 1;
      if (input.risk.volValue <= (input.risk.targetVol * 1.1)) pass += 1;
    }
    return total > 0 ? pass / total : 0.5;
  })();
  const valuationLayer = (() => {
    let s = 0.5;
    if (input?.valuation?.level === 'good') s += 0.28;
    else if (input?.valuation?.level === 'bad') s -= 0.28;
    if (Number.isFinite(input?.valuation?.premium)) {
      if (input.valuation.premium <= -0.008) s += 0.14;
      if (input.valuation.premium >= 0.012) s -= 0.14;
    }
    if (input?.trend?.level === 'good') s += 0.08;
    if (input?.trend?.level === 'bad') s -= 0.08;
    return clamp(s, 0, 1);
  })();
  const positionLayer = (() => {
    let s = 0.5;
    if (input?.risk?.highRisk) s -= 0.18;
    if (input?.risk?.premiumRisk) s -= 0.1;
    if (!input?.backtest?.softSampleOk) s -= 0.12;
    if (!input?.backtest?.softWinOk) s -= 0.12;
    if (input?.backtest?.hardSampleOk && input?.backtest?.hardWinOk) s += 0.1;
    return clamp(s, 0, 1);
  })();
  const layerCombined = clamp((trendLayer * 0.4) + (valuationLayer * 0.4) + (positionLayer * 0.2), 0, 1);

  let finalAction = kernel.action;
  let finalTier = kernel.tier;
  const finalReasons = Array.isArray(kernel.reasons) ? [...kernel.reasons] : [];
  const pushReason = (txt) => {
    if (!txt) return;
    if (!finalReasons.includes(txt)) finalReasons.push(txt);
  };

  if (finalAction === '加仓' && trendLayer < 0.4) {
    finalAction = '观望';
    finalTier = 'light';
    pushReason(`趋势门控：趋势评分 ${(trendLayer * 100).toFixed(0)}% < 40%，禁止加仓`);
  }
  if (finalAction === '减仓' && valuationLayer > 0.62 && trendLayer >= 0.6 && !input?.risk?.highRisk) {
    finalAction = '观望';
    finalTier = 'light';
    pushReason('估值门控：低估+趋势偏强，减仓降级为观望');
  }
  if (finalAction === '加仓' && valuationLayer < 0.38 && trendLayer <= 0.55) {
    finalAction = '观望';
    finalTier = 'light';
    pushReason('估值门控：高估或趋势未确认，加仓降级为观望');
  }
  if (finalAction === '加仓' && positionLayer < 0.35) {
    finalAction = '观望';
    finalTier = 'light';
    pushReason('仓位门控：风险预算不足，暂停加仓');
  }
  if (
    finalAction === '观望'
    && !input?.quality?.hardBlock
    && trendLayer >= 0.65
    && valuationLayer >= 0.66
    && positionLayer >= 0.5
    && !input?.risk?.highRisk
    && !input?.risk?.premiumRisk
  ) {
    finalAction = '加仓';
    finalTier = finalTier === 'strong' ? 'strong' : 'normal';
    pushReason('三层共振：趋势/估值/仓位同时满足，恢复加仓');
  }
  if (
    finalAction === '观望'
    && !input?.quality?.hardBlock
    && trendLayer <= 0.38
    && valuationLayer <= 0.4
    && (input?.risk?.highRisk || input?.risk?.premiumRisk)
  ) {
    finalAction = '减仓';
    finalTier = 'light';
    pushReason('三层共振：趋势转弱+高估/高风险，恢复减仓');
  }

  const nextAction = finalAction === '不可执行'
    ? { text: `补齐关键数据后再评估（覆盖率需 >= ${Math.round((STRATEGY_GATES.minCoverageRatio || 0.5) * 100)}%）`, triggerType: 'coverage', triggerValue: Math.round((STRATEGY_GATES.minCoverageRatio || 0.5) * 100) }
    : finalAction === '观望'
      ? { text: `等待分差扩大（当前分差 ${Math.abs(kernel.scores.diff).toFixed(2)}）后执行`, triggerType: 'score_diff', triggerValue: Number(Math.abs(kernel.scores.diff).toFixed(2)) }
      : { text: `按执行节奏分批执行，${executionPlan?.reviewAt || '次日 14:30'} 复核`, triggerType: 'review_at', triggerValue: executionPlan?.reviewAt || '次日 14:30' };
  return {
    finalAction,
    action: finalAction,
    tier: finalTier,
    positionRange: executionPlan?.positionRange || null,
    reasons: finalReasons,
    signalStars: (() => {
      if (finalAction === '不可执行') return 1;
      if (finalAction === '观望') return 3;
      if (finalAction === '加仓') return layerCombined >= 0.76 ? 5 : 4;
      if (finalAction === '减仓') return (input?.risk?.highRisk || layerCombined <= 0.28) ? 1 : 2;
      return 3;
    })(),
    layerScore: {
      trend: Number((trendLayer * 100).toFixed(1)),
      valuation: Number((valuationLayer * 100).toFixed(1)),
      position: Number((positionLayer * 100).toFixed(1)),
      combined: Number((layerCombined * 100).toFixed(1))
    },
    evidenceLevel: kernel.evidenceLevel,
    overrideReason: kernel.overrideReason || '',
    regime: kernel.regime || 'range',
    nextAction,
    uiState: kernel.uiState,
    backtestMeta: {
      sample,
      effectiveSample: sampleEffective,
      rawSample: sampleRaw,
      winRate,
      avgRet,
      maxDrawdown,
      minSample
    },
    executionPlan: {
      trigger: executionPlan?.trigger || valuationExplain?.label || '',
      rhythm: executionPlan?.executionRhythm || '分2-3笔执行',
      invalidation: executionPlan?.invalidCondition || '跌破止损或风险门控触发',
      reviewAt: executionPlan?.reviewAt || '次日 14:30'
    }
  };
};
