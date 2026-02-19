# Fund Daily Bot（14:30 盘中策略）

> 独立于主工程的定时任务，不影响现有代码。支持 GitHub Actions 每个交易日 14:30 自动计算盘中预估涨跌 + 简短加减仓建议，并通过邮箱发送。

## 目录结构
```
fund-daily-bot/
  config/
    funds.json         # 你的基金列表（仅 ID）
    strategy.json      # 预留参数（可不改）
  src/
    index.js           # 定时任务入口
    fetchers.js        # 数据源+兜底
    engine/            # 完整策略引擎（与主工程一致）
  .github/workflows/
    cron.yml           # GitHub Actions 定时任务
```

---

## 1. 只填写基金 ID
编辑 `fund-daily-bot/config/funds.json`：
```json
{
  "funds": [
    "008143",
    "020973"
  ]
}
```

> 自动补齐 6 位，例如 `20973` 会变成 `020973`。

---

## 2. 策略参数（可不改）
`fund-daily-bot/config/strategy.json` 目前仅作为预留扩展，不影响默认算法。

---

## 3. 策略逻辑说明
已迁移**主工程完整核心算法**（含 QDII 指数回补）：
- 估值分位 / z-score
- 趋势强弱 / 回撤
- 多因子加权评分
- 回测最优信号池（分层）
- 执行建议（加仓/减仓/观望）
- QDII/指数基金自动映射到标的指数（如纳指/标普/恒科）并回补历史

输出为“盘中估值涨跌 + 今日执行指令”。

---

## 4. GitHub Actions 部署（傻瓜步骤）

### Step 1. 上传代码到 GitHub
把整个仓库推送到 GitHub（你的主工程仓库即可）。

### Step 2. 打开仓库 Settings → Secrets and variables → Actions
添加以下 Secrets（腾讯企业邮箱 SMTP 配置）：
- `SMTP_HOST`：`smtp.exmail.qq.com`
- `SMTP_PORT`：`465`
- `SMTP_USER`：你的企业邮箱账号（例如 `xxx@hufeng.fun`）
- `SMTP_PASS`：邮箱 SMTP 授权码
- `MAIL_FROM`：同 SMTP_USER（可不填）
- `MAIL_TO`：你要接收的邮箱（可多个，用逗号分隔）

### Step 3. 启用 Actions
GitHub → Actions 页面 → 启用工作流。

### Step 4. 等待触发
每个交易日北京时间 14:30 自动执行。
如需立即测试：Actions → Fund Daily Strategy → Run workflow。

---

## 5. 限流优化（已内置）
- 并发控制（默认 6）
- 请求抖动（200~800ms）
- 历史缓存（每日只拉一次）
- 分批邮件（150 支拆多封）

---

## 6. 输出内容示例
```
2026-02-19 14:30 基金盘中策略（有操作）

工银黄金ETF联接C (#008143) | 盘中估值: 2.6079 | 昨日净值: 2.5890 | 预估涨跌: +0.73% | 策略: 加仓（组回测倾向：偏买；趋势：趋势偏强；估值：估值偏低）
易方达机器人ETF联接C (#020973) | 盘中估值: 1.4777 | 昨日净值: 1.4800 | 预估涨跌: -0.16% | 策略: 观望（组回测倾向：中性；趋势：趋势中性；估值：估值中性）
```

---

如需进一步增强（例如 QDII 指数映射、ETF溢价、风控阈值自适应），告诉我继续升级。
