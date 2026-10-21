# Zerodha Kite Connect — Setup Guide

This guide covers everything you need to connect the bot to NSE via Zerodha's Kite Connect API.

---

## 1. Create a Kite Connect app

1. Go to [developers.kite.trade](https://developers.kite.trade/) and log in with your Zerodha credentials
2. Click **Create new app**
3. Fill in the details:
   - **App name:** anything (e.g. "Trading Bot")
   - **App type:** Connect
   - **Redirect URL:** `http://127.0.0.1/` (or any URL you own — you just need to read the redirect)
4. Click **Create**
5. Your **API Key** and **API Secret** are shown on the app page — copy both

Add them to your `.env`:
```
KITE_API_KEY=your_api_key
KITE_API_SECRET=your_api_secret
```

> **Cost:** Kite Connect costs ₹2,000/month (waived if your trading generates sufficient brokerage). You can test with the sandbox at no cost.

---

## 2. Get your daily access token

Kite access tokens **expire at midnight IST every day**. You need to refresh it each morning before running the bot.

Run the auth helper:
```bash
node kite-auth.js
```

It will:
1. Show you a login URL — open it in your browser
2. You log in with Zerodha credentials
3. After login you're redirected — copy the `request_token` from the URL
4. Paste it back into the terminal
5. The script exchanges it for an access token and saves it to `.env` automatically

This takes about 30 seconds. You only do it once per day.

### Automate the daily login (optional)

If you want fully hands-free operation, you can automate the Zerodha login using a headless browser (Playwright or Puppeteer). This is beyond the scope of this guide, but search for "Zerodha auto login" — there are community scripts available.

---

## 3. Find your instrument token

Each stock on NSE has a unique numeric **instrument token**. You need this for the API.

**Option A — Download the full instruments list:**
```
https://api.kite.trade/instruments/NSE
```
This returns a CSV. Open it and search for your stock by `tradingsymbol`.

**Option B — Common tokens:**

| Symbol | Instrument Token |
|---|---|
| RELIANCE | 738561 |
| TCS | 2953217 |
| INFY | 408065 |
| HDFCBANK | 341249 |
| ICICIBANK | 1270529 |
| SBIN | 779521 |
| WIPRO | 969473 |
| NIFTY 50 (index) | 256265 |
| BANKNIFTY (index) | 260105 |

Add it to your `.env`:
```
KITE_INSTRUMENT_TOKEN=738561
SYMBOL=RELIANCE
```

---

## 4. Choose your product type

Set `TRADE_PRODUCT` in `.env`:

| Value | Meaning |
|---|---|
| `MIS` | Intraday — position auto-squares at 3:20 PM if not closed. Lower margin. |
| `CNC` | Delivery — position held overnight. Full capital required. |
| `NRML` | F&O — for futures and options positions. |

For day trading, use `MIS`. For overnight holdings, use `CNC`.

---

## 5. Market hours

The bot automatically checks NSE market hours before placing live orders.

- **Market open:** Mon–Fri, 09:15–15:30 IST
- Outside these hours: paper trading continues; live orders are blocked
- Check current IST time: `TZ=Asia/Kolkata date`

---

## 6. Credentials summary

| `.env` variable | Where to get it |
|---|---|
| `KITE_API_KEY` | developers.kite.trade → your app |
| `KITE_API_SECRET` | developers.kite.trade → your app |
| `KITE_ACCESS_TOKEN` | Generated daily by `node kite-auth.js` |
| `KITE_INSTRUMENT_TOKEN` | NSE instruments CSV or table above |
| `NSE_EXCHANGE` | `NSE` or `BSE` (default: `NSE`) |
| `TRADE_PRODUCT` | `MIS` (intraday) or `CNC` (delivery) |

---

## 7. Test the connection

Once your `.env` is filled in and `kite-auth.js` has been run:

```bash
node bot.js
```

In paper mode it will fetch live NSE data, run safety checks, and log what it would have traded — without placing any real orders.
