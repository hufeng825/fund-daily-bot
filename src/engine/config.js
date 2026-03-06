export const THRESHOLDS = {
  trendGood: 70,
  trendWarn: 50,
  lowEstimatePos: 0.2,
  highEstimatePos: 0.8,
  zLow: -1.2,
  zHigh: 1.2,
  drawdownLow: 0.15,
  drawdownHigh: 0.3
};

export const INDICATOR_CONFIG = {
  minSignalDays: 120,
  minPerfDays: 60,
  minRsiDays: 14,
  lookaheadDays: 40,
  backtestMinSample: 60,
  winRateStrict: 0.55,
  seasonalMinMonths: 8,
  seasonalHighMonths: 24
};

export const STRATEGY_WINDOW = {
  days: 720
};

export const HISTORY_WINDOWS = {
  signalDays: STRATEGY_WINDOW.days,
  riskDays: STRATEGY_WINDOW.days,
  valuationDays: STRATEGY_WINDOW.days,
  seasonalityDays: STRATEGY_WINDOW.days
};

export const QUANT_THRESHOLDS = {
  targetVol: { bond: 0.06, equity: 0.15, qdii: 0.18 },
  riskBudget: { bond: 0.12, equity: 0.18, qdii: 0.25 },
  softDrawdown: -0.08,
  hardDrawdown: -0.15,
  consistencyGap: 1.2,
  trendStrength: 2,
  winRateLow: 0.5,
  premiumThreshold: {
    default: 0.01,
    etf: 0.008,
    linked: 0.006,
    otc: 0.012,
    qdii: 0.012,
    commodity: 0.012,
    reits: 0.01
  },
  intradayUp: 0.012,
  intradayDown: -0.012,
  liquidityLow: 0.5,
  liquidityHigh: 5,
  liquidityReportLow: 50,
  liquidityReportHigh: 150
};

export const FACTOR_WEIGHTS = {
  base: {
    trend: 0.08,
    oversold: 0.12,
    sentiment: 0.05,
    risk: 0.3,
    fund_flow: 0.08,
    intraday: 0.06,
    liquidity: 0.1,
    consistency: 0.1,
    linkage: 0.05
  },
  tiltBase: 0.5,
  tiltDiv: 200
};

export const UI_THRESHOLDS = {
  winRateBuy: 0.58,
  winRateSell: 0.5,
  riskLow: 0.15,
  riskHigh: 0.3,
  scoreGood: 70,
  scoreWarn: 50
};

export const SEASONAL_SIGNAL = {
  lowPct: 0.2,
  highPct: 0.8
};

export const STRATEGY_GATES = {
  minDataQuality: 'mid',
  minCoverageRatio: 0.6,
  minConfidence: '中',
  driftDrop: 0.08,
  driftMinWin: 0.48,
  minBacktestSample: 40,
  minBacktestWin: 0.53,
  cooldownBase: 7,
  cooldownVolHigh: 0.03,
  cooldownVolExtreme: 0.05,
  cooldownAddHigh: 3,
  cooldownAddExtreme: 6,
  minHoldDaysC: 7
};

export const STRATEGY_DECISION_V2 = {
  thresholds: {
    buy: 1.6,
    buySoft: 1.9,
    buyContext: 1.1,
    sell: -2.2,
    sellSoft: -2.6
  },
  weights: {
    plan: 1.4,
    indicator: 1.0,
    backtest: 0.9,
    ai: 0.6,
    valuation: 0.8,
    trend: 0.7,
    tieBreaker: 0.5,
    momentum: 0.6,
    premiumRisk: 0.8,
    highRisk: 1.1,
    tuningPenalty: 0.25,
    tuningBias: 0.2,
    softPenalty: 0.3,
    backtestPenaltyBuy: 0.3,
    backtestPenaltySell: 0.2
  },
  momentum: {
    buy: -0.02,
    sell: 0.025,
    bearConfirm: 0.015,
    sellSuppress: -0.01,
    intradaySellSuppressPct: -0.8,
    meanReversionBuyPct: -1.2,
    meanReversionSellPct: 2.8,
    confirmMinSamples: 3,
    confirmLookback: 5,
    confirmPct: 0.18
  },
  rebalanceBand: {
    base: 0.04,
    costScale: 20,
    volScale: 1.5,
    max: 0.22
  },
  costs: {
    feeBps: { money: 4, bond: 8, equity: 12, qdii: 18, commodity: 18 },
    slippageBps: { money: 2, bond: 3, equity: 5, qdii: 8, commodity: 8 },
    timingBps: { intraday: 3, close: 1 }
  },
  distributionGuard: {
    minPool: 12,
    buyMaxRatio: 0.62,
    sellMaxRatio: 0.58,
    holdMaxRatio: 0.7,
    blockedMaxRatio: 0.35
  },
  portfolioGuard: {
    sameSideMaxRatio: 0.62,
    sameSideMaxCount: 6
  },
  regime: {
    trend: { trendScoreMin: 68, volMax: 0.022 },
    panic: { drawdownMin: 0.26, volMin: 0.035, intradayDropPct: -2.2 }
  },
  hardGuards: {
    inconsistentDataStop: true,
    minCoverageHard: 0.25
  }
};

export const STRATEGY_VERSION = '2026.02.27';
