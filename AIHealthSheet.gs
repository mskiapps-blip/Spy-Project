// ============================================================
// FILE: AIHealthSheet.gs
// PURPOSE: 🤖 AI HEALTH — Live monitoring sheet for all Gemini
//          usage. Renders on every 5-min tick via runAIHealthTick().
//
//  LAYOUT:
//    Row  1:    Banner
//    Row  2:    Subtitle / refresh time
//    Row  3:    Gap
//    Rows 4–11: CARD ROW 1 — Quota Power Meter | Per-Feature Bars
//    Row 12:    Gap
//    Rows 13–20: CARD ROW 2 — Last Success Table | Thresholds
//    Row 21:    Gap
//    Row 22:    Log section header  ← frozen rows 1–22
//    Row 23:    Log column headers
//    Row 24+:   Log entries (newest first, max 200 rows)
//
//  DAILY RESET:
//    Top cards reset automatically each CST day via
//    aiResetCounterIfNewDay() (already in AIHealth.gs).
//    Log rows persist across days and roll off after 200.
//
//  WIRING (add to Code.gs):
//    In runEvery5Minutes()  → add: runAIHealthTick(now);
//    In runManualTick()     → add: runAIHealthTick(now);
//    In ensureSheetsExist() → add the SHEET_AI_HEALTH block below.
//    In onOpen() menu       → add the Setup + Refresh items below.
// ============================================================

var SHEET_AI_HEALTH = "🤖 AI HEALTH";

// ─────────────────────────────────────────────────────────────
// PALETTE — matches dashboard dark theme
// ─────────────────────────────────────────────────────────────
var AH = {
  BG_SHEET:    "#0d0d2b",
  BG_BANNER:   "#070712",
  BG_CARD:     "#0f0f24",
  BG_DIVIDER:  "#1a1a3e",
  BG_LOG_ALT:  "#0a0a1a",
  BG_LOG_EVEN: "#0d0d22",

  TXT_BANNER:  "#00e5ff",
  TXT_SUB:     "#3d3d6b",
  TXT_HDR:     "#5555aa",
  TXT_PRIMARY: "#e8eaf6",
  TXT_DIM:     "#3d3d6b",
  TXT_CYAN:    "#00e5ff",
  TXT_GREEN:   "#00e676",
  TXT_RED:     "#ff5252",
  TXT_YELLOW:  "#ffd740",
  TXT_PURPLE:  "#e040fb",
  TXT_ORANGE:  "#ff9100",

  // Per-feature accent colors
  FEAT_MORNING_BRIEF: "#00e5ff",
  FEAT_BEAR_TRAP:     "#e040fb",
  FEAT_BEAR_TRAP_EOD: "#ff9100",
  FEAT_LARGE_MOVE:    "#00e676",
  FEAT_DASHBOARD:     "#00bcd4",
  FEAT_FORECAST:      "#ffd740"
};

// ─────────────────────────────────────────────────────────────
// COLUMN MAP
// ─────────────────────────────────────────────────────────────
var AHC = {
  LEFT:   1,   // card left column
  MID:    2,   // gap/separator
  RIGHT:  3,   // card right column
  EDGE:   4,   // right edge gap

  // Log columns
  LOG_TIME:     1,
  LOG_FEATURE:  2,
  LOG_STATUS:   3,
  LOG_CALLS:    4,
  LOG_FAILS:    5,
  LOG_DETAIL:   6
};

// ─────────────────────────────────────────────────────────────
// ROW MAP
// ─────────────────────────────────────────────────────────────
var AHR = {
  BANNER:   1,
  SUBTITLE: 2,
  GAP1:     3,

  // Card row 1 — quota meter + feature bars
  C1_HDR_L: 4,
  C1_BIG:   5,
  C1_LABEL: 6,
  C1_BAR:   7,
  C1_MARKS: 8,
  C1_DIV:   9,
  C1_STATS: 10,
  C1_PAD:   11,

  GAP2:     12,

  // Card row 2 — last success table + thresholds
  C2_HDR:   13,
  C2_ROW1:  14,
  C2_ROW2:  15,
  C2_ROW3:  16,
  C2_ROW4:  17,
  C2_ROW5:  18,
  C2_ROW6:  19,
  C2_PAD:   20,

  GAP3:     21,

  // Log section
  LOG_HDR:  22,
  LOG_COLS: 23,
  LOG_DATA: 24    // first data row
};

var AH_LOG_MAX     = 200;  // max log entries kept
var AH_LOG_COL_COUNT = 6;

// ─────────────────────────────────────────────────────────────
// FEATURE COLOR MAP
// ─────────────────────────────────────────────────────────────
function ahFeatureColor(feature) {
  var map = {
    "MORNING_BRIEF": AH.FEAT_MORNING_BRIEF,
    "BEAR_TRAP":     AH.FEAT_BEAR_TRAP,
    "BEAR_TRAP_EOD": AH.FEAT_BEAR_TRAP_EOD,
    "LARGE_MOVE":    AH.FEAT_LARGE_MOVE,
    "DASHBOARD":     AH.FEAT_DASHBOARD,
    "FORECAST":      AH.FEAT_FORECAST
  };
  return map[feature] || AH.TXT_PRIMARY;
}

// ─────────────────────────────────────────────────────────────
// SETUP — creates and styles the sheet skeleton
// Safe to re-run; skips if sheet already exists with content.
// ─────────────────────────────────────────────────────────────
function setupAIHealthSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_AI_HEALTH);
  if (!sheet) sheet = ss.insertSheet(SHEET_AI_HEALTH);
  sheet.setTabColor("#ab47bc");

  // Ensure enough columns + rows
  var neededCols = 6;
  var neededRows = AHR.LOG_DATA + AH_LOG_MAX + 10;
  if (sheet.getMaxColumns() < neededCols)
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  if (sheet.getMaxRows() < neededRows)
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());

  // Fill entire sheet background
  sheet.getRange(1, 1, neededRows, neededCols).setBackground(AH.BG_SHEET);

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.getRange(AHR.BANNER, 1, 1, neededCols).merge()
    .setValue("🤖  A I   H E A L T H   M O N I T O R  ·  G E M I N I   F R E E   T I E R")
    .setBackground(AH.BG_BANNER)
    .setFontColor(AH.TXT_BANNER)
    .setFontWeight("bold")
    .setFontSize(13)
    .setFontFamily("Trebuchet MS")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(AHR.BANNER, 36);

  // ── Row 2: Subtitle ────────────────────────────────────────
  sheet.getRange(AHR.SUBTITLE, 1, 1, neededCols).merge()
    .setValue("refreshing every 5 min  ·  daily stats reset at midnight CST  ·  log keeps last 200 entries")
    .setBackground(AH.BG_BANNER)
    .setFontColor(AH.TXT_SUB)
    .setFontSize(8)
    .setHorizontalAlignment("center");
  sheet.setRowHeight(AHR.SUBTITLE, 18);

  // ── Gap rows ───────────────────────────────────────────────
  sheet.getRange(AHR.GAP1, 1, 1, neededCols).setBackground(AH.BG_DIVIDER);
  sheet.setRowHeight(AHR.GAP1, 3);
  sheet.getRange(AHR.GAP2, 1, 1, neededCols).setBackground(AH.BG_DIVIDER);
  sheet.setRowHeight(AHR.GAP2, 3);
  sheet.getRange(AHR.GAP3, 1, 1, neededCols).setBackground(AH.BG_DIVIDER);
  sheet.setRowHeight(AHR.GAP3, 3);

  // ── Column widths ──────────────────────────────────────────
  sheet.setColumnWidth(1, 260);  // left card / log time+feature
  sheet.setColumnWidth(2, 8);    // gap
  sheet.setColumnWidth(3, 260);  // right card / log status
  sheet.setColumnWidth(4, 90);   // log calls
  sheet.setColumnWidth(5, 70);   // log fails
  sheet.setColumnWidth(6, 220);  // log detail

  // ── Log section header ────────────────────────────────────
  sheet.getRange(AHR.LOG_HDR, 1, 1, neededCols).merge()
    .setValue("  📋  SNAPSHOT LOG  ·  newest first  ·  last 200 entries")
    .setBackground("#0a0a18")
    .setFontColor("#5555aa")
    .setFontSize(9)
    .setFontWeight("bold")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(AHR.LOG_HDR, 26);

  // ── Log column headers ────────────────────────────────────
  var logHeaders = ["⏱ TIME (CST)", "📡 FEATURE", "STATUS", "CALLS", "FAILS", "DETAIL"];
  sheet.getRange(AHR.LOG_COLS, 1, 1, AH_LOG_COL_COUNT)
    .setValues([logHeaders])
    .setBackground("#0a0a18")
    .setFontColor(AH.TXT_HDR)
    .setFontSize(8)
    .setFontWeight("bold")
    .setHorizontalAlignment("center");
  sheet.setRowHeight(AHR.LOG_COLS, 20);

  // ── Freeze header rows ────────────────────────────────────
  sheet.setFrozenRows(AHR.LOG_COLS);

  Logger.log("AIHealthSheet: setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// MAIN TICK — called from runEvery5Minutes() in Code.gs
// now = raw UTC Date
// ─────────────────────────────────────────────────────────────
function runAIHealthTick(now) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_AI_HEALTH);
    if (!sheet) {
      setupAIHealthSheet(ss);
      sheet = ss.getSheetByName(SHEET_AI_HEALTH);
    }

    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();
    var dateStr = Utilities.formatDate(now, "America/Chicago", "EEE MMM d, yyyy");

    // Update subtitle with refresh time + health badge
    var h = getAIHealthStatus();
    sheet.getRange(AHR.SUBTITLE, 1, 1, 6).merge()
      .setValue(h.label + "   ·   refreshed  " + timeStr + " cst  ·  " + dateStr +
                "   ·   log keeps last 200 entries")
      .setBackground(AH.BG_BANNER)
      .setFontColor(
        h.status === "DOWN"     ? AH.TXT_RED :
        h.status === "DEGRADED" ? AH.TXT_YELLOW :
                                  AH.TXT_GREEN
      )
      .setFontSize(9)
      .setHorizontalAlignment("center");

    writeAHQuotaCard(sheet);
    writeAHFeatureBars(sheet);
    writeAHStatusTable(sheet);
    writeAHThresholds(sheet);

    Logger.log("AIHealthSheet: tick complete at " + timeStr);
  } catch (e) {
    Logger.log("runAIHealthTick ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CARD LEFT — Quota Power Meter
// ─────────────────────────────────────────────────────────────
function writeAHQuotaCard(sheet) {
  try {
    var callsToday = parseInt(getFlag("AI_CALLS_TODAY")    || "0");
    var failsToday = parseInt(getFlag("AI_FAILURES_TODAY") || "0");
    var skipped    = parseInt(getFlag("AI_SKIPPED_TODAY")  || "0");
    var hardCap    = AI_QUOTA.DAILY_HARD_CAP;
    var softCap    = AI_QUOTA.DAILY_SOFT_CAP;
    var remaining  = Math.max(0, hardCap - callsToday);
    var pct        = Math.min(1, callsToday / hardCap);

    // Bar color based on usage level
    var barColor = pct < 0.5 ? AH.TXT_GREEN :
                   pct < 0.83 ? AH.TXT_YELLOW : AH.TXT_RED;

    // ── Card header ───────────────────────────────────────────
    sheet.getRange(AHR.C1_HDR_L, AHC.LEFT).setValue("  ⚡  DAILY QUOTA POWER")
      .setBackground("#0a0918")
      .setFontColor(AH.TXT_YELLOW)
      .setFontSize(9)
      .setFontWeight("bold")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
    sheet.setRowHeight(AHR.C1_HDR_L, 26);

    // ── Big number ─────────────────────────────────────────────
    sheet.getRange(AHR.C1_BIG, AHC.LEFT).setValue(callsToday)
      .setBackground(AH.BG_CARD)
      .setFontColor(AH.TXT_CYAN)
      .setFontSize(32)
      .setFontWeight("bold")
      .setFontFamily("Roboto Mono")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
    sheet.setRowHeight(AHR.C1_BIG, 46);

    // ── Sub-label ──────────────────────────────────────────────
    sheet.getRange(AHR.C1_LABEL, AHC.LEFT)
      .setValue("calls today  ·  " + Math.round(pct * 100) + "% of daily hard cap (" + hardCap + ")")
      .setBackground(AH.BG_CARD)
      .setFontColor(AH.TXT_HDR)
      .setFontSize(8)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
    sheet.setRowHeight(AHR.C1_LABEL, 18);

    // ── Progress bar — built with cell background fill ─────────
    // We simulate a bar by writing a padded string and coloring the cell
    var filledCells = Math.round(pct * 26);  // 26 char-width approximation in label
    var barStr = "█".repeat(Math.max(1, filledCells)) +
                 "░".repeat(Math.max(0, 26 - filledCells));
    sheet.getRange(AHR.C1_BAR, AHC.LEFT)
      .setValue(barStr + "  " + callsToday + " / " + hardCap)
      .setBackground(AH.BG_CARD)
      .setFontColor(barColor)
      .setFontSize(9)
      .setFontFamily("Roboto Mono")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
    sheet.setRowHeight(AHR.C1_BAR, 20);

    // ── Cap markers ────────────────────────────────────────────
    sheet.getRange(AHR.C1_MARKS, AHC.LEFT)
      .setValue("0  ·  soft cap: " + softCap + "  ·  hard cap: " + hardCap)
      .setBackground(AH.BG_CARD)
      .setFontColor(AH.TXT_DIM)
      .setFontSize(8)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
    sheet.setRowHeight(AHR.C1_MARKS, 16);

    // ── Divider ────────────────────────────────────────────────
    sheet.getRange(AHR.C1_DIV, AHC.LEFT).setValue("")
      .setBackground(AH.BG_DIVIDER);
    sheet.setRowHeight(AHR.C1_DIV, 2);

    // ── Stats row ──────────────────────────────────────────────
    var statsStr = "✅ " + (callsToday - failsToday) + " ok   " +
                   "❌ " + failsToday + " failed   " +
                   "⏭ " + skipped + " skipped   " +
                   "💾 " + remaining + " remaining";
    sheet.getRange(AHR.C1_STATS, AHC.LEFT).setValue(statsStr)
      .setBackground(AH.BG_CARD)
      .setFontColor(AH.TXT_PRIMARY)
      .setFontSize(8)
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
    sheet.setRowHeight(AHR.C1_STATS, 20);

    // ── Padding ────────────────────────────────────────────────
    sheet.getRange(AHR.C1_PAD, AHC.LEFT).setValue("")
      .setBackground(AH.BG_CARD);
    sheet.setRowHeight(AHR.C1_PAD, 8);

    // Mid gap column
    for (var r = AHR.C1_HDR_L; r <= AHR.C1_PAD; r++) {
      sheet.getRange(r, AHC.MID).setBackground(AH.BG_SHEET);
    }

  } catch (e) {
    Logger.log("writeAHQuotaCard ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CARD RIGHT — Per-Feature Power Bars
// ─────────────────────────────────────────────────────────────
function writeAHFeatureBars(sheet) {
  try {
    var hardCap  = AI_QUOTA.DAILY_HARD_CAP;
    var features = Object.keys(AI_FEATURE);

    // Header
    sheet.getRange(AHR.C1_HDR_L, AHC.RIGHT).setValue("  📡  CALLS BY FEATURE")
      .setBackground("#0a0a18")
      .setFontColor(AH.TXT_CYAN)
      .setFontSize(9)
      .setFontWeight("bold")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");

    // Each feature gets one row from C1_BIG onward
    var rows = [
      AHR.C1_BIG, AHR.C1_LABEL, AHR.C1_BAR,
      AHR.C1_MARKS, AHR.C1_DIV, AHR.C1_STATS
    ];

    for (var i = 0; i < features.length && i < rows.length; i++) {
      var feat   = AI_FEATURE[features[i]];
      var calls  = parseInt(getFlag("AI_CALLS_" + feat) || "0");
      var pct    = Math.min(1, calls / Math.max(1, hardCap));
      var filled = Math.round(pct * 20);
      var bar    = "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, 20 - filled));
      var color  = ahFeatureColor(feat);

      var cellVal = feat + "   " + bar + "  " + calls;
      sheet.getRange(rows[i], AHC.RIGHT).setValue(cellVal)
        .setBackground(AH.BG_CARD)
        .setFontColor(color)
        .setFontSize(8)
        .setFontFamily("Roboto Mono")
        .setHorizontalAlignment("left")
        .setVerticalAlignment("middle");
    }

    // Padding
    sheet.getRange(AHR.C1_PAD, AHC.RIGHT).setValue("")
      .setBackground(AH.BG_CARD);

  } catch (e) {
    Logger.log("writeAHFeatureBars ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CARD ROW 2 LEFT — Last Success / Failure per Feature
// ─────────────────────────────────────────────────────────────
function writeAHStatusTable(sheet) {
  try {
    var features = Object.keys(AI_FEATURE);
    var rows2 = [
      AHR.C2_ROW1, AHR.C2_ROW2, AHR.C2_ROW3,
      AHR.C2_ROW4, AHR.C2_ROW5, AHR.C2_ROW6
    ];

    // Header spanning both columns
    sheet.getRange(AHR.C2_HDR, AHC.LEFT).setValue("  ✅  LAST SUCCESS PER FEATURE")
      .setBackground("#080818")
      .setFontColor(AH.TXT_GREEN)
      .setFontSize(9)
      .setFontWeight("bold")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
    sheet.getRange(AHR.C2_HDR, AHC.RIGHT).setValue("  🔧  QUOTA CONFIG")
      .setBackground("#080818")
      .setFontColor(AH.TXT_ORANGE)
      .setFontSize(9)
      .setFontWeight("bold")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("middle");
    sheet.getRange(AHR.C2_HDR, AHC.MID).setBackground(AH.BG_SHEET);
    sheet.setRowHeight(AHR.C2_HDR, 26);

    for (var i = 0; i < features.length && i < rows2.length; i++) {
      var feat    = AI_FEATURE[features[i]];
      var calls   = parseInt(getFlag("AI_CALLS_" + feat) || "0");
      var lastOkMs = parseInt(getFlag("AI_LAST_SUCCESS_" + feat) || "0") || 0;
      var lastOkStr = aiTimeSince(lastOkMs);
      var color   = ahFeatureColor(feat);
      var rowBg   = i % 2 === 0 ? AH.BG_LOG_EVEN : AH.BG_LOG_ALT;

      var cellStr = feat + "   last ok: " + lastOkStr + "   (" + calls + " calls)";
      sheet.getRange(rows2[i], AHC.LEFT).setValue(cellStr)
        .setBackground(rowBg)
        .setFontColor(color)
        .setFontSize(8)
        .setFontFamily("Roboto Mono")
        .setHorizontalAlignment("left")
        .setVerticalAlignment("middle");
      sheet.getRange(rows2[i], AHC.MID).setBackground(AH.BG_SHEET);
      sheet.setRowHeight(rows2[i], 20);
    }

    sheet.getRange(AHR.C2_PAD, AHC.LEFT).setValue("").setBackground(AH.BG_CARD);
    sheet.getRange(AHR.C2_PAD, AHC.MID).setBackground(AH.BG_SHEET);
    sheet.setRowHeight(AHR.C2_PAD, 8);

  } catch (e) {
    Logger.log("writeAHStatusTable ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CARD ROW 2 RIGHT — Quota Thresholds & Health Rules
// ─────────────────────────────────────────────────────────────
function writeAHThresholds(sheet) {
  try {
    var rows2 = [
      AHR.C2_ROW1, AHR.C2_ROW2, AHR.C2_ROW3,
      AHR.C2_ROW4, AHR.C2_ROW5, AHR.C2_ROW6
    ];

    var lines = [
      "soft cap (non-critical):  " + AI_QUOTA.DAILY_SOFT_CAP + " calls",
      "hard cap (all features):  " + AI_QUOTA.DAILY_HARD_CAP + " calls",
      "non-critical: LARGE_MOVE, DASHBOARD",
      "🟡 DEGRADED if 2+ fails in 30 min",
      "🔴 DOWN if 3+ fails in 30 min",
      "🔴 DOWN if no success in 2 hrs"
    ];

    var colors = [
      AH.TXT_YELLOW, AH.TXT_RED, AH.TXT_PRIMARY,
      AH.TXT_YELLOW, AH.TXT_RED, AH.TXT_RED
    ];

    for (var i = 0; i < lines.length && i < rows2.length; i++) {
      var rowBg = i % 2 === 0 ? AH.BG_LOG_EVEN : AH.BG_LOG_ALT;
      sheet.getRange(rows2[i], AHC.RIGHT).setValue(lines[i])
        .setBackground(rowBg)
        .setFontColor(colors[i])
        .setFontSize(8)
        .setFontFamily("Roboto Mono")
        .setHorizontalAlignment("left")
        .setVerticalAlignment("middle");
    }

    sheet.getRange(AHR.C2_PAD, AHC.RIGHT).setValue("").setBackground(AH.BG_CARD);

  } catch (e) {
    Logger.log("writeAHThresholds ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// APPEND LOG ENTRY
//
// Called from recordAICall() after every Gemini call — adds one
// row to the top of the log section, deletes oldest if > 200.
//
// status:  "OK" | "FAIL" | "SKIP"
// detail:  short string e.g. "phase: FLUSHING" or "HTTP 429"
// ─────────────────────────────────────────────────────────────
function appendAIHealthLog(feature, status, detail) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_AI_HEALTH);
    if (!sheet) return;  // sheet not set up yet — skip silently

    var now        = new Date();
    var timeStr    = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();
    var callsToday = getFlag("AI_CALLS_TODAY")    || "0";
    var failsToday = getFlag("AI_FAILURES_TODAY") || "0";

    var statusStr = status === "OK"   ? "✅ OK"   :
                    status === "FAIL" ? "❌ FAIL" : "⏭ SKIP";

    var newRow = [timeStr, feature, statusStr, callsToday, failsToday, detail || ""];

    // Insert row at top of log data (row AHR.LOG_DATA)
    sheet.insertRowBefore(AHR.LOG_DATA);
    sheet.getRange(AHR.LOG_DATA, 1, 1, AH_LOG_COL_COUNT).setValues([newRow]);

    // Style the new row
    var rowBg = AH.BG_LOG_EVEN;
    sheet.getRange(AHR.LOG_DATA, AHC.LOG_TIME).setBackground(rowBg)
      .setFontColor(AH.TXT_DIM).setFontSize(9).setFontFamily("Roboto Mono")
      .setHorizontalAlignment("center");
    sheet.getRange(AHR.LOG_DATA, AHC.LOG_FEATURE).setBackground(rowBg)
      .setFontColor(ahFeatureColor(feature)).setFontSize(9).setFontFamily("Roboto Mono")
      .setHorizontalAlignment("center");
    sheet.getRange(AHR.LOG_DATA, AHC.LOG_STATUS).setBackground(rowBg)
      .setFontColor(
        status === "OK"   ? AH.TXT_GREEN  :
        status === "FAIL" ? AH.TXT_RED    : AH.TXT_YELLOW
      )
      .setFontSize(9).setHorizontalAlignment("center");
    sheet.getRange(AHR.LOG_DATA, AHC.LOG_CALLS).setBackground(rowBg)
      .setFontColor(AH.TXT_PRIMARY).setFontSize(9).setHorizontalAlignment("center");
    sheet.getRange(AHR.LOG_DATA, AHC.LOG_FAILS).setBackground(rowBg)
      .setFontColor(failsToday > 0 ? AH.TXT_RED : AH.TXT_PRIMARY)
      .setFontSize(9).setHorizontalAlignment("center");
    sheet.getRange(AHR.LOG_DATA, AHC.LOG_DETAIL).setBackground(rowBg)
      .setFontColor(AH.TXT_DIM).setFontSize(9).setFontFamily("Roboto Mono")
      .setHorizontalAlignment("left");
    sheet.setRowHeight(AHR.LOG_DATA, 20);

    // Trim to max 200 log entries
    var lastRow = sheet.getLastRow();
    var logEnd  = AHR.LOG_DATA + AH_LOG_MAX;
    if (lastRow > logEnd) {
      sheet.deleteRows(logEnd + 1, lastRow - logEnd);
    }

  } catch (e) {
    Logger.log("appendAIHealthLog ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// MENU HANDLERS
// ─────────────────────────────────────────────────────────────
function setupAIHealthSheetFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupAIHealthSheet(ss);
  SpreadsheetApp.getUi().alert("✅ AI Health sheet created!\n\nRun a manual tick to populate it.");
}

function runManualAIHealthRefresh() {
  var now = getCurrentEasternTime();
  runAIHealthTick(now);
  SpreadsheetApp.getUi().alert("✅ AI Health sheet refreshed!");
}
