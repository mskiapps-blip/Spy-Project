// ============================================================
// FILE: BearTrapSetup.gs
// PURPOSE: Creates and styles the 🪤 BEAR TRAP sheet.
//          Run via menu: ⚡ SPY TRACKER → Setup Bear Trap Sheet
//          Safe to re-run — won't duplicate headers.
// ============================================================

// ─────────────────────────────────────────────────────────────
// BEAR TRAP COLUMN WIDTHS
// ─────────────────────────────────────────────────────────────
var BT_COL_WIDTHS = {
  1:  80,   // TIME
  2:  90,   // PRICE
  3:  130,  // PHASE
  4:  100,  // FLUSH DEPTH
  5:  120,  // VOL SIGNAL
  6:  100,  // CONFIDENCE
  7:  220,  // ENTRY SIGNAL
  8:  110,  // TARGET PRICE
  9:  280,  // OVERNIGHT
  10: 380   // AI MEMO
};

// ─────────────────────────────────────────────────────────────
// MAIN SETUP — called from menu and auto-called on first tick
// ─────────────────────────────────────────────────────────────
function setupBearTrapSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_BEAR_TRAP);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_BEAR_TRAP);
  }

  sheet.setTabColor("#ff4444");

  // Skip if already set up
  if (sheet.getLastRow() > 0) {
    applyBearTrapColumnWidths(sheet);
    addBearTrapHeaderNotes(sheet);
    Logger.log("Bear Trap sheet already exists — widths refreshed.");
    return sheet;
  }

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.appendRow(["🪤  B E A R   T R A P   O P E N   |   Pattern Confidence System   |   Active: 8:30–9:15 CST"]);
  var banner = sheet.getRange(1, 1, 1, BT_HEADERS.length);
  banner.merge()
    .setBackground("#1a0000")
    .setFontColor("#ff4444")
    .setFontWeight("bold")
    .setFontSize(13)
    .setFontFamily("Courier New")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  // ── Row 2: Pattern legend ─────────────────────────────────
  sheet.appendRow(["THE PATTERN: Overnight high tagged → Open flushes red (0.3-0.8%) on weak volume → Stalls → Momentum flip → 🚀 Rip back up + EOD pump"]);
  var legend = sheet.getRange(2, 1, 1, BT_HEADERS.length);
  legend.merge()
    .setBackground("#0d0d0d")
    .setFontColor("#ff9944")
    .setFontSize(9)
    .setFontFamily("Courier New")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle")
    .setFontStyle("italic");
  sheet.setRowHeight(2, 22);

  // ── Row 3: Column headers ─────────────────────────────────
  sheet.appendRow(BT_HEADERS);
  var headerRow = sheet.getRange(3, 1, 1, BT_HEADERS.length);
  headerRow
    .setBackground("#1a0a0a")
    .setFontColor("#ff4444")
    .setFontWeight("bold")
    .setFontSize(10)
    .setFontFamily("Courier New")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(3, 28);

  sheet.setFrozenRows(3);
  applyBearTrapColumnWidths(sheet);
  addBearTrapHeaderNotes(sheet);

  Logger.log("Bear Trap sheet setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// COLUMN WIDTHS
// ─────────────────────────────────────────────────────────────
function applyBearTrapColumnWidths(sheet) {
  for (var col in BT_COL_WIDTHS) {
    sheet.setColumnWidth(parseInt(col), BT_COL_WIDTHS[col]);
  }
}

// ─────────────────────────────────────────────────────────────
// HEADER NOTES — explains each column on hover
// ─────────────────────────────────────────────────────────────
function addBearTrapHeaderNotes(sheet) {
  // Find header row (row 3 in this sheet)
  var headerRow = 3;

  sheet.getRange(headerRow, BTC.TIME).setNote(
    "⏱ TIME (CST)\n─────────────────────\n" +
    "Time of this 5-minute tick in Central Standard Time (12-hour format).\n\n" +
    "Bear Trap active window: 8:30–9:15 CST.\n" +
    "Pre-open rows appear before 8:30 CST.\n" +
    "EOD Brief row appears at ~3:00 CST."
  );

  sheet.getRange(headerRow, BTC.PRICE).setNote(
    "💰 SPY PRICE\n─────────────────────\n" +
    "Current SPY price at this tick.\n\n" +
    "Watch for: price recovering toward/above the Day Open price\n" +
    "after the morning flush — that's the Bear Trap springing."
  );

  sheet.getRange(headerRow, BTC.PHASE).setNote(
    "📍 PHASE\n─────────────────────\n" +
    "Which phase of the Bear Trap pattern we're currently in:\n\n" +
    "🌅 PRE-OPEN   — Before 8:30 CST, watching pre-market\n" +
    "📉 FLUSH      — Active red candles, price dropping from open\n" +
    "⏸ STALL      — Flush momentum dying, volume drying up\n" +
    "⚡ FLIP       — First green tick detected after flush\n" +
    "🚀 RIP        — Confirmed reversal, pattern playing out\n" +
    "➡️ POST        — Window closed (after 9:15 CST)\n\n" +
    "STALL → FLIP is the critical transition. That's the entry zone."
  );

  sheet.getRange(headerRow, BTC.FLUSH_DEPTH).setNote(
    "📉 FLUSH DEPTH\n─────────────────────\n" +
    "How far SPY has dropped from the Day Open price (%).\n\n" +
    "Bear Trap thresholds:\n" +
    "  < 0.20% → too shallow, not a qualifying flush\n" +
    "  0.20–0.40% → moderate flush (standard Bear Trap)\n" +
    "  > 0.40% → strong flush (higher conviction trap)\n\n" +
    "Shown as negative (red) during flush, turns positive (green) on recovery.\n" +
    "Max flush depth is tracked and used in the EOD accuracy grade."
  );

  sheet.getRange(headerRow, BTC.VOL_SIGNAL).setNote(
    "📦 VOL SIGNAL\n─────────────────────\n" +
    "Today's volume vs. expected pace at this point in the session.\n\n" +
    "KEY TELL for Bear Trap:\n" +
    "  < 90% of pace during flush = WEAK VOLUME ⚠️\n" +
    "  This means the sell-off has no real conviction behind it.\n" +
    "  Institutions are NOT aggressively selling — retail is panicking.\n\n" +
    "🟡 Yellow = weak volume (Bear Trap signal)\n" +
    "🔴 Red = high volume (real selling — be cautious)\n\n" +
    "Weak volume during flush + flip = strongest Bear Trap signal."
  );

  sheet.getRange(headerRow, BTC.CONFIDENCE).setNote(
    "🎯 CONFIDENCE SCORE\n─────────────────────\n" +
    "0–100% score measuring how closely today matches the Bear Trap pattern.\n\n" +
    "Scoring breakdown:\n" +
    "  +20% — Qualifying flush exists (≥0.20%)\n" +
    "  +15% — Strong flush (≥0.40%)\n" +
    "  +15% — Volume weak during flush (< 90% pace)\n" +
    "  +15% — Price staying above key support (VWAP/PrevClose)\n" +
    "  +20% — Overnight high was tagged pre-market 🚨\n" +
    "  +15% — Momentum flip detected (first green tick)\n\n" +
    "Thresholds:\n" +
    "  75%+ = 🟢 Strong Bear Trap — consider entry\n" +
    "  50–74% = 🟡 Pattern forming — watch closely\n" +
    "  < 50% = 🔴 Not a clear Bear Trap"
  );

  sheet.getRange(headerRow, BTC.ENTRY_SIGNAL).setNote(
    "🚦 ENTRY SIGNAL\n─────────────────────\n" +
    "Actionable call option entry guidance.\n\n" +
    "⏳ WAIT          — Pattern not yet confirmed\n" +
    "🟡 FORMING        — Score 50%+, flush active, no flip yet\n" +
    "👀 WATCH          — Score 60%+, flip detected, waiting for price confirm\n" +
    "✅ BUY CALLS      — Score 75%+, flip confirmed, entry zone active\n" +
    "⚠️ MISSED         — Rip happened before flip signal caught it\n" +
    "❌ NOT TODAY      — Pattern does not match Bear Trap\n\n" +
    "NEVER buy calls during the FLUSH phase.\n" +
    "Entry is AFTER the flip is confirmed by price (see Target Price column)."
  );

  sheet.getRange(headerRow, BTC.TARGET_PRICE).setNote(
    "🏹 TARGET PRICE\n─────────────────────\n" +
    "The specific SPY price level to watch for call entry confirmation.\n\n" +
    "Calculated as: Flush Low + 0.10% buffer\n\n" +
    "HOW TO USE:\n" +
    "1. Wait for ENTRY SIGNAL to show 👀 WATCH or ✅ BUY CALLS\n" +
    "2. Watch for SPY price to cross ABOVE the Target Price\n" +
    "3. That cross confirms the flip is real, not a dead-cat bounce\n" +
    "4. Enter call options at or just above Target Price\n\n" +
    "The target updates dynamically as the flush deepens.\n" +
    "A deeper flush = lower target = more confirmation required before entry."
  );

  sheet.getRange(headerRow, BTC.OVERNIGHT).setNote(
    "🌙 OVERNIGHT DATA\n─────────────────────\n" +
    "Pre-market session context (4:00am–8:30am CST):\n\n" +
    "OH = Overnight High (highest pre-market price)\n" +
    "OL = Overnight Low (lowest pre-market price)\n" +
    "Δ OH = Current price distance from overnight high\n" +
    "Open gap = How far open was from overnight high\n\n" +
    "🚨 HIGH TAGGED = Price came within 0.15% of overnight high\n\n" +
    "WHY THIS MATTERS:\n" +
    "The Bear Trap almost always starts with price tagging or\n" +
    "nearly reaching the overnight high in pre-market, creating\n" +
    "FOMO. Then it flushes hard at open — trapping latecomers.\n\n" +
    "Overnight high tagged = +20% to confidence score."
  );

  sheet.getRange(headerRow, BTC.AI_MEMO).setNote(
    "🤖 AI MEMO\n─────────────────────\n" +
    "1-sentence Gemini AI commentary, updated every 5 minutes.\n\n" +
    "During active window (8:30–9:15 CST):\n" +
    "  Tells you current Bear Trap status and what to do right now.\n\n" +
    "At EOD (~3:00 CST):\n" +
    "  2-3 sentence accuracy brief: did the pattern play out,\n" +
    "  and which signal mattered most today.\n\n" +
    "Powered by Gemini 2.5 Flash (free tier).\n" +
    "Uses the same GEMINI_API_KEY as the main SPY Logger."
  );

  Logger.log("Bear Trap header notes added.");
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRY POINT — called from SPY TRACKER menu
// ─────────────────────────────────────────────────────────────
function setupBearTrapSheetFromMenu() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = setupBearTrapSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🪤 BEAR TRAP OPEN\n\n" +
    "✅ Sheet created and ready!\n\n" +
    "HOW IT WORKS:\n" +
    "• Activates automatically at 8:30 CST (market open)\n" +
    "• Tracks the morning flush pattern for 45 minutes\n" +
    "• AI updates every 5 min with 1-sentence status\n" +
    "• Issues ✅ BUY CALLS signal when pattern hits 75%+\n" +
    "• EOD brief fires at ~3:00 CST to grade the prediction\n\n" +
    "NO ADDITIONAL SETUP NEEDED.\n" +
    "It runs inside your existing 5-minute trigger."
  );
}
