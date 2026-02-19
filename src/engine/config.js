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
  liquidityLow: 0.5,
  liquidityHigh: 5,
  liquidityReportLow: 50,
  liquidityReportHigh: 150
};

export const FACTOR_WEIGHTS = {
  base: {
    trend: 0.15,
    oversold: 0.15,
    sentiment: 0.08,
    risk: 0.25,
    fund_flow: 0.12,
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
  minConfidence: '中'
};
