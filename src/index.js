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

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const normalizeCode = (c) => String(c || '').replace(/[^\d]/g, '').padStart(6, '0');

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

  const results = await runWithConcurrency(funds, 6, async (f) => {
    await jitter(200, 800);
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
      lines.push(`${r.item.code} | 获取失败: ${r.error?.message || 'unknown'}`);
      continue;
    }
    const f = r.data;
    if (f.skip) {
      lines.push(`${f.name} (#${f.code}) | ${f.reason}`);
      continue;
    }
    const diff = (f.gsz && f.dwjz) ? ((f.gsz - f.dwjz) / f.dwjz) * 100 : null;
    const diffText = diff === null ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`;
    const action = f.engine?.executionPlan?.action || '观望';
    const actionTier = f.engine?.executionPlan?.actionTier || null;
    const positionRange = f.engine?.executionPlan?.positionRange || null;
    const tierLabel = actionTier === 'strong' ? '强确认' : actionTier === 'light' ? '试探' : actionTier === 'normal' ? '常规' : '';
    const tierText = tierLabel ? `(${tierLabel})` : '';
    const driver = f.engine?.executionPlan?.driver || '—';
    const trigger = f.engine?.executionPlan?.trigger || '—';
    const instruction = f.engine?.executionPlan?.instructionHint || '—';
    if (action !== '观望') traded = true;
    const reasons = (f.engine?.executionPlan?.reasons || []).slice(0, 3).join('；') || '—';
    const risk = (f.engine?.executionPlan?.reasons || []).find((r) => /风控|回撤|溢价/.test(r));
    if (risk) riskNotes.push(`${f.name}：${risk}`);
    const row = `${f.name} (#${f.code}) | 预估涨跌: ${diffText} | 策略: ${action}${tierText}${positionRange ? `｜仓位 ${positionRange}` : ''} | 指令: ${instruction} | 触发: ${trigger} | 因子: ${driver}`;
    rows.push({ action, row, tier: actionTier });
  }

  const subject = `${tzToday} 14:30 基金盘中策略（${traded ? '有操作' : '观望'}）`;
  const batches = chunk(rows, 60);

  for (let i = 0; i < batches.length; i += 1) {
    const addRows = batches[i].filter((r) => r.action === '加仓');
    const reduceRows = batches[i].filter((r) => r.action === '减仓');
    const watchRows = batches[i].filter((r) => r.action !== '加仓' && r.action !== '减仓');
    const addLines = addRows.map((r) => r.row);
    const reduceLines = reduceRows.map((r) => r.row);
    const watchLines = watchRows.map((r) => r.row);
    const body = [
      `日期：${tzToday}`,
      `窗口：14:30 盘中估值`,
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
    const html = `
      <div style="font-family:Arial,sans-serif;color:#0f172a">
        <h2 style="margin:0 0 6px;">${tzToday} 14:30 盘中策略</h2>
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">策略版本：${results.find((r) => r.ok)?.data?.engine?.strategyMeta?.signature || '—'} · 批次 ${i + 1}/${batches.length}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;margin-bottom:10px;">
          <span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:999px;">强确认</span>
          <span style="background:#64748b;color:#fff;padding:2px 8px;border-radius:999px;">常规</span>
          <span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:999px;">试探</span>
        </div>
        <h3 style="margin:10px 0 6px;color:#16a34a;">加仓</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          ${(addRows.length ? addRows : [{ row: '—', tier: null }]).map((item) => {
            const tone = item.tier === 'strong' ? '#16a34a' : item.tier === 'light' ? '#f59e0b' : '#16a34a';
            const weight = item.tier ? '700' : '600';
            return `<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0;"><strong style="color:${tone};font-weight:${weight};">一句话指令：</strong> ${item.row}</td></tr>`;
          }).join('')}
        </table>
        <h3 style="margin:10px 0 6px;color:#dc2626;">减仓</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          ${(reduceRows.length ? reduceRows : [{ row: '—', tier: null }]).map((item) => {
            const tone = item.tier === 'strong' ? '#dc2626' : item.tier === 'light' ? '#f59e0b' : '#dc2626';
            const weight = item.tier ? '700' : '600';
            return `<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0;"><strong style="color:${tone};font-weight:${weight};">一句话指令：</strong> ${item.row}</td></tr>`;
          }).join('')}
        </table>
        <h3 style="margin:10px 0 6px;">观望/无动作</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          ${(watchRows.length ? watchRows : [{ row: '—', tier: null }]).map((item) => `<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0;color:#64748b;">${item.row}</td></tr>`).join('')}
        </table>
        <h3 style="margin:10px 0 6px;">风险提示</h3>
        <ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:#ef4444;">
          ${(riskNotes.length ? riskNotes.slice(0, 6) : ['—']).map((r) => `<li>${r}</li>`).join('')}
        </ul>
        <div style="margin-top:12px;font-size:11px;color:#94a3b8;">提示：仅供个人学习参考，不构成投资建议。</div>
      </div>
    `;
    await sendEmail(`${subject}（${i + 1}/${batches.length}）`, body, html);
    await jitter(500, 1200);
  }

  console.log('Mail sent');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
