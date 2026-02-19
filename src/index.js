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

const sendEmail = async (subject, text) => {
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
    text
  });
};

const main = async () => {
  const cfg = readJson(cfgPath);
  const funds = (cfg.funds || []).map((c) => ({ code: normalizeCode(c) }));

  if (!funds.length) {
    console.log('No funds');
    return;
  }

  const lines = [];
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
    if (action !== '观望') traded = true;
    const reasons = (f.engine?.executionPlan?.reasons || []).slice(0, 3).join('；') || '—';
    const note = f.isToday ? '' : ' | 估值未更新，使用昨日净值估算';
    lines.push(`${f.name} (#${f.code}) | 盘中估值: ${f.gsz ?? '—'} | 昨日净值: ${f.dwjz ?? '—'} | 预估涨跌: ${diffText} | 策略: ${action}（${reasons}）${note}`);
  }

  const subject = `${tzToday} 14:30 基金盘中策略（${traded ? '有操作' : '观望'}）`;
  const batches = chunk(lines, 60);

  for (let i = 0; i < batches.length; i += 1) {
    const body = [
      `日期：${tzToday}`,
      `窗口：14:30 盘中估值`,
      `批次：${i + 1}/${batches.length}`,
      '',
      ...batches[i],
      '',
      '提示：仅供个人学习参考，不构成投资建议。'
    ].join('\n');
    await sendEmail(`${subject}（${i + 1}/${batches.length}）`, body);
    await jitter(500, 1200);
  }

  console.log('Mail sent');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
