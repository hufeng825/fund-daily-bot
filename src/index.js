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

const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

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

  const items = [];
  let traded = false;

  const results = await runWithConcurrency(funds, 6, async (f) => {
    await jitter(200, 800);
    const gz = await fetchGszWithRetry(f.code, 2);
    const name = gz?.name || f.name || f.code;
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

    const dwjz = gz?.dwjz ? Number(gz.dwjz) : null;
    const gszRaw = gz?.gsz ? Number(gz.gsz) : null;
    const isToday = isTradingDay(gz);
    // If no intraday update, fall back to yesterday's NAV as estimate
    const gsz = Number.isFinite(gszRaw) ? gszRaw : Number.isFinite(dwjz) ? dwjz : null;
    if (!Number.isFinite(gsz) || !Number.isFinite(dwjz)) {
      return { ...f, name, skip: true, reason: '估值数据缺失', gz };
    }
    let engine = null;
    try {
      engine = buildStrategy({
        history,
        gsz,
        dwjz,
        name,
        code: f.code,
        profile,
        indexHistory
      });
    } catch (err) {
      return { ...f, name, gz, gsz, dwjz, history, profile, indexHistory, skip: true, reason: `策略计算失败: ${err?.message || 'unknown'}` };
    }

    return { ...f, name, gz, gsz, dwjz, history, profile, indexHistory, engine, isToday };
  });

  for (const r of results) {
    if (!r.ok) {
      items.push({
        category: 'skip',
        text: `${r.item.code} | 获取失败: ${r.error?.message || 'unknown'}`
      });
      continue;
    }
    const f = r.data;
    if (f.skip) {
      const msg = `${f.name} (#${f.code}) | ${f.reason}`;
      items.push({ category: 'skip', text: msg });
      continue;
    }
    const diff = (f.gsz && f.dwjz) ? ((f.gsz - f.dwjz) / f.dwjz) * 100 : null;
    const diffText = diff === null ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`;
    const action = f.engine?.executionPlan?.action || '观望';
    if (action !== '观望') traded = true;
    const reasons = (f.engine?.executionPlan?.reasons || []).slice(0, 2).join('；') || '—';
    const note = f.isToday ? '' : ' | 估值未更新，使用昨日净值估算';
    const line = `${f.name} (#${f.code}) | 估值: ${f.gsz ?? '—'} | 昨日净值: ${f.dwjz ?? '—'} | 涨跌: ${diffText} | 策略: ${action}（${reasons}）${note}`;
    let category = 'hold';
    if (action.includes('加仓')) category = 'buy';
    else if (action.includes('减仓') || action.includes('防守')) category = 'sell';
    items.push({ category, text: line, action, diffText });
  }

  const subject = `${tzToday} 14:30 基金盘中策略（${traded ? '有操作' : '观望'}）`;
  const batches = chunk(items, 60);

  for (let i = 0; i < batches.length; i += 1) {
    const group = { buy: [], sell: [], hold: [], skip: [] };
    batches[i].forEach((it) => {
      group[it.category] = group[it.category] || [];
      group[it.category].push(it);
    });
    const summary = [
      `日期：${tzToday}`,
      `窗口：14:30 盘中估值`,
      `批次：${i + 1}/${batches.length}`,
      `统计：加仓 ${group.buy.length}｜减仓/防守 ${group.sell.length}｜观望 ${group.hold.length}｜异常 ${group.skip.length}`,
      ''
    ];
    const textBody = [
      ...summary,
      '加仓/做多',
      ...(group.buy.length ? group.buy.map((it) => it.text) : ['无']),
      '',
      '减仓/防守',
      ...(group.sell.length ? group.sell.map((it) => it.text) : ['无']),
      '',
      '观望',
      ...(group.hold.length ? group.hold.map((it) => it.text) : ['无']),
      '',
      '异常/缺失',
      ...(group.skip.length ? group.skip.map((it) => it.text) : ['无']),
      '',
      '提示：仅供个人学习参考，不构成投资建议。'
    ].join('\n');
    const badge = (label, color) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${color};color:#fff;font-size:12px;margin-right:6px;">${label}</span>`;
    const row = (it) => {
      const actionColor = it.category === 'buy' ? '#16a34a' : it.category === 'sell' ? '#dc2626' : it.category === 'hold' ? '#64748b' : '#f97316';
      const diffColor = String(it.diffText || '').startsWith('-') ? '#dc2626' : '#16a34a';
      return `<div style="padding:6px 0;border-bottom:1px dashed #e5e7eb;">
        <div style="font-weight:600;">${escapeHtml(it.text.split('|')[0] || '')}</div>
        <div style="font-size:13px;color:#334155;">
          <span>涨跌：<b style="color:${diffColor}">${escapeHtml(it.diffText || '—')}</b></span>
          <span style="margin-left:10px;">策略：<b style="color:${actionColor}">${escapeHtml(it.action || '观望')}</b></span>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(it.text)}</div>
      </div>`;
    };
    const section = (title, color, list) => `
      <div style="margin:14px 0 6px 0;font-weight:700;color:${color};">${title}</div>
      ${list.length ? list.map(row).join('') : `<div style="color:#94a3b8;">无</div>`}
    `;
    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <div style="font-size:18px;font-weight:700;margin-bottom:6px;">基金盘中策略（${traded ? '有操作' : '观望'}）</div>
        <div style="color:#475569;font-size:13px;margin-bottom:8px;">
          ${badge('日期', '#0f172a')} ${tzToday}
          ${badge('窗口', '#0f172a')} 14:30 盘中估值
          ${badge('批次', '#0f172a')} ${i + 1}/${batches.length}
        </div>
        <div style="color:#0f172a;font-size:13px;margin-bottom:12px;">
          ${badge('加仓', '#16a34a')} ${group.buy.length}
          ${badge('减仓/防守', '#dc2626')} ${group.sell.length}
          ${badge('观望', '#64748b')} ${group.hold.length}
          ${badge('异常', '#f97316')} ${group.skip.length}
        </div>
        ${section('✅ 加仓/做多', '#16a34a', group.buy)}
        ${section('⚠️ 减仓/防守', '#dc2626', group.sell)}
        ${section('⏸ 观望', '#64748b', group.hold)}
        ${section('❗异常/缺失', '#f97316', group.skip)}
        <div style="margin-top:14px;color:#94a3b8;font-size:12px;">提示：仅供个人学习参考，不构成投资建议。</div>
      </div>
    `;
    await sendEmail(`${subject}（${i + 1}/${batches.length}）`, textBody, htmlBody);
    await jitter(500, 1200);
  }

  console.log('Mail sent');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
