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
  EMA_FAST_PERIOD:   9,     // Fast EMA period (bars)
  EMA_SLOW_PERIOD:   21,    // Slow EMA period (bars)
  HISTORY_BARS:      30,    // Max bars to store in CONFIG
  ROUND_NUMBER_STEP: 5,     // SPY round levels every $5 (e.g. 750, 755)
  NEAR_ZONE_PCT:     0.20,  // Within 0.20% = "near" a support/resistance zone
  MOMENTUM_BARS:     5      // Bars to look back for momentum label
};

// ─────────────────────────────────────────────────────────────
// MAIN: Analyze trend and return a one-line status string.
// data:         SPY data object from DataFetcher
// prevClose:    Yesterday's close price
// dayOpenPrice: Today's open price
// ─────────────────────────────────────────────────────────────
function analyzeTrend(data, prevClose, dayOpenPrice) {
  try {
    // Validate incoming data before doing anything
    if (!data || !data.price || data.price <= 0) {
      return "⚠️ No price data";
    }

    // ── 1. Update price history (filters NaN automatically) ──
    var history = updatePriceHistory(data.price);
    Logger.log("TREND: history length=" + history.length + " price=" + data.price);

    // ── 2. Compute EMAs ───────────────────────────────────────
    var fastEMA = computeEMA(history, TREND_SETTINGS.EMA_FAST_PERIOD);
    var slowEMA = computeEMA(history, TREND_SETTINGS.EMA_SLOW_PERIOD);
    Logger.log("TREND: fastEMA=" + fastEMA + " slowEMA=" + slowEMA);

    // ── 3. Determine trend direction ──────────────────────────
    var direction = "⚖️ NEUTRAL";

    if (fastEMA !== null && slowEMA !== null) {
      // We have enough bars for both EMAs
      if (fastEMA > slowEMA * 1.0003) {
        direction = "📈 UPTREND";
      } else if (fastEMA < slowEMA * 0.9997) {
        direction = "📉 DOWNTREND";
      } else {
        direction = "⚖️ CONSOLIDATING";
      }
    } else if (fastEMA !== null) {
      // Have fast EMA but not slow yet — use vs day open
      direction = data.price > (dayOpenPrice || data.price)
        ? "📈 ABOVE OPEN" : "📉 BELOW OPEN";
    } else if (history.length >= 3) {
      // Not enough bars for any EMA yet — simple open comparison
      direction = data.price > (dayOpenPrice || data.price)
        ? "📈 ABOVE OPEN" : "📉 BELOW OPEN";
    } else {
      direction = "⏳ GATHERING DATA (" + history.length + " bars)";
    }

    // ── 4. Find nearest S/R zone ──────────────────────────────
    var zones    = getSupportResistanceZones(data, prevClose, dayOpenPrice);
    var nearZone = findNearestZone(data.price, zones);

    // ── 5. Momentum tag ───────────────────────────────────────
    var momentumStr = getMomentumTag(history);

    // ── 6. Assemble output ────────────────────────────────────
    var parts = [direction];
    if (nearZone)    parts.push(nearZone);
    if (momentumStr) parts.push(momentumStr);

    return parts.join(" │ ");

  } catch (e) {
    Logger.log("analyzeTrend ERROR: " + e.message + "\nStack: " + e.stack);
    return "⚠️ Trend error: " + e.message;
  }
}

// ─────────────────────────────────────────────────────────────
// SUPPORT / RESISTANCE ZONES
// Returns array of { label, price, type } objects.
// All prices are validated before pushing — skips any that
// are 0, null, or NaN to avoid bad distance calculations.
// ─────────────────────────────────────────────────────────────
function getSupportResistanceZones(data, prevClose, dayOpen) {
  var zones = [];
  var price = data.price;

  // Helper: only add zone if price value is a real number
  function addZone(label, zonePrice, type) {
    if (typeof zonePrice === "number" && !isNaN(zonePrice) && zonePrice > 0) {
      zones.push({ label: label, price: zonePrice, type: type });
    }
  }

  addZone("PrevClose", prevClose,    price >= prevClose ? "support" : "resistance");
  addZone("DayOpen",   dayOpen,      price >= dayOpen   ? "support" : "resistance");
  addZone("DayHigh",   data.dayHigh, "resistance");
  addZone("DayLow",    data.dayLow,  "support");

  // Round number levels (every $5)
  var step  = TREND_SETTINGS.ROUND_NUMBER_STEP;
  var lower = Math.floor(price / step) * step;
  var upper = lower + step;
  addZone("$" + lower + " round", lower, "support");
  addZone("$" + upper + " round", upper, "resistance");

  return zones;
}

// ─────────────────────────────────────────────────────────────
// NEAREST ZONE: Find closest S/R zone within NEAR_ZONE_PCT
// ─────────────────────────────────────────────────────────────
function findNearestZone(price, zones) {
  var nearPct     = TREND_SETTINGS.NEAR_ZONE_PCT / 100;
  var closest     = null;
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
// MOMENTUM TAG: Short-term direction from last N bars
// ─────────────────────────────────────────────────────────────
function getMomentumTag(history) {
  var n = TREND_SETTINGS.MOMENTUM_BARS;
  if (!history || history.length < n + 1) return null;

  var recent    = history.slice(-n);
  var oldest    = recent[0];
  var newest    = recent[recent.length - 1];

  if (!oldest || oldest === 0) return null;
  var pctChange = ((newest - oldest) / oldest) * 100;

  if (pctChange > 0.3)  return "⚡ ACCELERATING UP";
  if (pctChange > 0.1)  return "↗️ GRINDING UP";
  if (pctChange < -0.3) return "💨 ACCELERATING DOWN";
  if (pctChange < -0.1) return "↘️ GRINDING DOWN";
  return "➡️ FLAT";
}

// ─────────────────────────────────────────────────────────────
// EMA CALCULATOR
// Returns EMA value, or null if not enough data.
// ─────────────────────────────────────────────────────────────
function computeEMA(history, period) {
  if (!history || history.length < period) return null;

  var k     = 2 / (period + 1);
  var slice = history.slice(-Math.min(period * 2, history.length));

  // Seed: SMA of the first `period` values
  var ema = 0;
  for (var i = 0; i < period; i++) ema += slice[i];
  ema /= period;

  // If the seed itself is NaN something got through — abort
  if (isNaN(ema)) return null;

  // Apply EMA for remaining bars
  for (var j = period; j < slice.length; j++) {
    ema = slice[j] * k + ema * (1 - k);
  }

  return isNaN(ema) ? null : ema;
}

// ─────────────────────────────────────────────────────────────
// PRICE HISTORY STORE
// Stored as comma-separated string in CONFIG sheet.
// Returns array of valid positive numbers (oldest first).
//
// WHY WE FILTER: A single NaN in the array silently corrupts
// every EMA. This can creep in when CONFIG is cleared mid-
// session, or when a blank row is appended. We always sanitize
// the stored string on read so the EMA is always clean.
// ─────────────────────────────────────────────────────────────
function updatePriceHistory(price) {
  var stored = getFlag("PRICE_HISTORY") || "";

  // Parse — discard anything that isn't a real positive number
  var arr = [];
  if (stored && stored.length > 0) {
    arr = stored.split(",")
      .map(parseFloat)
      .filter(function(v) { return !isNaN(v) && isFinite(v) && v > 0; });
  }

  // Append current price if valid
  if (typeof price === "number" && !isNaN(price) && price > 0) {
    arr.push(price);
  }

  // Trim to max window
  if (arr.length > TREND_SETTINGS.HISTORY_BARS) {
    arr = arr.slice(-TREND_SETTINGS.HISTORY_BARS);
  }

  setFlag("PRICE_HISTORY", arr.join(","));
  return arr;
}
