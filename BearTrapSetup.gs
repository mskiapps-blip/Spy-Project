// ============================================================
// FILE: BearTrapSetup.gs
// PURPOSE: Creates and styles the 🪤 BEAR TRAP sheet.
//          Updated for new columns: FLUSH SPEED, VIX, ES FUTURES.
// ============================================================

var BT_COL_WIDTHS = {
  1:  80,   // TIME
  2:  90,   // PRICE
  3:  130,  // PHASE
  4:  100,  // FLUSH DEPTH
  5:  140,  // FLUSH SPEED (NEW)
  6:  120,  // VOL SIGNAL
  7:  120,  // VIX (NEW)
  8:  140,  // ES FUTURES (NEW)
  9:  100,  // CONFIDENCE
  10: 220,  // ENTRY SIGNAL
  11: 110,  // TARGET PRICE
  12: 260,  // OVERNIGHT
  13: 380   // AI MEMO
};

function setupBearTrapSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_BEAR_TRAP);
  if (!sheet) sheet = ss.insertSheet(SHEET_BEAR_TRAP);

  sheet.setTabColor("#ff4444");

  if (sheet.getLastRow() > 0) {
    applyBearTrapColumnWidths(sheet);
    addBearTrapHeaderNotes(sheet);
    Logger.log("Bear Trap sheet already exists — widths refreshed.");
    return sheet;
  }

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.appendRow(["🪤  B E A R   T R A P   O P E N   |   Pattern Confidence System   |   Active: 8:30–9:15 CST"]);
  sheet.getRange(1, 1, 1, BT_HEADERS.length).merge()
    .setBackground("#1a0000").setFontColor("#ff4444")
    .setFontWeight("bold").setFontSize(13).setFontFamily("Courier New")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  // ── Row 2: Pattern legend ─────────────────────────────────
  sheet.appendRow(["THE PATTERN: Overnight high tagged → Open flushes red (0.3–0.8%) FAST on weak volume → Stalls → Momentum flip → 🚀 Rip. VIX 15–22 + ES FADING = highest confidence."]);
  sheet.getRange(2, 1, 1, BT_HEADERS.length).merge()
    .setBackground("#0d0d0d").setFontColor("#ff9944")
    .setFontSize(9).setFontFamily("Courier New")
    .setHorizontalAlignment("left").setVerticalAlignment("middle")
    .setFontStyle("italic");
  sheet.setRowHeight(2, 22);

  // ── Row 3: Column headers ─────────────────────────────────
  sheet.appendRow(BT_HEADERS);
  sheet.getRange(3, 1, 1, BT_HEADERS.length)
    .setBackground("#1a0a0a").setFontColor("#ff4444")
    .setFontWeight("bold").setFontSize(10).setFontFamily("Courier New")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(3, 28);

  sheet.setFrozenRows(3);
  applyBearTrapColumnWidths(sheet);
  addBearTrapHeaderNotes(sheet);

  Logger.log("Bear Trap sheet setup complete.");
  return sheet;
}

function applyBearTrapColumnWidths(sheet) {
  for (var col in BT_COL_WIDTHS) {
    sheet.setColumnWidth(parseInt(col), BT_COL_WIDTHS[col]);
  }
}

function addBearTrapHeaderNotes(sheet) {
  var h = 3; // header row

  sheet.getRange(h, BTC.TIME).setNote(
    "⏱ TIME (CST)\n─────────────────────\n" +
    "Tick time in Central Standard Time (12-hour format).\n\n" +
    "Active window: 8:30–9:15 CST.\n" +
    "Pre-open row appears before 8:30.\n" +
    "EOD Brief row appears at ~3:00 CST."
  );

  sheet.getRange(h, BTC.PRICE).setNote(
    "💰 SPY PRICE\n─────────────────────\n" +
    "Current SPY price at this 5-min tick.\n\n" +
    "Watch for recovery toward/above the Day Open\n" +
    "after the morning flush — that's the trap springing."
  );

  sheet.getRange(h, BTC.PHASE).setNote(
    "📍 PHASE\n─────────────────────\n" +
    "🌅 PRE-OPEN  — Before 8:30 CST\n" +
    "📉 FLUSH     — Red candles, price falling from open\n" +
    "⏸ STALL     — Flush losing momentum, volume drying up\n" +
    "⚡ FLIP      — First green tick after flush\n" +
    "🚀 RIP       — Confirmed reversal\n\n" +
    "STALL → FLIP is the entry zone. Never enter during FLUSH."
  );

  sheet.getRange(h, BTC.FLUSH_DEPTH).setNote(
    "📉 FLUSH DEPTH\n─────────────────────\n" +
    "How far SPY has dropped from the Day Open (%).\n\n" +
    "  < 0.20% → too shallow, not qualifying\n" +
    "  0.20–0.40% → moderate Bear Trap flush\n" +
    "  > 0.40% → strong flush, higher conviction\n\n" +
    "Negative = below open. Positive = recovering."
  );

  sheet.getRange(h, BTC.FLUSH_SPEED).setNote(
    "⚡ FLUSH SPEED\n─────────────────────\n" +
    "How fast the flush happened, measured as % drop per 5-min bar.\n\n" +
    "⚡ FAST   ≥0.15%/bar — Panic selling, not real distribution.\n" +
    "              Retail stops being hit. Institutions not involved.\n" +
    "              STRONGEST Bear Trap signal. +10% confidence.\n\n" +
    "📊 MODERATE  0.05–0.15%/bar — Normal flush, watch carefully.\n\n" +
    "🐌 SLOW   <0.05%/bar — Grinding, could be real selling.\n" +
    "              Bears have more control. Be cautious.\n\n" +
    "WHY IT MATTERS:\n" +
    "Bear Traps flush HARD and FAST then stop abruptly.\n" +
    "Real distribution grinds lower with sustained pressure."
  );

  sheet.getRange(h, BTC.VOL_SIGNAL).setNote(
    "📦 VOL SIGNAL\n─────────────────────\n" +
    "Volume vs expected pace at this point in session.\n\n" +
    "KEY TELL: < 90% of pace during flush = weak volume.\n" +
    "Institutions are NOT selling — retail is panicking.\n\n" +
    "🟡 Yellow = weak vol (Bear Trap signal) +10% confidence\n" +
    "🔴 Red    = heavy vol (real selling — be cautious)"
  );

  sheet.getRange(h, BTC.VIX).setNote(
    "😨 VIX\n─────────────────────\n" +
    "CBOE Volatility Index at this tick + regime classification.\n\n" +
    "VIX REGIMES for Bear Trap confidence:\n\n" +
    "🟢 LOW      VIX < 15  — Complacency. Traps form but\n" +
    "                        flush may be shallow.\n\n" +
    "🟢 NORMAL   VIX 15–22 — SWEET SPOT. This is where Bear\n" +
    "                        Traps are most reliable. +10% confidence.\n\n" +
    "🟡 ELEVATED VIX 22–28 — Nervous market. Traps still happen\n" +
    "                        but flush can overshoot. Neutral.\n\n" +
    "🔴 FEAR     VIX > 28  — Real fear. Morning flush may follow\n" +
    "                        through. −15% confidence penalty.\n\n" +
    "Rule: If VIX spikes above 28 overnight, skip the setup."
  );

  sheet.getRange(h, BTC.ES_TREND).setNote(
    "📡 ES FUTURES\n─────────────────────\n" +
    "S&P 500 E-mini futures (ES=F) price and trend direction.\n\n" +
    "ES TREND for Bear Trap confidence:\n\n" +
    "🟢 FADING   — ES rolling over from overnight high.\n" +
    "              Classic Bear Trap setup: futures peak → fade\n" +
    "              → SPY opens and flushes retail stops.\n" +
    "              +15% confidence.\n\n" +
    "🟡 FLAT     — ES consolidating. Neutral signal.\n\n" +
    "🔴 CLIMBING — ES still pushing up. If futures are rising,\n" +
    "              the flush may not be a trap — it could be\n" +
    "              real profit-taking or a trend continuation.\n" +
    "              −10% confidence penalty.\n\n" +
    "The ideal Bear Trap setup: ES tagged overnight high,\n" +
    "then FADING before 8:30 CST open."
  );

  sheet.getRange(h, BTC.CONFIDENCE).setNote(
    "🎯 CONFIDENCE SCORE (0–100%)\n─────────────────────\n" +
    "Composite score measuring how closely today matches the pattern.\n\n" +
    "SCORING:\n" +
    "  +15% Flush exists (≥0.20%)\n" +
    "  +10% Strong flush (≥0.40%)\n" +
    "  +10% Volume weak during flush\n" +
    "  +10% Price above key support\n" +
    "  +15% Overnight high tagged\n" +
    "  +10% Momentum flip detected\n" +
    "  +10% VIX in NORMAL regime (15–22)\n" +
    "  +15% ES Futures FADING\n" +
    "  +10% Flush was FAST (≥0.15%/bar)\n" +
    "  −15% VIX in FEAR regime (>28)\n" +
    "  −10% ES Futures CLIMBING\n\n" +
    "THRESHOLDS:\n" +
    "  ≥75% → ✅ BUY CALLS signal\n" +
    "  50–74% → 🟡 Forming, watch only\n" +
    "  <50% → ❌ Not a trap day"
  );

  sheet.getRange(h, BTC.ENTRY_SIGNAL).setNote(
    "🚦 ENTRY SIGNAL\n─────────────────────\n" +
    "⏳ WAIT       — Pattern not confirmed\n" +
    "🟡 FORMING    — Score ≥50%, flush active\n" +
    "👀 WATCH      — Score ≥60%, flip detected\n" +
    "✅ BUY CALLS  — Score ≥75%, flip confirmed\n" +
    "⚠️ MISSED      — Rip without clean flip signal\n" +
    "❌ NOT TODAY  — No matching pattern\n\n" +
    "NEVER buy calls during FLUSH phase.\n" +
    "Wait for the flip + price to clear Target Price."
  );

  sheet.getRange(h, BTC.TARGET_PRICE).setNote(
    "🏹 TARGET PRICE\n─────────────────────\n" +
    "Specific SPY price to cross before entering calls.\n\n" +
    "Formula: Flush Low + 0.10% buffer\n\n" +
    "1. Wait for ✅ BUY CALLS or 👀 WATCH signal\n" +
    "2. Watch for SPY to cross ABOVE this price\n" +
    "3. That cross = flip is confirmed, not a dead-cat\n" +
    "4. Enter call options at or just above Target\n\n" +
    "Updates dynamically as flush deepens."
  );

  sheet.getRange(h, BTC.OVERNIGHT).setNote(
    "🌙 OVERNIGHT DATA\n─────────────────────\n" +
    "Pre-market session context (4:00am–8:30am CST):\n\n" +
    "OH = Overnight High\n" +
    "OL = Overnight Low\n" +
    "Δ OH = Distance from overnight high\n" +
    "Gap = Open price gap from overnight high\n\n" +
    "🚨 = Price came within 0.15% of overnight high\n\n" +
    "Bear Trap almost always starts with OH tagged.\n" +
    "OH tagged = +15% confidence."
  );

  sheet.getRange(h, BTC.AI_MEMO).setNote(
    "🤖 AI MEMO\n─────────────────────\n" +
    "Gemini AI commentary — fires ONLY on meaningful events:\n" +
    "  • Phase change (FLUSH→STALL→FLIP→RIP)\n" +
    "  • Confidence crosses 50% or 75%\n" +
    "  • BUY CALLS signal issued\n" +
    "  • First tick of session\n\n" +
    "Budget: max 8 calls during active window + 1 EOD brief.\n" +
    "Silent ticks = nothing changed worth noting.\n\n" +
    "EOD row shows total AI calls used that day."
  );

  Logger.log("Bear Trap header notes added.");
}

function setupBearTrapSheetFromMenu() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = setupBearTrapSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🪤 BEAR TRAP OPEN\n\n" +
    "✅ Sheet ready!\n\n" +
    "NEW in this version:\n" +
    "• 😨 VIX regime check (NORMAL = +10% confidence)\n" +
    "• 📡 ES Futures trend (FADING = +15% confidence)\n" +
    "• ⚡ Flush speed scoring (FAST = +10% confidence)\n" +
    "• 🤖 AI only fires on phase changes (saves quota)\n\n" +
    "Active: 8:30–9:15 CST  |  EOD brief: 3:00 CST\n" +
    "Runs inside your existing 5-minute trigger."
  );
}
