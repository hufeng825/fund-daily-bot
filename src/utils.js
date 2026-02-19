export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export const jitter = (min = 200, max = 800) => {
  const ms = Math.floor(min + Math.random() * (max - min + 1));
  return sleep(ms);
};

export const runWithConcurrency = async (items, limit, worker) => {
  const results = [];
  let idx = 0;
  const exec = async () => {
    while (idx < items.length) {
      const current = items[idx++];
      try {
        const data = await worker(current);
        results.push({ ok: true, item: current, data });
      } catch (err) {
        results.push({ ok: false, item: current, error: err });
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, exec);
  await Promise.all(workers);
  return results;
};

export const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const todayISO = (tz = 'Asia/Shanghai') => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now).reduce((acc, p) => {
    if (p.type === 'year') acc.y = p.value;
    if (p.type === 'month') acc.m = p.value;
    if (p.type === 'day') acc.d = p.value;
    return acc;
  }, {});
  return `${parts.y}-${parts.m}-${parts.d}`;
};
