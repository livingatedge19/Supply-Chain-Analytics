# Coinbase Advanced API Setup

## Create your API key

1. Log in to Coinbase Advanced → **Settings** → **API**
2. Click **New API Key**
3. Select your portfolio and enable **Trade** permissions
4. Leave **Transfer** unchecked
5. Complete 2FA
6. Download or copy your **API Key** and **Private Key** (shown once)

## Credentials needed

| Variable | Description |
|---|---|
| `BITGET_API_KEY` | Your Coinbase API key name |
| `BITGET_SECRET_KEY` | Your Coinbase private key (EC key) |
| `BITGET_PASSPHRASE` | Leave blank |

> **Note:** Coinbase Advanced uses EC private keys rather than HMAC secrets. Additional adapter code may be needed for live order execution.
