const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const shrinkTowardsZero = (v, delta) => {
  if (!Number.isFinite(v) || !Number.isFinite(delta) || delta <= 0) return v;
  if (v > 0) return Math.max(0, v - delta);
  if (v < 0) return Math.min(0, v + delta);
  return v;
};

export const normalizeBias = (v) => {
  if (!v) return 'neutral';
  if (v === 'buy' || v === '加仓' || v === '偏多') return 'buy';
  if (v === 'sell' || v === '减仓' || v === '谨慎') return 'sell';
  return 'neutral';
};

export const evaluateDecisionKernel = (input) => {
  const {
    planSide,
    quality,
    risk,
    valuation,
    momentum,
    trend,
    biases,
    backtest,
    costs,
    tuning,
    context,
    config
  } = input;

  const reasons = [];
  const overrideReasons = [];
  const withOverride = (reason) => {
    reasons.push(reason);
    overrideReasons.push(reason);
  };
  if (quality.hardBlock) reasons.push('数据质量/覆盖严重不足');
  else if (quality.softBlock) reasons.push('数据质量一般（降级执行）');
  if (!backtest.hardSampleOk) reasons.push(`回测样本偏低（${backtest.sample}/${backtest.minSample})`);
  if (Number.isFinite(backtest.winRate)) reasons.push(`回测胜率 ${(backtest.winRate * 100).toFixed(1)}%`);
  if (Number.isFinite(backtest.expectancy)) reasons.push(`回测期望（扣费） ${(backtest.expectancy * 100).toFixed(2)}%`);
  if (risk.highRisk) reasons.push('回撤偏高');
  if (risk.premiumRisk) reasons.push('溢价偏高');
  if (quality.cooldown) reasons.push('冷静期内仅试探执行');

  const sideToNum = (side) => (side === 'buy' ? 1 : side === 'sell' ? -1 : 0);
  const contributions = {};
  const addContribution = (key, value) => {
    if (!Number.isFinite(value) || value === 0) return;
    contributions[key] = (contributions[key] || 0) + value;
  };

  const regime = (() => {
    const vol = input?.metrics?.vol;
    const trendScore = input?.metrics?.trendScore;
    const mdd = input?.metrics?.mddValue;
    const panicCfg = config?.regime?.panic || {};
    const trendCfg = config?.regime?.trend || {};
    if (
      risk.highRiskExtreme
      || risk.premiumRiskExtreme
      || (Number.isFinite(mdd) && mdd >= (panicCfg.drawdownMin ?? 0.26))
      || (Number.isFinite(vol) && vol >= (panicCfg.volMin ?? 0.035))
    ) return 'risk_off';
    if (Number.isFinite(trendScore) && trendScore >= (trendCfg.trendScoreMin ?? 68) && (!Number.isFinite(vol) || vol <= (trendCfg.volMax ?? 0.022))) {
      return 'trend';
    }
    return 'range';
  })();

  const planScore = sideToNum(planSide) * 0.35;
  const indicatorScore = sideToNum(biases.indicator) * 0.45;
  const backtestDirScore = sideToNum(biases.backtest) * (backtest.hardSampleOk ? 0.55 : backtest.softSampleOk ? 0.25 : 0.1);
  const aiScore = sideToNum(biases.ai) * 0.25;
  const valuationScore = valuation.level === 'good' ? 0.95 : valuation.level === 'bad' ? -0.95 : 0;
  const trendScoreTerm = trend.level === 'good' ? 0.75 : trend.level === 'bad' ? -0.75 : 0;
  const tieBreakerScore = sideToNum(context.tieBreakerSide) * 0.3;
  const momentumScore = Number.isFinite(momentum.value)
    ? (momentum.value <= config.momentum.buy ? 0.55 : momentum.value >= config.momentum.sell ? -0.55 : 0)
    : 0;
  const intradayReversionScore = Number.isFinite(momentum.intradayPct)
    ? (
      momentum.intradayPct <= config.momentum.meanReversionBuyPct
        ? 0.35
        : momentum.intradayPct >= config.momentum.meanReversionSellPct
          ? -0.35
          : 0
    )
    : 0;
  const edgeScore = Number.isFinite(backtest.edgeScore) ? clamp(backtest.edgeScore, -1.1, 1.1) * 0.85 : 0;

  addContribution('plan', planScore);
  addContribution('indicator', indicatorScore);
  addContribution('backtestDir', backtestDirScore);
  addContribution('ai', aiScore);
  addContribution('valuation', valuationScore);
  addContribution('trend', trendScoreTerm);
  addContribution('tieBreaker', tieBreakerScore);
  addContribution('momentum', momentumScore);
  addContribution('intradayReversion', intradayReversionScore);
  addContribution('edge', edgeScore);

  let signalScore = planScore
    + indicatorScore
    + backtestDirScore
    + aiScore
    + valuationScore
    + trendScoreTerm
    + tieBreakerScore
    + momentumScore
    + intradayReversionScore
    + edgeScore;

  if (context?.consensus?.conflict) {
    const conflictPenalty = backtest.hardSampleOk ? 0.18 : 0.3;
    const nextScore = shrinkTowardsZero(signalScore, conflictPenalty);
    const applied = nextScore - signalScore;
    signalScore = nextScore;
    addContribution('conflictPenalty', applied);
    reasons.push(`信号冲突（买 ${context.consensus.buyVotes} / 卖 ${context.consensus.sellVotes}），降档执行`);
  }

  let riskLoad = 0;
  if (risk.highRisk) riskLoad += 0.75;
  if (risk.premiumRisk) riskLoad += 0.6;
  if (risk.volTargetBreach) {
    riskLoad += risk.volTargetExtreme ? 0.65 : 0.35;
    if (Number.isFinite(risk.volValue) && Number.isFinite(risk.targetVol)) {
      reasons.push(`波动超目标（${(risk.volValue * 100).toFixed(2)}% > ${(risk.targetVol * 100).toFixed(2)}%）`);
    }
  }
  if (quality.softBlock) riskLoad += 0.45;
  if (!backtest.softSampleOk) riskLoad += 0.45;
  if (!backtest.softWinOk) riskLoad += 0.4;
  if (tuning.lowWin) riskLoad += 0.35;
  if (Number.isFinite(costs?.totalPenalty) && costs.totalPenalty > 0.0012) {
    const costDrag = clamp(costs.totalPenalty * 120, 0, 0.45);
    riskLoad += costDrag;
    reasons.push(`交易成本估计 ${(costs.totalPenalty * 100).toFixed(2)}%（含滑点/时点）`);
  }
  const riskPenalty = riskLoad * 0.55;
  signalScore -= riskPenalty;
  addContribution('riskPenalty', -riskPenalty);

  const bullishEvidence = (valuation.level === 'good' ? 0.7 : 0)
    + (trend.level === 'good' ? 0.6 : 0)
    + (planSide === 'buy' ? 0.35 : 0)
    + (biases.backtest === 'buy' ? 0.45 : 0);
  const bearishEvidence = (valuation.level === 'bad' ? 0.75 : 0)
    + (trend.level === 'bad' ? 0.65 : 0)
    + (planSide === 'sell' ? 0.4 : 0)
    + (biases.backtest === 'sell' ? 0.45 : 0)
    + (risk.highRisk ? 0.5 : 0);

  const severeBearRisk = risk.highRisk || risk.premiumRisk || regime === 'risk_off' || bearishEvidence >= 1.2;
  const bullishContext = !risk.highRisk && !risk.premiumRisk && bullishEvidence >= 0.95;
  const bearishContext = bearishEvidence >= 0.95;
  const extremeRisk = risk.highRiskExtreme || risk.premiumRiskExtreme || regime === 'risk_off';

  const gates = regime === 'trend'
    ? { buy: 1.2, sell: -1.55, buyRecovery: 1.35, sellRecovery: -1.8 }
    : regime === 'risk_off'
      ? { buy: 1.8, sell: -1.05, buyRecovery: 2.0, sellRecovery: -1.2 }
      : { buy: 1.4, sell: -1.4, buyRecovery: 1.6, sellRecovery: -1.6 };

  let action = '观望';
  let phase = 'score_gate';
  let lockLevel = 0;
  const setAction = (nextAction, { reason = '', level = 10, terminal = false } = {}) => {
    if (level < lockLevel) return false;
    action = nextAction;
    lockLevel = level;
    if (reason) withOverride(reason);
    if (terminal) phase = 'final';
    return true;
  };

  if (quality.hardBlock) {
    setAction('不可执行', { reason: '硬门控：数据质量不达标，暂停执行', level: 100, terminal: true });
  }

  if (phase !== 'final') {
    if (signalScore >= gates.buy && !risk.premiumRiskExtreme) {
      setAction('加仓', { level: 20 });
    } else if (signalScore <= gates.sell && (severeBearRisk || bearishContext)) {
      setAction('减仓', { level: 20 });
    }
  }

  const rebalanceBand = (() => {
    const cfg = config?.rebalanceBand || {};
    const base = Number.isFinite(cfg.base) ? cfg.base : 0.08;
    const costScale = Number.isFinite(cfg.costScale) ? cfg.costScale : 40;
    const volScale = Number.isFinite(cfg.volScale) ? cfg.volScale : 3;
    const maxBand = Number.isFinite(cfg.max) ? cfg.max : 0.4;
    const costBand = Number.isFinite(costs?.totalPenalty) ? costs.totalPenalty * costScale : 0;
    const volBand = Number.isFinite(input?.metrics?.vol) ? input.metrics.vol * volScale : 0;
    return clamp(base + costBand + volBand, base, maxBand);
  })();
  const rebalanceGuardEnabled = quality.softBlock || !backtest.hardSampleOk || Boolean(context?.consensus?.conflict);
  if (phase !== 'final' && rebalanceGuardEnabled && action === '加仓' && signalScore < (gates.buy + rebalanceBand)) {
    setAction('观望', { reason: `阈值再平衡：加仓分差未越过执行带宽（${rebalanceBand.toFixed(2)}）`, level: 52 });
  }
  if (phase !== 'final' && rebalanceGuardEnabled && action === '减仓' && signalScore > (gates.sell - rebalanceBand)) {
    setAction('观望', { reason: `阈值再平衡：减仓分差未越过执行带宽（${rebalanceBand.toFixed(2)}）`, level: 52 });
  }

  if (phase !== 'final' && action === '加仓' && Number.isFinite(momentum.intradayPct) && momentum.intradayPct >= config.momentum.meanReversionSellPct && trend.level !== 'good') {
    setAction('观望', { reason: `终裁风控：盘中上涨 ${momentum.intradayPct.toFixed(2)}%，避免追涨加仓`, level: 82 });
  }
  if (phase !== 'final' && action === '减仓' && Number.isFinite(momentum.value) && momentum.value <= config.momentum.sellSuppress && !extremeRisk) {
    setAction('观望', { reason: '终裁风控：下跌阶段不减仓，避免追跌', level: 82 });
  }
  if (phase !== 'final' && action === '减仓' && Number.isFinite(momentum.intradayPct) && momentum.intradayPct <= config.momentum.intradaySellSuppressPct && !extremeRisk) {
    setAction('观望', { reason: `终裁风控：盘中已下跌 ${momentum.intradayPct.toFixed(2)}%，不做追跌减仓`, level: 82 });
  }

  if (phase !== 'final' && planSide === 'buy' && action === '减仓' && !severeBearRisk) {
    setAction('观望', { reason: '方向保护：原策略偏多，未触发硬风险不翻转减仓', level: 78 });
  }
  if (phase !== 'final' && planSide === 'sell' && action === '加仓' && !bullishContext) {
    setAction('观望', { reason: '方向保护：原策略偏空，未触发强多头不翻转加仓', level: 78 });
  }

  if (phase !== 'final' && action === '观望' && planSide === 'buy' && bullishContext && !severeBearRisk && (signalScore >= gates.buyRecovery || context.swingDominantBuy || backtest.buyDominant)) {
    setAction('加仓', { reason: '多头延续：证据重聚，恢复试探加仓', level: 60 });
  }
  if (phase !== 'final' && action === '观望' && planSide === 'sell' && bearishContext && !extremeRisk && signalScore <= gates.sellRecovery) {
    setAction('减仓', { reason: '空头延续：证据重聚，恢复试探减仓', level: 60 });
  }

  if (phase !== 'final' && action !== '观望' && !backtest.hardSampleOk) {
    const allowLowEvidence = backtest.softSampleOk
      && backtest.softWinOk
      && Math.abs(signalScore) >= (Math.abs(action === '加仓' ? gates.buy : gates.sell) + 0.08);
    if (!allowLowEvidence) {
      setAction('观望', { reason: '样本门控：有效样本不足，降级观望', level: 79 });
    }
  }

  if (phase !== 'final' && context?.distribution?.alert) {
    const reason = context.distribution.reason || '全池动作分布异常';
    if (reason.includes('加仓') && action === '加仓') {
      setAction('观望', { reason: `分布守护：${reason}，当前加仓降档`, level: 85 });
    }
    if (reason.includes('减仓') && action === '减仓') {
      setAction('观望', { reason: `分布守护：${reason}，当前减仓降档`, level: 85 });
    }
    if (reason.includes('观望') && action === '观望' && bullishContext && !severeBearRisk && signalScore >= gates.buyRecovery) {
      setAction('加仓', { reason: '分布守护：观望比例过高，恢复试探加仓', level: 58 });
    } else if (
      reason.includes('观望')
      && action === '观望'
      && bearishContext
      && signalScore <= gates.sellRecovery
      && !(Number.isFinite(momentum.value) && momentum.value <= config.momentum.sellSuppress)
      && !(Number.isFinite(momentum.intradayPct) && momentum.intradayPct <= config.momentum.intradaySellSuppressPct)
    ) {
      setAction('减仓', { reason: '分布守护：观望比例过高，恢复试探减仓', level: 58 });
    }
  }

  if (phase !== 'final' && context?.portfolio?.alert && (action === '加仓' || action === '减仓')) {
    setAction('观望', { reason: `组合风控：${context.portfolio.reason}（同向 ${Math.round((context.portfolio.sameSideRatio || 0) * 100)}%）`, level: 84 });
  }

  let tier = 'light';
  if (action === '不可执行') tier = 'normal';
  else if (action === '观望') tier = 'light';
  else {
    let confidence = 0;
    if (backtest.hardSampleOk) confidence += 2;
    else if (backtest.softSampleOk) confidence += 1;
    if (backtest.hardWinOk) confidence += 1;
    else if (backtest.softWinOk) confidence += 0.5;
    if (!quality.softBlock) confidence += 1;
    if (!quality.cooldown) confidence += 0.5;
    if (Math.abs(signalScore) >= 1.9) confidence += 1;
    if (regime === 'risk_off' && action === '减仓') confidence += 0.5;
    if (confidence >= 4) tier = 'strong';
    else if (confidence >= 2.2) tier = 'normal';
    else tier = 'light';
    if (quality.cooldown || !backtest.hardSampleOk) tier = 'light';
  }

  const evidenceScore = (() => {
    let s = 0;
    if (!quality.softBlock) s += 1;
    if (backtest.hardSampleOk) s += 2;
    else if (backtest.softSampleOk) s += 1;
    if (backtest.hardWinOk) s += 2;
    else if (backtest.softWinOk) s += 1;
    if (tier === 'strong') s += 1;
    if (action === '观望') s -= 1;
    return s;
  })();
  const evidenceLevel = evidenceScore >= 5 ? 'high' : evidenceScore >= 3 ? 'medium' : 'low';
  const uiState = quality.hardBlock
    ? 'error'
    : (quality.softBlock || !backtest.hardSampleOk || !backtest.softWinOk ? 'degraded' : 'ready');

  const buy = Math.max(0, signalScore);
  const sell = Math.max(0, -signalScore) + riskLoad * 0.25;
  const diff = buy - sell;

  return {
    action,
    tier,
    reasons,
    overrideReason: overrideReasons[overrideReasons.length - 1] || '',
    overrideReasons,
    regime,
    evidenceLevel,
    uiState,
    contributions,
    scores: { buy, sell, diff },
    debug: { severeBearRisk, bullishContext, bearishContext, signalScore, riskLoad, rebalanceBand }
  };
};
