// ============================================================
// FILE: Logger.gs
// PURPOSE: Calculates all per-tick metrics and writes one row
//          to the SPY LOG sheet. Also triggers AI memo for
//          large movements and applies all cell formatting.
// ============================================================

// ─────────────────────────────────────────────────────────────
// COLUMN MAP — change numbers here to rearrange columns.
// Column 1 = A, 2 = B, etc.
// ─────────────────────────────────────────────────────────────
var COL = {
  DATE:              1,   // A
  TIME:              2,   // B
  PRICE:             3,   // C
  PCT_CHANGE:        4,   // D  (vs prev close)
  TICK_CHANGE:       5,   // E  (price diff from last tick)
  TICK_PCT:          6,   // F  (% change from last tick)
  TICK_VS_AVG:       7,   // G  (tick compared to average tick)
  VOLUME:            8,   // H
  VOLUME_VS_AVG:     9,   // I  (% of 30-day avg)
  TREND:             10,  // J
  AI_MEMO:           11   // K
};

// ─────────────────────────────────────────────────────────────
// HEADER LABELS — matching column order above
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
// MAIN LOG FUNCTION — called every 5 minutes from Code.gs
// ─────────────────────────────────────────────────────────────
function logTick(data, now) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = setupLogSheet();
  }

  // ── Ensure headers exist ──────────────────────────────────
  if (log.getLastRow() === 0) {
    writeHeaders(log);
  }

  // ── Retrieve stored state from CONFIG ────────────────────
  var prevPrice    = parseFloat(getFlag("PREV_PRICE"))    || 0;
  var prevClose    = parseFloat(getFlag("PREV_CLOSE_PRICE")) || data.prevClose;
  var dayOpenPrice = parseFloat(getFlag("DAY_OPEN_PRICE")) || 0;

  // First tick of the day
  if (dayOpenPrice === 0) {
    dayOpenPrice = data.price;
    setFlag("DAY_OPEN_PRICE", dayOpenPrice);
  }
  if (prevClose === 0) {
    prevClose = data.prevClose;
    setFlag("PREV_CLOSE_PRICE", prevClose);
  }

  // ── CALCULATE METRICS ────────────────────────────────────

  // % change vs previous close
  var pctChange = prevClose !== 0
    ? ((data.price - prevClose) / prevClose) * 100
    : 0;

  // Price change since last tick
  var tickChange = prevPrice !== 0
    ? data.price - prevPrice
    : 0;

  // % change since last tick
  var tickPct = prevPrice !== 0
    ? ((data.price - prevPrice) / prevPrice) * 100
    : 0;

  // Rolling average tick magnitude (stored in CONFIG)
  var avgTick = updateRollingAvgTick(Math.abs(tickChange));
  var tickVsAvg = "—";
  if (avgTick > 0 && prevPrice !== 0) {
    var ratio = Math.abs(tickChange) / avgTick;
    if (ratio >= 2.0)       tickVsAvg = "🚀 HUGE (" + ratio.toFixed(1) + "x avg)";
    else if (ratio >= 1.5)  tickVsAvg = "⚡ LARGE (" + ratio.toFixed(1) + "x avg)";
    else if (ratio >= 0.75) tickVsAvg = "📊 NORMAL (" + ratio.toFixed(1) + "x avg)";
    else                    tickVsAvg = "😴 QUIET (" + ratio.toFixed(1) + "x avg)";
  }

  // Volume vs 30-day average (as percentage)
  var volPct = data.avgVol30 > 0
    ? (data.volumeToday / data.avgVol30) * 100
    : 0;
  var volPctStr = volPct > 0 ? volPct.toFixed(1) + "%" : "—";

  // Trend analysis
  var trendStr = analyzeTrend(data, prevClose, dayOpenPrice);

  // Format time
  var timeStr = Utilities.formatDate(now, "America/New_York", "HH:mm");
  var dateStr = Utilities.formatDate(now, "America/New_York", "yyyy-MM-dd");

  // ── BUILD THE ROW ────────────────────────────────────────
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
    ""   // AI memo — filled in below if needed
  ];

  // ── WRITE ROW ────────────────────────────────────────────
  var newRow = log.getLastRow() + 1;
  log.appendRow(row);

  // ── APPLY FORMATTING ─────────────────────────────────────
  applyRowFormatting(log, newRow, data.price, pctChange, tickPct, data.volumeToday, volPct, data.avgVol30);

  // ── AI MEMO: fire on large tick movements ─────────────────
  if (Math.abs(pctChange) >= LARGE_MOVE_THRESHOLD && prevPrice !== 0) {
    var memo = getAIMemo(data, pctChange, tickChange, trendStr, now);
    if (memo) {
      log.getRange(newRow, COL.AI_MEMO).setValue(memo);
      // Slightly smaller font for memo readability
      log.getRange(newRow, COL.AI_MEMO).setFontSize(8);
    }
  }

  // ── SAVE STATE ───────────────────────────────────────────
  setFlag("PREV_PRICE", data.price);
}

// ─────────────────────────────────────────────────────────────
// ROLLING AVERAGE TICK — keeps a running average of tick sizes
// stored in CONFIG. Returns updated average.
// ─────────────────────────────────────────────────────────────
function updateRollingAvgTick(absTickChange) {
  var stored = parseFloat(getFlag("AVG_TICK_SIZE")) || 0;
  var count  = parseInt(getFlag("TICK_COUNT"))      || 0;

  if (absTickChange === 0) return stored; // Don't update on first tick

  count++;
  // Exponential moving average with alpha = 0.15 for smooth adaptation
  var alpha  = 0.15;
  var newAvg = count === 1
    ? absTickChange
    : stored * (1 - alpha) + absTickChange * alpha;

  setFlag("AVG_TICK_SIZE", newAvg);
  setFlag("TICK_COUNT",    count);
  return newAvg;
}

// ─────────────────────────────────────────────────────────────
// WRITE HEADERS — called once when sheet is empty
// ─────────────────────────────────────────────────────────────
function writeHeaders(sheet) {
  sheet.appendRow(HEADERS);
  var headerRow = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRow
    .setBackground("#0d0d2b")
    .setFontColor("#00e5ff")
    .setFontWeight("bold")
    .setFontSize(11)
    .setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
}

// ─────────────────────────────────────────────────────────────
// FINALIZE DAY SUMMARY — called at market close
// Adds a summary row with daily stats
// ─────────────────────────────────────────────────────────────
function finalizeDaySummary() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(SHEET_LOG);
  if (!log || log.getLastRow() <= 1) return;

  var lastRow = log.getLastRow();
  var summaryRow = ["── DAY CLOSE ──", "", "", "", "", "", "", "", "", "Session ended.", ""];
  log.appendRow(summaryRow);

  // Style the summary divider
  var range = log.getRange(lastRow + 1, 1, 1, HEADERS.length);
  range.setBackground("#1a1a3e")
       .setFontColor("#9c9ccc")
       .setFontStyle("italic")
       .setFontSize(9);

  // Reset daily flags
  setFlag("DAY_OPEN_PRICE", "");
  setFlag("AVG_TICK_SIZE",  "");
  setFlag("TICK_COUNT",     "");
  Logger.log("Day summary written.");
}
