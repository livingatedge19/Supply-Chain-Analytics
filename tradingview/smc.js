'use strict';

// Smart Money Concepts — JavaScript port of the Pine Script SMC indicator.
// Detects BOS / CHoCH, Order Blocks, Fair Value Gaps, and structural bias.
// Candle format expected: { time, open, high, low, close, volume }

const BULLISH     = 1;
const BEARISH     = -1;
const BULLISH_LEG = 1;
const BEARISH_LEG = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rangeMax(candles, start, end) {
  let m = -Infinity;
  for (let i = start; i <= end; i++) if (candles[i]) m = Math.max(m, candles[i].high);
  return m;
}

function rangeMin(candles, start, end) {
  let m = Infinity;
  for (let i = start; i <= end; i++) if (candles[i]) m = Math.min(m, candles[i].low);
  return m;
}

// ─── Leg direction ────────────────────────────────────────────────────────────
// Mirrors Pine Script leg(size): confirmed pivot high → BEARISH_LEG; pivot low → BULLISH_LEG.
// A pivot high at bar[i-size] is confirmed when high[i-size] > highest of bars[i-size+1..i].

function computeLegs(candles, size) {
  const legs = new Array(candles.length).fill(BEARISH_LEG);
  for (let i = size; i < candles.length; i++) {
    const pivot   = candles[i - size];
    const maxHigh = rangeMax(candles, i - size + 1, i);
    const minLow  = rangeMin(candles, i - size + 1, i);
    if      (pivot.high > maxHigh) legs[i] = BEARISH_LEG;
    else if (pivot.low  < minLow)  legs[i] = BULLISH_LEG;
    else                           legs[i] = legs[i - 1];
  }
  return legs;
}

// ─── Structure: BOS / CHoCH + Order Blocks ───────────────────────────────────

function detectStructure(candles, swingSize = 50) {
  if (candles.length < swingSize * 2 + 2) {
    return { bias: 0, bosEvents: [], chochEvents: [], orderBlocks: [] };
  }

  const legs      = computeLegs(candles, swingSize);
  let trendBias   = 0;

  // Active swing pivots
  let swHigh = { level: NaN, idx: -1, crossed: false };
  let swLow  = { level: NaN, idx: -1, crossed: false };

  const bosEvents   = [];
  const chochEvents = [];
  const allOrderBlocks = [];

  for (let i = 1; i < candles.length; i++) {
    const legChanged = legs[i] !== legs[i - 1];

    if (legChanged) {
      const pivotIdx = i - swingSize;
      if (pivotIdx >= 0) {
        if (legs[i] === BULLISH_LEG) {
          // Confirmed pivot LOW at pivotIdx
          swLow = { level: candles[pivotIdx].low, idx: pivotIdx, crossed: false };
        } else {
          // Confirmed pivot HIGH at pivotIdx
          swHigh = { level: candles[pivotIdx].high, idx: pivotIdx, crossed: false };
        }
      }
    }

    const c     = candles[i];
    const cPrev = candles[i - 1];

    // Bullish crossover: price closes above swing high
    if (!isNaN(swHigh.level) && !swHigh.crossed) {
      if (cPrev.close <= swHigh.level && c.close > swHigh.level) {
        const tag = trendBias === BEARISH ? 'CHoCH' : 'BOS';
        const ev  = { type: tag, direction: 'bullish', price: swHigh.level, bar: i, time: c.time };
        (tag === 'CHoCH' ? chochEvents : bosEvents).push(ev);
        swHigh.crossed = true;
        trendBias      = BULLISH;

        // Bullish order block = last bearish candle between pivot-high bar and this bar
        for (let j = i - 1; j >= swHigh.idx; j--) {
          if (candles[j].close < candles[j].open) {
            allOrderBlocks.push({
              bias: BULLISH, high: candles[j].high, low: candles[j].low,
              time: candles[j].time, barIdx: j, mitigated: false,
            });
            break;
          }
        }
      }
    }

    // Bearish crossunder: price closes below swing low
    if (!isNaN(swLow.level) && !swLow.crossed) {
      if (cPrev.close >= swLow.level && c.close < swLow.level) {
        const tag = trendBias === BULLISH ? 'CHoCH' : 'BOS';
        const ev  = { type: tag, direction: 'bearish', price: swLow.level, bar: i, time: c.time };
        (tag === 'CHoCH' ? chochEvents : bosEvents).push(ev);
        swLow.crossed = true;
        trendBias     = BEARISH;

        // Bearish order block = last bullish candle between pivot-low bar and this bar
        for (let j = i - 1; j >= swLow.idx; j--) {
          if (candles[j].close > candles[j].open) {
            allOrderBlocks.push({
              bias: BEARISH, high: candles[j].high, low: candles[j].low,
              time: candles[j].time, barIdx: j, mitigated: false,
            });
            break;
          }
        }
      }
    }

    // Mitigate order blocks (price low dips below bullish OB low, or high exceeds bearish OB high)
    for (const ob of allOrderBlocks) {
      if (ob.mitigated) continue;
      if (ob.bias === BULLISH && c.low  < ob.low)  ob.mitigated = true;
      if (ob.bias === BEARISH && c.high > ob.high) ob.mitigated = true;
    }
  }

  return {
    bias:        trendBias,
    bosEvents,
    chochEvents,
    orderBlocks: allOrderBlocks.filter(ob => !ob.mitigated),
  };
}

// ─── Fair Value Gaps ──────────────────────────────────────────────────────────
// Bullish FVG: bar[0].low > bar[2].high AND bar[1].close > bar[2].high
// Bearish FVG: bar[0].high < bar[2].low AND bar[1].close < bar[2].low

function detectFVGs(candles) {
  const fvgs = [];

  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i], c1 = candles[i - 1], c2 = candles[i - 2];

    if (c0.low > c2.high && c1.close > c2.high) {
      fvgs.push({ bias: BULLISH, top: c0.low, bottom: c2.high, time: c1.time, barIdx: i, filled: false });
    }
    if (c0.high < c2.low && c1.close < c2.low) {
      fvgs.push({ bias: BEARISH, top: c2.low, bottom: c0.high, time: c1.time, barIdx: i, filled: false });
    }

    for (const fvg of fvgs) {
      if (fvg.filled) continue;
      if (fvg.bias === BULLISH && c0.low  < fvg.bottom) fvg.filled = true;
      if (fvg.bias === BEARISH && c0.high > fvg.top)    fvg.filled = true;
    }
  }

  return fvgs.filter(f => !f.filled);
}

// ─── Trailing extremes (Strong / Weak High & Low) ────────────────────────────

function getTrailingExtremes(candles, swingSize = 50) {
  const lookback = Math.min(candles.length, swingSize * 3);
  const start    = candles.length - lookback;
  let high = -Infinity, low = Infinity;
  for (let i = start; i < candles.length; i++) {
    if (candles[i].high > high) high = candles[i].high;
    if (candles[i].low  < low)  low  = candles[i].low;
  }
  return { strongHigh: high, strongLow: low };
}

// ─── Main export ──────────────────────────────────────────────────────────────

function analyzeSMC(candles, swingSize = 50) {
  if (!candles || candles.length < swingSize * 2 + 2) {
    return {
      bias: 0, biasLabel: 'NEUTRAL',
      recentBOS: null, recentCHoCH: null,
      activeOrderBlocks: [], activeFVGs: [],
      strongHigh: null, strongLow: null,
      inOrderBlock: null, inFVG: null,
    };
  }

  const { bias, bosEvents, chochEvents, orderBlocks } = detectStructure(candles, swingSize);
  const fvgs      = detectFVGs(candles);
  const extremes  = getTrailingExtremes(candles, swingSize);
  const lastPrice = candles[candles.length - 1].close;

  const inOrderBlock = orderBlocks.find(ob => lastPrice >= ob.low && lastPrice <= ob.high) || null;
  const inFVG        = fvgs.find(fvg => lastPrice >= fvg.bottom && lastPrice <= fvg.top)   || null;

  return {
    bias,
    biasLabel:         bias === BULLISH ? 'BULLISH' : bias === BEARISH ? 'BEARISH' : 'NEUTRAL',
    recentBOS:         bosEvents.length   > 0 ? bosEvents[bosEvents.length - 1]     : null,
    recentCHoCH:       chochEvents.length > 0 ? chochEvents[chochEvents.length - 1] : null,
    activeOrderBlocks: orderBlocks,
    activeFVGs:        fvgs,
    strongHigh:        extremes.strongHigh,
    strongLow:         extremes.strongLow,
    inOrderBlock,
    inFVG,
  };
}

module.exports = { analyzeSMC, detectStructure, detectFVGs, BULLISH, BEARISH };
