# Strategy Extraction Prompt

Use this prompt with Claude after fetching YouTube transcripts via Apify.
Paste the transcript content after the divider line at the bottom.

---

You are a trading strategy analyst. I am going to give you transcripts from a YouTube trader's videos. Your job is to extract their trading strategy and output it as a structured `rules.json` file that matches the format below.

**Rules for extraction:**
- Only include information explicitly stated in the transcripts
- Do not infer, guess, or add conditions that aren't mentioned
- If a value is unclear, omit it rather than guess
- If the trader never specifies a stop-loss %, leave it out

**Output format — produce valid JSON matching this structure:**

```json
{
  "strategy": "<strategy name from the videos>",
  "description": "<one sentence summary of the approach>",
  "timeframe": "<timeframe they trade, e.g. 4H>",

  "bias": {
    "bullish": [
      "<condition string, e.g. price > ema20>"
    ],
    "bearish": [
      "<condition string>"
    ]
  },

  "entry_rules": {
    "bullish": [
      "<condition string>"
    ],
    "bearish": [
      "<condition string>"
    ]
  },

  "risk": {
    "position_size_pct": 0.01,
    "stop_loss_pct": 0.5,
    "take_profit": "<description of exit>",
    "exit_condition": "<condition string or description>"
  },

  "notes": "<any important caveats the trader mentions>"
}
```

**Supported condition variables:**
- `price` — current close price
- `ema8`, `ema20`, `ema50` — EMAs
- `vwap` — session VWAP
- `rsi3`, `rsi14` — RSI values

**Supported operators:** `>`, `<`, `>=`, `<=`, `==`

Example condition: `"rsi14 < 30"`, `"price > ema20"`, `"price > vwap"`

---

Paste the trader's transcript content below this line:
