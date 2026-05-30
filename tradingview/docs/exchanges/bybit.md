# Bybit API Setup

## Create your API key

1. Log in to Bybit → top-right menu → **API**
2. Click **Create New Key**
3. Select **System-generated API Keys**
4. Set a name (e.g. "Trading Bot")
5. Under permissions, enable **Trade** for Spot or Derivatives as needed
6. Leave **Withdraw** unchecked
7. (Optional) Add your VPS IP to the IP whitelist
8. Complete 2FA and copy your **API Key** and **Secret Key**

## Credentials needed

| Variable | Description |
|---|---|
| `BITGET_API_KEY` | Your Bybit API key |
| `BITGET_SECRET_KEY` | Your Bybit secret key |
| `BITGET_PASSPHRASE` | Leave blank (Bybit doesn't use a passphrase) |
