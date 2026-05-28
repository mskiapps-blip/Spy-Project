// ============================================================
// FILE: TrendAnalyzer.gs
// PURPOSE: Determines SPY trend status, support/resistance
//          zones, and likely direction for each tick.
//
//  HOW TREND IS DESIGNED:
//  ┌─────────────────────────────────────────────────────────┐
//  │  1. TREND DIRECTION  — based on short-term EMAs         │
//  │  2. SUPPORT / RESISTANCE ZONES                          │
//  │  3. OUTLOOK STRING                                      │
//  │  4. getTopSRZones() — exported for Logger columns       │
//  └─────────────────────────────────────────────────────────┘
// ============================================================

// ─────────────────────────────────────────────────────────────
// TREND SETTINGS
// ─────────────────────────────────────────────────────────────
var TREND_SETTINGS = {
  EMA_FAST_PERIOD:   9,
  EMA_SLOW_PERIOD:   21,
  HISTORY_BARS:      30,
  ROUND_NUMBER_STEP: 5,     // SPY round levels every $5
  NEAR_ZONE_PCT:     0.20,  // Within 0.20% = "near" for trend label
  MOMENTUM_BARS:     5
};

// ─────────────────────────────────────────────────────────────
// MAIN: Analyze trend and return a one-line status string.
// ─────────────────────────────────────────────────────────────
function analyzeTrend(data, prevClose, dayOpenPrice) {
  try {
    if (!data || !data.price || data.price <= 0) {
      return "⚠️ No price data";
    }

    var history = updatePriceHistory(data.price);
    Logger.log("TREND: history length=" + history.length + " price=" + data.price);

    var fastEMA = computeEMA(history, TREND_SETTINGS.EMA_FAST_PERIOD);
    var slowEMA = computeEMA(history, TREND_SETTINGS.EMA_SLOW_PERIOD);
    Logger.log("TREND: fastEMA=" + fastEMA + " slowEMA=" + slowEMA);

    var direction = "⚖️ NEUTRAL";

    if (fastEMA !== null && slowEMA !== null) {
      if (fastEMA > slowEMA * 1.0003) {
        direction = "📈 UPTREND";
      } else if (fastEMA < slowEMA * 0.9997) {
        direction = "📉 DOWNTREND";
      } else {
        direction = "⚖️ CONSOLIDATING";
      }
    } else if (fastEMA !== null) {
      direction = data.price > (dayOpenPrice || data.price)
        ? "📈 ABOVE OPEN" : "📉 BELOW OPEN";
    } else if (history.length >= 3) {
      direction = data.price > (dayOpenPrice || data.price)
        ? "📈 ABOVE OPEN" : "📉 BELOW OPEN";
    } else {
      direction = "⏳ GATHERING DATA (" + history.length + " bars)";
    }

    var zones    = getSupportResistanceZones(data, prevClose, dayOpenPrice);
    var nearZone = findNearestZone(data.price, zones);
    var momentumStr = getMomentumTag(history);

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
// INTERNAL: Build all S/R zones from available price levels.
// Returns array of { label, price, type } objects.
// ─────────────────────────────────────────────────────────────
function getSupportResistanceZones(data, prevClose, dayOpen) {
  var zones = [];
  var price = data.price;

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
  addZone("$" + lower, lower, "support");
  addZone("$" + upper, upper, "resistance");

  // VWAP as a dynamic S/R zone if available
  if (data.vwap && data.vwap > 0) {
    addZone("VWAP", data.vwap, price >= data.vwap ? "support" : "resistance");
  }

  return zones;
}

// ─────────────────────────────────────────────────────────────
// PUBLIC: Return top 2 supports and top 2 resistances for
// the dedicated S/R columns in the log.
//
// Supports  = zones BELOW current price, sorted closest first.
// Resistances = zones ABOVE current price, sorted closest first.
// Each entry includes { label, price, distPct }.
//
// Deduplication: zones within 0.05% of each other are merged
// (keeps the one with the more descriptive label) so the log
// never shows two essentially identical levels.
// ─────────────────────────────────────────────────────────────
function getTopSRZones(data, prevClose, dayOpenPrice) {
  var price = data.price;
  var zones = getSupportResistanceZones(data, prevClose, dayOpenPrice);

  // Separate into below (supports) and above (resistances)
  var rawSupports    = [];
  var rawResistances = [];

  zones.forEach(function(z) {
    var distPct = ((price - z.price) / price) * 100; // positive = below price
    if (z.price < price) {
      rawSupports.push({ label: z.label, price: z.price, distPct: Math.abs(distPct) });
    } else if (z.price > price) {
      rawResistances.push({ label: z.label, price: z.price, distPct: Math.abs(distPct) });
    }
    // Skip zones at exactly the current price (distPct = 0)
  });

  // Sort: closest first
  rawSupports.sort(function(a, b) { return a.distPct - b.distPct; });
  rawResistances.sort(function(a, b) { return a.distPct - b.distPct; });

  // Deduplicate: drop any zone within 0.05% of a closer one
  function dedup(arr) {
    var result = [];
    arr.forEach(function(z) {
      var tooClose = result.some(function(kept) {
        return Math.abs(kept.price - z.price) / price * 100 < 0.05;
      });
      if (!tooClose) result.push(z);
    });
    return result;
  }

  var supports    = dedup(rawSupports).slice(0, 2);
  var resistances = dedup(rawResistances).slice(0, 2);

  // Pad to 2 entries so callers don't need null checks
  while (supports.length    < 2) supports.push(null);
  while (resistances.length < 2) resistances.push(null);

  return { supports: supports, resistances: resistances };
}

// ─────────────────────────────────────────────────────────────
// NEAREST ZONE: find closest S/R within NEAR_ZONE_PCT
// (used by analyzeTrend for the inline trend string)
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
// MOMENTUM TAG
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
// ─────────────────────────────────────────────────────────────
function computeEMA(history, period) {
  if (!history || history.length < period) return null;

  var k     = 2 / (period + 1);
  var slice = history.slice(-Math.min(period * 2, history.length));

  var ema = 0;
  for (var i = 0; i < period; i++) ema += slice[i];
  ema /= period;

  if (isNaN(ema)) return null;

  for (var j = period; j < slice.length; j++) {
    ema = slice[j] * k + ema * (1 - k);
  }

  return isNaN(ema) ? null : ema;
}

// ─────────────────────────────────────────────────────────────
// PRICE HISTORY STORE
// ─────────────────────────────────────────────────────────────
function updatePriceHistory(price) {
  var stored = getFlag("PRICE_HISTORY") || "";

  var arr = [];
  if (stored && stored.length > 0) {
    arr = stored.split(",")
      .map(parseFloat)
      .filter(function(v) { return !isNaN(v) && isFinite(v) && v > 0; });
  }

  if (typeof price === "number" && !isNaN(price) && price > 0) {
    arr.push(price);
  }

  if (arr.length > TREND_SETTINGS.HISTORY_BARS) {
    arr = arr.slice(-TREND_SETTINGS.HISTORY_BARS);
  }

  setFlag("PRICE_HISTORY", arr.join(","));
  return arr;
}
