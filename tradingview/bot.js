#!/usr/bin/env node
'use strict';

const fs          = require('fs');
const path        = require('path');
const crypto      = require('crypto');
const https       = require('https');
const querystring = require('querystring');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// ─── Paths ───────────────────────────────────────────────────────────────────

const TRADES_CSV  = path.join(__dirname, 'trades.csv');
const SAFETY_LOG  = path.join(__dirname, 'safety-check-log.json');
const ENV_FILE    = path.join(__dirname, '.env');
const ENV_EXAMPLE = path.join(__dirname, '.env.example');
const RULES_FILE  = path.join(__dirname, 'rules.json');

// ─── Config ──────────────────────────────────────────────────────────────────

const EXCHANGE         = (process.env.EXCHANGE || 'bitget').toLowerCase();
const IS_KITE          = EXCHANGE === 'zerodha' || EXCHANGE === 'kite';
const SYMBOL           = process.env.SYMBOL        || (IS_KITE ? 'RELIANCE' : 'BTCUSDT');
const TIMEFRAME        = process.env.TIMEFRAME     || '1H';
const PAPER_TRADING    = process.env.PAPER_TRADING !== 'false';
const TRADE_MODE       = (process.env.TRADE_MODE   || 'spot').toLowerCase();

// Currency symbol and portfolio (INR for Kite, USD for crypto)
const CURRENCY         = IS_KITE ? '₹' : '$';
const PORTFOLIO_VALUE  = IS_KITE
  ? parseFloat(process.env.PORTFOLIO_VALUE_INR || '100000')
  : parseFloat(process.env.PORTFOLIO_VALUE_USD || '1000');
const MAX_TRADE_AMT    = IS_KITE
  ? parseFloat(process.env.MAX_TRADE_SIZE_INR  || '10000')
  : parseFloat(process.env.MAX_TRADE_SIZE_USD  || '100');
const MAX_DAILY_TRADES = parseInt(process.env.MAX_TRADES_PER_DAY || '3', 10);

// BitGet
const BITGET_KEY    = process.env.BITGET_API_KEY    || '';
const BITGET_SECRET = process.env.BITGET_SECRET_KEY || '';
const BITGET_PASS   = process.env.BITGET_PASSPHRASE || '';

// Kite Connect (Zerodha)
const KITE_API_KEY      = process.env.KITE_API_KEY         || '';
const KITE_ACCESS_TOKEN = process.env.KITE_ACCESS_TOKEN    || '';
const KITE_INSTRUMENT   = process.env.KITE_INSTRUMENT_TOKEN || '';
const NSE_EXCHANGE      = (process.env.NSE_EXCHANGE  || 'NSE').toUpperCase(); // NSE or BSE
const TRADE_PRODUCT     = (process.env.TRADE_PRODUCT || 'MIS').toUpperCase(); // MIS=intraday, CNC=delivery

// ─── First-run onboarding ────────────────────────────────────────────────────

function checkFirstRun() {
  if (fs.existsSync(ENV_FILE)) return;
  console.log('\n👋  First run detected — no .env file found.');
  if (fs.existsSync(ENV_EXAMPLE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log('✅  Created .env from .env.example.');
  } else {
    console.error('❌  .env.example not found. Run from the tradingview/ directory.');
    process.exit(1);
  }
  console.log('👉  Open .env, fill in your credentials, then run the bot again.\n');
  process.exit(0);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Parse error (HTTP ${res.statusCode}): ${body.slice(0, 300)}`)); }
      });
    }).on('error', reject);
  });
}

function httpsPost(options, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Response parse error')); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── NSE market hours helpers (IST = UTC+5:30) ───────────────────────────────

function isNSEOpen() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMin >= 225 && utcMin < 600; // 03:45–10:00 UTC = 09:15–15:30 IST
}

function nseSessionStartUTC() {
  const now = new Date();
  // 09:15 IST = 03:45 UTC
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 45, 0);
}

function istTimeString() {
  const now = new Date();
  const istMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return `${String(Math.floor(istMin / 60)).padStart(2, '0')}:${String(istMin % 60).padStart(2, '0')} IST`;
}

// ─── Kite Connect market data ─────────────────────────────────────────────────

const KITE_INTERVAL = {
  '1m':  'minute',   '3m':  '3minute',  '5m':  '5minute',
  '15m': '15minute', '30m': '30minute', '1H':  '60minute',
  '4H':  '60minute', // Kite max intraday interval; 4H not natively supported
  '1D':  'day',
};

const KITE_DAYS_BACK = {
  minute: 5, '3minute': 7, '5minute': 10, '15minute': 15,
  '30minute': 20, '60minute': 45, day: 400,
};

async function fetchKiteCandles(instrumentToken, timeframe) {
  if (!KITE_API_KEY || !KITE_ACCESS_TOKEN) {
    throw new Error(
      'KITE_API_KEY and KITE_ACCESS_TOKEN must be set in .env\n' +
      '   Run: node kite-auth.js  to generate your daily access token.'
    );
  }
  if (!instrumentToken) {
    throw new Error(
      'KITE_INSTRUMENT_TOKEN not set in .env\n' +
      '   See docs/exchanges/zerodha-kite.md to look up your token.'
    );
  }

  const interval  = KITE_INTERVAL[timeframe] || '60minute';
  const daysBack  = KITE_DAYS_BACK[interval] || 45;
  const toDate    = new Date();
  const fromDate  = new Date(toDate.getTime() - daysBack * 86400000);
  const fmt       = d => d.toISOString().slice(0, 10);

  if (timeframe === '4H') {
    console.log(`  ⚠️   Kite doesn't support 4H natively — using 60minute candles instead.`);
  }

  const url = `https://api.kite.trade/instruments/historical/${instrumentToken}/${interval}` +
              `?from=${fmt(fromDate)}&to=${fmt(toDate)}&continuous=0&oi=0`;

  const res = await httpGet(url, {
    'X-Kite-Version': '3',
    'Authorization':  `token ${KITE_API_KEY}:${KITE_ACCESS_TOKEN}`,
  });

  if (res.status !== 'success') {
    const msg = res.message || JSON.stringify(res);
    if (msg.includes('TokenException') || msg.toLowerCase().includes('access token')) {
      throw new Error('Kite access token expired or invalid.\n   Run: node kite-auth.js');
    }
    throw new Error(`Kite API error: ${msg}`);
  }

  return (res.data?.candles || []).map(c => ({
    time:   new Date(c[0]).getTime(),
    open:   c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
  }));
}

// ─── Binance market data (crypto) ─────────────────────────────────────────────

const BINANCE_INTERVAL = {
  '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m',
  '1H':'1h','2H':'2h','4H':'4h','1D':'1d','1W':'1w',
};

async function fetchBinanceCandles(symbol, timeframe, limit = 200) {
  const interval = BINANCE_INTERVAL[timeframe] || '4h';
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const raw = await httpGet(url);
  if (!Array.isArray(raw)) throw new Error('Unexpected Binance response');
  return raw.map(c => ({
    time: parseInt(c[0], 10), open: parseFloat(c[1]), high: parseFloat(c[2]),
    low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
  }));
}

// ─── Technical indicators ─────────────────────────────────────────────────────

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let v = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) v = values[i] * k + v * (1 - k);
  return v;
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

function vwap(candles, sessionStartMs) {
  const session = candles.filter(c => c.time >= sessionStartMs);
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
  const closes       = candles.map(c => c.close);
  const sessionStart = IS_KITE
    ? nseSessionStartUTC()
    : (() => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); })();

  return {
    price: closes[closes.length - 1],
    ema8:  ema(closes, 8),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    vwap:  vwap(candles, sessionStart),
    rsi3:  rsi(closes, 3),
    rsi14: rsi(closes, 14),
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
  const score = conds => (conds || []).filter(c => evalCond(c, indicators).pass).length;
  const bull = score(rules.bias.bullish);
  const bear = score(rules.bias.bearish);
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'neutral';
}

function runSafetyCheck(rules, indicators, bias) {
  const conditions = rules.entry_rules?.[bias] || rules.entry_rules?.any || [];
  const results = conditions.map(cond => ({ condition: cond, ...evalCond(cond, indicators) }));
  return { allPass: results.every(r => r.pass), bias, results };
}

// ─── Trade CSV log ────────────────────────────────────────────────────────────

function ensureCSV() {
  if (fs.existsSync(TRADES_CSV)) return;
  const cur = IS_KITE ? 'inr' : 'usd';
  fs.writeFileSync(
    TRADES_CSV,
    `date,time,exchange,symbol,side,quantity,price,total_${cur},fee_${cur},net_${cur},order_id,mode,notes\n`
  );
  console.log(`📄  Trade log: ${TRADES_CSV}`);
}

function logTrade({ exchange, symbol, side, quantity, price, orderId, mode, notes }) {
  ensureCSV();
  const now    = new Date();
  const date   = now.toISOString().slice(0, 10);
  const time   = now.toISOString().slice(11, 19);
  const total  = quantity * price;
  const feeRate = IS_KITE ? 0.0003 : 0.001; // Zerodha ~0.03%, crypto ~0.1%
  const fee    = total * feeRate;
  const safeN  = (notes || '').replace(/"/g, "'");
  fs.appendFileSync(
    TRADES_CSV,
    `"${date}","${time}","${exchange}","${symbol}","${side}","${quantity}","${price.toFixed(2)}",` +
    `"${total.toFixed(2)}","${fee.toFixed(4)}","${(total - fee).toFixed(2)}","${orderId || ''}","${mode}","${safeN}"\n`
  );
}

function logSafetyCheck(payload) {
  const existing = fs.existsSync(SAFETY_LOG) ? JSON.parse(fs.readFileSync(SAFETY_LOG, 'utf8')) : [];
  existing.push({ timestamp: new Date().toISOString(), ...payload });
  if (existing.length > 1000) existing.splice(0, existing.length - 1000);
  fs.writeFileSync(SAFETY_LOG, JSON.stringify(existing, null, 2));
}

// ─── Daily trade counter ──────────────────────────────────────────────────────

function countTodayTrades() {
  if (!fs.existsSync(TRADES_CSV)) return 0;
  const today = new Date().toISOString().slice(0, 10);
  return fs.readFileSync(TRADES_CSV, 'utf8').split('\n').slice(1)
    .filter(l => l.startsWith(`"${today}"`) && (l.includes('"live"') || l.includes('"paper"')))
    .length;
}

// ─── Kite Connect order execution ─────────────────────────────────────────────

async function placeKiteOrder({ symbol, side, quantity }) {
  if (!KITE_API_KEY || !KITE_ACCESS_TOKEN) {
    throw new Error('Kite credentials not configured. Run: node kite-auth.js');
  }
  const body = querystring.stringify({
    tradingsymbol:    symbol,
    exchange:         NSE_EXCHANGE,
    transaction_type: side,        // 'BUY' or 'SELL'
    quantity:         String(quantity),
    product:          TRADE_PRODUCT, // MIS or CNC
    order_type:       'MARKET',
    validity:         'DAY',
  });

  const result = await httpsPost(
    {
      hostname: 'api.kite.trade',
      path:     '/orders/regular',
      method:   'POST',
      headers: {
        'X-Kite-Version': '3',
        'Authorization':  `token ${KITE_API_KEY}:${KITE_ACCESS_TOKEN}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );

  if (result.status !== 'success') {
    const msg = result.message || result.error_type || JSON.stringify(result);
    if (msg.includes('TokenException') || msg.toLowerCase().includes('access token')) {
      throw new Error('Kite access token expired. Run: node kite-auth.js');
    }
    throw new Error(`Kite order failed: ${msg}`);
  }

  return result.data?.order_id || 'unknown';
}

// ─── BitGet order execution ───────────────────────────────────────────────────

async function placeBitgetOrder({ symbol, side, size }) {
  if (!BITGET_KEY || BITGET_KEY === 'your_api_key_here') {
    throw new Error('BitGet API credentials not configured in .env');
  }
  const timestamp = Date.now().toString();
  const method    = 'POST';
  const apiPath   = TRADE_MODE === 'futures'
    ? '/api/v2/mix/order/place-order'
    : '/api/v2/spot/trade/place-order';

  const bodyObj = TRADE_MODE === 'futures'
    ? { symbol, productType: 'usdt-futures', marginMode: 'crossed', marginCoin: 'USDT',
        size: String(size), side: side.toLowerCase(), orderType: 'market',
        tradeSide: side.toLowerCase() === 'buy' ? 'open' : 'close' }
    : { symbol, side: side.toLowerCase(), orderType: 'market', force: 'normal', size: String(size) };

  const bodyStr = JSON.stringify(bodyObj);
  const sig = crypto.createHmac('sha256', BITGET_SECRET)
    .update(timestamp + method + apiPath + bodyStr).digest('base64');

  const result = await httpsPost(
    {
      hostname: 'api.bitget.com', path: apiPath, method,
      headers: {
        'ACCESS-KEY': BITGET_KEY, 'ACCESS-SIGN': sig,
        'ACCESS-TIMESTAMP': timestamp, 'ACCESS-PASSPHRASE': BITGET_PASS,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr),
      },
    },
    bodyStr
  );

  if (result.code !== '00000') throw new Error(`BitGet error: ${result.msg}`);
  return result.data?.orderId || 'unknown';
}

// ─── Tax summary ──────────────────────────────────────────────────────────────

function printTaxSummary() {
  if (!fs.existsSync(TRADES_CSV)) { console.log('No trades logged yet.'); return; }
  const lines = fs.readFileSync(TRADES_CSV, 'utf8').split('\n').slice(1).filter(Boolean);
  let trades = 0, volume = 0, fees = 0;
  for (const line of lines) {
    const cols = line.split('","');
    if (cols.length < 12) continue;
    const mode = cols[11].replace(/"/g, '');
    if (mode === 'live' || mode === 'paper') {
      trades++; volume += parseFloat(cols[7]) || 0; fees += parseFloat(cols[8]) || 0;
    }
  }
  console.log('\n📊  Tax Summary');
  console.log('────────────────────────────────────');
  console.log(`  Total trades:      ${trades}`);
  console.log(`  Total volume:      ${CURRENCY}${volume.toFixed(2)}`);
  console.log(`  Estimated fees:    ${CURRENCY}${fees.toFixed(4)}`);
  console.log(`\n  📄  Full log:      ${TRADES_CSV}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes('--tax-summary')) { printTaxSummary(); return; }

  checkFirstRun();
  ensureCSV();

  const exchangeLabel = IS_KITE ? 'Zerodha Kite (NSE)' : 'BitGet (Crypto)';
  const exchangeName  = IS_KITE ? 'Zerodha' : 'BitGet';

  console.log('\n🤖  Claude + TradingView MCP — Trading Bot');
  console.log('──────────────────────────────────────────');
  console.log(`  Exchange:      ${exchangeLabel}`);
  console.log(`  Symbol:        ${SYMBOL}${IS_KITE ? ` (token: ${KITE_INSTRUMENT || 'NOT SET'})` : ''}`);
  console.log(`  Timeframe:     ${TIMEFRAME}`);
  console.log(`  Mode:          ${PAPER_TRADING ? '📝  PAPER (no real orders)' : '🔴  LIVE'}`);
  if (IS_KITE) console.log(`  Product:       ${TRADE_PRODUCT} on ${NSE_EXCHANGE}`);
  console.log(`  Portfolio:     ${CURRENCY}${PORTFOLIO_VALUE.toLocaleString('en-IN')}`);
  console.log(`  Max trade:     ${CURRENCY}${MAX_TRADE_AMT.toLocaleString('en-IN')}`);
  console.log(`  Daily limit:   ${MAX_DAILY_TRADES} trades\n`);

  // NSE market hours check (warn but don't block paper trading)
  if (IS_KITE) {
    if (!isNSEOpen()) {
      console.log(`⏰  NSE is currently closed (${istTimeString()}). Market: Mon–Fri 09:15–15:30 IST.`);
      if (!PAPER_TRADING) {
        console.log('    Live orders will be rejected outside market hours. Exiting.');
        return;
      }
      console.log('    Running in paper mode — continuing.\n');
    }
  }

  // Daily limit guard
  const todayCount = countTodayTrades();
  if (todayCount >= MAX_DAILY_TRADES) {
    console.log(`🛑  Daily trade limit reached (${todayCount}/${MAX_DAILY_TRADES}). Exiting.`);
    return;
  }

  // Fetch candles
  const source = IS_KITE ? 'Kite Connect' : 'Binance';
  console.log(`📡  Fetching ${SYMBOL} ${TIMEFRAME} data from ${source}...`);
  let candles;
  try {
    candles = IS_KITE
      ? await fetchKiteCandles(KITE_INSTRUMENT, TIMEFRAME)
      : await fetchBinanceCandles(SYMBOL, TIMEFRAME);
  } catch (e) {
    console.error('❌  Market data fetch failed:', e.message);
    process.exit(1);
  }

  if (candles.length < 10) {
    console.error(`❌  Not enough candles (${candles.length}). Market may be closed or symbol/token may be wrong.`);
    process.exit(1);
  }
  console.log(`    Got ${candles.length} candles. Latest close: ${CURRENCY}${candles[candles.length - 1].close.toFixed(2)}`);

  // Indicators
  const indicators          = calcIndicators(candles);
  const { price, ema8, vwap: vwapVal, rsi3 } = indicators;

  console.log('\n📈  Indicators');
  console.log('────────────────────────────────────');
  console.log(`  Price:         ${CURRENCY}${price.toFixed(2)}`);
  console.log(`  EMA(8):        ${CURRENCY}${ema8?.toFixed(2) ?? 'N/A'}`);
  console.log(`  VWAP:          ${CURRENCY}${vwapVal?.toFixed(2) ?? 'N/A'}`);
  console.log(`  RSI(3):        ${rsi3?.toFixed(2) ?? 'N/A'}`);

  // Bias + safety check
  const rules = loadRules();
  const bias  = getBias(rules, indicators);
  console.log(`  Bias:          ${bias.toUpperCase()}`);

  const check = runSafetyCheck(rules, indicators, bias);

  console.log('\n🔍  Safety Check');
  console.log('────────────────────────────────────');
  for (const r of check.results) {
    const icon = r.pass ? '✅' : '❌';
    const got  = r.actual != null ? ` (got ${typeof r.actual === 'number' ? r.actual.toFixed(2) : r.actual})` : '';
    console.log(`  ${icon}  ${r.condition}${got}`);
  }

  logSafetyCheck({ exchange: EXCHANGE, symbol: SYMBOL, timeframe: TIMEFRAME, indicators, bias, check });

  if (!check.allPass) {
    const failed = check.results.filter(r => !r.pass).map(r => r.condition);
    console.log(`\n🚫  No trade — failed: ${failed.join(', ')}`);
    logTrade({
      exchange: exchangeName, symbol: SYMBOL,
      side: bias === 'bullish' ? 'BUY' : 'SELL',
      quantity: 0, price, orderId: null, mode: 'blocked',
      notes: `Failed: ${failed.join('; ')}`,
    });
    return;
  }

  // Position sizing — NSE requires whole shares; crypto allows fractions
  const riskPct  = rules.risk?.position_size_pct ?? 0.01;
  const tradeAmt = Math.min(MAX_TRADE_AMT, PORTFOLIO_VALUE * riskPct);
  const quantity = IS_KITE
    ? Math.max(1, Math.floor(tradeAmt / price))
    : parseFloat((tradeAmt / price).toFixed(6));
  const side = bias === 'bullish' ? 'BUY' : bias === 'bearish' ? 'SELL' : null;

  if (!side) { console.log('\n🚫  Bias neutral — no trade.'); return; }

  const actualAmt = (quantity * price).toFixed(2);
  console.log(`\n💡  Decision: ${side} ${quantity} ${SYMBOL} @ ${CURRENCY}${price.toFixed(2)} (~${CURRENCY}${actualAmt})`);

  if (PAPER_TRADING) {
    const orderId = `PAPER-${Date.now()}`;
    console.log(`\n📝  PAPER TRADE — logged (no real order placed).`);
    logTrade({ exchange: exchangeName, symbol: SYMBOL, side, quantity, price, orderId, mode: 'paper', notes: '' });
    console.log(`✅  Saved to ${TRADES_CSV}`);
  } else {
    console.log(`\n🔴  Placing live order on ${exchangeName}...`);
    try {
      const orderId = IS_KITE
        ? await placeKiteOrder({ symbol: SYMBOL, side, quantity })
        : await placeBitgetOrder({ symbol: SYMBOL, side, size: quantity });
      console.log(`✅  Order placed — ID: ${orderId}`);
      logTrade({ exchange: exchangeName, symbol: SYMBOL, side, quantity, price, orderId, mode: 'live', notes: '' });
    } catch (e) {
      console.error('❌  Order failed:', e.message);
      logTrade({ exchange: exchangeName, symbol: SYMBOL, side, quantity, price, orderId: null, mode: 'error', notes: e.message });
    }
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
