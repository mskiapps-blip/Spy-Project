// ============================================================
// FILE: DataFetcher.gs
// PURPOSE: Fetches live SPY data from Yahoo Finance (free, no key).
//          Uses the v8 chart endpoint. Now also computes VWAP
//          from intraday 5-min bars.
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

    // ── VWAP: cumulative(typical_price × volume) / cumulative(volume)
    // Typical price = (high + low + close) / 3 per bar.
    // Skip bars with null/zero data to avoid skewing the result.
    var vwap = computeVWAP(highs, lows, closes, volumes);
    Logger.log("VWAP: " + vwap);

    // ── 30-day average volume (cached ~6h) ──────────────────
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
// VWAP CALCULATOR
// Uses intraday 5-min bars: typical price = (H + L + C) / 3.
// Returns 0 if there are no valid bars yet.
// ─────────────────────────────────────────────────────────────
function computeVWAP(highs, lows, closes, volumes) {
  var cumTPV = 0;  // cumulative (typical price × volume)
  var cumVol = 0;  // cumulative volume

  var len = Math.min(highs.length, lows.length, closes.length, volumes.length);

  for (var i = 0; i < len; i++) {
    var h = highs[i];
    var l = lows[i];
    var c = closes[i];
    var v = volumes[i];

    // Skip null or zero-volume bars (pre-market stubs, etc.)
    if (h == null || l == null || c == null || v == null || v === 0) continue;

    var typicalPrice = (h + l + c) / 3;
    cumTPV += typicalPrice * v;
    cumVol += v;
  }

  if (cumVol === 0) return 0;
  return Math.round((cumTPV / cumVol) * 100) / 100;  // round to 2 decimal places
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
      cache.put("AVG_VOL_30", String(avg), 21600); // cache 6 hours
    }
    return avg;

  } catch (e) {
    Logger.log("fetch30DayAvgVolume ERROR: " + e.message);
    return 0;
  }
}
