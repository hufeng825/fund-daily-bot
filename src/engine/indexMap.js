export const getIndexSecidByFund = (name, type, benchmark) => {
  const text = `${type || ''}${name || ''}${benchmark || ''}`.replace(/\s+/g, '');
  if (/债|货币|理财|现金|固收/.test(text)) return null;
  if (/沪深300/.test(text)) return '1.000300';
  if (/中证500/.test(text)) return '1.000905';
  if (/中证1000/.test(text)) return '1.000852';
  if (/创业板/.test(text)) return '0.399006';
  if (/科创50|科创/.test(text)) return '1.000688';
  if (/上证50/.test(text)) return '1.000016';
  if (/红利/.test(text)) return '1.000922';
  if (/纳斯达克100|纳指|NDX/i.test(text)) return '100.NDX';
  if (/标普500|S&P500|SPX/i.test(text)) return '100.SPX';
  if (/恒生科技|HSTECH/i.test(text)) return '100.HSTECH';
  if (/恒生|HSI/.test(text)) return '100.HSI';
  if (/指数/.test(type) || /指数/.test(name)) return '1.000300';
  return null;
};

export const getFallbackQdiiIndex = (name, type, benchmark) => {
  const text = `${type || ''}${name || ''}${benchmark || ''}`.replace(/\s+/g, '');
  if (!/QDII/i.test(text)) return null;
  if (/纳斯达克100|纳指|NDX/i.test(text)) return '100.NDX';
  if (/标普500|S&P500|SPX/i.test(text)) return '100.SPX';
  if (/恒生科技|HSTECH/i.test(text)) return '100.HSTECH';
  if (/恒生|HSI/i.test(text)) return '100.HSI';
  return null;
};
