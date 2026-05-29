// ============================================================
// FILE: MorningBriefSetup.gs
// PURPOSE: Creates and styles the 🌅 MORNING BRIEF sheet.
//          Run once via menu: ⚡ SPY TRACKER → Setup Morning Brief
//
//  LAYOUT (rows):
//    1      — Banner (title)
//    2      — Sub-header / description
//    3      — Spacer (6px)
//    4–17   — Prediction panel (filled at 8:25 CST by MorningBrief.gs)
//    18     — Spacer (6px)
//    19     — Spacer (6px)
//    20     — Chart data header row  ← MB.CHART_DATA_START_ROW - 1
//    21+    — Intraday tracking data ← MB.CHART_DATA_START_ROW = 21
//
//  NOTE: MB.CHART_DATA_START_ROW in MorningBrief.gs MUST be 21.
// ============================================================

function setupMorningBriefSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_MORNING_BRIEF);
  if (!sheet) sheet = ss.insertSheet(SHEET_MORNING_BRIEF);

  sheet.setTabColor("#e65100");

  // ── Force-clear existing content so re-runs always rebuild cleanly ──
  if (sheet.getLastRow() > 0) {
    sheet.clearContents();
    sheet.clearFormats();
    sheet.clearNotes();
  }

  var totalCols = MB_CHART_HEADERS.length + 8;  // 7 data cols + 8 extra = 15

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.appendRow(["🌅  Morning Brief  ·  AI Price Predictions  ·  Fires at 8:25 CST"]);
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setBackground("#0f0800")
    .setFontColor("#ff9800")
    .setFontWeight("bold")
    .setFontSize(15)
    .setFontFamily(BT_FONT.BANNER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 48);

  // ── Row 2: Sub-header ─────────────────────────────────────
  sheet.appendRow(["Gemini analyzes overnight highs, VIX, ES futures, and gap context to predict the day's key SPY price levels.  Updated once at 8:25 CST.  Targets marked ✅ when SPY comes within 0.15%."]);
  sheet.getRange(2, 1, 1, totalCols).merge()
    .setBackground("#130800")
    .setFontColor("#cc7700")
    .setFontSize(10)
    .setFontFamily(BT_FONT.HEADER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setFontStyle("italic");
  sheet.setRowHeight(2, 26);

  // ── Row 3: Spacer ─────────────────────────────────────────
  sheet.appendRow([""]);
  sheet.getRange(3, 1, 1, totalCols).setBackground("#0a0a12");
  sheet.setRowHeight(3, 6);

  // ── Rows 4–17: Prediction panel (populated at 8:25 CST) ──
  // Pre-fill with visible placeholder text so the section is
  // clearly visible before the brief fires.
  var placeholderLabels = [
    "",                                    // row 4  — date/time header (filled by brief)
    "Setup Type",                          // row 5
    "",                                    // row 6  — confidence (right half)
    "Rationale",                           // row 7
    "📊  PRICE TARGETS",                  // row 8
    "📉  FLUSH TARGET",                   // row 9
    "⚡  FLIP ZONE",                      // row 10
    "🚀  RIP TARGET",                     // row 11
    "🎯  EOD TARGET",                     // row 12
    "",                                    // row 13 — divider
    "📈  INTRADAY TRACKING",              // row 14
    "",                                    // row 15
    "",                                    // row 16
    ""                                     // row 17
  ];

  var placeholderBgs = [
    "#0f0800",  // row 4
    "#1a1a2a",  // row 5
    "#1a1a2a",  // row 6
    "#0a0a18",  // row 7
    "#111120",  // row 8
    "#0d0d1a",  // row 9
    "#0d0d1a",  // row 10
    "#0d0d1a",  // row 11
    "#0d0d1a",  // row 12
    "#222230",  // row 13 — divider
    "#080810",  // row 14
    "#080810",  // row 15
    "#080810",  // row 16
    "#080810"   // row 17
  ];

  var placeholderFgs = [
    "#ff9800",  // row 4
    "#444466",  // row 5
    "#444466",  // row 6
    "#444455",  // row 7
    "#555577",  // row 8
    "#555577",  // row 9
    "#555577",  // row 10
    "#555577",  // row 11
    "#555577",  // row 12
    "#222230",  // row 13 — divider (invisible text)
    "#444466",  // row 14
    "#444466",  // row 15
    "#444466",  // row 16
    "#444466"   // row 17
  ];

  var placeholderHeights = [
    28,  // row 4
    40,  // row 5
    40,  // row 6
    40,  // row 7
    22,  // row 8
    30,  // row 9
    30,  // row 10
    30,  // row 11
    30,  // row 12
    4,   // row 13 — thin divider
    20,  // row 14
    8,   // row 15
    8,   // row 16
    8    // row 17
  ];

  for (var i = 0; i < 14; i++) {
    var rowNum = 4 + i;
    sheet.appendRow([placeholderLabels[i] || ""]);
    sheet.getRange(rowNum, 1, 1, totalCols)
      .merge()
      .setBackground(placeholderBgs[i])
      .setFontColor(placeholderFgs[i])
      .setFontSize(i === 4 ? 11 : (i === 7 ? 16 : 9))
      .setFontWeight(i === 7 ? "bold" : "normal")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setFontStyle(i === 6 ? "italic" : "normal");
    sheet.setRowHeight(rowNum, placeholderHeights[i]);
  }

  // ── Row 18: Spacer ────────────────────────────────────────
  sheet.appendRow([""]);
  sheet.getRange(18, 1, 1, totalCols).setBackground("#0a0a12");
  sheet.setRowHeight(18, 6);

  // ── Row 19: Spacer ────────────────────────────────────────
  sheet.appendRow([""]);
  sheet.getRange(19, 1, 1, totalCols).setBackground("#0a0a12");
  sheet.setRowHeight(19, 6);

  // ── Row 20: Chart data header ─────────────────────────────
  // This is MB.CHART_DATA_START_ROW - 1 = 20
  // Data rows start at MB.CHART_DATA_START_ROW = 21
  sheet.appendRow(MB_CHART_HEADERS);

  // Style header across all 7 data columns (A–G), full width
  sheet.getRange(20, 1, 1, MB_CHART_HEADERS.length)
    .setBackground("#0d0d2b")
    .setFontColor("#00e5ff")
    .setFontWeight("bold")
    .setFontFamily(BT_FONT.HEADER)
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");

  // Style remaining columns in the row to match (dark bg, no orphan white)
  if (totalCols > MB_CHART_HEADERS.length) {
    sheet.getRange(20, MB_CHART_HEADERS.length + 1, 1, totalCols - MB_CHART_HEADERS.length)
      .setBackground("#0d0d2b");
  }
  sheet.setRowHeight(20, 32);

  // ── Freeze banner row ─────────────────────────────────────
  sheet.setFrozenRows(1);

  // ── Column widths ─────────────────────────────────────────
  // Generous widths so emoji + text headers don't truncate
  sheet.setColumnWidth(1, 130);   // ⏱ TIME (CST)
  sheet.setColumnWidth(2, 130);   // 💰 ACTUAL SPY
  sheet.setColumnWidth(3, 150);   // 📉 FLUSH TARGET
  sheet.setColumnWidth(4, 140);   // ⚡ FLIP ZONE
  sheet.setColumnWidth(5, 140);   // 🚀 RIP TARGET
  sheet.setColumnWidth(6, 140);   // 🎯 EOD TARGET
  sheet.setColumnWidth(7, 160);   // ✅ HIT
  sheet.setColumnWidth(8, 60);    // gap / chart anchor
  for (var c = 9; c <= totalCols; c++) {
    sheet.setColumnWidth(c, 80);
  }

  // ── Header notes on row 20 ────────────────────────────────
  sheet.getRange(20, MBC.TIME).setNote(
    "⏱ TIME (CST)\n─────────────────────\n" +
    "CST timestamp of each 5-minute SPY price tick.\n" +
    "This is the X-axis of the intraday chart."
  );
  sheet.getRange(20, MBC.ACTUAL_PRICE).setNote(
    "💰 ACTUAL SPY\n─────────────────────\n" +
    "SPY price logged every 5 minutes during market hours.\n" +
    "This is the line plotted on the chart."
  );
  sheet.getRange(20, MBC.FLUSH_TARGET).setNote(
    "📉 FLUSH TARGET\n─────────────────────\n" +
    "AI's predicted flush level — where SPY might bottom\n" +
    "during the morning trap (if Bear Trap setup).\n\n" +
    "Flat reference line on the chart.\n" +
    "Marked ✅ in the HIT column when SPY comes within 0.15%."
  );
  sheet.getRange(20, MBC.FLIP_ZONE).setNote(
    "⚡ FLIP ZONE\n─────────────────────\n" +
    "AI's predicted reversal zone — the price level where\n" +
    "the morning flush is expected to find support and turn.\n\n" +
    "This is the entry zone for calls in a Bear Trap setup."
  );
  sheet.getRange(20, MBC.RIP_TARGET).setNote(
    "🚀 RIP TARGET\n─────────────────────\n" +
    "AI's predicted rip target — where SPY could run to\n" +
    "after the Bear Trap reversal plays out.\n\n" +
    "Use this for call exit planning / profit target."
  );
  sheet.getRange(20, MBC.EOD_TARGET).setNote(
    "🎯 EOD TARGET\n─────────────────────\n" +
    "AI's predicted SPY closing price for today.\n\n" +
    "Graded at 3:00 CST — within 0.30% counts as a hit.\n" +
    "EOD accuracy tracked in the Scorecard."
  );
  sheet.getRange(20, MBC.HIT_FLAG).setNote(
    "✅ HIT\n─────────────────────\n" +
    "Marked when SPY price comes within ±0.15% of any\n" +
    "predicted target during that 5-minute tick.\n\n" +
    "EOD grade: 3/4 targets hit = ✅ GOOD\n" +
    "           4/4 targets hit = 🎯 EXCELLENT"
  );

  Logger.log("Morning Brief sheet setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRY POINT
// ─────────────────────────────────────────────────────────────
function setupMorningBriefSheetFromMenu() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = setupMorningBriefSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🌅 Morning Brief\n\n" +
    "✅ Sheet created and ready!\n\n" +
    "HOW IT WORKS:\n" +
    "• Fires automatically at 8:25 CST (5 min before open)\n" +
    "• Gemini analyzes overnight data and returns 4 price targets\n" +
    "• Summary panel appears on 🪤 Bear Trap sheet too\n" +
    "• Every 5-min tick tracks actual SPY vs predictions\n" +
    "• Targets marked ✅ when hit within ±0.15%\n" +
    "• Line chart plots actual price vs all target levels\n" +
    "• EOD grade fires at 3:00 CST\n\n" +
    "AI BUDGET: 1 Gemini call at 8:25 CST\n" +
    "Runs inside your existing 5-minute trigger.\n\n" +
    "IMPORTANT: MB.CHART_DATA_START_ROW must be 21 in MorningBrief.gs"
  );
}
