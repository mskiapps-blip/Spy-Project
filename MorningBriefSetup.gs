// ============================================================
// FILE: MorningBriefSetup.gs
// PURPOSE: Creates and styles the 🌅 MORNING BRIEF sheet.
//          Run once via menu: ⚡ SPY TRACKER → Setup Morning Brief
// ============================================================

function setupMorningBriefSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_MORNING_BRIEF);
  if (!sheet) sheet = ss.insertSheet(SHEET_MORNING_BRIEF);

  sheet.setTabColor("#e65100");

  if (sheet.getLastRow() > 0) {
    Logger.log("Morning Brief sheet already exists.");
    return sheet;
  }

  // ── Row 1: Banner ─────────────────────────────────────────
  var totalCols = MB_CHART_HEADERS.length + 8;
  sheet.appendRow(["🌅  Morning Brief  ·  AI Price Predictions  ·  Fires at 8:25 CST"]);
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setBackground("#0f0800")
    .setFontColor("#ff9800")
    .setFontWeight("bold")
    .setFontSize(15)
    .setFontFamily(BT_FONT.BANNER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 42);

  // ── Row 2: Sub-header ─────────────────────────────────────
  sheet.appendRow(["Gemini analyzes overnight highs, VIX, ES futures, and gap context to predict the day's key SPY price levels. Updated once at 8:25 CST. Targets marked ✅ when SPY comes within 0.15%."]);
  sheet.getRange(2, 1, 1, totalCols).merge()
    .setBackground("#130800")
    .setFontColor("#cc7700")
    .setFontSize(9)
    .setFontFamily(BT_FONT.HEADER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setFontStyle("italic");
  sheet.setRowHeight(2, 20);

  // ── Row 3: Spacer ─────────────────────────────────────────
  sheet.appendRow([""]);
  sheet.getRange(3, 1, 1, totalCols)
    .setBackground("#0a0a12");
  sheet.setRowHeight(3, 8);

  // ── Rows 4–17: Prediction panel (populated at 8:25 CST) ──
  // Leave these blank — MorningBrief.gs will fill them
  for (var i = 4; i <= 17; i++) {
    sheet.appendRow([""]);
    sheet.getRange(i, 1, 1, totalCols).setBackground("#0a0a12");
    sheet.setRowHeight(i, 24);
  }

  // ── Row 18: Spacer ────────────────────────────────────────
  sheet.appendRow([""]);
  sheet.getRange(18, 1, 1, totalCols).setBackground("#0a0a12");
  sheet.setRowHeight(18, 8);

  // ── Row 19: Spacer ────────────────────────────────────────
  sheet.appendRow([""]);
  sheet.getRange(19, 1, 1, totalCols).setBackground("#0a0a12");
  sheet.setRowHeight(19, 8);

  // ── Row 20: Chart data header (pre-placed) ────────────────
  sheet.appendRow(MB_CHART_HEADERS);
  sheet.getRange(20, 1, 1, MB_CHART_HEADERS.length)
    .setBackground("#1c0505")
    .setFontColor("#ff6b6b")
    .setFontWeight("bold")
    .setFontFamily(BT_FONT.HEADER)
    .setFontSize(9)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(20, 26);

  sheet.setFrozenRows(1);

  // ── Column widths ─────────────────────────────────────────
  sheet.setColumnWidth(1,  175);  // Label / Time
  sheet.setColumnWidth(2,  110);  // Value / Actual Price
  sheet.setColumnWidth(3,  110);  // Flush Target
  sheet.setColumnWidth(4,  110);  // Flip Zone
  sheet.setColumnWidth(5,  110);  // Rip Target
  sheet.setColumnWidth(6,  110);  // EOD Target
  sheet.setColumnWidth(7,  200);  // Hit Flag
  // Chart area cols 9+
  for (var c = 8; c <= 16; c++) {
    sheet.setColumnWidth(c, 90);
  }

  // ── Header notes ──────────────────────────────────────────
  sheet.getRange(20, MBC.ACTUAL_PRICE).setNote(
    "💰 ACTUAL SPY\n─────────────────────\n" +
    "SPY price logged every 5 minutes during market hours.\n" +
    "This is the line plotted on the chart."
  );
  sheet.getRange(20, MBC.FLUSH_TARGET).setNote(
    "📉 FLUSH TARGET\n─────────────────────\n" +
    "AI's predicted flush level — where SPY might bottom\n" +
    "during the morning trap (if Bear Trap setup).\n\n" +
    "This is a flat reference line on the chart.\n" +
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

function setupMorningBriefSheetFromMenu() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = setupMorningBriefSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🌅 Morning Brief\n\n" +
    "✅ Sheet created and ready!\n\n" +
    "HOW IT WORKS:\n" +
    "• Fires automatically at 8:25 CST (5 min before open)\n" +
    "• Gemini analyzes overnight data and returns 5 price targets\n" +
    "• Summary panel appears on 🪤 Bear Trap sheet too\n" +
    "• Every 5-min tick tracks actual SPY vs predictions\n" +
    "• Targets marked ✅ when hit within ±0.15%\n" +
    "• Line chart plots actual price vs all target levels\n" +
    "• EOD grade fires at 3:00 CST\n\n" +
    "AI BUDGET: 1 call at 8:25 CST (in addition to Bear Trap calls)\n" +
    "Runs inside your existing 5-minute trigger."
  );
}
