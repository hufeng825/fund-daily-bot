import { INDICATOR_CONFIG } from './config.js';
import { annualizedReturn, annualizedVol, maxDrawdown, sharpeRatio } from './analytics.js';

export const computeRisk = ({ metricPoints, history, metrics }) => {
  const values = history.length ? history.map((p) => p.value) : metricPoints.map((p) => p.v);
  if (values.length < 5) {
    return {
      annRet: null,
      annVol: null,
      sharpe: null,
      mdd: null,
      winRate: null,
      recent30: null,
      recent30Insufficient: true,
      insufficient: true
    };
  }
  const returns = values.slice(1).map((v, i) => (v - values[i]) / values[i]);
  const annRet = annualizedReturn(values);
  const annVol = annualizedVol(returns);
  const sharpe = sharpeRatio(annRet, annVol);
  const mdd = maxDrawdown(values);
  const winRate = returns.filter((r) => r > 0).length / returns.length;
  const recent30 = values.length >= 30 ? (values[values.length - 1] - values[values.length - 30]) / values[values.length - 30] : (values.length >= 2 ? (values[values.length - 1] - values[0]) / values[0] : null);
  return {
    annRet,
    annVol,
    sharpe,
    mdd,
    winRate,
    recent30,
    recent30Insufficient: values.length < 30,
    insufficient: values.length < INDICATOR_CONFIG.minPerfDays
  };
};
