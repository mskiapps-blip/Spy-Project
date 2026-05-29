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
//    20     — Chart data header row  ← MB.CHART_DATA_START_ROW - 1 = 20
//    21+    — Intraday tracking data ← MB.CHART_DATA_START_ROW = 21
//
//  IMPORTANT: MB.CHART_DATA_START_ROW in MorningBrief.gs MUST be 21.
// ============================================================

function setupMorningBriefSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_MORNING_BRIEF);
  if (!sheet) sheet = ss.insertSheet(SHEET_MORNING_BRIEF);

  sheet.setTabColor("#e65100");

  // ── Full reset: unmerge first, then clear everything ──────
  // clearFormats() does NOT unmerge — must breakApart() first
  // or existing merge regions will fight the new merges.
  var maxRow = Math.max(sheet.getLastRow(), 25);
  var totalCols = MB_CHART_HEADERS.length + 8;  // = 15
  sheet.getRange(1, 1, maxRow, totalCols).breakApart();
  sheet.clearContents();
  sheet.clearFormats();
  sheet.clearNotes();

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.getRange(1, 1).setValue("🌅  Morning Brief  ·  AI Price Predictions  ·  Fires at 8:25 CST");
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
  sheet.getRange(2, 1).setValue(
    "Gemini analyzes overnight highs, VIX, ES futures, and gap context to predict the day's key SPY price levels." +
    "  Updated once at 8:25 CST.  Targets marked ✅ when SPY comes within 0.15%."
  );
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
  sheet.getRange(3, 1, 1, totalCols)
    .merge()
    .setBackground("#0a0a12");
  sheet.setRowHeight(3, 6);

  // ── Rows 4–17: Prediction panel placeholder ───────────────
  // These rows are overwritten at 8:25 CST by writeBriefToSheet().
  // Placeholders give visual structure before the brief fires.
  //
  //  Row 4  — Date/time header bar         (orange on near-black)
  //  Row 5  — Setup type label             (large, bold)
  //  Row 6  — Confidence sub-line          (dim)
  //  Row 7  — Rationale text               (italic, wrapped)
  //  Row 8  — "📊 PRICE TARGETS" header    (section label)
  //  Row 9  — Flush Target label+value     (target row)
  //  Row 10 — Flip Zone label+value        (target row)
  //  Row 11 — Rip Target label+value       (target row)
  //  Row 12 — EOD Target label+value       (target row)
  //  Row 13 — Thin divider                 (4px)
  //  Row 14 — "📈 INTRADAY TRACKING" label (section label)
  //  Rows 15–17 — reserved padding         (8px each)

  var panelRows = [
    // [rowNum, text,                              bg,        fg,        fontSize, bold,  height, italic]
    [4,  "⏳  Brief fires at 8:25 AM CST",         "#0f0800", "#ff9800", 11,    true,  28,   false],
    [5,  "— Awaiting Setup —",                     "#1a1a2a", "#555577", 16,    true,  44,   false],
    [6,  "Pre-market confidence: —",               "#1a1a2a", "#555566", 10,    false, 28,   true ],
    [7,  "Rationale will appear here after brief generates.", "#0a0a18", "#444455", 10, false, 44, true ],
    [8,  "📊  PRICE TARGETS",                      "#111120", "#555577",  9,    true,  24,   false],
    [9,  "📉  FLUSH TARGET    —",                  "#0d0d1a", "#555577", 10,    false, 32,   false],
    [10, "⚡  FLIP ZONE    —",                     "#0d0d1a", "#555577", 10,    false, 32,   false],
    [11, "🚀  RIP TARGET    —",                    "#0d0d1a", "#555577", 10,    false, 32,   false],
    [12, "🎯  EOD TARGET    —",                    "#0d0d1a", "#555577", 10,    false, 32,   false],
    [13, "",                                        "#222230", "#222230",  9,    false,  4,   false],
    [14, "📈  INTRADAY TRACKING  —  auto-updated every 5 min during market hours",
                                                   "#080810", "#444466",  8,    false, 20,   false],
    [15, "",                                        "#080810", "#080810",  9,    false,  8,   false],
    [16, "",                                        "#080810", "#080810",  9,    false,  8,   false],
    [17, "",                                        "#080810", "#080810",  9,    false,  8,   false]
  ];

  for (var p = 0; p < panelRows.length; p++) {
    var pr = panelRows[p];
    var rowNum  = pr[0];
    var txt     = pr[1];
    var bg      = pr[2];
    var fg      = pr[3];
    var fs      = pr[4];
    var bold    = pr[5];
    var ht      = pr[6];
    var italic  = pr[7];

    // Set value in col A first, then merge the whole row
    sheet.getRange(rowNum, 1).setValue(txt);
    sheet.getRange(rowNum, 1, 1, totalCols).merge()
      .setBackground(bg)
      .setFontColor(fg)
      .setFontSize(fs)
      .setFontWeight(bold ? "bold" : "normal")
      .setFontStyle(italic ? "italic" : "normal")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrap(true);
    sheet.setRowHeight(rowNum, ht);
  }

  // ── Row 18: Spacer ────────────────────────────────────────
  sheet.getRange(18, 1, 1, totalCols).merge().setBackground("#0a0a12");
  sheet.setRowHeight(18, 6);

  // ── Row 19: Spacer ────────────────────────────────────────
  sheet.getRange(19, 1, 1, totalCols).merge().setBackground("#0a0a12");
  sheet.setRowHeight(19, 6);

  // ── Row 20: Chart data header ─────────────────────────────
  // hdrRow = MB.CHART_DATA_START_ROW - 1 = 20
  // Data rows begin at MB.CHART_DATA_START_ROW = 21
  for (var h = 0; h < MB_CHART_HEADERS.length; h++) {
    sheet.getRange(20, h + 1).setValue(MB_CHART_HEADERS[h]);
  }
  // Style the 7 data columns individually (no merge — they need separate headers)
  sheet.getRange(20, 1, 1, MB_CHART_HEADERS.length)
    .setBackground("#0d0d2b")
    .setFontColor("#00e5ff")
    .setFontWeight("bold")
    .setFontFamily(BT_FONT.HEADER)
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  // Fill remaining columns in row 20 with matching dark bg
  if (totalCols > MB_CHART_HEADERS.length) {
    sheet.getRange(20, MB_CHART_HEADERS.length + 1, 1, totalCols - MB_CHART_HEADERS.length)
      .setBackground("#0d0d2b");
  }
  sheet.setRowHeight(20, 34);

  // ── Freeze banner row ─────────────────────────────────────
  sheet.setFrozenRows(1);

  // ── Column widths ─────────────────────────────────────────
  sheet.setColumnWidth(1, 145);   // ⏱ TIME (CST)
  sheet.setColumnWidth(2, 135);   // 💰 ACTUAL SPY
  sheet.setColumnWidth(3, 155);   // 📉 FLUSH TARGET
  sheet.setColumnWidth(4, 140);   // ⚡ FLIP ZONE
  sheet.setColumnWidth(5, 145);   // 🚀 RIP TARGET
  sheet.setColumnWidth(6, 145);   // 🎯 EOD TARGET
  sheet.setColumnWidth(7, 165);   // ✅ HIT
  sheet.setColumnWidth(8,  50);   // gap / chart spacer
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
    "during the morning trap (Bear Trap setup).\n\n" +
    "Flat reference line on the chart.\n" +
    "Marked ✅ when SPY comes within 0.15%."
  );
  sheet.getRange(20, MBC.FLIP_ZONE).setNote(
    "⚡ FLIP ZONE\n─────────────────────\n" +
    "AI's predicted reversal zone — price level where\n" +
    "the flush finds support and turns.\n\n" +
    "Entry zone for calls in a Bear Trap setup."
  );
  sheet.getRange(20, MBC.RIP_TARGET).setNote(
    "🚀 RIP TARGET\n─────────────────────\n" +
    "AI's predicted rip target — where SPY could run\n" +
    "after the Bear Trap reversal plays out.\n\n" +
    "Use for call exit planning / profit target."
  );
  sheet.getRange(20, MBC.EOD_TARGET).setNote(
    "🎯 EOD TARGET\n─────────────────────\n" +
    "AI's predicted SPY closing price for today.\n\n" +
    "Graded at 3:00 CST — within 0.30% = hit.\n" +
    "EOD accuracy tracked in the Scorecard."
  );
  sheet.getRange(20, MBC.HIT_FLAG).setNote(
    "✅ HIT\n─────────────────────\n" +
    "Marked when SPY comes within ±0.15% of any\n" +
    "predicted target during that 5-min tick.\n\n" +
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupMorningBriefSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🌅 Morning Brief\n\n" +
    "✅ Sheet rebuilt successfully!\n\n" +
    "HOW IT WORKS:\n" +
    "• Fires automatically at 8:25 CST (5 min before open)\n" +
    "• Gemini analyzes overnight data → 4 price targets\n" +
    "• Summary panel also written to 🪤 Bear Trap sheet\n" +
    "• Every 5-min tick tracks actual SPY vs predictions\n" +
    "• Targets marked ✅ when hit within ±0.15%\n" +
    "• Line chart plots actual price vs all target levels\n" +
    "• EOD grade fires at 3:00 CST\n\n" +
    "To test immediately: use menu → 🌅 Run Morning Brief Now\n\n" +
    "⚠️  REMINDER: MB.CHART_DATA_START_ROW must be 21 in MorningBrief.gs"
  );
}
