import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { fetchGszWithRetry, fetchHistory, fetchFundProfileLite } from './fetchers.js';
import { runWithConcurrency, chunk, jitter, todayISO } from './utils.js';
import { buildStrategy } from './engine/strategyEngine.js';
import { getIndexSecidByFund, getFallbackQdiiIndex } from './engine/indexMap.js';
import { fetchIndexHistory } from './engine/indexFetcher.js';

const ROOT = path.resolve(process.cwd());
const cfgPath = path.join(ROOT, 'config', 'funds.json');
const cacheDir = path.join(ROOT, 'cache');
const tzToday = todayISO('Asia/Shanghai');
const nowChinaTime = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const normalizeCode = (c) => String(c || '').replace(/[^\d]/g, '').padStart(6, '0');

const fmtPct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—');

const normalizeActionByHomepageDiscipline = ({ action, diffPct, premium }) => {
  const diff = Number(diffPct);
  const prem = Number(premium);
  const hasDiff = Number.isFinite(diff);
  const hasPrem = Number.isFinite(prem);
  if (action === '观望') {
    if (hasDiff && diff <= -0.25 && (!hasPrem || prem <= 0.025)) return { action: '加仓', tier: 'light', reason: '首页纪律覆盖：盘中回撤触发轻量补仓' };
    if (hasDiff && diff >= 0.95 && (!hasPrem || prem >= 0)) return { action: '减仓', tier: 'light', reason: '首页纪律覆盖：盘中上涨触发轻量止盈' };
    if (hasPrem && prem <= -0.008 && (!hasDiff || diff <= 0.45)) return { action: '加仓', tier: 'light', reason: '首页纪律覆盖：估值折价触发轻量补仓' };
  }
  if (action === '减仓' && hasDiff && diff < 0.75 && (!hasPrem || prem < 0.002)) {
    return { action: '观望', tier: 'light', reason: '首页纪律覆盖：涨幅不足且未明显高估，减仓降级观望' };
  }
  return { action, tier: null, reason: '' };
};

const buildRowLine = (item) => {
  const tierLabel = item.actionTier === 'strong' ? '强确认' : item.actionTier === 'light' ? '试探' : item.actionTier === 'normal' ? '常规' : '';
  const tierText = tierLabel ? `(${tierLabel})` : '';
  return `${item.name} (#${item.code}) | 涨跌 ${fmtPct(item.diffPct)} | 动作 ${item.action}${tierText}${item.positionRange ? `｜仓位 ${item.positionRange}` : ''} | 证据 ${item.evidence || 'low'} | 样本 ${item.btSample || 0} | 胜率 ${item.btWin || '—'} | 下一步 ${item.nextAction || '—'} | 触发 ${item.trigger || '—'} | 失效 ${item.invalidation || '—'} | 复核 ${item.reviewAt || '次日 14:30'} | 依据 ${item.reasons || '—'}`;
};

const isTradingDay = (gz) => {
  const t = gz?.gztime || '';
  if (!t) return false;
  return String(t).startsWith(tzToday);
};

const loadCache = (code) => {
  try {
    const p = path.join(cacheDir, `${code}.json`);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!raw?.date || raw.date !== tzToday) return null;
    return raw.data || null;
  } catch {
    return null;
  }
};

const saveCache = (code, data) => {
  try {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const p = path.join(cacheDir, `${code}.json`);
    fs.writeFileSync(p, JSON.stringify({ date: tzToday, data }, null, 2));
  } catch { }
};

const sendEmail = async (subject, text, html) => {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    MAIL_FROM,
    MAIL_TO
  } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_TO) {
    throw new Error('SMTP env not configured');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 465),
    secure: String(SMTP_PORT || 465) === '465',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  await transporter.sendMail({
    from: MAIL_FROM || SMTP_USER,
    to: MAIL_TO,
    subject,
    text,
    html
  });
};

const main = async () => {
  const cfg = readJson(cfgPath);
  const funds = (cfg.funds || []).map((c) => ({ code: normalizeCode(c) }));

  if (!funds.length) {
    console.log('No funds');
    return;
  }

  const rows = [];
  const riskNotes = [];
  let traded = false;

  const fastMode = String(process.env.FAST_MODE || '1') === '1';
  const concurrency = Number(process.env.FUND_CONCURRENCY || (fastMode ? 10 : 6));
  const preFetchJitterMin = fastMode ? 0 : 120;
  const preFetchJitterMax = fastMode ? 40 : 400;
  const mailJitterMin = fastMode ? 4 : 30;
  const mailJitterMax = fastMode ? 12 : 90;

  const results = await runWithConcurrency(funds, concurrency, async (f) => {
    await jitter(preFetchJitterMin, preFetchJitterMax);
    const gz = await fetchGszWithRetry(f.code, 2);
    const name = gz?.name || f.name || f.code;
    if (!isTradingDay(gz)) {
      return { ...f, name, skip: true, reason: '非交易日或估值未更新', gz };
    }

    let history = loadCache(f.code);
    if (!history) {
      history = await fetchHistory(f.code, 360);
      saveCache(f.code, history);
    }

    let profile = null;
    try {
      profile = await fetchFundProfileLite(f.code);
    } catch {
      profile = null;
    }
    const indexSecid = getIndexSecidByFund(name, profile?.type, profile?.benchmark)
      || getFallbackQdiiIndex(name, profile?.type, profile?.benchmark);
    let indexHistory = [];
    if (indexSecid) {
      try {
        indexHistory = await fetchIndexHistory(indexSecid, 360);
      } catch {
        indexHistory = [];
      }
    }

    const gsz = gz?.gsz ? Number(gz.gsz) : null;
    const dwjz = gz?.dwjz ? Number(gz.dwjz) : null;
    const engine = buildStrategy({
      history,
      gsz,
      dwjz,
      name,
      code: f.code,
      profile,
      indexHistory
    });

    return { ...f, name, gz, gsz, dwjz, history, profile, indexHistory, engine };
  });

  for (const r of results) {
    if (!r.ok) {
      rows.push({ action: '观望', row: `${r.item.code} | 获取失败: ${r.error?.message || 'unknown'}`, actionTier: null, prebuilt: true });
      continue;
    }
    const f = r.data;
    if (f.skip) {
      rows.push({ action: '观望', row: `${f.name} (#${f.code}) | ${f.reason}`, actionTier: null, prebuilt: true });
      continue;
    }
    const diff = (f.gsz && f.dwjz) ? ((f.gsz - f.dwjz) / f.dwjz) * 100 : null;
    const decision = f.engine?.strategyDecision || null;
    const actionRaw = decision?.finalAction || f.engine?.executionPlan?.action || '观望';
    const actionTierRaw = decision?.tier || f.engine?.executionPlan?.actionTier || null;
    const positionRange = decision?.positionRange || f.engine?.executionPlan?.positionRange || null;
    const premium = Number.isFinite(diff) ? diff / 100 : null;
    const overlay = normalizeActionByHomepageDiscipline({ action: actionRaw, diffPct: diff, premium });
    const action = overlay.action;
    const actionTier = overlay.tier || actionTierRaw || null;
    const driver = f.engine?.executionPlan?.driver || '—';
    const trigger = f.engine?.executionPlan?.trigger || decision?.executionPlan?.trigger || '—';
    const nextAction = typeof decision?.nextAction === 'object' ? (decision.nextAction.text || '—') : (decision?.nextAction || '—');
    const instruction = f.engine?.executionPlan?.instructionHint || nextAction;
    if (action === '加仓' || action === '减仓') traded = true;
    const reasonsRaw = (decision?.reasons || f.engine?.executionPlan?.reasons || []).slice(0, 2).join('；') || '—';
    const reasons = overlay.reason ? `${overlay.reason}；${reasonsRaw}` : reasonsRaw;
    const risk = (decision?.reasons || f.engine?.executionPlan?.reasons || []).find((r) => /风控|回撤|溢价/.test(r));
    if (risk) riskNotes.push(`${f.name}：${risk}`);
    const evidence = decision?.evidenceLevel ? `${decision.evidenceLevel}` : 'low';
    const btSample = Number.isFinite(decision?.backtestMeta?.effectiveSample) ? decision.backtestMeta.effectiveSample : (decision?.backtestMeta?.sample || 0);
    const btWin = Number.isFinite(decision?.backtestMeta?.winRate) ? `${(decision.backtestMeta.winRate * 100).toFixed(1)}%` : '—';
    const plan = decision?.executionPlan || f.engine?.executionPlan || {};
    rows.push({
      action,
      actionTier,
      code: f.code,
      name: f.name,
      diffPct: diff,
      premium,
      positionRange,
      evidence,
      btSample,
      btWin,
      nextAction,
      trigger: plan.trigger || trigger || '—',
      invalidation: plan.invalidation || '—',
      reviewAt: plan.reviewAt || '次日 14:30',
      reasons,
      row: '',
      driver,
      instruction
    });
  }

  // 若全池未触发加仓，按盘中回撤+折价补齐轻仓加仓，避免长期单边“观望/减仓”。
  const hasBuy = rows.some((r) => r.action === '加仓');
  if (!hasBuy) {
    const candidates = rows
      .filter((r) => r.action === '观望')
      .filter((r) => Number.isFinite(r.diffPct))
      .sort((a, b) => Number(a.diffPct) - Number(b.diffPct))
      .slice(0, 3);
    candidates.forEach((c) => {
      if (c.diffPct <= -0.2 || (Number.isFinite(c.premium) && c.premium <= -0.008)) {
        c.action = '加仓';
        c.actionTier = 'light';
        c.reasons = `分布修正：观望占比过高，恢复轻量补仓；${c.reasons}`;
        traded = true;
      }
    });
  }

  rows.forEach((r) => {
    if (r.prebuilt) return;
    r.row = buildRowLine(r);
  });

  const validRows = rows.filter((r) => !/非交易日或估值未更新/.test(r.row));
  if (!validRows.length) {
    console.log('Skip mail: no tradable rows');
    return;
  }
  const actionCounts = validRows.reduce((acc, it) => {
    acc[it.action] = (acc[it.action] || 0) + 1;
    return acc;
  }, {});
  const totalActions = Math.max(1, validRows.length);
  const sellRatio = (actionCounts['减仓'] || 0) / totalActions;
  const blockedRatio = (actionCounts['不可执行'] || 0) / totalActions;
  if (sellRatio > 0.65 || blockedRatio > 0.45) {
    throw new Error(`strategy_distribution_guard_failed sell=${sellRatio.toFixed(2)} blocked=${blockedRatio.toFixed(2)}`);
  }
  const now = nowChinaTime();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const inSession = (hour > 9 || (hour === 9 && minute >= 35)) && (hour < 14 || (hour === 14 && minute <= 55));
  if (!inSession) {
    console.log(`Skip mail: out of trading session ${hour}:${String(minute).padStart(2, '0')}`);
    return;
  }

  const subject = `${tzToday} 盘中基金策略（${traded ? '有操作' : '观望'}）`;
  const batches = chunk(validRows, fastMode ? 120 : 60);

  for (let i = 0; i < batches.length; i += 1) {
    const addRows = batches[i].filter((r) => r.action === '加仓');
    const reduceRows = batches[i].filter((r) => r.action === '减仓');
    const watchRows = batches[i].filter((r) => r.action !== '加仓' && r.action !== '减仓');
    const addLines = addRows.map((r) => r.row);
    const reduceLines = reduceRows.map((r) => r.row);
    const watchLines = watchRows.map((r) => r.row);
    const body = [
      `日期：${tzToday}`,
      `窗口：盘中估值（${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}）`,
      `策略版本：${results.find((r) => r.ok)?.data?.engine?.strategyMeta?.signature || '—'}`,
      `档位说明：强确认/常规/试探（试探为轻仓执行）`,
      `批次：${i + 1}/${batches.length}`,
      '',
      '【加仓】',
      ...(addLines.length ? addLines : ['—']),
      '',
      '【减仓】',
      ...(reduceLines.length ? reduceLines : ['—']),
      '',
      '【观望/无动作】',
      ...(watchLines.length ? watchLines : ['—']),
      '',
      '【风险提示】',
      ...(riskNotes.length ? riskNotes.slice(0, 6) : ['—']),
      '',
      '提示：仅供个人学习参考，不构成投资建议。'
    ].join('\n');
    const buyCount = addRows.length;
    const sellCount = reduceRows.length;
    const holdCount = watchRows.length;
    const renderRows = (list, tone) => (list.length ? list : [{ row: '—', actionTier: null }]).map((item) => {
      const accent = item.actionTier === 'strong' ? tone : item.actionTier === 'light' ? '#f59e0b' : tone;
      return `<tr><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;line-height:1.6;"><span style="display:inline-block;margin-right:6px;padding:1px 6px;border-radius:999px;background:${accent};color:#fff;font-size:10px;">${item.actionTier || 'normal'}</span>${item.row}</td></tr>`;
    }).join('');
    const html = `
      <div style="font-family:'SF Pro Text','PingFang SC',Arial,sans-serif;background:#f3f6fb;padding:14px;color:#0f172a;">
        <div style="max-width:980px;margin:0 auto;background:#fff;border:1px solid #dbe5f3;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(15,23,42,0.08);">
          <div style="padding:14px 16px;background:linear-gradient(135deg,#0ea5e9,#2563eb);color:#fff;">
            <div style="font-size:20px;font-weight:800;letter-spacing:.2px;">${tzToday} 盘中策略快照</div>
            <div style="margin-top:4px;font-size:12px;opacity:.95;">策略版本：${results.find((r) => r.ok)?.data?.engine?.strategyMeta?.signature || '—'} · 批次 ${i + 1}/${batches.length}</div>
          </div>
          <div style="padding:12px 16px 6px;display:flex;gap:8px;flex-wrap:wrap;">
            <span style="padding:4px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:700;font-size:12px;">加仓 ${buyCount}</span>
            <span style="padding:4px 10px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:12px;">减仓 ${sellCount}</span>
            <span style="padding:4px 10px;border-radius:999px;background:#f1f5f9;color:#334155;font-weight:700;font-size:12px;">观望 ${holdCount}</span>
            <span style="padding:4px 10px;border-radius:999px;background:#ecfeff;color:#0e7490;font-weight:700;font-size:12px;">发送时点 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}</span>
          </div>
          <div style="padding:0 16px 14px;">
            <h3 style="margin:10px 0 6px;color:#15803d;">加仓</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;background:#f8fffb;border:1px solid #d1fae5;border-radius:10px;overflow:hidden;">${renderRows(addRows, '#16a34a')}</table>
            <h3 style="margin:12px 0 6px;color:#b91c1c;">减仓</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff8f8;border:1px solid #fee2e2;border-radius:10px;overflow:hidden;">${renderRows(reduceRows, '#dc2626')}</table>
            <h3 style="margin:12px 0 6px;color:#475569;">观望/无动作</h3>
            <table style="width:100%;border-collapse:collapse;font-size:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">${renderRows(watchRows, '#64748b')}</table>
            <h3 style="margin:12px 0 6px;color:#b45309;">风险提示</h3>
            <ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:#b45309;line-height:1.6;">
              ${(riskNotes.length ? riskNotes.slice(0, 8) : ['—']).map((r) => `<li>${r}</li>`).join('')}
            </ul>
            <div style="margin-top:12px;font-size:11px;color:#94a3b8;">提示：仅供个人学习参考，不构成投资建议。</div>
          </div>
        </div>
      </div>
    `;
    await sendEmail(`${subject}（${i + 1}/${batches.length}）`, body, html);
    await jitter(mailJitterMin, mailJitterMax);
  }

  console.log('Mail sent');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
