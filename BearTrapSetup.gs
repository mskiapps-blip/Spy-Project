// ============================================================
// FILE: BearTrapSetup.gs
// PURPOSE: Creates and styles the 🪤 BEAR TRAP sheet.
//          Updated for new columns: TRAP ALERT, FLUSH SPEED,
//          VIX, ES FUTURES. Refined typography and layout.
//
//  FONT DESIGN:
//    Banner:  Georgia — elegant serif, great for display titles
//    Headers: Trebuchet MS — sharp, readable, modern feel
//    Data:    Arial — clean, crisp, easy to scan quickly
//    Alert:   Impact — maximum visual weight for the danger cell
// ============================================================

// ── TYPOGRAPHY ────────────────────────────────────────────────
var BT_FONT = {
  BANNER:  "Georgia",
  HEADER:  "Trebuchet MS",
  DATA:    "Arial",
  ALERT:   "Arial Black",   // bold sans for the alarm cell
  MONO:    "Roboto Mono"    // price/number cells — clean mono
};

// ── PALETTE ───────────────────────────────────────────────────
var BT_COLOR = {
  // Backgrounds
  BG_BANNER:   "#0f0000",   // near-black with red warmth
  BG_LEGEND:   "#130000",   // slightly lighter, warm dark
  BG_HEADER:   "#1c0505",   // header row — deep burgundy
  BG_ROW:      "#0a0a12",   // default data row — deep navy-black
  BG_ROW_ALT:  "#0d0d18",   // subtle zebra (every other row)

  // Row-level alert backgrounds
  BG_DANGER:   "#250000",   // dark red wash — DO NOT BUY PUTS
  BG_CAUTION:  "#1a1000",   // dark amber — stall / possible trap
  BG_READY:    "#001a08",   // dark green — flip / enter
  BG_GO:       "#002a0a",   // richer green — BUY CALLS / RIP

  // Row background aliases used by applyBearTrapRowFormat()
  ROW_EVEN:    "#0a0a12",   // same as BG_ROW
  ROW_ODD:     "#0d0d18",   // same as BG_ROW_ALT
  ROW_FLUSH:   "#250000",   // red — flushing / danger
  ROW_STALL:   "#1a1000",   // amber — stalling
  ROW_FLIP:    "#001a08",   // dark green — flip detected
  ROW_BUY:     "#002a0a",   // richer green — buy calls signal
  ROW_RIP:     "#003a0c",   // brightest green — ripping

  // Text
  TEXT_DIM:      "#7a7a9a",   // timestamps, quiet data
  TEXT_BASE:     "#d0d0e8",   // normal data
  TEXT_PRIMARY:  "#d0d0e8",   // alias for TEXT_BASE
  TEXT_SECONDARY:"#9090aa",   // subdued text
  TEXT_PRICE:    "#4fc3f7",   // SPY price — cool blue
  TEXT_RED:      "#ff5252",   // flush / danger
  TEXT_GOLD:     "#ffca28",   // warnings / stall
  TEXT_GREEN:    "#69f0ae",   // flip / go signal
  TEXT_BRIGHT:   "#ffffff",   // maximum contrast for alert cells

  // Header accent
  HDR_TEXT:    "#ff6b6b",   // header label color
  HDR_ACCENT:  "#ff8a80",   // lighter accent for subtext

  // Banner
  BAN_TEXT:    "#ff4444",
  BAN_SUB:     "#cc6633"
};

var BT_COL_WIDTHS = {
  1:  82,   // TIME
  2:  95,   // PRICE
  3:  235,  // TRAP ALERT — widest, most important
  4:  125,  // PHASE
  5:  105,  // FLUSH DEPTH
  6:  145,  // FLUSH SPEED
  7:  120,  // VOL SIGNAL
  8:  125,  // VIX
  9:  145,  // ES FUTURES
  10: 95,   // CONFIDENCE
  11: 215,  // ENTRY SIGNAL
  12: 115,  // TARGET PRICE
  13: 255,  // OVERNIGHT
  14: 360   // AI MEMO
};

function setupBearTrapSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_BEAR_TRAP);
  if (!sheet) sheet = ss.insertSheet(SHEET_BEAR_TRAP);

  sheet.setTabColor("#cc2200");

  if (sheet.getLastRow() > 0) {
    applyBearTrapColumnWidths(sheet);
    addBearTrapHeaderNotes(sheet);
    Logger.log("Bear Trap sheet already exists — widths refreshed.");
    return sheet;
  }

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.appendRow(["🪤  Bear Trap Open  ·  Pattern Confidence System  ·  Active 8:30 – 9:30 CST  ·  Closes early if invalidated"]);
  sheet.getRange(1, 1, 1, BT_HEADERS.length).merge()
    .setBackground(BT_COLOR.BG_BANNER)
    .setFontColor(BT_COLOR.BAN_TEXT)
    .setFontWeight("bold")
    .setFontSize(15)
    .setFontFamily(BT_FONT.BANNER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 42);

  // ── Row 2: Pattern legend ─────────────────────────────────
  sheet.appendRow(["The Pattern:  Overnight high tagged  →  Fast flush on weak volume  →  Stall  →  Flip  →  🚀 Rip.  Watch the 🚨 Trap Alert column — a red row means DO NOT BUY PUTS.  Window closes early on ES VOID or VIX FEAR."]);
  sheet.getRange(2, 1, 1, BT_HEADERS.length).merge()
    .setBackground(BT_COLOR.BG_LEGEND)
    .setFontColor(BT_COLOR.BAN_SUB)
    .setFontSize(9)
    .setFontFamily(BT_FONT.HEADER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setFontStyle("italic");
  sheet.setRowHeight(2, 22);

  // ── Row 3: Column headers ─────────────────────────────────
  sheet.appendRow(BT_HEADERS);
  sheet.getRange(3, 1, 1, BT_HEADERS.length)
    .setBackground(BT_COLOR.BG_HEADER)
    .setFontColor(BT_COLOR.HDR_TEXT)
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontFamily(BT_FONT.HEADER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(3, 30);

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
    "Active window: 8:30–9:30 CST.\n" +
    "Window may close early if ES VOID, VIX FEAR, or pattern fails.\n" +
    "Pre-open row appears before 8:30.\n" +
    "EOD Brief row appears at ~3:00pm CST."
  );

  sheet.getRange(h, BTC.PRICE).setNote(
    "💰 SPY PRICE\n─────────────────────\n" +
    "Current SPY price at this 5-min tick.\n\n" +
    "Watch for recovery toward/above the Day Open\n" +
    "after the morning flush — that's the trap springing."
  );

  sheet.getRange(h, BTC.TRAP_ALERT).setNote(
    "🚨 TRAP ALERT — Plain-English Status\n─────────────────────\n" +
    "The single most important column. One glance tells you\n" +
    "exactly what to do right now. No math, no interpretation.\n\n" +
    "DURING A FLUSH (confidence ≥50%):\n" +
    "  🚨 DO NOT BUY PUTS     — Row turns RED\n" +
    "     Bear Trap is forming. This flush is likely fake.\n" +
    "     Buying puts here is exactly what the trap wants.\n\n" +
    "  ⚠️ POSSIBLE TRAP        — Orange warning\n" +
    "     Early signal, not yet confirmed. Avoid puts.\n\n" +
    "STALL PHASE:\n" +
    "  ⚠️ STALL — DO NOT BUY PUTS\n" +
    "     Flush losing steam. Reversal is close. Stay patient.\n\n" +
    "AFTER FLIP:\n" +
    "  ⚡ FLIP DETECTED        — Row turns GOLD\n" +
    "     First green tick after flush. Watch the target price.\n\n" +
    "GO SIGNALS:\n" +
    "  ✅ ENTER CALLS NOW      — Row turns GREEN\n" +
    "     Score ≥75%, flip confirmed. Wait for Target Price cross.\n\n" +
    "  🚀 RIP CONFIRMED        — Bright green\n" +
    "     Pattern played. Manage your position.\n\n" +
    "INVALIDATION:\n" +
    "  🛑 INVALIDATED          — Dark red row\n" +
    "     ES VOID, VIX FEAR, or pattern collapsed.\n" +
    "     Window closed early. No trade today."
  );

  sheet.getRange(h, BTC.PHASE).setNote(
    "📍 PHASE\n─────────────────────\n" +
    "🌅 PRE-OPEN  — Before 8:30am CST\n" +
    "📉 FLUSH     — Red candles, price falling from open\n" +
    "⏸ STALL     — Flush losing momentum, volume drying up\n" +
    "⚡ FLIP      — First green tick after flush\n" +
    "🚀 RIP       — Confirmed reversal\n" +
    "🛑 INVALIDATED — Window closed early\n\n" +
    "STALL → FLIP is the entry zone. Never enter during FLUSH."
  );

  sheet.getRange(h, BTC.FLUSH_DEPTH).setNote(
    "📉 FLUSH DEPTH\n─────────────────────\n" +
    "How far SPY has dropped from its POST-OPEN LOCAL HIGH (%).\n\n" +
    "⚠️ NOT measured from day open — measured from the highest\n" +
    "price reached after 8:30am CST. This handles the common case\n" +
    "where SPY chops up for 10-15 min before the flush begins.\n\n" +
    "Example: Open $585.00 → chop to $585.80 → flush to $584.30\n" +
    "  Old system saw: −0.12% (too shallow, ignored ❌)\n" +
    "  New system sees: −0.26% from $585.80 (qualifying flush ✅)\n\n" +
    "Thresholds:\n" +
    "  < 0.20% → not qualifying\n" +
    "  0.20–0.40% → moderate Bear Trap flush\n" +
    "  > 0.40% → strong flush, higher conviction\n\n" +
    "Local high locks in once the flush begins — price recovering\n" +
    "does not reset the anchor."
  );

  sheet.getRange(h, BTC.FLUSH_SPEED).setNote(
    "⚡ FLUSH SPEED\n─────────────────────\n" +
    "How fast the flush happened, measured as % drop per 5-min bar.\n\n" +
    "⚠️ Timing starts when the flush BEGINS (from the local high),\n" +
    "NOT from the 8:30am CST open. A 15-min pre-flush chop does not\n" +
    "dilute this reading.\n\n" +
    "⚡ FAST   ≥0.15%/bar — Panic selling, retail stops hit.\n" +
    "              Institutions not involved. Strongest trap signal.\n" +
    "              +10% confidence.\n\n" +
    "📊 MODERATE  0.05–0.15%/bar — Normal flush, watch carefully.\n\n" +
    "🐌 SLOW   <0.05%/bar — Grinding lower. Could be real selling.\n" +
    "              Be cautious, reduce position size.\n\n" +
    "Bear Traps flush HARD and FAST then stop abruptly.\n" +
    "Real distribution grinds with sustained pressure."
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
    "                        through. −15% confidence penalty.\n" +
    "                        ⚠️ Also triggers early window invalidation.\n\n" +
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
    "🛑 FADING HARD (>1%) — ES VOID. Real distribution.\n" +
    "              Triggers early window invalidation. Skip today.\n\n" +
    "The ideal Bear Trap setup: ES tagged overnight high,\n" +
    "then FADING before 8:30am CST open."
  );

  sheet.getRange(h, BTC.CONFIDENCE).setNote(
    "🎯 CONFIDENCE SCORE (0–100%)\n─────────────────────\n" +
    "Composite score measuring how closely today matches the pattern.\n\n" +
    "SCORING:\n" +
    "  +20% Overnight high tagged\n" +
    "  +15% Flush exists (≥0.20%)\n" +
    "  +15% Flush was FAST (≥0.15%/bar)\n" +
    "  +15% Momentum flip detected\n" +
    "  +15% Volume weak during flush\n" +
    "  +10% Strong flush (≥0.40%)\n" +
    "  +10% Rip confirmed\n" +
    "  +10% VIX in NORMAL regime (15–22)\n" +
    "  +10% ES Futures FADING\n" +
    "  −10% ES CAUTION (futures climbing)\n" +
    "  −20% VIX in FEAR regime (>28)\n" +
    "  −30% ES VOID (fading hard >1%)\n\n" +
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
    "❌ NOT TODAY  — No matching pattern\n" +
    "❌ NO TRADE TODAY — Window invalidated early\n\n" +
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
    "OH tagged = +20% confidence."
  );

  sheet.getRange(h, BTC.AI_MEMO).setNote(
    "🤖 AI MEMO\n─────────────────────\n" +
    "Gemini AI commentary — fires ONLY on meaningful events:\n" +
    "  • Phase change (FLUSH→STALL→FLIP→RIP)\n" +
    "  • Confidence crosses 50% or 75%\n" +
    "  • BUY CALLS signal issued\n" +
    "  • First tick of session\n\n" +
    "Budget: max 10 calls during active window + 1 EOD brief.\n" +
    "Silent ticks = nothing changed worth noting.\n\n" +
    "EOD row shows total AI calls used that day."
  );

  Logger.log("Bear Trap header notes added.");
}

function setupBearTrapSheetFromMenu() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = setupBearTrapSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🪤 Bear Trap Open\n\n" +
    "✅ Sheet created and styled!\n\n" +
    "What's included:\n" +
    "• 🚨 Trap Alert — plain-English signal, loudest column\n" +
    "• 😨 VIX regime check (NORMAL = +10% confidence)\n" +
    "• 📡 ES Futures trend (FADING = +10% confidence)\n" +
    "• ⚡ Flush speed scoring (FAST = +15% confidence)\n" +
    "• 🤖 AI memos fire only on phase changes (saves quota)\n" +
    "• 🛑 Early invalidation on ES VOID or VIX FEAR\n\n" +
    "Active: 8:30–9:30am CST  ·  EOD brief: 3:00pm CST\n" +
    "Window closes early if ES fades hard, VIX > 28, or pattern fails.\n" +
    "Runs inside your existing 5-minute trigger."
  );
}
