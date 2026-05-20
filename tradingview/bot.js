#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// ─── Paths ───────────────────────────────────────────────────────────────────

const TRADES_CSV  = path.join(__dirname, 'trades.csv');
const SAFETY_LOG  = path.join(__dirname, 'safety-check-log.json');
const ENV_FILE    = path.join(__dirname, '.env');
const ENV_EXAMPLE = path.join(__dirname, '.env.example');
const RULES_FILE  = path.join(__dirname, 'rules.json');

// ─── Config ──────────────────────────────────────────────────────────────────

const SYMBOL           = process.env.SYMBOL            || 'BTCUSDT';
const TIMEFRAME        = process.env.TIMEFRAME         || '4H';
const PAPER_TRADING    = process.env.PAPER_TRADING     !== 'false';
const TRADE_MODE       = (process.env.TRADE_MODE       || 'spot').toLowerCase();
const PORTFOLIO_VALUE  = parseFloat(process.env.PORTFOLIO_VALUE_USD || '1000');
const MAX_TRADE_USD    = parseFloat(process.env.MAX_TRADE_SIZE_USD  || '100');
const MAX_DAILY_TRADES = parseInt(process.env.MAX_TRADES_PER_DAY    || '3', 10);
const BITGET_KEY       = process.env.BITGET_API_KEY    || '';
const BITGET_SECRET    = process.env.BITGET_SECRET_KEY || '';
const BITGET_PASS      = process.env.BITGET_PASSPHRASE || '';

// ─── First-run onboarding ────────────────────────────────────────────────────

function checkFirstRun() {
  if (fs.existsSync(ENV_FILE)) return;
  console.log('\n👋  First run detected — no .env file found.');
  if (fs.existsSync(ENV_EXAMPLE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log('✅  Created .env from .env.example.');
  } else {
    fs.writeFileSync(ENV_FILE, [
      '# BitGet API credentials',
      'BITGET_API_KEY=your_api_key_here',
      'BITGET_SECRET_KEY=your_secret_key_here',
      'BITGET_PASSPHRASE=your_passphrase_here',
      '',
      'TRADE_MODE=spot',
      'SYMBOL=BTCUSDT',
      'TIMEFRAME=4H',
      '',
      'PORTFOLIO_VALUE_USD=1000',
      'MAX_TRADE_SIZE_USD=100',
      'MAX_TRADES_PER_DAY=3',
      '',
      'PAPER_TRADING=true',
    ].join('\n') + '\n');
    console.log('✅  Created .env template.');
  }
  console.log('👉  Open .env, fill in your credentials, then run the bot again.\n');
  process.exit(0);
}

// ─── HTTP helper (no dependencies) ───────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    lib.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`JSON parse error — status ${res.statusCode}: ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function httpsRequest(options, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = require('https').request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('BitGet response parse error')); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Market data (Binance public API) ────────────────────────────────────────

const TF_INTERVAL = {
  '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m',
  '1H':'1h','2H':'2h','4H':'4h','1D':'1d','1W':'1w',
};

async function fetchCandles(symbol, timeframe, limit = 200) {
  const interval = TF_INTERVAL[timeframe] || '4h';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const raw = await httpGet(url);
  if (!Array.isArray(raw)) throw new Error('Unexpected response from Binance');
  return raw.map(c => ({
    time:   parseInt(c[0], 10),
    open:   parseFloat(c[1]),
    high:   parseFloat(c[2]),
    low:    parseFloat(c[3]),
    close:  parseFloat(c[4]),
    volume: parseFloat(c[5]),
  }));
}

// ─── Technical indicators ─────────────────────────────────────────────────────

function ema(values, period) {
  if (values.length < period) return null;
  const k  = 2 / (period + 1);
  let val  = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) val = values[i] * k + val * (1 - k);
  return val;
}

function rsi(values, period) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function vwap(candles) {
  const todayUTC = new Date();
  const sessionStart = Date.UTC(
    todayUTC.getUTCFullYear(),
    todayUTC.getUTCMonth(),
    todayUTC.getUTCDate()
  );
  const session = candles.filter(c => c.time >= sessionStart);
  const src = session.length > 0 ? session : candles;
  let sumPV = 0, sumV = 0;
  for (const c of src) {
    const tp = (c.high + c.low + c.close) / 3;
    sumPV += tp * c.volume;
    sumV  += c.volume;
  }
  return sumV === 0 ? candles[candles.length - 1].close : sumPV / sumV;
}

function calcIndicators(candles) {
  const closes = candles.map(c => c.close);
  return {
    price: closes[closes.length - 1],
    ema8:  ema(closes, 8),
    vwap:  vwap(candles),
    rsi3:  rsi(closes, 3),
    rsi14: rsi(closes, 14),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
  };
}

// ─── Rules engine ─────────────────────────────────────────────────────────────

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  } catch (e) {
    console.error('❌  Cannot load rules.json:', e.message);
    process.exit(1);
  }
}

function evalCond(condition, indicators) {
  const { price, ema8, ema20, ema50, vwap: v, rsi3, rsi14 } = indicators;
  const vars = {
    price, PRICE: price,
    ema8,  EMA8:  ema8,
    ema20, EMA20: ema20,
    ema50, EMA50: ema50,
    vwap:  v, VWAP: v,
    rsi3,  RSI3:  rsi3,
    rsi14, RSI14: rsi14,
  };

  const parts = condition.trim().split(/\s+/);
  if (parts.length !== 3) return { pass: false, actual: null, error: 'unparseable: ' + condition };

  const [lTok, op, rTok] = parts;
  const lv = vars[lTok] ?? parseFloat(lTok);
  const rv = vars[rTok] ?? parseFloat(rTok);

  let pass = false;
  switch (op) {
    case '>':  pass = lv > rv;  break;
    case '<':  pass = lv < rv;  break;
    case '>=': pass = lv >= rv; break;
    case '<=': pass = lv <= rv; break;
    case '==': pass = lv === rv; break;
    default: return { pass: false, actual: lv, threshold: rv, error: 'unknown op: ' + op };
  }
  return { pass, actual: lv, threshold: rv };
}

function getBias(rules, indicators) {
  if (!rules.bias) return 'neutral';
  const score = (conditions) =>
    (conditions || []).filter(c => evalCond(c, indicators).pass).length;
  const bull = score(rules.bias.bullish);
  const bear = score(rules.bias.bearish);
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'neutral';
}

function runSafetyCheck(rules, indicators, bias) {
  const conditions =
    rules.entry_rules?.[bias] ||
    rules.entry_rules?.any    ||
    [];

  const results = conditions.map(cond => ({ condition: cond, ...evalCond(cond, indicators) }));
  const allPass  = results.every(r => r.pass);
  return { allPass, bias, results };
}

// ─── Trade CSV log ────────────────────────────────────────────────────────────

function ensureCSV() {
  if (fs.existsSync(TRADES_CSV)) return;
  const header = 'date,time,exchange,symbol,side,quantity,price,total_usd,fee_usd,net_usd,order_id,mode,notes\n';
  const hint   = `"${new Date().toISOString().slice(0,10)}","","","","","","","","","","","","Hey — if you're at this stage of the setup, you must be enjoying it... perhaps you could hit subscribe now? :)"\n`;
  fs.writeFileSync(TRADES_CSV, header + hint);
  console.log(`📄  Trade log: ${TRADES_CSV}`);
}

function logTrade({ exchange, symbol, side, quantity, price, orderId, mode, notes }) {
  ensureCSV();
  const now    = new Date();
  const date   = now.toISOString().slice(0, 10);
  const time   = now.toISOString().slice(11, 19);
  const total  = (quantity * price).toFixed(2);
  const fee    = (quantity * price * 0.001).toFixed(4);
  const net    = (quantity * price * 0.999).toFixed(2);
  const safeN  = (notes || '').replace(/"/g, "'");
  fs.appendFileSync(
    TRADES_CSV,
    `"${date}","${time}","${exchange}","${symbol}","${side}","${quantity}","${price}","${total}","${fee}","${net}","${orderId || ''}","${mode}","${safeN}"\n`
  );
}

function logSafetyCheck(payload) {
  const existing = fs.existsSync(SAFETY_LOG)
    ? JSON.parse(fs.readFileSync(SAFETY_LOG, 'utf8'))
    : [];
  existing.push({ timestamp: new Date().toISOString(), ...payload });
  if (existing.length > 1000) existing.splice(0, existing.length - 1000);
  fs.writeFileSync(SAFETY_LOG, JSON.stringify(existing, null, 2));
}

// ─── Daily trade counter ──────────────────────────────────────────────────────

function countTodayTrades() {
  if (!fs.existsSync(TRADES_CSV)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  return fs
    .readFileSync(TRADES_CSV, 'utf8')
    .split('\n')
    .slice(2) // skip header + hint row
    .filter(l => l.startsWith(`"${today}"`) && (l.includes('"live"') || l.includes('"paper"')))
    .length;
}

// ─── BitGet order execution ───────────────────────────────────────────────────

function bitgetSign(message) {
  return crypto.createHmac('sha256', BITGET_SECRET).update(message).digest('base64');
}

async function placeOrder({ symbol, side, size }) {
  if (!BITGET_KEY || BITGET_KEY === 'your_api_key_here') {
    throw new Error('BitGet API credentials not configured in .env');
  }

  const timestamp = Date.now().toString();
  const method    = 'POST';
  const apiPath   = TRADE_MODE === 'futures'
    ? '/api/v2/mix/order/place-order'
    : '/api/v2/spot/trade/place-order';

  const bodyObj = TRADE_MODE === 'futures'
    ? {
        symbol, productType: 'usdt-futures', marginMode: 'crossed',
        marginCoin: 'USDT', size: String(size),
        side: side.toLowerCase(), orderType: 'market',
        tradeSide: side.toLowerCase() === 'buy' ? 'open' : 'close',
      }
    : {
        symbol, side: side.toLowerCase(),
        orderType: 'market', force: 'normal', size: String(size),
      };

  const bodyStr  = JSON.stringify(bodyObj);
  const prehash  = timestamp + method + apiPath + bodyStr;
  const sig      = bitgetSign(prehash);

  return httpsRequest(
    {
      hostname: 'api.bitget.com',
      path:     apiPath,
      method,
      headers: {
        'ACCESS-KEY':        BITGET_KEY,
        'ACCESS-SIGN':       sig,
        'ACCESS-TIMESTAMP':  timestamp,
        'ACCESS-PASSPHRASE': BITGET_PASS,
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(bodyStr),
      },
    },
    bodyStr
  );
}

// ─── Tax summary ──────────────────────────────────────────────────────────────

function printTaxSummary() {
  if (!fs.existsSync(TRADES_CSV)) {
    console.log('No trades logged yet.');
    return;
  }
  const lines = fs.readFileSync(TRADES_CSV, 'utf8').split('\n').slice(2).filter(Boolean);
  let trades = 0, volume = 0, fees = 0;
  for (const line of lines) {
    const cols = line.split('","');
    if (cols.length < 12) continue;
    const mode = cols[11].replace(/"/g, '');
    if (mode === 'live' || mode === 'paper') {
      trades++;
      volume += parseFloat(cols[7]) || 0;
      fees   += parseFloat(cols[8]) || 0;
    }
  }
  console.log('\n📊  Tax Summary');
  console.log('────────────────────────────────────');
  console.log(`  Total trades:      ${trades}`);
  console.log(`  Total volume:      $${volume.toFixed(2)}`);
  console.log(`  Estimated fees:    $${fees.toFixed(4)}`);
  console.log(`\n  📄  Full log:      ${TRADES_CSV}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes('--tax-summary')) {
    printTaxSummary();
    return;
  }

  checkFirstRun();
  ensureCSV();

  console.log('\n🤖  Claude + TradingView MCP — Trading Bot');
  console.log('──────────────────────────────────────────');
  console.log(`  Symbol:        ${SYMBOL}`);
  console.log(`  Timeframe:     ${TIMEFRAME}`);
  console.log(`  Mode:          ${PAPER_TRADING ? '📝  PAPER (no real orders)' : '🔴  LIVE'}`);
  console.log(`  Portfolio:     $${PORTFOLIO_VALUE}`);
  console.log(`  Max trade:     $${MAX_TRADE_USD}`);
  console.log(`  Daily limit:   ${MAX_DAILY_TRADES} trades\n`);

  // Daily limit guard
  const todayCount = countTodayTrades();
  if (todayCount >= MAX_DAILY_TRADES) {
    console.log(`🛑  Daily trade limit reached (${todayCount}/${MAX_DAILY_TRADES}). Exiting.`);
    return;
  }

  // Fetch candles
  console.log(`📡  Fetching ${SYMBOL} ${TIMEFRAME} data from Binance...`);
  let candles;
  try {
    candles = await fetchCandles(SYMBOL, TIMEFRAME);
  } catch (e) {
    console.error('❌  Market data fetch failed:', e.message);
    process.exit(1);
  }
  console.log(`    Got ${candles.length} candles. Latest close: ${candles[candles.length - 1].close}`);

  // Indicators
  const indicators = calcIndicators(candles);
  const { price, ema8, vwap: vwapVal, rsi3 } = indicators;

  console.log('\n📈  Indicators');
  console.log('────────────────────────────────────');
  console.log(`  Price:         ${price.toFixed(2)}`);
  console.log(`  EMA(8):        ${ema8?.toFixed(2) ?? 'N/A'}`);
  console.log(`  VWAP:          ${vwapVal?.toFixed(2) ?? 'N/A'}`);
  console.log(`  RSI(3):        ${rsi3?.toFixed(2) ?? 'N/A'}`);

  // Bias + safety check
  const rules  = loadRules();
  const bias   = getBias(rules, indicators);
  console.log(`  Bias:          ${bias.toUpperCase()}`);

  const check  = runSafetyCheck(rules, indicators, bias);

  console.log('\n🔍  Safety Check');
  console.log('────────────────────────────────────');
  for (const r of check.results) {
    const icon = r.pass ? '✅' : '❌';
    const got  = r.actual != null ? ` (got ${typeof r.actual === 'number' ? r.actual.toFixed(4) : r.actual})` : '';
    console.log(`  ${icon}  ${r.condition}${got}`);
  }

  logSafetyCheck({ symbol: SYMBOL, timeframe: TIMEFRAME, indicators, bias, check });

  if (!check.allPass) {
    const failed = check.results.filter(r => !r.pass).map(r => r.condition);
    console.log(`\n🚫  No trade — failed: ${failed.join(', ')}`);
    logTrade({
      exchange: 'BitGet', symbol: SYMBOL,
      side: bias === 'bullish' ? 'BUY' : 'SELL',
      quantity: 0, price,
      orderId: null, mode: 'blocked',
      notes: `Failed: ${failed.join('; ')}`,
    });
    return;
  }

  // Position sizing
  const riskPct   = rules.risk?.position_size_pct ?? 0.01;
  const tradeUSD  = Math.min(MAX_TRADE_USD, PORTFOLIO_VALUE * riskPct);
  const quantity  = parseFloat((tradeUSD / price).toFixed(6));
  const side      = bias === 'bullish' ? 'BUY' : bias === 'bearish' ? 'SELL' : null;

  if (!side) {
    console.log('\n🚫  Bias neutral — no trade.');
    return;
  }

  console.log(`\n💡  Decision: ${side} ${quantity} ${SYMBOL} @ $${price.toFixed(2)} (~$${tradeUSD.toFixed(2)})`);

  if (PAPER_TRADING) {
    const orderId = `PAPER-${Date.now()}`;
    console.log(`\n📝  PAPER TRADE — logged (no real order placed).`);
    logTrade({ exchange: 'BitGet', symbol: SYMBOL, side, quantity, price, orderId, mode: 'paper', notes: '' });
    console.log(`✅  Saved to ${TRADES_CSV}`);
  } else {
    console.log('\n🔴  Placing live order on BitGet...');
    try {
      const result = await placeOrder({ symbol: SYMBOL, side, size: quantity });
      if (result.code === '00000') {
        const orderId = result.data?.orderId || 'unknown';
        console.log(`✅  Order placed — ID: ${orderId}`);
        logTrade({ exchange: 'BitGet', symbol: SYMBOL, side, quantity, price, orderId, mode: 'live', notes: '' });
      } else {
        console.error(`❌  BitGet error: ${result.msg}`);
        logTrade({ exchange: 'BitGet', symbol: SYMBOL, side, quantity, price, orderId: null, mode: 'error', notes: result.msg });
      }
    } catch (e) {
      console.error('❌  Order failed:', e.message);
    }
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
