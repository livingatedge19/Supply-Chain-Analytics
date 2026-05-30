# BitGet API Setup

## Create your API key (mobile)

1. Open the BitGet app
2. Tap **Home** (bottom left) → tap your **profile picture** (top left)
3. Scroll down → **More Services** → **Tools** → **API Keys**
4. Tap **Create API Key** → **Automatically Generated API Keys**
5. Give it a name (e.g. "Trading Bot")
6. Set a **Passphrase** — write it down, you cannot recover it later
7. Permissions: enable **Spot Trading** (and Futures if needed). **Leave Withdrawals OFF.**
8. Tap **Confirm** and complete 2FA
9. Copy your **API Key** and **Secret Key**

## Credentials needed

| Variable | Description |
|---|---|
| `BITGET_API_KEY` | Your API key |
| `BITGET_SECRET_KEY` | Your secret key |
| `BITGET_PASSPHRASE` | The passphrase you set during creation |

## Notes
- Never enable Withdrawals on a bot API key
- Use an IP whitelist if you know your VPS IP in advance
