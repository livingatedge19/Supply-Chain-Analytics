# Binance API Setup

## Create your API key

1. Log in to Binance → hover your profile icon → **API Management**
2. Click **Create API** → choose **System generated**
3. Label it (e.g. "Trading Bot") and complete 2FA
4. Under **API restrictions**, enable **Enable Spot & Margin Trading**
5. Leave **Enable Withdrawals** unchecked
6. (Recommended) Add your VPS IP under **Restrict access to trusted IPs only**
7. Copy your **API Key** and **Secret Key** — the secret is shown only once

## Credentials needed

| Variable | Description |
|---|---|
| `BITGET_API_KEY` | Your Binance API key |
| `BITGET_SECRET_KEY` | Your Binance secret key |
| `BITGET_PASSPHRASE` | Leave blank (Binance doesn't use a passphrase) |

> **Note:** The bot uses Binance's **public** API for market data regardless of your exchange choice. These credentials are only used for order execution if you route live trades through Binance.
