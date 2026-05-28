// ============================================================
// FILE: Logger.gs
// PURPOSE: Calculates all per-tick metrics and writes one row
//          to the SPY LOG sheet.
// ============================================================

// ─────────────────────────────────────────────────────────────
// COLUMN MAP — change numbers here to rearrange columns.
// Column 1 = A, 2 = B, etc.
// ─────────────────────────────────────────────────────────────
var COL = {
  DATE:          1,   // A
  TIME:          2,   // B
  PRICE:         3,   // C
  PCT_CHANGE:    4,   // D  (vs prev close)
  TICK_CHANGE:   5,   // E  (price diff from last tick)
  TICK_PCT:      6,   // F  (% change from last tick)
  TICK_VS_AVG:   7,   // G  (tick compared to rolling average)
  VOLUME:        8,   // H
  VOLUME_VS_AVG: 9,   // I  (% of 30-day avg)
  TREND:         10,  // J
  AI_MEMO:       11   // K
};

// ─────────────────────────────────────────────────────────────
// HEADER LABELS — must match column order above
// ─────────────────────────────────────────────────────────────
var HEADERS = [
  "📅 DATE",
  "⏱ TIME (ET)",
  "💰 PRICE",
  "📊 % CHANGE",
  "⬆⬇ TICK Δ",
  "⚡ TICK %",
  "📈 TICK vs AVG",
  "📦 VOLUME TODAY",
  "🔥 VOL vs 30D",
  "🌐 TREND STATUS",
  "🤖 AI MEMO"
];

// ─────────────────────────────────────────────────────────────
// MAIN LOG FUNCTION — called every 5 minutes
// ─────────────────────────────────────────────────────────────
function logTick(data, now) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Get or create the log sheet ──────────────────────────
  var log = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
    log.setTabColor("#00bcd4");
  }

  // ── Ensure sheet has at least a header row ────────────────
  // If sheet is completely empty, write a simple header row now.
  // (setupSheets writes a fancier banner+header — this is the fallback.)
  if (log.getLastRow() === 0) {
    log.appendRow(HEADERS);
    var hr = log.getRange(1, 1, 1, HEADERS.length);
    hr.setBackground("#0d0d2b").setFontColor("#00e5ff").setFontWeight("bold").setFontSize(10);
    log.setFrozenRows(1);
  }

  // ── Retrieve stored state ────────────────────────────────
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

  // ── CALCULATE METRICS ────────────────────────────────────

  // % change vs previous close
  var pctChange = (prevClose && prevClose !== 0)
    ? ((data.price - prevClose) / prevClose) * 100
    : 0;

  // Price change since last tick
  var tickChange = (prevPrice && prevPrice !== 0)
    ? data.price - prevPrice
    : 0;

  // % change since last tick
  var tickPct = (prevPrice && prevPrice !== 0)
    ? ((data.price - prevPrice) / prevPrice) * 100
    : 0;

  // Rolling average tick (EMA stored in CONFIG)
  var avgTick   = updateRollingAvgTick(Math.abs(tickChange));
  var tickVsAvg = "—";
  if (avgTick > 0 && prevPrice !== 0) {
    var ratio = Math.abs(tickChange) / avgTick;
    if (ratio >= 2.0)       tickVsAvg = "🚀 HUGE ("   + ratio.toFixed(1) + "x)";
    else if (ratio >= 1.5)  tickVsAvg = "⚡ LARGE ("  + ratio.toFixed(1) + "x)";
    else if (ratio >= 0.75) tickVsAvg = "📊 NORMAL (" + ratio.toFixed(1) + "x)";
    else                    tickVsAvg = "😴 QUIET ("   + ratio.toFixed(1) + "x)";
  }

  // Volume vs 30-day average, adjusted for time of day.
  // We compare today's CUMULATIVE volume against the fraction of a
  // full-day average that should have traded by now — so 100% means
  // "on pace for an average day," not "already hit a full day's volume."
  var dayFraction = getSessionFractionElapsed(now);
  var expectedSoFar = (data.avgVol30 > 0 && dayFraction > 0)
    ? data.avgVol30 * dayFraction
    : 0;
  var volPct    = (expectedSoFar > 0) ? (data.volumeToday / expectedSoFar) * 100 : 0;
  var volPctStr = (volPct > 0) ? volPct.toFixed(1) + "%" : "—";

  // Trend analysis
  var trendStr = analyzeTrend(data, prevClose, dayOpenPrice);

  // Format date/time — date as M-dd-yyyy, time as 12-hour CST
  var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();
  var dateStr = Utilities.formatDate(now, "America/Chicago", "M-dd-yyyy");

  // ── BUILD ROW ────────────────────────────────────────────
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
    trendStr,
    ""   // AI memo — filled below if triggered
  ];

  // ── WRITE ROW ────────────────────────────────────────────
  log.appendRow(row);
  var newRow = log.getLastRow();
  Logger.log("Row written at row " + newRow);

  // ── APPLY FORMATTING ─────────────────────────────────────
  applyRowFormatting(log, newRow, data.price, pctChange, tickPct, data.volumeToday, volPct, data.avgVol30);

  // ── AI MEMO: fire on large movements ─────────────────────
  if (Math.abs(pctChange) >= LARGE_MOVE_THRESHOLD && prevPrice !== 0) {
    Logger.log("Large move detected (" + pctChange.toFixed(2) + "%) — requesting AI memo.");
    var memo = getAIMemo(data, pctChange, tickChange, trendStr, now);
    if (memo) {
      log.getRange(newRow, COL.AI_MEMO).setValue(memo);
      log.getRange(newRow, COL.AI_MEMO).setFontSize(8).setWrap(true);
    }
  }

  // ── SAVE STATE ───────────────────────────────────────────
  setFlag("PREV_PRICE", data.price);
}

// ─────────────────────────────────────────────────────────────
// SESSION FRACTION ELAPSED
// Returns 0–1: how far through the 9:30–16:00 ET session we are.
// Used to scale the 30-day full-day average down to a fair
// "expected volume by now" benchmark for the VOLUME color.
// Clamped to a small minimum so the very first tick doesn't divide
// by ~0 and explode the percentage.
// ─────────────────────────────────────────────────────────────
function getSessionFractionElapsed(easternDate) {
  var h = easternDate.getHours();
  var m = easternDate.getMinutes();
  var nowMins   = h * 60 + m;
  var openMins  = MARKET_OPEN_HOUR  * 60 + MARKET_OPEN_MIN;   // 570
  var closeMins = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MIN;  // 960
  var sessionLen = closeMins - openMins;                      // 390 min

  var elapsed = nowMins - openMins;
  if (elapsed <= 0) return 0.02;          // pre/at open — tiny floor
  if (elapsed >= sessionLen) return 1;    // at/after close
  var frac = elapsed / sessionLen;
  return Math.max(0.02, frac);            // never below 2% of the day
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

// ─────────────────────────────────────────────────────────────
// FINALIZE DAY SUMMARY — called at market close
// ─────────────────────────────────────────────────────────────
function finalizeDaySummary() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(SHEET_LOG);
  if (!log || log.getLastRow() < 2) return;

  log.appendRow(["── DAY CLOSE ──", "", "", "", "", "", "", "", "", "Session ended.", ""]);
  var lastRow = log.getLastRow();
  log.getRange(lastRow, 1, 1, HEADERS.length)
     .setBackground("#1a1a3e")
     .setFontColor("#9c9ccc")
     .setFontStyle("italic")
     .setFontSize(9);

  setFlag("DAY_OPEN_PRICE", "");
  setFlag("PREV_PRICE",     "");   // FIX #4: clear so first tick tomorrow
                                   // shows a dash instead of computing a
                                   // tick-delta against yesterday's close.
  setFlag("AVG_TICK_SIZE",  "");
  setFlag("TICK_COUNT",     "");
  setFlag("PRICE_HISTORY",  "");
  Logger.log("Day summary row written.");
}
