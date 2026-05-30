#!/usr/bin/env node
'use strict';

/**
 * Kite Connect — Daily Access Token Generator
 *
 * Kite access tokens expire at midnight IST every day.
 * Run this once each morning before starting the bot:
 *
 *   node kite-auth.js
 *
 * It will update KITE_ACCESS_TOKEN in your .env automatically.
 */

const https      = require('https');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const qs         = require('querystring');
const readline   = require('readline');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const ENV_FILE   = path.join(__dirname, '.env');
const API_KEY    = process.env.KITE_API_KEY;
const API_SECRET = process.env.KITE_API_SECRET;

// ─── Preflight checks ────────────────────────────────────────────────────────

if (!API_KEY || API_KEY === 'your_kite_api_key') {
  console.error('\n❌  KITE_API_KEY is not set in .env');
  console.error('    See docs/exchanges/zerodha-kite.md for setup.\n');
  process.exit(1);
}
if (!API_SECRET || API_SECRET === 'your_kite_api_secret') {
  console.error('\n❌  KITE_API_SECRET is not set in .env');
  console.error('    See docs/exchanges/zerodha-kite.md for setup.\n');
  process.exit(1);
}

// ─── Instructions ─────────────────────────────────────────────────────────────

const loginUrl = `https://kite.trade/connect/login?api_key=${API_KEY}&v=3`;

console.log('\n🔑  Kite Connect — Daily Login');
console.log('──────────────────────────────────────────');
console.log('\nStep 1.  Open this URL in your browser:\n');
console.log(`         ${loginUrl}\n`);
console.log('Step 2.  Log in with your Zerodha credentials.');
console.log('Step 3.  After login you will be redirected. The URL will look like:\n');
console.log('         https://yourapp.com/?request_token=AbCdXxXxXx&action=login&status=success\n');
console.log('Step 4.  Copy the value after request_token=');

// ─── Read request_token from stdin ───────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('\nPaste request_token here: ', async (raw) => {
  rl.close();
  const requestToken = raw.trim();

  if (!requestToken) {
    console.error('\n❌  No token entered. Exiting.\n');
    process.exit(1);
  }

  // Kite checksum = SHA256(api_key + request_token + api_secret)
  const checksum = crypto.createHash('sha256')
    .update(API_KEY + requestToken + API_SECRET)
    .digest('hex');

  const body = qs.stringify({ api_key: API_KEY, request_token: requestToken, checksum });

  console.log('\n⏳  Exchanging request_token for access_token...');

  let result;
  try {
    result = await post('/session/token', body);
  } catch (e) {
    console.error('\n❌  Request failed:', e.message, '\n');
    process.exit(1);
  }

  if (result.status !== 'success') {
    const msg = result.message || JSON.stringify(result);
    console.error(`\n❌  Kite error: ${msg}`);
    if (msg.includes('InvalidInputException') || msg.includes('request_token')) {
      console.error('    Hint: request_tokens expire within seconds — use a fresh one.\n');
    }
    process.exit(1);
  }

  const { access_token, user_id, user_name } = result.data;

  // ─── Write access_token back to .env ───────────────────────────────────────

  let env = fs.readFileSync(ENV_FILE, 'utf8');
  if (env.includes('KITE_ACCESS_TOKEN=')) {
    env = env.replace(/KITE_ACCESS_TOKEN=.*/m, `KITE_ACCESS_TOKEN=${access_token}`);
  } else {
    env = env.trimEnd() + `\nKITE_ACCESS_TOKEN=${access_token}\n`;
  }
  fs.writeFileSync(ENV_FILE, env);

  console.log('\n✅  Access token saved to .env');
  console.log(`   User:  ${user_name} (${user_id})`);
  console.log('   Valid: until midnight tonight (IST)\n');
  console.log('Run the bot now:');
  console.log('   node bot.js\n');
});

// ─── HTTPS POST helper ────────────────────────────────────────────────────────

function post(apiPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.kite.trade',
        path:     apiPath,
        method:   'POST',
        headers: {
          'X-Kite-Version': '3',
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
