# Windows Setup Guide

Everything in the main README applies — the only differences are how you launch TradingView with CDP enabled and where the files live.

---

## 1. Find your TradingView executable

TradingView Desktop on Windows is installed as an `.msix` package. The executable lives in a path like:

```
C:\Users\[YourName]\AppData\Local\Packages\TradingView.TradingViewDesktop_[hash]\LocalCache\Local\TradingView\TradingView.exe
```

To find the exact path, open PowerShell and run:
```powershell
Get-AppxPackage -Name "TradingView*" | Select-Object -ExpandProperty InstallLocation
```
Inside that folder, look for `TradingView.exe`.

---

## 2. Launch TradingView with CDP enabled

Close TradingView if it's running, then in PowerShell:

```powershell
& "C:\Users\[YourName]\AppData\Local\...\TradingView.exe" --remote-debugging-port=9222
```

Replace the path with the one you found in Step 1.

**Tip:** Save this as a `.ps1` script or a desktop shortcut so you don't have to type it every time.

---

## 3. Configure the MCP

In your Claude Code MCP config (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "npx",
      "args": ["-y", "@tradingview/mcp-server"],
      "env": {
        "CDP_PORT": "9222"
      }
    }
  }
}
```

---

## 4. Verify the connection

In Claude Code terminal:

```
tv_health_check
```

If it returns `cdp_connected: true` — you're good. If not:
- Make sure TradingView was launched with `--remote-debugging-port=9222`
- Check that nothing else is using port 9222
- Try closing and relaunching TradingView using the PowerShell command above

---

## 5. Continue with the main setup

Once `tv_health_check` passes, go back to the [main README](../README.md) and continue from Step 2.
