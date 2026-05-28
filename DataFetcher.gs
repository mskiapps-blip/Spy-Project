// ============================================================
// FILE: DataFetcher.gs
// PURPOSE: Fetches live SPY data from Yahoo Finance (free, no key).
//          Also fetches 30-day historical volume for comparison.
// ============================================================

// ─────────────────────────────────────────────────────────────
// YAHOO FINANCE BASE URL
// We use the v8 chart endpoint — no API key required.
// ─────────────────────────────────────────────────────────────
var YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/SPY";

// ─────────────────────────────────────────────────────────────
// MAIN FETCH: Returns an object with all SPY data needed for a tick.
// Returns null on failure so the caller can skip gracefully.
// ─────────────────────────────────────────────────────────────
function fetchSPYData() {
  try {
    // ── Fetch current quote (1-day, 5-min interval) ──────────
    var url = YAHOO_BASE + "?interval=5m&range=1d";
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log("Yahoo fetch failed: " + response.getResponseCode());
      return null;
    }

    var json = JSON.parse(response.getContentText());
    var result = json.chart.result[0];

    if (!result) {
      Logger.log("Yahoo: no result in chart response.");
      return null;
    }

    var meta       = result.meta;
    var price      = meta.regularMarketPrice;
    var prevClose  = meta.previousClose || meta.chartPreviousClose;
    var volume     = meta.regularMarketVolume || 0;
    var dayHigh    = meta.regularMarketDayHigh || price;
    var dayLow     = meta.regularMarketDayLow  || price;
    var dayOpen    = meta.regularMarketOpen    || prevClose;

    // ── Pull timestamp array to get latest 5-min tick volumes ─
    var timestamps = result.timestamp || [];
    var indicators = result.indicators;
    var quotes     = indicators.quote[0];
    var closes     = quotes.close  || [];
    var volumes    = quotes.volume || [];

    // Latest valid close from intraday bars (as a sanity check)
    var latestBarClose = getLatestValid(closes) || price;

    // Sum of today's bar volumes up to now
    var volumeToday = 0;
    for (var i = 0; i < volumes.length; i++) {
      if (volumes[i] != null) volumeToday += volumes[i];
    }
    // Use meta volume if bar sum is unavailable
    if (volumeToday === 0) volumeToday = volume;

    // ── Fetch 30-day daily data for volume average ────────────
    var avgVol30 = fetch30DayAvgVolume();

    // ── Build and return the data object ─────────────────────
    return {
      price:       price,
      prevClose:   prevClose,
      dayOpen:     dayOpen,
      dayHigh:     dayHigh,
      dayLow:      dayLow,
      volumeToday: volumeToday,
      avgVol30:    avgVol30,
      closes:      closes,      // array of intraday bar closes
      volumes:     volumes      // array of intraday bar volumes
    };

  } catch (e) {
    Logger.log("fetchSPYData ERROR: " + e.toString());
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Fetch 30-day daily bars and return average daily volume.
// Uses Yahoo 1d interval, 1mo range.
// ─────────────────────────────────────────────────────────────
function fetch30DayAvgVolume() {
  try {
    var url = YAHOO_BASE + "?interval=1d&range=1mo";
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return 0;

    var json    = JSON.parse(response.getContentText());
    var result  = json.chart.result[0];
    var volumes = result.indicators.quote[0].volume || [];

    var total = 0, count = 0;
    for (var i = 0; i < volumes.length; i++) {
      if (volumes[i] != null && volumes[i] > 0) {
        total += volumes[i];
        count++;
      }
    }
    return count > 0 ? Math.round(total / count) : 0;

  } catch (e) {
    Logger.log("fetch30DayAvgVolume ERROR: " + e.toString());
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER: Get the last non-null value from an array
// ─────────────────────────────────────────────────────────────
function getLatestValid(arr) {
  for (var i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Fetch recent intraday closes for trend analysis.
// Returns an array of the last N close prices from today's bars.
// ─────────────────────────────────────────────────────────────
function fetchIntradayCloses(n) {
  try {
    var url = YAHOO_BASE + "?interval=5m&range=1d";
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return [];
    var json   = JSON.parse(response.getContentText());
    var result = json.chart.result[0];
    var closes = result.indicators.quote[0].close || [];
    // Filter nulls
    var valid = closes.filter(function(c) { return c != null; });
    return valid.slice(-n);
  } catch (e) {
    Logger.log("fetchIntradayCloses ERROR: " + e.toString());
    return [];
  }
}
