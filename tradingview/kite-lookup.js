#!/usr/bin/env node
/**
 * Kite Instrument Token Lookup
 *
 * Fetches the NSE instruments list from Kite and fills in the token
 * for every stock in watchlist.json automatically.
 *
 * Run once after adding new symbols to watchlist.json:
 *   node kite-lookup.js
 */

'use strict';

const https    = require('https');
const fs       = require('fs');
const path     = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const WATCHLIST_FILE = path.join(__dirname, 'watchlist.json');

const API_KEY      = process.env.KITE_API_KEY;
const ACCESS_TOKEN = process.env.KITE_ACCESS_TOKEN;

if (!API_KEY || API_KEY === 'your_kite_api_key') {
  console.error('\n❌  KITE_API_KEY not set in .env');
  console.error('    Run: node kite-auth.js  first.\n');
  process.exit(1);
}
if (!ACCESS_TOKEN || ACCESS_TOKEN === '') {
  console.error('\n❌  KITE_ACCESS_TOKEN not set in .env');
  console.error('    Run: node kite-auth.js  to generate your daily token.\n');
  process.exit(1);
}

// ─── Fetch NSE instruments CSV from Kite ─────────────────────────────────────

function fetchInstruments() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.kite.trade',
      path:     '/instruments/NSE',
      method:   'GET',
      headers: {
        'X-Kite-Version': '3',
        'Authorization':  `token ${API_KEY}:${ACCESS_TOKEN}`,
      },
    };

    https.get(options, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const msg  = json.message || body.slice(0, 200);
            if (msg.includes('TokenException') || msg.toLowerCase().includes('access token')) {
              reject(new Error('Access token expired. Run: node kite-auth.js'));
            } else {
              reject(new Error(`Kite error (${res.statusCode}): ${msg}`));
            }
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        });
        return;
      }

      let csv = '';
      res.on('data', chunk => csv += chunk);
      res.on('end', () => resolve(csv));
    }).on('error', reject);
  });
}

// ─── Parse CSV into symbol → token map ───────────────────────────────────────

function parseInstruments(csv) {
  const lines = csv.trim().split('\n');
  const map   = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 9) continue;

    const token   = cols[0].trim();
    const symbol  = cols[2].trim();   // tradingsymbol
    const name    = cols[8]?.trim();  // name
    const segment = cols[9]?.trim();  // segment — we want NSE-EQ for equities

    if (symbol && token && (segment === 'NSE-EQ' || segment === 'NSE')) {
      map[symbol] = { token: parseInt(token, 10), name };
    }
  }

  return map;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));

  console.log('\n🔍  Fetching NSE instruments from Kite...');
  let csv;
  try {
    csv = await fetchInstruments();
  } catch (e) {
    console.error('❌ ', e.message);
    process.exit(1);
  }

  const instruments = parseInstruments(csv);
  console.log(`    Loaded ${Object.keys(instruments).length} NSE instruments.\n`);

  let found = 0, missing = 0;

  for (const stock of watchlist) {
    const match = instruments[stock.symbol];
    if (match) {
      stock.token = match.token;
      console.log(`  ✅  ${stock.symbol.padEnd(12)} → token ${match.token}`);
      found++;
    } else {
      console.log(`  ❌  ${stock.symbol.padEnd(12)} → NOT FOUND (check symbol spelling)`);
      missing++;
    }
  }

  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(watchlist, null, 2));

  console.log(`\n  Found: ${found}   Missing: ${missing}`);
  console.log(`  Saved to watchlist.json\n`);

  if (missing > 0) {
    console.log('  For missing symbols, check the exact NSE tradingsymbol at:');
    console.log('  https://api.kite.trade/instruments/NSE\n');
  } else {
    console.log('  All tokens found. Run the bot:');
    console.log('  node bot.js\n');
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
