import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Shanghai');

const nowInTz = () => dayjs().tz('Asia/Shanghai');

export const computeValuationExplain = ({ values, metrics, profile, fund, thresholds, stdSimple }) => {
  const last = values.length ? values[values.length - 1] : null;
  if (!values.length || !Number.isFinite(last)) {
    return { level: 'warn', label: '估值中性', position: null, z: null, drawdown: null, premium: null, percentile: null, band: null, action: '观望' };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = stdSimple(values) || 0;
  const returns = values.slice(1).map((v, i) => {
    const prev = values[i];
    return prev ? (v - prev) / prev : 0;
  }).filter((v) => Number.isFinite(v));
  const avgAbsRet = returns.length ? (returns.reduce((a, b) => a + Math.abs(b), 0) / returns.length) : 0;
  const ma20 = (() => {
    if (values.length < 20) return null;
    const slice = values.slice(-20);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  })();
  const position = max === min ? 0.5 : (last - min) / (max - min);
  const z = sd > 0 ? (last - mean) / sd : 0;
  const peak = Math.max(...values.slice(-120));
  const drawdown = peak ? (last - peak) / peak : 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.findIndex((v) => v >= last);
  const percentile = rank >= 0 ? rank / Math.max(1, sorted.length - 1) : 0.5;
  const rollWindow = Math.min(60, values.length);
  const recent = values.slice(-rollWindow);
  const rMean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const rStd = stdSimple(recent) || 0;
  const band = rStd ? (last - rMean) / rStd : 0;
  let level = 'warn';
  let label = '估值中性';
  if (position >= thresholds.highEstimatePos || z > thresholds.zHigh || percentile > 0.8 || band > 1.2) {
    level = 'bad';
    label = '估值偏高';
  } else if (position <= thresholds.lowEstimatePos || z < thresholds.zLow || drawdown < -0.08 || percentile < 0.2 || band < -1.2) {
    level = 'good';
    label = '估值偏低';
  }
  const trendScore = metrics?.trendScore ?? 50;
  const trendFilter = trendScore >= 65 ? '趋势强' : trendScore <= 45 ? '趋势弱' : '趋势中性';
  const trendOk = trendScore >= 60;
  let action = '观望';
  if (label === '估值偏低' && trendOk) action = '考虑加仓';
  if (label === '估值偏低' && !trendOk) action = '等待趋势确认';
  if (label === '估值偏高' && !trendOk) action = '考虑减仓';
  if (label === '估值偏高' && trendOk) action = '估值高但趋势强，谨慎减仓';
  const rawGsz = profile?.latest?.gsz ?? fund?.gsz;
  const dwjz = profile?.latest?.dwjz ?? fund?.dwjz ?? last;
  const premium = Number.isFinite(fund?.marketPremium)
    ? fund.marketPremium
    : (Number.isFinite(rawGsz) && Number.isFinite(dwjz) ? (rawGsz - dwjz) / dwjz : null);
  const percentileText = Number.isFinite(percentile) ? `${(percentile * 100).toFixed(1)}%` : '—';
  const explain = `分位 ${percentileText} / 位置 ${(position * 100).toFixed(1)}% / ${trendFilter}`;
  const estimateDays = (() => {
    if (!Number.isFinite(last) || !Number.isFinite(avgAbsRet) || avgAbsRet <= 0) return null;
    const target = Number.isFinite(ma20) ? ma20 : mean;
    const gap = Math.abs(target - last) / Math.max(1e-6, last);
    const rawDays = Math.ceil(gap / Math.max(avgAbsRet, 0.002));
    return Math.max(2, Math.min(30, rawDays));
  })();
  const estimateDate = Number.isFinite(estimateDays) ? nowInTz().add(estimateDays, 'day').format('YYYY-MM-DD') : null;
  const estimateText = estimateDays ? `${estimateDays} 个交易日（约 ${estimateDate}）` : '—';
  return { level, label, position, z, drawdown, premium, percentile, band, action, trendFilter, percentileText, explain, estimateDays, estimateDate, estimateText };
};
