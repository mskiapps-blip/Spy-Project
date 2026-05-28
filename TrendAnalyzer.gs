// ============================================================
// FILE: TrendAnalyzer.gs
// PURPOSE: Determines SPY trend status, support/resistance
//          zones, and likely direction for each tick.
//
//  HOW TREND IS DESIGNED:
//  ┌─────────────────────────────────────────────────────────┐
//  │  1. TREND DIRECTION  — based on short-term EMAs         │
//  │     We store the last N closes in CONFIG and compute a  │
//  │     fast EMA (9-bar) vs slow EMA (21-bar).              │
//  │                                                         │
//  │  2. SUPPORT / RESISTANCE ZONES                          │
//  │     Derived from today's: Open, DayHigh, DayLow,       │
//  │     Previous Close, and round-number levels.            │
//  │                                                         │
//  │  3. OUTLOOK STRING                                      │
//  │     Combines direction + nearest S/R + momentum tag.   │
//  └─────────────────────────────────────────────────────────┘
// ============================================================

// ─────────────────────────────────────────────────────────────
// TREND SETTINGS — adjust these to tune sensitivity
// ─────────────────────────────────────────────────────────────
var TREND_SETTINGS = {
  EMA_FAST_PERIOD:  9,      // Fast EMA period (bars)
  EMA_SLOW_PERIOD:  21,     // Slow EMA period (bars)
  HISTORY_BARS:     30,     // Max bars to store in CONFIG
  ROUND_NUMBER_STEP: 5,     // SPY round levels (every $5, e.g. 520, 525)
  NEAR_ZONE_PCT:    0.15,   // How close (%) to count as "near" S/R
  MOMENTUM_BARS:    5       // Bars to look back for momentum reading
};

// ─────────────────────────────────────────────────────────────
// MAIN: Analyze trend and return a one-line status string.
// data:        SPY data object from DataFetcher
// prevClose:   Yesterday's close price
// dayOpenPrice: Today's open price
// ─────────────────────────────────────────────────────────────
function analyzeTrend(data, prevClose, dayOpenPrice) {
  try {
    // ── 1. Update stored price history ───────────────────────
    var history = updatePriceHistory(data.price);

    // ── 2. Compute EMAs if we have enough bars ───────────────
    var fastEMA = computeEMA(history, TREND_SETTINGS.EMA_FAST_PERIOD);
    var slowEMA = computeEMA(history, TREND_SETTINGS.EMA_SLOW_PERIOD);

    // ── 3. Determine trend direction ─────────────────────────
    var direction = "⚖️ NEUTRAL";
    if (fastEMA && slowEMA) {
      if (fastEMA > slowEMA * 1.0003) {
        direction = "📈 UPTREND";
      } else if (fastEMA < slowEMA * 0.9997) {
        direction = "📉 DOWNTREND";
      } else {
        direction = "⚖️ CONSOLIDATING";
      }
    } else if (history.length >= 3) {
      // Simple: is price above or below the day open?
      direction = data.price > dayOpenPrice ? "📈 ABOVE OPEN" : "📉 BELOW OPEN";
    }

    // ── 4. Find S/R zones ────────────────────────────────────
    var zones    = getSupportResistanceZones(data, prevClose, dayOpenPrice);
    var nearZone = findNearestZone(data.price, zones);

    // ── 5. Momentum tag ──────────────────────────────────────
    var momentumStr = getMomentumTag(history);

    // ── 6. Build output string ───────────────────────────────
    var parts = [direction];
    if (nearZone)    parts.push(nearZone);
    if (momentumStr) parts.push(momentumStr);

    return parts.join(" │ ");

  } catch (e) {
    Logger.log("analyzeTrend ERROR: " + e.toString());
    return "⚠️ Trend unavailable";
  }
}

// ─────────────────────────────────────────────────────────────
// SUPPORT / RESISTANCE ZONES
// Returns an array of { label, price, type } objects.
// Type: "support" or "resistance"
// ─────────────────────────────────────────────────────────────
function getSupportResistanceZones(data, prevClose, dayOpen) {
  var zones = [];
  var price = data.price;

  // ── Previous close ────────────────────────────────────────
  zones.push({ label: "PrevClose",  price: prevClose,    type: price >= prevClose ? "support"    : "resistance" });

  // ── Day open ──────────────────────────────────────────────
  zones.push({ label: "DayOpen",    price: dayOpen,      type: price >= dayOpen   ? "support"    : "resistance" });

  // ── Day high / low ────────────────────────────────────────
  zones.push({ label: "DayHigh",    price: data.dayHigh, type: "resistance" });
  zones.push({ label: "DayLow",     price: data.dayLow,  type: "support" });

  // ── Round number levels (every $5) ───────────────────────
  var step  = TREND_SETTINGS.ROUND_NUMBER_STEP;
  var lower = Math.floor(price / step) * step;
  var upper = lower + step;
  zones.push({ label: "$" + lower + " round",  price: lower, type: "support" });
  zones.push({ label: "$" + upper + " round",  price: upper, type: "resistance" });

  return zones;
}

// ─────────────────────────────────────────────────────────────
// NEAREST ZONE: Find the closest S/R zone within threshold
// ─────────────────────────────────────────────────────────────
function findNearestZone(price, zones) {
  var nearPct   = TREND_SETTINGS.NEAR_ZONE_PCT / 100;
  var closest   = null;
  var closestDist = Infinity;

  for (var i = 0; i < zones.length; i++) {
    var z    = zones[i];
    var dist = Math.abs(price - z.price);
    var pct  = dist / price;

    if (pct <= nearPct && dist < closestDist) {
      closest     = z;
      closestDist = dist;
    }
  }

  if (!closest) return null;

  var distStr = (closestDist / price * 100).toFixed(2) + "%";
  var emoji   = closest.type === "support" ? "🟢" : "🔴";
  return emoji + " Near " + closest.type + " (" + closest.label + ", " + distStr + " away)";
}

// ─────────────────────────────────────────────────────────────
// MOMENTUM TAG: Short-term direction based on last N bars
// ─────────────────────────────────────────────────────────────
function getMomentumTag(history) {
  var n = TREND_SETTINGS.MOMENTUM_BARS;
  if (history.length < n + 1) return null;

  var recent    = history.slice(-n);
  var oldest    = recent[0];
  var newest    = recent[recent.length - 1];
  var pctChange = ((newest - oldest) / oldest) * 100;

  if (pctChange > 0.3)       return "⚡ ACCELERATING UP";
  if (pctChange > 0.1)       return "↗️ GRINDING UP";
  if (pctChange < -0.3)      return "💨 ACCELERATING DOWN";
  if (pctChange < -0.1)      return "↘️ GRINDING DOWN";
  return "➡️ FLAT";
}

// ─────────────────────────────────────────────────────────────
// EMA CALCULATOR (Exponential Moving Average)
// history: array of closing prices (oldest first)
// period:  EMA period (e.g. 9, 21)
// Returns: the EMA value or null if not enough data
// ─────────────────────────────────────────────────────────────
function computeEMA(history, period) {
  if (history.length < period) return null;

  var k     = 2 / (period + 1); // smoothing factor
  var slice = history.slice(-period * 2); // use up to 2x period for accuracy

  // Seed with SMA of first `period` bars
  var ema = 0;
  for (var i = 0; i < period; i++) ema += slice[i];
  ema /= period;

  // Apply EMA formula for remaining bars
  for (var j = period; j < slice.length; j++) {
    ema = slice[j] * k + ema * (1 - k);
  }

  return ema;
}

// ─────────────────────────────────────────────────────────────
// PRICE HISTORY STORE: Appends price and trims to max length.
// Stored as a comma-separated string in CONFIG.
// Returns array of numbers (oldest first).
// ─────────────────────────────────────────────────────────────
function updatePriceHistory(price) {
  var stored  = getFlag("PRICE_HISTORY") || "";
  var arr     = stored ? stored.split(",").map(parseFloat) : [];

  arr.push(price);

  // Keep only the last HISTORY_BARS values
  if (arr.length > TREND_SETTINGS.HISTORY_BARS) {
    arr = arr.slice(-TREND_SETTINGS.HISTORY_BARS);
  }

  setFlag("PRICE_HISTORY", arr.join(","));
  return arr;
}
