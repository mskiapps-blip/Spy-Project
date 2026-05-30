// ============================================================
// FILE: Logger.gs
// PURPOSE: Calculates all per-tick metrics and writes one row
//          to the SPY LOG sheet.
// ============================================================

// ─────────────────────────────────────────────────────────────
// COLUMN MAP
// ─────────────────────────────────────────────────────────────
var COL = {
  DATE:          1,
  TIME:          2,
  PRICE:         3,
  PCT_CHANGE:    4,
  TICK_CHANGE:   5,
  TICK_PCT:      6,
  TICK_VS_AVG:   7,
  VOLUME:        8,
  VOLUME_VS_AVG: 9,
  VWAP:          10,
  S1:            11,
  S2:            12,
  R1:            13,
  R2:            14,
  TREND:         15,
  AI_MEMO:       16
};

var HEADERS = [
  "📅 DATE",
  "⏱ TIME (CST)",
  "💰 PRICE",
  "📊 % CHANGE",
  "⬆⬇ TICK Δ",
  "⚡ TICK %",
  "📈 TICK vs AVG",
  "📦 VOLUME TODAY",
  "🔥 VOL vs 30D",
  "〰️ VWAP",
  "🟢 S1",
  "🟢 S2",
  "🔴 R1",
  "🔴 R2",
  "🌐 TREND STATUS",
  "🤖 AI MEMO"
];

// ─────────────────────────────────────────────────────────────
// MAIN LOG FUNCTION — called every 5 minutes
// ─────────────────────────────────────────────────────────────
function logTick(data, now) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var log = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
    log.setTabColor("#00bcd4");
  }

  if (log.getLastRow() === 0) {
    log.appendRow(HEADERS);
    var hr = log.getRange(1, 1, 1, HEADERS.length);
    hr.setBackground("#0d0d2b").setFontColor("#00e5ff").setFontWeight("bold").setFontSize(10);
    log.setFrozenRows(1);
  }

  var prevPrice    = parseFloat(getFlag("PREV_PRICE"))       || 0;
  var prevClose    = parseFloat(getFlag("PREV_CLOSE_PRICE")) || data.prevClose;
  var dayOpenPrice = parseFloat(getFlag("DAY_OPEN_PRICE"))   || 0;

  if (dayOpenPrice === 0) {
    dayOpenPrice = data.price;
    setFlag("DAY_OPEN_PRICE", dayOpenPrice);
  }
  if (!prevClose || prevClose === 0) {
    prevClose = data.prevClose;
    setFlag("PREV_CLOSE_PRICE", prevClose);
  }

  var pctChange = (prevClose && prevClose !== 0)
    ? ((data.price - prevClose) / prevClose) * 100 : 0;

  var tickChange = (prevPrice && prevPrice !== 0)
    ? data.price - prevPrice : 0;

  var tickPct = (prevPrice && prevPrice !== 0)
    ? ((data.price - prevPrice) / prevPrice) * 100 : 0;

  var avgTick   = updateRollingAvgTick(Math.abs(tickChange));
  var tickVsAvg = "—";
  if (avgTick > 0 && prevPrice !== 0) {
    var ratio = Math.abs(tickChange) / avgTick;
    if (ratio >= 2.0)       tickVsAvg = "🚀 HUGE ("   + ratio.toFixed(1) + "x)";
    else if (ratio >= 1.5)  tickVsAvg = "⚡ LARGE ("  + ratio.toFixed(1) + "x)";
    else if (ratio >= 0.75) tickVsAvg = "📊 NORMAL (" + ratio.toFixed(1) + "x)";
    else                    tickVsAvg = "😴 QUIET ("   + ratio.toFixed(1) + "x)";
  }

  var dayFraction   = getSessionFractionElapsed(now);
  var expectedSoFar = (data.avgVol30 > 0 && dayFraction > 0)
    ? data.avgVol30 * dayFraction : 0;
  var volPct    = (expectedSoFar > 0) ? (data.volumeToday / expectedSoFar) * 100 : 0;
  var volPctStr = (volPct > 0) ? volPct.toFixed(1) + "%" : "—";

  var vwap        = data.vwap || 0;
  var vwapDisplay = (vwap > 0) ? vwap : "—";
  var vwapDiffPct = (vwap > 0) ? ((data.price - vwap) / vwap) * 100 : null;

  var srZones = getTopSRZones(data, prevClose, dayOpenPrice) || { supports: [null, null], resistances: [null, null] };

  function formatZone(zone) {
    if (!zone) return "—";
    return zone.label + "  $" + zone.price.toFixed(2) + "  (" + zone.distPct.toFixed(2) + "%)";
  }

  var s1Str = formatZone(srZones.supports[0]);
  var s2Str = formatZone(srZones.supports[1]);
  var r1Str = formatZone(srZones.resistances[0]);
  var r2Str = formatZone(srZones.resistances[1]);

  // ── Cache S/R flags for AI prompts ────────────────────────
  // Bear Trap memos, Dashboard brief, and Forecast all read
  // SESSION_LAST_S1/R1 to give the AI support/resistance context.
  setFlag("SESSION_LAST_S1", s1Str);
  setFlag("SESSION_LAST_S2", s2Str);
  setFlag("SESSION_LAST_R1", r1Str);
  setFlag("SESSION_LAST_R2", r2Str);

  var trendStr = analyzeTrend(data, prevClose, dayOpenPrice);

  // Utilities.formatDate on raw UTC now — always correct for CST display
  var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();
  var dateStr = Utilities.formatDate(now, "America/Chicago", "M-dd-yyyy");

  var row = [
    dateStr,
    timeStr,
    data.price,
    pctChange,
    tickChange !== 0 ? tickChange : "—",
    tickPct    !== 0 ? tickPct    : "—",
    tickVsAvg,
    data.volumeToday,
    volPctStr,
    vwapDisplay,
    s1Str,
    s2Str,
    r1Str,
    r2Str,
    trendStr,
    ""
  ];

  log.appendRow(row);
  var newRow = log.getLastRow();
  Logger.log("Row written at row " + newRow);

  applyRowFormatting(
    log, newRow,
    data.price, pctChange, tickPct,
    data.volumeToday, volPct, data.avgVol30,
    vwap, vwapDiffPct,
    srZones
  );

  if (Math.abs(pctChange) >= LARGE_MOVE_THRESHOLD && prevPrice !== 0) {
    Logger.log("Large move detected (" + pctChange.toFixed(2) + "%) — requesting AI memo.");
    var memo = getAIMemo(data, pctChange, tickChange, trendStr, now);
    if (memo) {
      log.getRange(newRow, COL.AI_MEMO).setValue(memo);
      log.getRange(newRow, COL.AI_MEMO).setFontSize(8).setWrap(true);
    }
  }

  setFlag("PREV_PRICE", data.price);
}

// ─────────────────────────────────────────────────────────────
// SESSION FRACTION ELAPSED — FIXED
//
// OLD (broken): called .getHours()/.getMinutes() on the now param,
//   which is a raw UTC Date — returns UTC hours, not ET hours.
// NEW: extracts ET hours and minutes via Utilities.formatDate
//   using "America/New_York" — reliable in Apps Script.
// ─────────────────────────────────────────────────────────────
function getSessionFractionElapsed(utcDate) {
  var etH       = parseInt(Utilities.formatDate(utcDate, "America/New_York", "H"),  10);
  var etM       = parseInt(Utilities.formatDate(utcDate, "America/New_York", "mm"), 10);
  var nowMins   = etH * 60 + etM;
  var openMins  = MARKET_OPEN_HOUR  * 60 + MARKET_OPEN_MIN;
  var closeMins = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MIN;
  var sessionLen = closeMins - openMins;

  var elapsed = nowMins - openMins;
  if (elapsed <= 0) return 0.02;
  if (elapsed >= sessionLen) return 1;
  return Math.max(0.02, elapsed / sessionLen);
}

// ─────────────────────────────────────────────────────────────
// ROLLING AVERAGE TICK SIZE (EMA, alpha=0.15)
// ─────────────────────────────────────────────────────────────
function updateRollingAvgTick(absTickChange) {
  var stored = parseFloat(getFlag("AVG_TICK_SIZE")) || 0;
  var count  = parseInt(getFlag("TICK_COUNT"))      || 0;

  if (absTickChange === 0) return stored;

  count++;
  var alpha  = 0.15;
  var newAvg = (count === 1) ? absTickChange : stored * (1 - alpha) + absTickChange * alpha;

  setFlag("AVG_TICK_SIZE", newAvg);
  setFlag("TICK_COUNT",    count);
  return newAvg;
}
