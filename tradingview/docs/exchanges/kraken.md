# Kraken API Setup

## Create your API key

1. Log in to Kraken → top-right menu → **Security** → **API**
2. Click **Add key**
3. Set a description and enable **Create & modify orders** under Query + Orders
4. Leave **Withdraw funds** unchecked
5. (Optional) Add your IP to the key's IP allowlist
6. Click **Generate Key** and copy your **API Key** and **Private Key**

## Credentials needed

| Variable | Description |
|---|---|
| `BITGET_API_KEY` | Your Kraken API key |
| `BITGET_SECRET_KEY` | Your Kraken private key (base64) |
| `BITGET_PASSPHRASE` | Leave blank |
