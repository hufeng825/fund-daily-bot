export const FUND_TYPES = {
  commodity_gold: {
    name: '商品型-黄金',
    keywords: ['黄金ETF', '贵金属', '上海金', 'COMEX', '伦敦金'],
    search_focus: ['美联储', '实际利率', '美元指数', '央行购金', '地缘政治', 'SPDR持仓'],
    macro_factors: ['美国CPI', '非农就业', '美联储利率决议', '实际利率']
  },
  commodity_oil: {
    name: '商品型-原油',
    keywords: ['原油', '石油', 'OPEC', 'WTI', '布伦特'],
    search_focus: ['OPEC+产量', '美国原油库存', '地缘政治', '全球需求预期'],
    macro_factors: ['EIA库存', 'IEA月报', 'OPEC会议', '美元汇率']
  },
  equity_tech: {
    name: '股票型-科技',
    keywords: ['科技', '半导体', '芯片', 'AI', '人工智能', 'TMT'],
    search_focus: ['国产替代', 'AI算力', '半导体周期', '大模型', '政策扶持'],
    macro_factors: ['全球半导体销售额', '费城半导体指数', 'GPU产能', '科技政策']
  },
  equity_medicine: {
    name: '股票型-医药',
    keywords: ['医药', '医疗', '创新药', 'CXO', '医疗器械', '生物科技'],
    search_focus: ['集采政策', '医保谈判', '创新药审批', '出海', 'GLP-1'],
    macro_factors: ['医保支出', 'FDA审批', '全球医药投融资', '老龄化数据']
  },
  equity_new_energy: {
    name: '股票型-新能源',
    keywords: ['新能源', '光伏', '锂电', '储能', '电动车', '碳中和'],
    search_focus: ['产能过剩', '价格战', '技术迭代', '欧美关税', '电网投资'],
    macro_factors: ['碳酸锂价格', '硅料价格', '新能源车销量', '欧美政策']
  },
  equity_consumption: {
    name: '股票型-消费',
    keywords: ['消费', '白酒', '食品饮料', '家电', '免税', '医美'],
    search_focus: ['消费复苏', '库存周期', '价格战', '渠道变革', '出海'],
    macro_factors: ['社会零售总额', 'CPI', '居民储蓄率', '房地产销售']
  },
  equity_finance: {
    name: '股票型-金融',
    keywords: ['银行', '券商', '保险', '金融', '地产'],
    search_focus: ['净息差', '资产质量', '政策刺激', '地产风险', '资本市场改革'],
    macro_factors: ['LPR利率', '社融数据', '地产销售', '资本市场成交额']
  },
  index_broad: {
    name: '指数型-宽基',
    keywords: ['沪深300', '中证500', '中证1000', '上证50', '创业板指', '科创板'],
    search_focus: ['估值分位', '资金流向', '风格切换', '成分股调整'],
    macro_factors: ['A股整体估值', '北向资金', '融资余额', 'IPO节奏']
  },
  index_sector: {
    name: '指数型-行业',
    keywords: ['行业ETF', '主题ETF', 'SmartBeta'],
    search_focus: ['行业景气度', '政策催化', '资金流向', '估值性价比'],
    macro_factors: ['行业ROE', '资本开支', '库存周期', '政策文件']
  },
  bond_rate: {
    name: '债券型-利率债',
    keywords: ['国债', '政金债', '利率债', '纯债'],
    search_focus: ['货币政策', '央行降准降息', '国债发行', '资金面'],
    macro_factors: ['10年期国债收益率', 'MLF利率', 'DR007', '通胀预期']
  },
  bond_credit: {
    name: '债券型-信用债',
    keywords: ['信用债', '企业债', '公司债', '城投债'],
    search_focus: ['信用利差', '违约风险', '地产债', '城投化债'],
    macro_factors: ['AAA信用利差', '违约率', '地产销售', '化债政策']
  },
  bond_convertible: {
    name: '债券型-可转债',
    keywords: ['可转债', '转债'],
    search_focus: ['转股溢价率', '下修条款', '强赎风险', '正股走势'],
    macro_factors: ['转债平均价格', '溢价率中位数', '正股波动率']
  },
  hybrid_balanced: {
    name: '混合型-平衡',
    keywords: ['平衡混合', '股债平衡'],
    search_focus: ['股债性价比', '资产配置', '回撤控制', '打新收益'],
    macro_factors: ['股债利差', '波动率', '股债相关性']
  },
  hybrid_flexible: {
    name: '混合型-灵活配置',
    keywords: ['灵活配置', '偏股混合', '偏债混合'],
    search_focus: ['仓位择时', '行业轮动', '个股选择', '回撤控制'],
    macro_factors: ['基金经理能力', '换手率', '胜率']
  },
  qdii_us: {
    name: 'QDII-美股',
    keywords: ['纳斯达克', '标普500', '美股', '道琼斯'],
    search_focus: ['美联储政策', '科技股财报', 'AI投资', '经济软着陆'],
    macro_factors: ['美联储点阵图', '美股盈利预期', 'VIX指数', '美元流动性']
  },
  qdii_hk: {
    name: 'QDII-港股',
    keywords: ['恒生科技', '恒生指数', '港股', '中概互联'],
    search_focus: ['南向资金', '港股通', '互联网政策', '美联储降息'],
    macro_factors: ['港股估值', 'AH溢价', '人民币汇率', '美联储政策']
  },
  qdii_emerging: {
    name: 'QDII-新兴市场',
    keywords: ['越南', '印度', '东南亚', '新兴市场'],
    search_focus: ['汇率风险', '地缘政治', '供应链转移', '外资流向'],
    macro_factors: ['美元指数', '大宗商品价格', '当地货币政策']
  },
  reits: {
    name: 'REITs',
    keywords: ['REITs', '基础设施', '产业园', '高速公路', '仓储物流'],
    search_focus: ['分红率', '底层资产', '估值溢价', '扩募进展'],
    macro_factors: ['无风险利率', '租金水平', 'occupancy率', '政策红利']
  },
  fof: {
    name: 'FOF',
    keywords: ['FOF', '基金中基金', '养老FOF'],
    search_focus: ['子基金选择', '资产配置', '双重收费', '波动控制'],
    macro_factors: ['目标日期', '风险等级', '子基金业绩']
  },
  money_market: {
    name: '货币型',
    keywords: ['货币基金', '余额宝', '现金管理'],
    search_focus: ['收益率走势', '流动性', '规模变化'],
    macro_factors: ['Shibor', '资金面', '货币政策']
  }
};

export function detectFundType({ fundName, fundCode }) {
  const name = String(fundName || '').trim();
  const fundNameUpper = name.toUpperCase();
  const code = String(fundCode || '');
  const codePrefix = code.slice(0, 2);
  const codeMap = {
    '51': 'commodity_gold',
    '16': 'bond_rate',
    '15': 'bond_credit'
  };
  let detectedType = null;
  let confidence = 0;
  for (const [typeKey, conf] of Object.entries(FUND_TYPES)) {
    for (const keyword of conf.keywords) {
      const upperKeyword = String(keyword).toUpperCase();
      if (name.includes(keyword) || fundNameUpper.includes(upperKeyword)) {
        detectedType = typeKey;
        confidence = 0.8;
        break;
      }
    }
    if (detectedType) break;
  }
  if (!detectedType && codeMap[codePrefix]) {
    detectedType = codeMap[codePrefix];
    confidence = 0.6;
  }
  if (!detectedType) {
    detectedType = 'hybrid_flexible';
    confidence = 0.5;
  }
  return {
    type_key: detectedType,
    type_name: FUND_TYPES[detectedType]?.name || '混合型-灵活配置',
    confidence,
    search_focus: FUND_TYPES[detectedType]?.search_focus || [],
    macro_factors: FUND_TYPES[detectedType]?.macro_factors || []
  };
}

export function mapFundTypeToCategory(typeKey) {
  const key = String(typeKey || '');
  if (key === 'money_market') return 'money';
  if (key.startsWith('bond_')) return 'bond';
  if (key.startsWith('qdii_') || key.startsWith('commodity_')) return 'qdii';
  return 'equity';
}

export function mapFundTypeToQuantKey(typeKey) {
  const category = mapFundTypeToCategory(typeKey);
  if (category === 'money') return 'bond';
  if (category === 'bond') return 'bond';
  if (category === 'qdii') return 'qdii';
  return 'equity';
}
