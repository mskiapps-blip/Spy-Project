// ============================================================
// FILE: ForecastAccuracyLog.gs
// PURPOSE: 📈 FC ACCURACY LOG — Logs per-slot forecast accuracy
//          for the 📡 FORECAST sheet. One row per trading day.
//
//  FEATURES:
//    • 14 per-slot DIFF values (Actual − Predicted)
//    • AM avg diff  (8:30 AM – 11:00 AM CST, slots 1–5)
//    • PM avg diff  (11:30 AM – 3:00 PM CST, slots 6–14)
//    • Day avg diff (all completed slots)
//    • Abs avg diff (direction-agnostic accuracy measure)
//    • Daily grade  🎯 SHARP / ✅ GOOD / ⚠️ FAIR / ❌ POOR
//    • VIX at time of first forecast (for regime correlation)
//    • Bias direction flag: OVER / UNDER / NEUTRAL
//
//  TRIGGERED BY:
//    logForecastAccuracy(sheet, now) — called from
//    fillActualPrices() in ForecastSheet.gs when the 3:00 PM
//    slot fills for the first time. Locks in at EOD.
//    Also called dynamically throughout the day to update the
//    current-day row (partial actuals) — final lock at 3:00 PM.
//
//  DIFF HISTORY FLAGS (read by ForecastSheet.gs prompt builder):
//    FC_DIFF_AVG_D1  — yesterday's day avg diff
//    FC_DIFF_AM_D1   — yesterday's AM avg diff
//    FC_DIFF_PM_D1   — yesterday's PM avg diff
//    FC_DIFF_AVG_D2  — 2 days ago
//    FC_DIFF_AM_D2   — 2 days ago AM
//    FC_DIFF_PM_D2   — 2 days ago PM
//    FC_DIFF_AVG_D3  — 3 days ago
//    FC_DIFF_AM_D3   — 3 days ago AM
//    FC_DIFF_PM_D3   — 3 days ago PM
//
//  All times in CST 12-hour format.
// ============================================================

var SHEET_FC_ACCURACY = "📈 FC ACCURACY LOG";

// ─────────────────────────────────────────────────────────────
// COLUMN MAP
// ─────────────────────────────────────────────────────────────
var FCA = {
  DATE:        1,   // A — yyyy-MM-dd
  VIX:         2,   // B — VIX at forecast time
  SLOTS_START: 3,   // C–P — 14 per-slot diffs (C=8:30AM ... P=3:00PM)
  SLOTS_END:   16,  // P
  AM_AVG:      17,  // Q — avg diff slots 1–5 (8:30–11:00)
  PM_AVG:      18,  // R — avg diff slots 6–14 (11:30–3:00)
  DAY_AVG:     19,  // S — avg diff all completed slots
  ABS_AVG:     20,  // T — abs avg diff (accuracy measure)
  BIAS:        21,  // U — OVER / UNDER / NEUTRAL
  GRADE:       22,  // V — 🎯 / ✅ / ⚠️ / ❌
  SLOTS_FILLED:23,  // W — how many slots had actuals
  TOTAL_COLS:  23
};

// Slot time labels for headers
var FCA_SLOT_LABELS = [
  "8:30A","9:00A","9:30A","10:00A","10:30A","11:00A","11:30A",
  "12:00P","12:30P","1:00P","1:30P","2:00P","2:30P","3:00P"
];

// AM = slots 0–4 (indices), PM = slots 5–13
var FCA_AM_SLOT_END   = 4;  // last AM index (inclusive) = 11:00 AM
var FCA_PM_SLOT_START = 5;  // first PM index = 11:30 AM

// Grade thresholds on abs avg diff
var FCA_GRADE = {
  SHARP: 0.30,  // ≤ $0.30 abs avg → 🎯 SHARP
  GOOD:  0.60,  // ≤ $0.60         → ✅ GOOD
  FAIR:  1.00   // ≤ $1.00         → ⚠️ FAIR
                // > $1.00         → ❌ POOR
};

// ─────────────────────────────────────────────────────────────
// COLORS
// ─────────────────────────────────────────────────────────────
var FCA_COLOR = {
  BG_SHEET:    "#0a0a14",
  BG_BANNER:   "#070712",
  BG_HEADER:   "#0d0d2b",
  BG_ROW:      "#0a0a14",
  BG_ROW_ALT:  "#0d0d1a",
  BG_LOCK:     "#001a08",   // locked EOD row background
  TXT_BANNER:  "#00e5ff",
  TXT_HEADER:  "#00e5ff",
  TXT_POS:     "#69f0ae",   // positive diff (SPY > pred)
  TXT_NEG:     "#ff6b6b",   // negative diff (SPY < pred)
  TXT_NEUTRAL: "#7070aa",
  TXT_META:    "#5a5a8a",
  TXT_GRADE_A: "#69f0ae",
  TXT_GRADE_B: "#ffd740",
  TXT_GRADE_C: "#ff9944",
  TXT_GRADE_D: "#ff5252"
};

// ─────────────────────────────────────────────────────────────
// SETUP SHEET
// ─────────────────────────────────────────────────────────────
function setupFCAccuracySheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_FC_ACCURACY);
  if (!sheet) sheet = ss.insertSheet(SHEET_FC_ACCURACY);
  sheet.setTabColor("#4caf50");

  // Ensure enough cols/rows
  var neededCols = FCA.TOTAL_COLS;
  var neededRows = 300;
  if (sheet.getMaxColumns() < neededCols)
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  if (sheet.getMaxRows() < neededRows)
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());

  sheet.getRange(1, 1, neededRows, neededCols).setBackground(FCA_COLOR.BG_SHEET);

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.getRange(1, 1, 1, neededCols).merge()
    .setValue("📈  F O R E C A S T   A C C U R A C Y   L O G   ·   P E R - S L O T   D I F F")
    .setBackground(FCA_COLOR.BG_BANNER).setFontColor(FCA_COLOR.TXT_BANNER)
    .setFontWeight("bold").setFontSize(13).setFontFamily("Courier New")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  // ── Row 2: Sub-banner ─────────────────────────────────────
  sheet.getRange(2, 1, 1, neededCols).merge()
    .setValue("Actual − Predicted per 30-min slot · Positive = SPY beat forecast · Negative = SPY missed · Locked at 3:00 PM CST · Updates dynamically intraday")
    .setBackground(FCA_COLOR.BG_BANNER).setFontColor(FCA_COLOR.TXT_META)
    .setFontSize(8).setHorizontalAlignment("center");
  sheet.setRowHeight(2, 18);

  // ── Row 3: Headers ────────────────────────────────────────
  var headers = ["📅 DATE", "🌡️ VIX"];
  FCA_SLOT_LABELS.forEach(function(lbl) { headers.push("Δ " + lbl); });
  headers = headers.concat([
    "🌅 AM AVG", "🌇 PM AVG", "📊 DAY AVG",
    "🎯 ABS AVG", "⚖️ BIAS", "🏆 GRADE", "✅ SLOTS"
  ]);

  sheet.getRange(3, 1, 1, neededCols).setValues([headers])
    .setBackground(FCA_COLOR.BG_HEADER).setFontColor(FCA_COLOR.TXT_HEADER)
    .setFontWeight("bold").setFontSize(8).setFontFamily("Courier New")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(3, 24);
  sheet.setFrozenRows(3);

  // ── Column widths ─────────────────────────────────────────
  sheet.setColumnWidth(FCA.DATE, 90);
  sheet.setColumnWidth(FCA.VIX,  50);
  for (var c = FCA.SLOTS_START; c <= FCA.SLOTS_END; c++) {
    sheet.setColumnWidth(c, 58);
  }
  sheet.setColumnWidth(FCA.AM_AVG,      65);
  sheet.setColumnWidth(FCA.PM_AVG,      65);
  sheet.setColumnWidth(FCA.DAY_AVG,     65);
  sheet.setColumnWidth(FCA.ABS_AVG,     65);
  sheet.setColumnWidth(FCA.BIAS,        70);
  sheet.setColumnWidth(FCA.GRADE,       100);
  sheet.setColumnWidth(FCA.SLOTS_FILLED, 55);

  // ── Header notes ──────────────────────────────────────────
  sheet.getRange(3, FCA.AM_AVG).setNote(
    "🌅 AM AVG\n─────────────────\n" +
    "Average diff for slots 8:30–11:00 AM CST.\n" +
    "Positive = AI was too bearish in the morning.\n" +
    "Negative = AI was too bullish in the morning."
  );
  sheet.getRange(3, FCA.PM_AVG).setNote(
    "🌇 PM AVG\n─────────────────\n" +
    "Average diff for slots 11:30 AM–3:00 PM CST.\n" +
    "Positive = AI underestimated the afternoon.\n" +
    "Negative = AI overestimated the afternoon."
  );
  sheet.getRange(3, FCA.ABS_AVG).setNote(
    "🎯 ABS AVG\n─────────────────\n" +
    "Direction-agnostic accuracy: avg of |Actual−Pred|.\n" +
    "≤ $0.30 = 🎯 SHARP\n" +
    "≤ $0.60 = ✅ GOOD\n" +
    "≤ $1.00 = ⚠️ FAIR\n" +
    "> $1.00 = ❌ POOR"
  );
  sheet.getRange(3, FCA.BIAS).setNote(
    "⚖️ BIAS\n─────────────────\n" +
    "OVER  = AI consistently predicted too high.\n" +
    "UNDER = AI consistently predicted too low.\n" +
    "NEUTRAL = mixed direction errors."
  );

  Logger.log("FC Accuracy Log sheet setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY — called from ForecastSheet.gs fillActualPrices()
//
// Reads the 📡 FORECAST sheet for the current day's predicted
// and actual values, computes per-slot diffs, and writes/updates
// the current-day row. Finalizes (locks color) at 3:00 PM CST.
//
// now = raw UTC Date
// isEOD = true when 3:00 PM slot just filled (lock-in call)
// ─────────────────────────────────────────────────────────────
function logForecastAccuracy(now, isEOD) {
  try {
    var ss         = SpreadsheetApp.getActiveSpreadsheet();
    var fcSheet    = ss.getSheetByName(SHEET_FORECAST);
    var logSheet   = ss.getSheetByName(SHEET_FC_ACCURACY);

    if (!fcSheet) {
      Logger.log("FCA: FORECAST sheet not found — skipping.");
      return;
    }
    if (!logSheet) {
      setupFCAccuracySheet(ss);
      logSheet = ss.getSheetByName(SHEET_FC_ACCURACY);
    }

    var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");

    // ── Read all 14 slot predicted + actual values ─────────
    var diffs       = [];
    var amDiffs     = [];
    var pmDiffs     = [];
    var absDiffs    = [];
    var slotsFilled = 0;

    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var row    = FC.DATA_START_ROW + i;
      var pred   = parseFloat(fcSheet.getRange(row, FC.COL_PRED).getValue())   || 0;
      var actual = parseFloat(fcSheet.getRange(row, FC.COL_ACTUAL).getValue()) || 0;

      if (pred > 0 && actual > 0) {
        var diff = actual - pred;
        diffs.push(diff);
        absDiffs.push(Math.abs(diff));
        slotsFilled++;

        if (i <= FCA_AM_SLOT_END) {
          amDiffs.push(diff);
        } else {
          pmDiffs.push(diff);
        }
      } else {
        diffs.push("");   // blank for unfilled slots
      }
    }

    if (slotsFilled === 0) {
      Logger.log("FCA: No filled slots yet — skipping log.");
      return;
    }

    // ── Compute summary stats ──────────────────────────────
    var avg = function(arr) {
      if (arr.length === 0) return null;
      return arr.reduce(function(s, v) { return s + v; }, 0) / arr.length;
    };

    var amAvg  = avg(amDiffs);
    var pmAvg  = avg(pmDiffs);
    var dayAvg = avg(absDiffs.map(function(v, i) { return diffs[diffs.indexOf !== undefined ? i : i]; }));
    // Recompute dayAvg from raw signed diffs
    var signedCompleted = diffs.filter(function(v) { return v !== ""; });
    dayAvg = avg(signedCompleted);
    var absAvg = avg(absDiffs);

    // Bias: if >60% of completed diffs same sign → OVER/UNDER
    var posCount = signedCompleted.filter(function(v) { return v > 0; }).length;
    var negCount = signedCompleted.filter(function(v) { return v < 0; }).length;
    var bias;
    if (posCount / slotsFilled >= 0.6)      bias = "UNDER";   // actual > pred = AI underestimated
    else if (negCount / slotsFilled >= 0.6) bias = "OVER";    // actual < pred = AI overestimated
    else                                     bias = "NEUTRAL";

    // Grade based on abs avg diff
    var grade;
    if      (absAvg <= FCA_GRADE.SHARP) grade = "🎯 SHARP";
    else if (absAvg <= FCA_GRADE.GOOD)  grade = "✅ GOOD";
    else if (absAvg <= FCA_GRADE.FAIR)  grade = "⚠️ FAIR";
    else                                 grade = "❌ POOR";

    // VIX from flag
    var vix = parseFloat(getFlag("FC_LAST_VIX") || "0") || 0;

    // ── Build the row data array ───────────────────────────
    var rowData = [todayStr, vix > 0 ? vix : "—"];
    for (var j = 0; j < FC.SLOT_COUNT; j++) {
      rowData.push(diffs[j] !== "" ? Math.round(diffs[j] * 100) / 100 : "—");
    }
    rowData.push(
      amAvg  !== null ? Math.round(amAvg  * 100) / 100 : "—",
      pmAvg  !== null ? Math.round(pmAvg  * 100) / 100 : "—",
      dayAvg !== null ? Math.round(dayAvg * 100) / 100 : "—",
      absAvg !== null ? Math.round(absAvg * 100) / 100 : "—",
      bias,
      grade,
      slotsFilled + "/14"
    );

    // ── Find or create today's row (search from bottom) ───
    var lastRow    = logSheet.getLastRow();
    var targetRow  = -1;

    // Search last 10 rows for today's date
    var searchStart = Math.max(4, lastRow - 9);
    if (lastRow >= 4) {
      var dateVals = logSheet.getRange(searchStart, FCA.DATE, lastRow - searchStart + 1, 1).getValues();
      for (var d = dateVals.length - 1; d >= 0; d--) {
        if (dateVals[d][0] === todayStr) {
          targetRow = searchStart + d;
          break;
        }
      }
    }

    // If not found, append a new row
    if (targetRow === -1) {
      targetRow = lastRow + 1;
      if (targetRow < 4) targetRow = 4;
    }

    // ── Write data ────────────────────────────────────────
    logSheet.getRange(targetRow, 1, 1, FCA.TOTAL_COLS).setValues([rowData]);

    // ── Apply formatting ──────────────────────────────────
    applyFCARowFormat(logSheet, targetRow, isEOD, diffs, amAvg, pmAvg, absAvg, grade, bias);

    // ── If EOD: cache diff flags for next-day AI prompt ──
    if (isEOD) {
      cacheDiffHistoryFlags(dayAvg, amAvg, pmAvg);
      Logger.log("FCA: EOD locked — grade=" + grade + " absAvg=$" +
                 (absAvg !== null ? absAvg.toFixed(2) : "?") +
                 " slots=" + slotsFilled + "/14");
    } else {
      Logger.log("FCA: Intraday update — slots=" + slotsFilled + "/14");
    }

  } catch (e) {
    Logger.log("logForecastAccuracy ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// APPLY ROW FORMAT
// ─────────────────────────────────────────────────────────────
function applyFCARowFormat(sheet, rowNum, isEOD, diffs, amAvg, pmAvg, absAvg, grade, bias) {
  try {
    var rowBg = isEOD ? FCA_COLOR.BG_LOCK : FCA_COLOR.BG_ROW;
    sheet.getRange(rowNum, 1, 1, FCA.TOTAL_COLS)
      .setBackground(rowBg)
      .setFontFamily("Courier New")
      .setFontSize(8)
      .setVerticalAlignment("middle");

    // DATE
    sheet.getRange(rowNum, FCA.DATE)
      .setFontColor(FCA_COLOR.TXT_HEADER)
      .setFontWeight("bold")
      .setHorizontalAlignment("center");

    // VIX
    sheet.getRange(rowNum, FCA.VIX)
      .setFontColor(FCA_COLOR.TXT_NEUTRAL)
      .setHorizontalAlignment("center");

    // Per-slot diffs — color by sign
    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var col  = FCA.SLOTS_START + i;
      var val  = diffs[i];
      var cell = sheet.getRange(rowNum, col);
      cell.setHorizontalAlignment("center");
      if (val === "" || val === "—") {
        cell.setFontColor(FCA_COLOR.TXT_NEUTRAL);
      } else {
        var v = parseFloat(val);
        cell.setFontColor(v > 0 ? FCA_COLOR.TXT_POS : v < 0 ? FCA_COLOR.TXT_NEG : FCA_COLOR.TXT_NEUTRAL);
        cell.setNumberFormat('[>0]"+$"0.00;[<0]"$"0.00;"—"');
      }
    }

    // AM avg
    var amCell = sheet.getRange(rowNum, FCA.AM_AVG);
    amCell.setHorizontalAlignment("center").setFontWeight("bold");
    if (amAvg !== null) {
      amCell.setFontColor(amAvg > 0 ? FCA_COLOR.TXT_POS : amAvg < 0 ? FCA_COLOR.TXT_NEG : FCA_COLOR.TXT_NEUTRAL);
      amCell.setNumberFormat('[>0]"+$"0.00;[<0]"$"0.00;"—"');
    } else {
      amCell.setFontColor(FCA_COLOR.TXT_NEUTRAL);
    }

    // PM avg
    var pmCell = sheet.getRange(rowNum, FCA.PM_AVG);
    pmCell.setHorizontalAlignment("center").setFontWeight("bold");
    if (pmAvg !== null) {
      pmCell.setFontColor(pmAvg > 0 ? FCA_COLOR.TXT_POS : pmAvg < 0 ? FCA_COLOR.TXT_NEG : FCA_COLOR.TXT_NEUTRAL);
      pmCell.setNumberFormat('[>0]"+$"0.00;[<0]"$"0.00;"—"');
    } else {
      pmCell.setFontColor(FCA_COLOR.TXT_NEUTRAL);
    }

    // Day avg
    sheet.getRange(rowNum, FCA.DAY_AVG)
      .setHorizontalAlignment("center")
      .setFontColor(FCA_COLOR.TXT_NEUTRAL)
      .setNumberFormat('[>0]"+$"0.00;[<0]"$"0.00;"—"');

    // Abs avg
    sheet.getRange(rowNum, FCA.ABS_AVG)
      .setHorizontalAlignment("center").setFontWeight("bold")
      .setFontColor(absAvg !== null && absAvg <= FCA_GRADE.GOOD ? FCA_COLOR.TXT_GRADE_A : FCA_COLOR.TXT_GRADE_C)
      .setNumberFormat('"$"0.00');

    // Bias
    var biasColor = bias === "NEUTRAL" ? FCA_COLOR.TXT_NEUTRAL
                  : bias === "UNDER"   ? FCA_COLOR.TXT_POS
                  : FCA_COLOR.TXT_NEG;
    sheet.getRange(rowNum, FCA.BIAS)
      .setFontColor(biasColor).setHorizontalAlignment("center");

    // Grade
    var gradeColor = grade.indexOf("SHARP") !== -1 ? FCA_COLOR.TXT_GRADE_A
                   : grade.indexOf("GOOD")  !== -1 ? FCA_COLOR.TXT_GRADE_B
                   : grade.indexOf("FAIR")  !== -1 ? FCA_COLOR.TXT_GRADE_C
                   : FCA_COLOR.TXT_GRADE_D;
    sheet.getRange(rowNum, FCA.GRADE)
      .setFontColor(gradeColor).setFontWeight("bold")
      .setHorizontalAlignment("center");

    // Slots filled
    sheet.getRange(rowNum, FCA.SLOTS_FILLED)
      .setFontColor(FCA_COLOR.TXT_NEUTRAL).setHorizontalAlignment("center");

    sheet.setRowHeight(rowNum, 22);

  } catch (e) {
    Logger.log("applyFCARowFormat ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CACHE DIFF HISTORY FLAGS
// Shifts D1→D2→D3 and writes today's values to D1.
// Called at EOD lock-in only.
// ─────────────────────────────────────────────────────────────
function cacheDiffHistoryFlags(dayAvg, amAvg, pmAvg) {
  try {
    // Shift D2 → D3
    setFlag("FC_DIFF_AVG_D3", getFlag("FC_DIFF_AVG_D2") || "");
    setFlag("FC_DIFF_AM_D3",  getFlag("FC_DIFF_AM_D2")  || "");
    setFlag("FC_DIFF_PM_D3",  getFlag("FC_DIFF_PM_D2")  || "");

    // Shift D1 → D2
    setFlag("FC_DIFF_AVG_D2", getFlag("FC_DIFF_AVG_D1") || "");
    setFlag("FC_DIFF_AM_D2",  getFlag("FC_DIFF_AM_D1")  || "");
    setFlag("FC_DIFF_PM_D2",  getFlag("FC_DIFF_PM_D1")  || "");

    // Write today → D1
    setFlag("FC_DIFF_AVG_D1", dayAvg !== null ? dayAvg.toFixed(4) : "");
    setFlag("FC_DIFF_AM_D1",  amAvg  !== null ? amAvg.toFixed(4)  : "");
    setFlag("FC_DIFF_PM_D1",  pmAvg  !== null ? pmAvg.toFixed(4)  : "");

    Logger.log("FCA: Diff history flags cached — D1 dayAvg=" +
               (dayAvg !== null ? dayAvg.toFixed(2) : "n/a") +
               " amAvg=" + (amAvg !== null ? amAvg.toFixed(2) : "n/a") +
               " pmAvg=" + (pmAvg !== null ? pmAvg.toFixed(2) : "n/a"));
  } catch (e) {
    Logger.log("cacheDiffHistoryFlags ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD DIFF HISTORY CONTEXT STRING
// Called by buildForecastPrompt() in ForecastSheet.gs.
// Returns a compact string to inject into the AI prompt.
// ─────────────────────────────────────────────────────────────
function buildDiffHistoryContext() {
  try {
    var d1Avg = getFlag("FC_DIFF_AVG_D1");
    var d1Am  = getFlag("FC_DIFF_AM_D1");
    var d1Pm  = getFlag("FC_DIFF_PM_D1");
    var d2Avg = getFlag("FC_DIFF_AVG_D2");
    var d2Am  = getFlag("FC_DIFF_AM_D2");
    var d2Pm  = getFlag("FC_DIFF_PM_D2");
    var d3Avg = getFlag("FC_DIFF_AVG_D3");
    var d3Am  = getFlag("FC_DIFF_AM_D3");
    var d3Pm  = getFlag("FC_DIFF_PM_D3");

    // Need at least 1 day of history
    if (!d1Avg || d1Avg === "") return "";

    var fmt = function(v) {
      if (!v || v === "") return "n/a";
      var f = parseFloat(v);
      if (isNaN(f)) return "n/a";
      return (f >= 0 ? "+" : "") + f.toFixed(2);
    };

    var lines = ["=== FORECAST ACCURACY HISTORY (Actual − Predicted) ==="];

    if (d1Avg && d1Avg !== "") {
      lines.push("Yesterday:    day=" + fmt(d1Avg) +
                 "  AM=" + fmt(d1Am) + "  PM=" + fmt(d1Pm));
    }
    if (d2Avg && d2Avg !== "") {
      lines.push("2 days ago:   day=" + fmt(d2Avg) +
                 "  AM=" + fmt(d2Am) + "  PM=" + fmt(d2Pm));
    }
    if (d3Avg && d3Avg !== "") {
      lines.push("3 days ago:   day=" + fmt(d3Avg) +
                 "  AM=" + fmt(d3Am) + "  PM=" + fmt(d3Pm));
    }

    // Compute 3-day rolling bias if we have enough data
    var vals   = [d1Avg, d2Avg, d3Avg].filter(function(v) { return v && v !== ""; });
    var amVals = [d1Am, d2Am, d3Am].filter(function(v)    { return v && v !== ""; });
    var pmVals = [d1Pm, d2Pm, d3Pm].filter(function(v)    { return v && v !== ""; });

    if (vals.length >= 2) {
      var avgRolling = vals.reduce(function(s, v) { return s + parseFloat(v); }, 0) / vals.length;
      lines.push("Rolling avg:  " + fmt(avgRolling.toFixed(4)) +
                 "  (positive = AI tends to underestimate; negative = overestimate)");
    }
    if (amVals.length >= 2) {
      var amRolling = amVals.reduce(function(s, v) { return s + parseFloat(v); }, 0) / amVals.length;
      lines.push("AM bias:      " + fmt(amRolling.toFixed(4)));
    }
    if (pmVals.length >= 2) {
      var pmRolling = pmVals.reduce(function(s, v) { return s + parseFloat(v); }, 0) / pmVals.length;
      lines.push("PM bias:      " + fmt(pmRolling.toFixed(4)));
    }

    lines.push("INSTRUCTION: Use this history to self-correct today's forecast bias. " +
               "If AM bias is consistently negative, raise AM slot prices accordingly. " +
               "If PM bias is consistently positive, lower PM slot prices accordingly.");

    return lines.join("\n");
  } catch (e) {
    Logger.log("buildDiffHistoryContext ERROR: " + e.message);
    return "";
  }
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRY
// ─────────────────────────────────────────────────────────────
function setupFCAccuracySheetFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupFCAccuracySheet(ss);
  SpreadsheetApp.getUi().alert(
    "📈 FC ACCURACY LOG\n\n" +
    "✅ Sheet created!\n\n" +
    "HOW IT WORKS:\n" +
    "• Updates dynamically throughout the day as actuals fill in\n" +
    "• Locks in the final row at 3:00 PM CST (EOD)\n" +
    "• AM = slots 8:30–11:00 AM CST\n" +
    "• PM = slots 11:30 AM–3:00 PM CST\n" +
    "• Positive diff = SPY beat forecast (AI underestimated)\n" +
    "• Negative diff = SPY missed forecast (AI overestimated)\n" +
    "• 🎯 SHARP = abs avg ≤ $0.30\n" +
    "• ✅ GOOD   = abs avg ≤ $0.60\n" +
    "• ⚠️ FAIR   = abs avg ≤ $1.00\n" +
    "• ❌ POOR   = abs avg > $1.00\n\n" +
    "Last 3-day diff history is fed back into\n" +
    "the AI forecast prompt automatically."
  );
}
