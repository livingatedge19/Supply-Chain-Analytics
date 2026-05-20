# Claude + TradingView MCP — Automated Trading Bot

Connects Claude to TradingView charts and executes trades on cryptocurrency exchanges automatically.

## What it does

1. Fetches live candlestick data from Binance's public API
2. Calculates EMA(8), VWAP, and RSI(3)
3. Checks your strategy conditions from `rules.json`
4. Executes or blocks the trade, with a full explanation
5. Logs every decision to `trades.csv` for tax records

Paper trading is on by default — no real money moves until you explicitly turn it off.

---

## Quick start

**Prerequisite:** TradingView Desktop running with `--remote-debugging-port=9222` and the MCP configured. See:
- [Linux setup](docs/setup-linux.md)
- [Windows setup](docs/setup-windows.md)

**One-shot setup (recommended):**
Paste the contents of [`prompts/02-one-shot-trade.md`](prompts/02-one-shot-trade.md) into Claude Code. Claude walks you through the entire setup interactively.

**Manual setup:**
```bash
cd tradingview
npm install
cp .env.example .env
# Edit .env with your credentials
node bot.js
```

---

## Supported exchanges

BitGet · Binance · Bybit · OKX · Coinbase Advanced · Kraken · KuCoin · Gate.io · MEXC · Bitfinex

Market data always comes from Binance's free public API. Exchange credentials are only used for live order execution.

---

## Configuration

All settings live in `.env`. Key variables:

| Variable | Default | Description |
|---|---|---|
| `SYMBOL` | `BTCUSDT` | Trading pair |
| `TIMEFRAME` | `4H` | Candle timeframe |
| `PAPER_TRADING` | `true` | Set `false` to go live |
| `PORTFOLIO_VALUE_USD` | `1000` | Used to calculate position size |
| `MAX_TRADE_SIZE_USD` | `100` | Hard cap per trade |
| `MAX_TRADES_PER_DAY` | `3` | Bot stops after this many trades |

---

## Strategy

Strategy conditions are in `rules.json`. The default is VWAP + RSI(3) + EMA(8) scalping:

- **Bullish entry:** price > VWAP, price > EMA(8), RSI(3) < 30
- **Bearish entry:** price < VWAP, price < EMA(8), RSI(3) > 70

To use your own strategy, edit `rules.json` directly, or use the onboarding prompt (option 2 or 3) to have Claude build it from your description or a YouTube trader's channel.

---

## Running

```bash
# Run the bot once
node bot.js

# Get a tax/trade summary
node bot.js --tax-summary
```

Every run logs a full decision record to `safety-check-log.json` and appends any executed (or blocked) trades to `trades.csv`.

---

## Cloud deployment (24/7)

Deploy to any VPS with Node.js 18+. The onboarding prompt (Step 5) handles SSH setup and cron scheduling automatically.

```bash
# Example cron — check every 4 hours
0 */4 * * * cd /root/bot/tradingview && node bot.js >> bot.log 2>&1
```

---

## Files

```
tradingview/
├── bot.js              # Main bot
├── rules.json          # Strategy conditions
├── trades.csv          # Trade log (auto-created)
├── safety-check-log.json  # Decision audit trail (auto-created)
├── .env.example        # Credentials template
├── package.json
├── railway.json        # Railway cloud deployment config
├── docs/
│   ├── setup-linux.md
│   ├── setup-windows.md
│   └── exchanges/      # Per-exchange API key guides
└── prompts/
    ├── 01-extract-strategy.md   # YouTube strategy extractor
    └── 02-one-shot-trade.md     # Interactive onboarding agent
```
