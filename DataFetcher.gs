// ============================================================
// FILE: DataFetcher.gs
// PURPOSE: Fetches live SPY data from Yahoo Finance (free, no key).
//          Uses the v8 chart endpoint with a timeout-safe fetch.
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
        // Some Yahoo endpoints need a browser-like User-Agent
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
    var closes  = (quotes && quotes.close)  || [];
    var volumes = (quotes && quotes.volume) || [];

    // Sum bar volumes as a more accurate intraday volume
    var volumeToday = 0;
    volumes.forEach(function(v) { if (v != null) volumeToday += v; });
    if (volumeToday === 0) volumeToday = volume;

    // ── 30-day average volume (cached — barely moves intraday) ─
    var avgVol30 = fetch30DayAvgVolume();

    return {
      price:       price,
      prevClose:   prevClose,
      dayOpen:     dayOpen,
      dayHigh:     dayHigh,
      dayLow:      dayLow,
      volumeToday: volumeToday,
      avgVol30:    avgVol30,
      closes:      closes,
      volumes:     volumes
    };

  } catch (e) {
    Logger.log("fetchSPYData ERROR: " + e.message + "\n" + e.stack);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Fetch 30-day daily bars → average daily volume.
// Cached for 6 hours via CacheService — the 30-day average does
// not meaningfully change within a single trading session, so we
// avoid a second Yahoo round-trip on every 5-minute tick.
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
