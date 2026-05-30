// ============================================================
// FILE: DataFetcher.gs
// PURPOSE: Fetches live SPY data from Yahoo Finance (free, no key).
//          Uses the v8 chart endpoint. Also computes VWAP
//          from intraday 5-min bars.
//          NEW: fetchVIX() and fetchESFutures() for Bear Trap context.
//          Both are cached per 5-min cycle to avoid extra quota burn.
//          NEW: fetchPreMarketData() for overnight high/low/close.
// ============================================================

var YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/SPY";

// ─────────────────────────────────────────────────────────────
// MAIN FETCH — returns data object or null on failure
// ─────────────────────────────────────────────────────────────
function fetchSPYData() {
  try {
    var url = YAHOO_BASE + "?interval=5m&range=1d";
    Logger.log("Fetching: " + url);

    var options = {
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    };

    var response = UrlFetchApp.fetch(url, options);
    var code     = response.getResponseCode();
    Logger.log("Yahoo response code: " + code);

    if (code !== 200) {
      Logger.log("Yahoo non-200: " + response.getContentText().substring(0, 200));
      return null;
    }

    var json   = JSON.parse(response.getContentText());
    var result = json.chart && json.chart.result && json.chart.result[0];

    if (!result) {
      Logger.log("Yahoo: no result object in response.");
      return null;
    }

    var meta = result.meta;
    if (!meta) {
      Logger.log("Yahoo: no meta in result.");
      return null;
    }

    // ── Extract fields (with safe fallbacks) ─────────────────
    var price     = meta.regularMarketPrice     || 0;
    var prevClose = meta.previousClose          || meta.chartPreviousClose || price;
    var volume    = meta.regularMarketVolume    || 0;
    var dayHigh   = meta.regularMarketDayHigh   || price;
    var dayLow    = meta.regularMarketDayLow    || price;
    var dayOpen   = meta.regularMarketOpen      || prevClose;

    Logger.log("price=" + price + " prevClose=" + prevClose + " volume=" + volume);

    if (price === 0) {
      Logger.log("Yahoo returned price=0 — market may be closed.");
      return null;
    }

    // ── Intraday bar data ─────────────────────────────────────
    var quotes  = result.indicators && result.indicators.quote && result.indicators.quote[0];
    var highs   = (quotes && quotes.high)   || [];
    var lows    = (quotes && quotes.low)    || [];
    var closes  = (quotes && quotes.close)  || [];
    var volumes = (quotes && quotes.volume) || [];

    // Sum bar volumes for intraday total
    var volumeToday = 0;
    volumes.forEach(function(v) { if (v != null) volumeToday += v; });
    if (volumeToday === 0) volumeToday = volume;

    // ── VWAP ─────────────────────────────────────────────────
    var vwap = computeVWAP(highs, lows, closes, volumes);
    Logger.log("VWAP: " + vwap);

    // ── 30-day average volume (cached ~6h) ───────────────────
    var avgVol30 = fetch30DayAvgVolume();

    return {
      price:       price,
      prevClose:   prevClose,
      dayOpen:     dayOpen,
      dayHigh:     dayHigh,
      dayLow:      dayLow,
      volumeToday: volumeToday,
      avgVol30:    avgVol30,
      vwap:        vwap,
      closes:      closes,
      volumes:     volumes
    };

  } catch (e) {
    Logger.log("fetchSPYData ERROR: " + e.message + "\n" + e.stack);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// PRE-MARKET DATA — overnight high, low, and last price
// Cached 4 minutes to match VIX/ES cycle.
//
// Strategy: fetch 1-minute bars for the full day, then filter
// to only bars that fall in the pre-market window (before
// 9:30am ET = before market open). Extract high/low/last
// from those bars.
//
// Returns: { high, low, close } or null on failure.
//   high:  highest price reached overnight / pre-market
//   low:   lowest price reached overnight / pre-market
//   close: most recent pre-market price (last valid bar)
// ─────────────────────────────────────────────────────────────
function fetchPreMarketData() {
  var cache  = CacheService.getScriptCache();
  var cached = cache.get("PRE_MARKET_DATA");
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }

  try {
    // 1-minute bars for today gives us pre-market detail
    var url  = YAHOO_BASE + "?interval=1m&range=1d";
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("fetchPreMarketData non-200: " + resp.getResponseCode());
      return null;
    }

    var json   = JSON.parse(resp.getContentText());
    var result = json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.meta) return null;

    var meta       = result.meta;
    var timestamps = result.timestamp || [];
    var quotes     = result.indicators && result.indicators.quote && result.indicators.quote[0];
    var highs      = (quotes && quotes.high)  || [];
    var lows       = (quotes && quotes.low)   || [];
    var closes     = (quotes && quotes.close) || [];

    // Market open in Unix seconds = today at 9:30am ET
    // Yahoo timestamps are UTC. 9:30am ET = 14:30 UTC (EST) or 13:30 UTC (EDT).
    // We use the meta.regularMarketTime as the open anchor — anything before
    // it is pre-market.
    var marketOpenTs = meta.regularMarketTime || 0;

    // Fallback: if no timestamps, use meta fields directly
    if (timestamps.length === 0 || marketOpenTs === 0) {
      var fallbackPrice = meta.regularMarketPrice || meta.chartPreviousClose || 0;
      if (fallbackPrice === 0) return null;
      var data = { high: fallbackPrice, low: fallbackPrice, close: fallbackPrice };
      cache.put("PRE_MARKET_DATA", JSON.stringify(data), 240);
      return data;
    }

    // Filter to pre-market bars only (timestamp < market open)
    var pmHighs  = [];
    var pmLows   = [];
    var pmCloses = [];

    for (var i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= marketOpenTs) break; // stop at market open
      var h = highs[i];
      var l = lows[i];
      var c = closes[i];
      if (h != null && h > 0) pmHighs.push(h);
      if (l != null && l > 0) pmLows.push(l);
      if (c != null && c > 0) pmCloses.push(c);
    }

    // If no pre-market bars found (e.g. very early morning before any trading),
    // fall back to previous close as a reasonable baseline
    if (pmHighs.length === 0) {
      var pc = meta.previousClose || meta.chartPreviousClose || 0;
      if (pc === 0) return null;
      var data = { high: pc, low: pc, close: pc };
      cache.put("PRE_MARKET_DATA", JSON.stringify(data), 240);
      Logger.log("fetchPreMarketData: no pre-market bars found, using prevClose=" + pc);
      return data;
    }

    var pmHigh  = Math.max.apply(null, pmHighs);
    var pmLow   = Math.min.apply(null, pmLows);
    var pmClose = pmCloses[pmCloses.length - 1]; // most recent pre-market bar

    var data = {
      high:  Math.round(pmHigh  * 100) / 100,
      low:   Math.round(pmLow   * 100) / 100,
      close: Math.round(pmClose * 100) / 100
    };

    cache.put("PRE_MARKET_DATA", JSON.stringify(data), 240);
    Logger.log("fetchPreMarketData: high=" + data.high + " low=" + data.low + " close=" + data.close +
               " (" + pmHighs.length + " pre-market bars)");
    return data;

  } catch (e) {
    Logger.log("fetchPreMarketData ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// VIX FETCH — cached 4 minutes so it only hits Yahoo once
// per 5-min trigger cycle.
//
// Returns: { price, prevClose, change, changePct }
//   price:     current VIX level
//   prevClose: yesterday's VIX close
//   change:    raw point change
//   changePct: % change
//   regime:    "LOW" (<15) | "NORMAL" (15-22) | "ELEVATED" (22-28) | "FEAR" (>28)
//
// Bear Trap context:
//   NORMAL (15-22) = sweet spot — traps form most reliably here
//   ELEVATED (22-28) = caution — flush may have more follow-through
//   FEAR (>28) = danger — real selling, not a trap day
// ─────────────────────────────────────────────────────────────
function fetchVIX() {
  var cache  = CacheService.getScriptCache();
  var cached = cache.get("VIX_DATA");
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }

  try {
    var url  = "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=5m&range=1d";
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("VIX fetch non-200: " + resp.getResponseCode());
      return null;
    }

    var json   = JSON.parse(resp.getContentText());
    var result = json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.meta) return null;

    var meta      = result.meta;
    var price     = meta.regularMarketPrice  || 0;
    var prevClose = meta.previousClose       || meta.chartPreviousClose || price;

    if (price === 0) return null;

    var change    = price - prevClose;
    var changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    // Regime classification for Bear Trap scoring
    var regime;
    if      (price < 15)  regime = "LOW";
    else if (price < 22)  regime = "NORMAL";
    else if (price < 28)  regime = "ELEVATED";
    else                  regime = "FEAR";

    var data = {
      price:     Math.round(price * 100) / 100,
      prevClose: Math.round(prevClose * 100) / 100,
      change:    Math.round(change * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      regime:    regime
    };

    // Cache 4 minutes (240 seconds)
    cache.put("VIX_DATA", JSON.stringify(data), 240);
    Logger.log("VIX: " + price + " regime=" + regime);
    return data;

  } catch (e) {
    Logger.log("fetchVIX ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// ES FUTURES FETCH — S&P 500 E-mini futures (ES=F)
// Cached 4 minutes, same as VIX.
//
// Returns: { price, prevClose, change, changePct, trend }
//   trend: "FADING" | "FLAT" | "CLIMBING"
//     FADING   = futures dropping from their overnight high (trap setup)
//     FLAT     = neutral, waiting
//     CLIMBING = futures still pushing up (may not be a trap day)
//
// Bear Trap context:
//   FADING ES pre-market = strong trap setup signal
//   CLIMBING ES = trap less likely, flush may follow through
// ─────────────────────────────────────────────────────────────
function fetchESFutures() {
  var cache  = CacheService.getScriptCache();
  var cached = cache.get("ES_FUTURES_DATA");
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }

  try {
    var url  = "https://query1.finance.yahoo.com/v8/finance/chart/ES%3DF?interval=5m&range=1d";
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("ES futures fetch non-200: " + resp.getResponseCode());
      return null;
    }

    var json   = JSON.parse(resp.getContentText());
    var result = json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.meta) return null;

    var meta      = result.meta;
    var price     = meta.regularMarketPrice || 0;
    var prevClose = meta.previousClose      || meta.chartPreviousClose || price;

    if (price === 0) return null;

    var change    = price - prevClose;
    var changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    // ── ES trend: is it fading from its overnight high? ──────
    // Look at the last 3 intraday bars to see direction
    var quotes  = result.indicators && result.indicators.quote && result.indicators.quote[0];
    var closes  = (quotes && quotes.close) || [];
    var dayHigh = meta.regularMarketDayHigh || price;

    // Filter nulls and get last 3 valid closes
    var validCloses = closes.filter(function(c) { return c != null && c > 0; });
    var last3       = validCloses.slice(-3);

    var trend = "FLAT";
    if (last3.length >= 2) {
      var recentMove = last3[last3.length - 1] - last3[0];
      var movePct    = (recentMove / last3[0]) * 100;
      if      (movePct < -0.05) trend = "FADING";
      else if (movePct >  0.05) trend = "CLIMBING";
      else                      trend = "FLAT";
    }

    // Also flag if price is well below the day's high (fading from high)
    var distFromHigh = dayHigh > 0 ? ((price - dayHigh) / dayHigh) * 100 : 0;
    if (distFromHigh < -0.15 && trend !== "CLIMBING") trend = "FADING";

    // ── ES alignment tag for Bear Trap ───────────────────────
    var alignmentTag;
    if      (changePct < -1.0)  alignmentTag = "ES VOID";
    else if (changePct >  0.5)  alignmentTag = "ES CAUTION";
    else                        alignmentTag = "ES MONITOR";

    var data = {
      price:        Math.round(price * 100) / 100,
      prevClose:    Math.round(prevClose * 100) / 100,
      change:       Math.round(change * 100) / 100,
      changePct:    Math.round(changePct * 100) / 100,
      trend:        trend,
      distFromHigh: Math.round(distFromHigh * 100) / 100,
      alignmentTag: alignmentTag
    };

    // Cache 4 minutes (240 seconds)
    cache.put("ES_FUTURES_DATA", JSON.stringify(data), 240);
    Logger.log("ES Futures: " + price + " trend=" + trend + " distFromHigh=" + distFromHigh + "% align=" + alignmentTag);
    return data;

  } catch (e) {
    Logger.log("fetchESFutures ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// VWAP CALCULATOR
// ─────────────────────────────────────────────────────────────
function computeVWAP(highs, lows, closes, volumes) {
  var cumTPV = 0;
  var cumVol = 0;
  var len = Math.min(highs.length, lows.length, closes.length, volumes.length);

  for (var i = 0; i < len; i++) {
    var h = highs[i];
    var l = lows[i];
    var c = closes[i];
    var v = volumes[i];
    if (h == null || l == null || c == null || v == null || v === 0) continue;
    var typicalPrice = (h + l + c) / 3;
    cumTPV += typicalPrice * v;
    cumVol += v;
  }

  if (cumVol === 0) return 0;
  return Math.round((cumTPV / cumVol) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────
// 30-DAY AVERAGE VOLUME (cached 6 hours)
// ─────────────────────────────────────────────────────────────
function fetch30DayAvgVolume() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("AVG_VOL_30");
  if (cached !== null) {
    var c = parseInt(cached);
    if (!isNaN(c)) return c;
  }

  try {
    var url  = YAHOO_BASE + "?interval=1d&range=1mo";
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (resp.getResponseCode() !== 200) return 0;

    var json    = JSON.parse(resp.getContentText());
    var result  = json.chart && json.chart.result && json.chart.result[0];
    if (!result) return 0;

    var volumes = result.indicators.quote[0].volume || [];
    var total   = 0;
    var count   = 0;
    volumes.forEach(function(v) {
      if (v != null && v > 0) { total += v; count++; }
    });

    var avg = count > 0 ? Math.round(total / count) : 0;
    Logger.log("30d avg volume (" + count + " bars): " + avg);

    if (avg > 0) {
      cache.put("AVG_VOL_30", String(avg), 21600);
    }
    return avg;

  } catch (e) {
    Logger.log("fetch30DayAvgVolume ERROR: " + e.message);
    return 0;
  }
}
