import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { fetchGszWithRetry, fetchHistory, fetchFundProfileLite, fetchHistoryDeep } from './fetchers.js';
import { runWithConcurrency, chunk, jitter, todayISO } from './utils.js';
import { buildStrategy } from './engine/strategyEngine.js';
import { getIndexSecidByFund, getFallbackQdiiIndex } from './engine/indexMap.js';
import { fetchIndexHistory } from './engine/indexFetcher.js';
import { detectFundType, mapFundTypeToCategory } from './engine/fundType.js';

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
  const strategyConfigPath = path.join(ROOT, 'src', 'engine', 'config.js');
  let strategyHash = 'unknown';
  try {
    const cfgText = fs.readFileSync(strategyConfigPath, 'utf-8');
    strategyHash = crypto.createHash('sha256').update(cfgText).digest('hex').slice(0, 10);
  } catch { }
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
    const fundTypeConf = detectFundType({ fundName: name, fundCode: f.code });
    const fundCategory = mapFundTypeToCategory(fundTypeConf?.type_key);
    const targetDays = fundCategory === 'money' ? 300 : fundCategory === 'bond' ? 600 : fundCategory === 'qdii' ? 1500 : 1800;
    if (history.length < Math.min(300, Math.floor(targetDays * 0.4))) {
      try {
        history = await fetchHistoryDeep(f.code, targetDays, 12);
        saveCache(f.code, history);
      } catch { }
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
    const premium = Number.isFinite(f.engine?.premium) ? f.engine.premium : null;
    const check = {
      action,
      groupBias: f.engine?.decision?.groupBias || '—',
      stance: f.engine?.decision?.stance || '—',
      valuationLevel: f.engine?.valuationExplain?.level || '—',
      driver: f.engine?.executionPlan?.driver || '—',
      trigger: f.engine?.executionPlan?.trigger || '—',
      minWait: f.engine?.executionPlan?.minWaitDays ? `${f.engine.executionPlan.minWaitDays}天` : '—',
      position: f.engine?.executionPlan?.positionRange || '—',
      consistency: Number.isFinite(premium) ? (Math.abs(premium) > 0.03 ? '差' : Math.abs(premium) > 0.015 ? '中' : '好') : '—'
    };
    const riskValue = Number.isFinite(f.engine?.perfStats?.mdd) ? f.engine.perfStats.mdd : (Number.isFinite(f.engine?.metrics?.riskScore) ? f.engine.metrics.riskScore : null);
    let category = 'hold';
    if (action.includes('加仓')) category = 'buy';
    else if (action.includes('减仓') || action.includes('防守')) category = 'sell';
    items.push({ category, text: line, action, diffText, check, riskValue, isToday: f.isToday });
  }

  const subject = `${tzToday} 14:30 基金盘中策略（${traded ? '有操作' : '观望'}）`;
  const batches = chunk(items, 60);

  for (let i = 0; i < batches.length; i += 1) {
    const group = { buy: [], sell: [], hold: [], skip: [] };
    batches[i].forEach((it) => {
      group[it.category] = group[it.category] || [];
      group[it.category].push(it);
    });
    const estimatedCount = batches[i].filter((it) => it.isToday === false && it.category !== 'skip').length;
    const estimatedRatio = batches[i].length ? `${Math.round((estimatedCount / batches[i].length) * 100)}%` : '0%';
    const highRiskCount = batches[i].filter((it) => Number.isFinite(it.riskValue) && it.riskValue >= 0.2).length;
    const highValCount = batches[i].filter((it) => it.check?.valuationLevel === 'bad').length;
    const badConsistencyCount = batches[i].filter((it) => it.check?.consistency === '差').length;
    const hasAction = group.buy.length + group.sell.length > 0;
    let holdList = group.hold;
    if (hasAction) {
      const sorted = [...group.hold].sort((a, b) => (b.riskValue || 0) - (a.riskValue || 0));
      holdList = sorted.slice(0, 12);
    }
    const summary = [
      `日期：${tzToday}`,
      `窗口：14:30 盘中估值`,
      `批次：${i + 1}/${batches.length}`,
      `统计：加仓 ${group.buy.length}｜减仓/防守 ${group.sell.length}｜观望 ${group.hold.length}｜异常 ${group.skip.length}`,
      `风险聚焦：高回撤 ${highRiskCount}｜估值偏高 ${highValCount}｜一致性差 ${badConsistencyCount}`,
      `估算比例：${estimatedCount}/${batches[i].length}（${estimatedRatio}）`,
      `策略版本：${strategyHash}`,
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
      hasAction ? '观望（仅展示高风险Top12）' : '观望',
      ...(holdList.length ? holdList.map((it) => it.text) : ['无']),
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
      const checkText = `校验：action=${it.check?.action || '—'}｜bias=${it.check?.groupBias || '—'}｜stance=${it.check?.stance || '—'}｜val=${it.check?.valuationLevel || '—'}｜一致性=${it.check?.consistency || '—'}`;
      const planText = `执行：仓位 ${it.check?.position || '—'}｜触发 ${it.check?.trigger || '—'}｜等待 ${it.check?.minWait || '—'}｜主导 ${it.check?.driver || '—'}`;
      return `<div style="padding:6px 0;border-bottom:1px dashed #e5e7eb;">
        <div style="font-weight:600;">${escapeHtml(it.text.split('|')[0] || '')}</div>
        <div style="font-size:13px;color:#334155;">
          <span>涨跌：<b style="color:${diffColor}">${escapeHtml(it.diffText || '—')}</b></span>
          <span style="margin-left:10px;">策略：<b style="color:${actionColor}">${escapeHtml(it.action || '观望')}</b></span>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(it.text)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHtml(checkText)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHtml(planText)}</div>
      </div>`;
    };
    const actionPill = (label, color) => `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${color};color:#fff;font-size:12px;font-weight:600;">${label}</span>`;
    const tableHeader = `
      <div style="display:grid;grid-template-columns:2.2fr 0.8fr 1fr 1.2fr;gap:8px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-bottom:0;border-radius:10px 10px 0 0;font-size:12px;color:#475569;">
        <div>基金</div><div>涨跌</div><div>策略</div><div>执行摘要</div>
      </div>`;
    const tableRow = (it) => {
      const actionColor = it.category === 'buy' ? '#16a34a' : it.category === 'sell' ? '#dc2626' : it.category === 'hold' ? '#64748b' : '#f97316';
      const diffColor = String(it.diffText || '').startsWith('-') ? '#dc2626' : '#16a34a';
      return `
        <div style="display:grid;grid-template-columns:2.2fr 0.8fr 1fr 1.2fr;gap:8px;padding:10px;border:1px solid #e2e8f0;border-top:0;">
          <div style="font-weight:600;">${escapeHtml(it.text.split('|')[0] || '')}</div>
          <div style="color:${diffColor};font-weight:700;">${escapeHtml(it.diffText || '—')}</div>
          <div>${actionPill(escapeHtml(it.action || '观望'), actionColor)}</div>
          <div style="font-size:12px;color:#64748b;">
            仓位 ${escapeHtml(it.check?.position || '—')}｜等待 ${escapeHtml(it.check?.minWait || '—')}｜一致性 ${escapeHtml(it.check?.consistency || '—')}
          </div>
        </div>`;
    };
    const card = (title, color, list, note) => `
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:14px 0;background:#ffffff;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-weight:800;color:${color};font-size:15px;">${title}</div>
          ${note ? `<div style="font-size:11px;color:#94a3b8;">${note}</div>` : ''}
        </div>
        ${list.length ? `${tableHeader}${list.map(tableRow).join('')}` : `<div style="color:#94a3b8;">无</div>`}
      </div>
    `;
    const htmlBody = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#f1f5f9;padding:18px;">
        <div style="max-width:860px;margin:0 auto;">
          <div style="background:#0f172a;color:#fff;border-radius:14px;padding:14px 16px;">
            <div style="font-size:18px;font-weight:800;">日内策略晨会简报</div>
            <div style="font-size:12px;opacity:.85;margin-top:4px;">基金盘中策略（${traded ? '有操作' : '观望'}）</div>
            <div style="margin-top:8px;font-size:12px;">
              ${badge('日期', '#2563eb')} ${tzToday}
              ${badge('窗口', '#2563eb')} 14:30 盘中估值
              ${badge('批次', '#2563eb')} ${i + 1}/${batches.length}
              ${badge('估算比例', '#0ea5e9')} ${estimatedCount}/${batches[i].length}（${estimatedRatio}）
              ${badge('高回撤', '#ef4444')} ${highRiskCount}
              ${badge('估值偏高', '#f97316')} ${highValCount}
              ${badge('一致性差', '#f59e0b')} ${badConsistencyCount}
              ${badge('策略版本', '#64748b')} ${strategyHash}
            </div>
          </div>
          <div style="margin:12px 0;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
            <div style="background:#ecfdf3;border:1px solid #bbf7d0;border-radius:12px;padding:10px;">
              <div style="font-size:12px;color:#16a34a;">加仓</div>
              <div style="font-size:18px;font-weight:800;color:#16a34a;">${group.buy.length}</div>
            </div>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px;">
              <div style="font-size:12px;color:#dc2626;">减仓/防守</div>
              <div style="font-size:18px;font-weight:800;color:#dc2626;">${group.sell.length}</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;">
              <div style="font-size:12px;color:#64748b;">观望</div>
              <div style="font-size:18px;font-weight:800;color:#64748b;">${group.hold.length}</div>
            </div>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px;">
              <div style="font-size:12px;color:#f97316;">异常</div>
              <div style="font-size:18px;font-weight:800;color:#f97316;">${group.skip.length}</div>
            </div>
          </div>
          ${card('✅ 加仓/做多', '#16a34a', group.buy)}
          ${card('⚠️ 减仓/防守', '#dc2626', group.sell)}
          ${card(hasAction ? '⏸ 观望（仅展示高风险Top12）' : '⏸ 观望', '#64748b', holdList, hasAction ? '有操作时仅展示风险最高的观望标的' : '')}
          ${card('❗异常/缺失', '#f97316', group.skip)}
          <div style="margin-top:12px;color:#94a3b8;font-size:12px;">提示：仅供个人学习参考，不构成投资建议。</div>
        </div>
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
