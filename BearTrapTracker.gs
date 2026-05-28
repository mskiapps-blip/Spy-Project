// ============================================================
// FILE: BearTrapTracker.gs
// PURPOSE: 🪤 THE BEAR TRAP OPEN — pattern detection system.
//
//  Detects the classic SPY morning pattern:
//    1. Overnight high tagged in pre-market
//    2. Flush down in first 15-30 min after open (8:30 CST)
//    3. Flush stalls — low volume, momentum dies
//    4. Rocket reversal up — the TRAP springs
//
//  Active window:  8:30–9:15 CST (first 45 min of session)
//  AI memo:        1 sentence per 5 min — ONLY on phase change
//                  or confidence threshold cross. Silent otherwise.
//                  Free tier budget: max ~9 calls/day total.
//  EOD brief:      Fires once at ~3:00 CST. Logs to SCORECARD.
//
//  NEW in this version:
//    • VIX regime check (LOW/NORMAL/ELEVATED/FEAR)
//    • ES Futures trend (FADING/FLAT/CLIMBING)
//    • Flush speed scoring (fast flush = stronger trap signal)
//    • Win/Loss scorecard (📊 SCORECARD sheet)
//    • AI only fires on meaningful state changes — not every tick
//
//  All times in CST 12-hour format.
// ============================================================

var SHEET_BEAR_TRAP = "🪤 BEAR TRAP";

// ─────────────────────────────────────────────────────────────
// TIMING CONSTANTS — all in CST
// ─────────────────────────────────────────────────────────────
var BT = {
  OPEN_HOUR:          8,
  OPEN_MIN:           30,
  ACTIVE_END_HOUR:    9,
  ACTIVE_END_MIN:     15,
  EOD_HOUR:           15,
  EOD_MIN:            0,
  EOD_WINDOW_MIN:     10,

  // ── Pattern thresholds ────────────────────────────────────
  FLUSH_MIN_PCT:      0.20,
  FLUSH_STRONG_PCT:   0.40,
  VOLUME_WEAK_PCT:    90,
  MOMENTUM_FLIP_PCT:  0.05,
  OVERNIGHT_TAG_PCT:  0.15,
  CALL_CONFIRM_PCT:   0.10,

  // ── Flush speed thresholds (% drop per 5-min bar) ─────────
  // Fast flush = price drops hard in 1-2 bars then stalls
  // Slow grind = price bleeds for 4-6 bars (less trap-like)
  FLUSH_FAST_PCT_PER_BAR:  0.15, // ≥0.15%/bar = fast (strong trap signal)
  FLUSH_SLOW_PCT_PER_BAR:  0.05, // <0.05%/bar = slow grind (weaker signal)

  // ── VIX regime weights ────────────────────────────────────
  // Added to confidence when VIX is in the Bear Trap sweet spot
  SCORE_VIX_NORMAL:   10, // VIX 15-22: ideal trap conditions
  // ELEVATED (22-28): neutral, no bonus — traps still happen but riskier
  // FEAR (>28): subtract from confidence — real selling more likely
  SCORE_VIX_FEAR:    -15, // VIX >28: penalize — not a trap day

  // ── ES Futures weights ────────────────────────────────────
  SCORE_ES_FADING:    15, // ES fading from overnight high = trap setup
  SCORE_ES_CLIMBING: -10, // ES still climbing = flush may follow through

  // ── Flush speed weights ───────────────────────────────────
  SCORE_FLUSH_FAST:   10, // fast flush = panic, not real selling
  // Slow flush: no bonus — neutral

  // ── Original weights (rebalanced to keep max=100) ─────────
  SCORE_FLUSH_EXISTS:  15,
  SCORE_FLUSH_STRONG:  10,
  SCORE_VOL_WEAK:      10,
  SCORE_ABOVE_SUPPORT: 10,
  SCORE_OVERNIGHT_TAG: 15,
  SCORE_MOMENTUM_FLIP: 10

  // ── Max possible score breakdown ──────────────────────────
  // Flush exists:    15
  // Flush strong:    10
  // Vol weak:        10
  // Above support:   10
  // Overnight tag:   15
  // Momentum flip:   10
  // VIX normal:      10
  // ES fading:       15
  // Flush fast:      10
  // ─────────────────
  // Max raw:        105  (intentionally slightly over 100 so
  //                       multiple strong signals push past 75%
  //                       threshold cleanly)
};

// ─────────────────────────────────────────────────────────────
// BEAR TRAP COLUMNS
// NEW: VIX and ES columns added (shifted AI_MEMO right)
// ─────────────────────────────────────────────────────────────
var BTC = {
  TIME:           1,  // A
  PRICE:          2,  // B
  PHASE:          3,  // C
  FLUSH_DEPTH:    4,  // D
  FLUSH_SPEED:    5,  // E — NEW: fast/slow/grinding
  VOL_SIGNAL:     6,  // F
  VIX:            7,  // G — NEW: VIX level + regime
  ES_TREND:       8,  // H — NEW: ES futures trend
  CONFIDENCE:     9,  // I
  ENTRY_SIGNAL:   10, // J
  TARGET_PRICE:   11, // K
  OVERNIGHT:      12, // L
  AI_MEMO:        13  // M
};

var BT_HEADERS = [
  "⏱ TIME (CST)",
  "💰 SPY PRICE",
  "📍 PHASE",
  "📉 FLUSH DEPTH",
  "⚡ FLUSH SPEED",
  "📦 VOL SIGNAL",
  "😨 VIX",
  "📡 ES FUTURES",
  "🎯 CONFIDENCE",
  "🚦 ENTRY SIGNAL",
  "🏹 TARGET PRICE",
  "🌙 OVERNIGHT",
  "🤖 AI MEMO"
];

// Phase labels
var PHASE = {
  PRE_OPEN: "🌅 PRE-OPEN",
  FLUSH:    "📉 FLUSH",
  STALL:    "⏸ STALL",
  FLIP:     "⚡ FLIP",
  RIP:      "🚀 RIP",
  POST:     "➡️ POST-WINDOW",
  CLOSED:   "🔒 CLOSED"
};

// ─────────────────────────────────────────────────────────────
// AI USAGE BUDGET
// Free tier Gemini: ~1500 requests/day, 1M tokens/day.
// We target max 9 AI calls per trading day:
//   • Up to 8 during active window (phase-change gated, not every tick)
//   • 1 EOD brief
// Gate: only fire when phase changes OR confidence crosses a threshold.
// This means silent ticks where nothing meaningful changed.
// ─────────────────────────────────────────────────────────────
var AI_PHASE_CHANGE_GATE = true; // set false to revert to every-tick AI

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY — called from runEvery5Minutes() in Code.gs
// ─────────────────────────────────────────────────────────────
function runBearTrapTick(data, now) {
  try {
    var cst = toCSTDate(now);
    var ss  = SpreadsheetApp.getActiveSpreadsheet();

    var sheet = ss.getSheetByName(SHEET_BEAR_TRAP);
    if (!sheet) {
      setupBearTrapSheet(ss);
      sheet = ss.getSheetByName(SHEET_BEAR_TRAP);
    }

    var cstHour  = cst.getHours();
    var cstMin   = cst.getMinutes();
    var totalMin = cstHour * 60 + cstMin;

    var openMin      = BT.OPEN_HOUR * 60 + BT.OPEN_MIN;
    var activeEndMin = BT.ACTIVE_END_HOUR * 60 + BT.ACTIVE_END_MIN;
    var eodMin       = BT.EOD_HOUR * 60 + BT.EOD_MIN;

    // ── EOD Brief ─────────────────────────────────────────────
    if (totalMin >= eodMin && totalMin <= eodMin + BT.EOD_WINDOW_MIN) {
      var eodFired = getFlag("BT_EOD_FIRED_TODAY");
      var todayStr = Utilities.formatDate(cst, "America/Chicago", "yyyy-MM-dd");
      if (eodFired !== todayStr) {
        writeEODBrief(sheet, data, cst);
        setFlag("BT_EOD_FIRED_TODAY", todayStr);
      }
      return;
    }

    // ── Pre-open panel (before 8:30 CST) ─────────────────────
    if (totalMin < openMin) {
      if (data) updatePreOpenPanel(sheet, data, cst);
      return;
    }

    // ── Outside active window (after 9:15 CST) ───────────────
    if (totalMin > activeEndMin) return;

    if (!data) return;

    // ── Fetch VIX + ES (cached — no extra quota per tick) ────
    var vixData = fetchVIX();
    var esData  = fetchESFutures();

    // ── Compute metrics ───────────────────────────────────────
    var metrics = computeBearTrapMetrics(data, cst, vixData, esData);

    // ── AI memo — gated to save quota ────────────────────────
    var aiMemo = null;
    if (shouldFireAI(metrics)) {
      aiMemo = getBearTrapAIMemo(metrics, data, vixData, esData, cst);
    }

    // ── Build row ─────────────────────────────────────────────
    var timeStr  = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();

    var flushStr = metrics.flushDepthPct !== 0
      ? (metrics.flushDepthPct < 0 ? "" : "+") + metrics.flushDepthPct.toFixed(2) + "%"
      : "—";

    var flushSpeedStr = metrics.flushSpeedStr || "—";

    var volStr = metrics.volPct > 0
      ? metrics.volPct.toFixed(0) + "% of pace"
      : "—";

    var vixStr = vixData
      ? vixData.price.toFixed(2) + " [" + vixData.regime + "]"
      : "—";

    var esStr = esData
      ? "$" + esData.price.toFixed(2) + " " + esData.trend
      : "—";

    var confStr   = Math.min(metrics.confidence, 100) + "%";
    var targetStr = metrics.targetPrice ? "$" + metrics.targetPrice.toFixed(2) : "—";

    var row = [
      timeStr,
      data.price,
      metrics.phase,
      flushStr,
      flushSpeedStr,
      volStr,
      vixStr,
      esStr,
      confStr,
      metrics.entrySignal,
      targetStr,
      metrics.overnightStr || "—",
      aiMemo || ""
    ];

    sheet.appendRow(row);
    var newRow = sheet.getLastRow();
    applyBearTrapRowFormat(sheet, newRow, metrics, vixData, esData);

    Logger.log("BearTrap tick: phase=" + metrics.phase +
               " conf=" + metrics.confidence + "%" +
               " vix=" + (vixData ? vixData.regime : "n/a") +
               " es=" + (esData ? esData.trend : "n/a"));

  } catch (e) {
    Logger.log("runBearTrapTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// AI GATE — only fire Gemini when something meaningful changed.
// Saves ~60-70% of AI calls vs every-tick firing.
//
// Fires when:
//   1. Phase just changed (FLUSH→STALL, STALL→FLIP, FLIP→RIP)
//   2. Confidence just crossed a threshold (50%, 75%)
//   3. Entry signal just upgraded to BUY CALLS
//   4. First tick of the session (initial read)
// ─────────────────────────────────────────────────────────────
function shouldFireAI(metrics) {
  if (!AI_PHASE_CHANGE_GATE) return true; // bypass gate if disabled

  var lastPhase    = getFlag("BT_LAST_AI_PHASE")      || "";
  var lastConfBand = getFlag("BT_LAST_AI_CONF_BAND")  || "0";
  var lastSignal   = getFlag("BT_LAST_AI_SIGNAL")     || "";
  var aiCallCount  = parseInt(getFlag("BT_AI_CALL_COUNT") || "0");

  // Hard cap: max 8 AI calls during active window
  if (aiCallCount >= 8) {
    Logger.log("AI gate: daily cap reached (" + aiCallCount + ")");
    return false;
  }

  var currentConfBand = metrics.confidence >= 75 ? "HIGH"
                      : metrics.confidence >= 50 ? "MID"
                      : "LOW";

  var fire = false;
  var reason = "";

  // Phase changed
  if (metrics.phase !== lastPhase) {
    fire = true; reason = "phase change: " + lastPhase + " → " + metrics.phase;
  }
  // Confidence band crossed upward
  else if (currentConfBand !== lastConfBand &&
           (currentConfBand === "MID" || currentConfBand === "HIGH")) {
    fire = true; reason = "conf band: " + lastConfBand + " → " + currentConfBand;
  }
  // Entry signal upgraded to BUY CALLS
  else if (metrics.entrySignal.indexOf("BUY CALLS") !== -1 &&
           lastSignal.indexOf("BUY CALLS") === -1) {
    fire = true; reason = "entry signal: BUY CALLS issued";
  }
  // First tick of session (no phase stored yet)
  else if (lastPhase === "") {
    fire = true; reason = "first tick of session";
  }

  if (fire) {
    setFlag("BT_LAST_AI_PHASE",     metrics.phase);
    setFlag("BT_LAST_AI_CONF_BAND", currentConfBand);
    setFlag("BT_LAST_AI_SIGNAL",    metrics.entrySignal);
    setFlag("BT_AI_CALL_COUNT",     (aiCallCount + 1).toString());
    Logger.log("AI gate: FIRING (" + reason + ") call #" + (aiCallCount + 1));
  } else {
    Logger.log("AI gate: silent tick (phase=" + metrics.phase +
               " conf=" + metrics.confidence + "%)");
  }

  return fire;
}

// ─────────────────────────────────────────────────────────────
// COMPUTE ALL BEAR TRAP METRICS
// ─────────────────────────────────────────────────────────────
function computeBearTrapMetrics(data, cst, vixData, esData) {
  var price     = data.price;
  var prevClose = data.prevClose || price;
  var dayOpen   = parseFloat(getFlag("BT_DAY_OPEN"))     || 0;
  var flushLow  = parseFloat(getFlag("BT_FLUSH_LOW"))    || 0;
  var flipDetected = getFlag("BT_FLIP_DETECTED") === "YES";
  var ripDetected  = getFlag("BT_RIP_DETECTED")  === "YES";

  if (dayOpen === 0) {
    dayOpen = price;
    setFlag("BT_DAY_OPEN", dayOpen);
    setFlag("BT_OPEN_TIME_MIN", (cst.getHours() * 60 + cst.getMinutes()).toString());
  }

  // Session high/low tracking
  var sessionHigh = parseFloat(getFlag("BT_SESSION_HIGH")) || price;
  var sessionLow  = parseFloat(getFlag("BT_SESSION_LOW"))  || price;
  if (price > sessionHigh) { sessionHigh = price; setFlag("BT_SESSION_HIGH", sessionHigh); }
  if (price < sessionLow || sessionLow === 0) { sessionLow = price; setFlag("BT_SESSION_LOW", sessionLow); }

  // ── Flush depth ───────────────────────────────────────────
  var flushDepthPct = dayOpen > 0 ? Math.round(((price - dayOpen) / dayOpen) * 10000) / 100 : 0;
  var maxFlushPct   = parseFloat(getFlag("BT_MAX_FLUSH_PCT")) || 0;

  if (flushDepthPct < maxFlushPct) {
    maxFlushPct = flushDepthPct;
    setFlag("BT_MAX_FLUSH_PCT", maxFlushPct);
    setFlag("BT_FLUSH_LOW", price);
    flushLow = price;
  }

  // ── Flush speed ───────────────────────────────────────────
  // Track how fast the flush happened: % drop per bar elapsed since open
  var openTimeMins = parseInt(getFlag("BT_OPEN_TIME_MIN") || "0");
  var nowMins      = cst.getHours() * 60 + cst.getMinutes();
  var barsElapsed  = Math.max(1, Math.round((nowMins - openTimeMins) / 5));
  var flushPctPerBar = barsElapsed > 0 ? Math.abs(maxFlushPct) / barsElapsed : 0;

  var flushSpeedStr;
  var flushFast = false;
  if (Math.abs(maxFlushPct) < BT.FLUSH_MIN_PCT) {
    flushSpeedStr = "—";
  } else if (flushPctPerBar >= BT.FLUSH_FAST_PCT_PER_BAR) {
    flushSpeedStr = "⚡ FAST (" + flushPctPerBar.toFixed(2) + "%/bar)";
    flushFast = true;
  } else if (flushPctPerBar >= BT.FLUSH_SLOW_PCT_PER_BAR) {
    flushSpeedStr = "📊 MODERATE (" + flushPctPerBar.toFixed(2) + "%/bar)";
  } else {
    flushSpeedStr = "🐌 SLOW (" + flushPctPerBar.toFixed(2) + "%/bar)";
  }

  // ── Volume vs pace ────────────────────────────────────────
  var cstHour    = cst.getHours();
  var cstMin     = cst.getMinutes();
  var elapsedMin = (cstHour * 60 + cstMin) - (BT.OPEN_HOUR * 60 + BT.OPEN_MIN);
  var dayFrac    = Math.max(0.02, elapsedMin / 390);
  var expectedV  = data.avgVol30 > 0 ? data.avgVol30 * dayFrac : 0;
  var volPct     = expectedV > 0 ? (data.volumeToday / expectedV) * 100 : 0;

  // ── Overnight data ────────────────────────────────────────
  var overnightHigh = parseFloat(getFlag("BT_OVERNIGHT_HIGH")) || 0;
  var overnightLow  = parseFloat(getFlag("BT_OVERNIGHT_LOW"))  || 0;
  var overnightStr  = buildOvernightStr(price, overnightHigh, overnightLow, dayOpen);

  // ── Flip / rip detection ──────────────────────────────────
  var prevPrice = parseFloat(getFlag("PREV_PRICE")) || 0;
  var tickPct   = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

  var flushExists = Math.abs(maxFlushPct) >= BT.FLUSH_MIN_PCT;
  var flushStrong = Math.abs(maxFlushPct) >= BT.FLUSH_STRONG_PCT;

  if (!flipDetected && flushExists && tickPct >= BT.MOMENTUM_FLIP_PCT && price < dayOpen) {
    flipDetected = true;
    setFlag("BT_FLIP_DETECTED", "YES");
    setFlag("BT_FLIP_PRICE", price.toString());
    setFlag("BT_FLIP_TIME", Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase());
  }

  if (!ripDetected && flipDetected) {
    var flipPrice = parseFloat(getFlag("BT_FLIP_PRICE")) || 0;
    if (flipPrice > 0 && price > flipPrice * 1.002) {
      ripDetected = true;
      setFlag("BT_RIP_DETECTED", "YES");
    }
  }

  // ── Phase ─────────────────────────────────────────────────
  var phase;
  if (ripDetected) {
    phase = PHASE.RIP;
  } else if (flipDetected) {
    phase = PHASE.FLIP;
  } else if (flushExists) {
    var recentTicks = getFlag("BT_RECENT_TICKS") || "";
    var tickArr = recentTicks.length > 0
      ? recentTicks.split(",").map(parseFloat).filter(function(v) { return !isNaN(v); })
      : [];
    tickArr.push(tickPct);
    if (tickArr.length > 4) tickArr = tickArr.slice(-4);
    setFlag("BT_RECENT_TICKS", tickArr.join(","));
    var avgTick = tickArr.reduce(function(a, b) { return a + b; }, 0) / tickArr.length;
    phase = (avgTick > -0.02 && avgTick < 0.05) ? PHASE.STALL : PHASE.FLUSH;
  } else {
    phase = PHASE.FLUSH;
  }

  // ── Confidence score ──────────────────────────────────────
  var score = 0;

  // Original signals
  if (flushExists)  score += BT.SCORE_FLUSH_EXISTS;
  if (flushStrong)  score += BT.SCORE_FLUSH_STRONG;
  if (volPct > 0 && volPct < BT.VOLUME_WEAK_PCT) score += BT.SCORE_VOL_WEAK;

  var vwap       = data.vwap || 0;
  var keySupport = Math.max(prevClose, vwap > 0 ? vwap : 0);
  if (keySupport > 0 && price >= keySupport * 0.997) score += BT.SCORE_ABOVE_SUPPORT;

  var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
  if (overnightTagged) score += BT.SCORE_OVERNIGHT_TAG;
  if (flipDetected)    score += BT.SCORE_MOMENTUM_FLIP;

  // NEW: VIX regime bonus/penalty
  if (vixData) {
    if (vixData.regime === "NORMAL")  score += BT.SCORE_VIX_NORMAL;
    if (vixData.regime === "FEAR")    score += BT.SCORE_VIX_FEAR;
    // ELEVATED: no bonus, no penalty — neutral
  }

  // NEW: ES Futures trend bonus/penalty
  if (esData) {
    if (esData.trend === "FADING")   score += BT.SCORE_ES_FADING;
    if (esData.trend === "CLIMBING") score += BT.SCORE_ES_CLIMBING;
  }

  // NEW: Flush speed bonus
  if (flushFast) score += BT.SCORE_FLUSH_FAST;

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // ── Entry signal + target ─────────────────────────────────
  var entrySignal = "⏳ WAIT";
  var targetPrice = null;

  if (score >= 75 && flipDetected && !ripDetected) {
    targetPrice = flushLow > 0
      ? Math.round(flushLow * (1 + BT.CALL_CONFIRM_PCT / 100) * 100) / 100
      : Math.round(price * 1.001 * 100) / 100;
    entrySignal = "✅ BUY CALLS";
  } else if (score >= 60 && flipDetected) {
    targetPrice = flushLow > 0
      ? Math.round(flushLow * (1 + BT.CALL_CONFIRM_PCT / 100) * 100) / 100
      : null;
    entrySignal = "👀 WATCH — Flip @ $" + (targetPrice ? targetPrice.toFixed(2) : "?");
  } else if (score >= 50 && flushExists) {
    entrySignal = "🟡 PATTERN FORMING (" + score + "%)";
  } else if (ripDetected && !flipDetected) {
    entrySignal = "⚠️ MISSED — Rip without clean flip";
  } else if (score < 25 && flushExists) {
    entrySignal = "❌ NOT TODAY";
  }

  // Persist for EOD grading
  setFlag("BT_LAST_CONFIDENCE", score.toString());
  setFlag("BT_LAST_PHASE", phase);
  if (entrySignal.indexOf("BUY") !== -1) {
    setFlag("BT_SIGNAL_ISSUED", "YES");
    setFlag("BT_SIGNAL_PRICE", price.toString());
  }

  return {
    phase:         phase,
    flushDepthPct: flushDepthPct,
    maxFlushPct:   maxFlushPct,
    flushSpeedStr: flushSpeedStr,
    flushFast:     flushFast,
    volPct:        volPct,
    confidence:    score,
    entrySignal:   entrySignal,
    targetPrice:   targetPrice,
    overnightStr:  overnightStr,
    flushExists:   flushExists,
    flushStrong:   flushStrong,
    flipDetected:  flipDetected,
    ripDetected:   ripDetected,
    tickPct:       tickPct,
    sessionHigh:   sessionHigh,
    sessionLow:    sessionLow
  };
}

// ─────────────────────────────────────────────────────────────
// PRE-OPEN PANEL
// ─────────────────────────────────────────────────────────────
function updatePreOpenPanel(sheet, data, cst) {
  try {
    var pmData = fetchPreMarketData();
    if (!pmData) return;

    setFlag("BT_OVERNIGHT_HIGH",   pmData.high.toString());
    setFlag("BT_OVERNIGHT_LOW",    pmData.low.toString());
    setFlag("BT_PREMARKET_CLOSE",  pmData.close.toString());

    var priceDiffPct = Math.abs((data.price - pmData.high) / pmData.high) * 100;
    if (priceDiffPct <= BT.OVERNIGHT_TAG_PCT) {
      setFlag("BT_OVERNIGHT_TAGGED", "YES");
    }

    var lastPreOpen = getFlag("BT_PREOPEN_WRITTEN");
    var todayStr    = Utilities.formatDate(cst, "America/Chicago", "yyyy-MM-dd");
    if (lastPreOpen === todayStr) return;

    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();
    var tagStr  = priceDiffPct <= BT.OVERNIGHT_TAG_PCT ? "🚨 HIGH TAGGED" : "—";
    var summary = "PM High: $" + pmData.high.toFixed(2)
                + "  PM Low: $" + pmData.low.toFixed(2)
                + "  Last: $"   + pmData.close.toFixed(2);

    // Fetch VIX early for pre-open context
    var vixData = fetchVIX();
    var esData  = fetchESFutures();
    var vixStr  = vixData ? vixData.price.toFixed(2) + " [" + vixData.regime + "]" : "—";
    var esStr   = esData  ? "$" + esData.price.toFixed(2) + " " + esData.trend    : "—";

    // Pre-open row uses all columns, padded to match BT_HEADERS length
    var preRow = new Array(BT_HEADERS.length).fill("—");
    preRow[BTC.TIME - 1]      = timeStr;
    preRow[BTC.PRICE - 1]     = data.price;
    preRow[BTC.PHASE - 1]     = PHASE.PRE_OPEN;
    preRow[BTC.VIX - 1]       = vixStr;
    preRow[BTC.ES_TREND - 1]  = esStr;
    preRow[BTC.ENTRY_SIGNAL - 1] = tagStr;
    preRow[BTC.OVERNIGHT - 1] = summary;
    preRow[BTC.AI_MEMO - 1]   = "⏳ Watching pre-market...";

    sheet.appendRow(preRow);
    var r = sheet.getLastRow();
    sheet.getRange(r, 1, 1, BT_HEADERS.length)
      .setBackground("#1a1a3e")
      .setFontColor("#9090cc")
      .setFontSize(9)
      .setFontStyle("italic");

    setFlag("BT_PREOPEN_WRITTEN", todayStr);
  } catch (e) {
    Logger.log("updatePreOpenPanel ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FETCH PRE-MARKET DATA
// ─────────────────────────────────────────────────────────────
function fetchPreMarketData() {
  try {
    var url  = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=5m&range=1d&includePrePost=true";
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (resp.getResponseCode() !== 200) return null;

    var json   = JSON.parse(resp.getContentText());
    var result = json.chart && json.chart.result && json.chart.result[0];
    if (!result) return null;

    var timestamps = result.timestamp || [];
    var quotes     = result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!quotes) return null;

    var highs  = quotes.high  || [];
    var lows   = quotes.low   || [];
    var closes = quotes.close || [];

    // Pre-market = before 8:30 CST = before 14:30 UTC
    var preMarketEndUTC = 14 * 3600 + 30 * 60;
    var pmHigh = 0, pmLow = Infinity, pmClose = 0;

    for (var i = 0; i < timestamps.length; i++) {
      var d        = new Date(timestamps[i] * 1000);
      var secOfDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      if (secOfDay < preMarketEndUTC) {
        if (highs[i]  != null && highs[i]  > pmHigh)  pmHigh  = highs[i];
        if (lows[i]   != null && lows[i]   < pmLow)   pmLow   = lows[i];
        if (closes[i] != null)                         pmClose = closes[i];
      }
    }

    if (pmHigh === 0) return null;
    if (pmLow === Infinity) pmLow = pmHigh;

    Logger.log("Pre-market: high=" + pmHigh + " low=" + pmLow + " close=" + pmClose);
    return { high: pmHigh, low: pmLow, close: pmClose };
  } catch (e) {
    Logger.log("fetchPreMarketData ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD OVERNIGHT STRING
// ─────────────────────────────────────────────────────────────
function buildOvernightStr(price, overnightHigh, overnightLow, dayOpen) {
  if (overnightHigh === 0) return "—";
  var distFromHigh = ((price - overnightHigh) / overnightHigh) * 100;
  var gapFromOpen  = dayOpen > 0 ? ((dayOpen - overnightHigh) / overnightHigh) * 100 : null;
  var parts = [];
  if (overnightHigh > 0) parts.push("OH: $" + overnightHigh.toFixed(2));
  if (overnightLow  > 0) parts.push("OL: $" + overnightLow.toFixed(2));
  var tag = Math.abs(distFromHigh) <= BT.OVERNIGHT_TAG_PCT ? " 🚨" : "";
  parts.push("Δ OH: " + distFromHigh.toFixed(2) + "%" + tag);
  if (gapFromOpen !== null && Math.abs(gapFromOpen) > 0.05) {
    parts.push("Gap: " + gapFromOpen.toFixed(2) + "%");
  }
  return parts.join("  |  ");
}

// ─────────────────────────────────────────────────────────────
// AI MEMO — fires only when gate allows (see shouldFireAI)
// Ultra-short prompt: VIX + ES data baked in as numbers,
// not extra words. 80 token output = 1 tight sentence.
// ─────────────────────────────────────────────────────────────
function getBearTrapAIMemo(metrics, data, vixData, esData, cst) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return "⚙️ Add GEMINI_API_KEY to enable AI memos.";

    var prompt = buildBearTrapPrompt(metrics, data, vixData, esData);
    Logger.log("BT AI prompt: " + prompt);

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 80, temperature: 0.3 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("BT Gemini error: " + resp.getResponseCode());
      return null;
    }

    var json = JSON.parse(resp.getContentText());
    var text = json.candidates
            && json.candidates[0]
            && json.candidates[0].content
            && json.candidates[0].content.parts
            && json.candidates[0].content.parts[0]
             ? json.candidates[0].content.parts[0].text.trim()
             : null;

    return text ? "🤖 " + text : null;

  } catch (e) {
    Logger.log("getBearTrapAIMemo ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD AI PROMPT — numbers instead of words to save tokens.
// ~55 tokens in, 80 tokens out = ~135 tokens per call.
// At 9 calls/day = ~1,215 tokens/day. Well under free tier.
// ─────────────────────────────────────────────────────────────
function buildBearTrapPrompt(metrics, data, vixData, esData) {
  var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
  return (
    "SPY Bear Trap detector. " +
    "$" + data.price.toFixed(2) + " phase:" + metrics.phase + " " +
    "flush:" + Math.abs(metrics.maxFlushPct).toFixed(2) + "% " +
    "speed:" + (metrics.flushFast ? "FAST" : "SLOW") + " " +
    "vol:" + (metrics.volPct > 0 ? metrics.volPct.toFixed(0) + "%" : "?") + " " +
    "conf:" + metrics.confidence + "% " +
    "OHtag:" + (overnightTagged ? "Y" : "N") + " " +
    "flip:" + (metrics.flipDetected ? "Y" : "N") + " " +
    "VIX:" + (vixData ? vixData.price.toFixed(1) + "/" + vixData.regime : "?") + " " +
    "ES:" + (esData ? esData.trend : "?") + ". " +
    "1 sentence: status + action."
  );
}

// ─────────────────────────────────────────────────────────────
// EOD BRIEF — fires once at 3:00 CST, logs to SCORECARD
// ─────────────────────────────────────────────────────────────
function writeEODBrief(sheet, data, cst) {
  try {
    var confidence      = getFlag("BT_LAST_CONFIDENCE")  || "0";
    var signalIssued    = getFlag("BT_SIGNAL_ISSUED")    || "NO";
    var signalPrice     = parseFloat(getFlag("BT_SIGNAL_PRICE"))  || 0;
    var flipTime        = getFlag("BT_FLIP_TIME")         || "—";
    var maxFlush        = parseFloat(getFlag("BT_MAX_FLUSH_PCT"))  || 0;
    var sessionHigh     = parseFloat(getFlag("BT_SESSION_HIGH"))   || 0;
    var dayOpen         = parseFloat(getFlag("BT_DAY_OPEN"))       || 0;
    var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
    var ripDetected     = getFlag("BT_RIP_DETECTED")  === "YES";
    var flipDetected    = getFlag("BT_FLIP_DETECTED") === "YES";
    var aiCallCount     = getFlag("BT_AI_CALL_COUNT") || "0";

    var patternPlayed = ripDetected && flipDetected && Math.abs(maxFlush) >= BT.FLUSH_MIN_PCT;
    var grade, gradeColor;

    if      (patternPlayed && signalIssued === "YES") { grade = "✅ CONFIRMED + SIGNAL CORRECT"; gradeColor = "#1a4a1a"; }
    else if (patternPlayed && signalIssued !== "YES") { grade = "⚠️ PATTERN PLAYED — SIGNAL MISSED";  gradeColor = "#4a3a00"; }
    else if (!patternPlayed && signalIssued === "YES") { grade = "❌ SIGNAL ISSUED — NO PATTERN";     gradeColor = "#4a1a1a"; }
    else                                               { grade = "➡️ NO PATTERN TODAY";               gradeColor = "#1a1a3e"; }

    var closeVsOpen = dayOpen > 0 ? ((data.price - dayOpen) / dayOpen) * 100 : 0;

    // EOD AI brief (1 call, slightly longer output = 150 tokens)
    var eodMemo = getEODAIMemo({
      confidence: confidence, signalIssued: signalIssued,
      signalPrice: signalPrice, currentPrice: data.price,
      maxFlush: maxFlush, flipTime: flipTime,
      ripDetected: ripDetected, flipDetected: flipDetected,
      overnightTagged: overnightTagged, closeVsOpen: closeVsOpen,
      grade: grade, aiCallsUsed: aiCallCount
    });

    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();

    // ── Write separator row ───────────────────────────────────
    var sepRow = new Array(BT_HEADERS.length).fill("");
    sepRow[0] = "── EOD BRIEF ──";
    sepRow[BT_HEADERS.length - 1] = "AI calls today: " + aiCallCount + "/8";
    sheet.appendRow(sepRow);
    var sep = sheet.getLastRow();
    sheet.getRange(sep, 1, 1, BT_HEADERS.length)
      .setBackground(gradeColor).setFontColor("#ffffff")
      .setFontWeight("bold").setFontSize(9).setFontStyle("italic");
    sheet.setRowHeight(sep, 20);

    // ── Write summary row ─────────────────────────────────────
    var summaryRow = new Array(BT_HEADERS.length).fill("—");
    summaryRow[BTC.TIME - 1]         = timeStr;
    summaryRow[BTC.PRICE - 1]        = data.price;
    summaryRow[BTC.PHASE - 1]        = grade;
    summaryRow[BTC.FLUSH_DEPTH - 1]  = "Max: " + Math.abs(maxFlush).toFixed(2) + "%";
    summaryRow[BTC.CONFIDENCE - 1]   = confidence + "%";
    summaryRow[BTC.ENTRY_SIGNAL - 1] = signalIssued === "YES"
                                        ? "Signal @ $" + signalPrice.toFixed(2) : "No signal";
    summaryRow[BTC.TARGET_PRICE - 1] = "Close vs open: " + closeVsOpen.toFixed(2) + "%";
    summaryRow[BTC.OVERNIGHT - 1]    = "OH tagged: " + (overnightTagged ? "✅" : "❌");
    summaryRow[BTC.AI_MEMO - 1]      = eodMemo || "—";

    sheet.appendRow(summaryRow);
    var eodRow = sheet.getLastRow();
    sheet.getRange(eodRow, 1, 1, BT_HEADERS.length)
      .setBackground(gradeColor).setFontColor("#e0e0ff")
      .setFontSize(9).setWrap(true);
    sheet.setRowHeight(eodRow, 50);

    // ── Log result to SCORECARD ───────────────────────────────
    logToScorecard(cst, confidence, signalIssued, signalPrice,
                   patternPlayed, grade, maxFlush, closeVsOpen,
                   overnightTagged, aiCallCount);

    // ── Reset for tomorrow ────────────────────────────────────
    resetDailyBearTrapFlags();
    Logger.log("EOD Brief written: " + grade);

  } catch (e) {
    Logger.log("writeEODBrief ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// EOD AI BRIEF — 2-3 sentences, 150 token output max
// ─────────────────────────────────────────────────────────────
function getEODAIMemo(ctx) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return null;

    var prompt =
      "Bear Trap EOD. Conf:" + ctx.confidence + "% " +
      "signal:" + ctx.signalIssued + (ctx.signalPrice > 0 ? "@$" + ctx.signalPrice.toFixed(2) : "") + " " +
      "flush:" + Math.abs(ctx.maxFlush).toFixed(2) + "% " +
      "flip:" + ctx.flipDetected + "@" + ctx.flipTime + " " +
      "rip:" + ctx.ripDetected + " " +
      "OHtag:" + ctx.overnightTagged + " " +
      "close/open:" + ctx.closeVsOpen.toFixed(2) + "% " +
      "grade:" + ctx.grade + " " +
      "AIcalls:" + ctx.aiCallsUsed + "/8. " +
      "2-3 sentences: accurate? key signal today?";

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.4 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) return null;

    var json = JSON.parse(resp.getContentText());
    return json.candidates
        && json.candidates[0]
        && json.candidates[0].content
        && json.candidates[0].content.parts
        && json.candidates[0].content.parts[0]
         ? "🤖 EOD: " + json.candidates[0].content.parts[0].text.trim()
         : null;
  } catch (e) {
    Logger.log("getEODAIMemo ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// FORMAT ONE DATA ROW
// ─────────────────────────────────────────────────────────────
function applyBearTrapRowFormat(sheet, rowNum, metrics, vixData, esData) {
  try {
    sheet.setRowHeight(rowNum, 24);

    sheet.getRange(rowNum, 1, 1, BT_HEADERS.length)
      .setBackground("#0d0d2b")
      .setFontColor("#c0c0e0")
      .setFontFamily("Courier New")
      .setFontSize(9)
      .setVerticalAlignment("middle");

    // TIME
    sheet.getRange(rowNum, BTC.TIME)
      .setFontColor("#9090cc").setHorizontalAlignment("center");

    // PRICE
    sheet.getRange(rowNum, BTC.PRICE)
      .setNumberFormat("$#,##0.00")
      .setFontColor("#00e5ff").setFontWeight("bold")
      .setHorizontalAlignment("center");

    // PHASE
    var phaseCell = sheet.getRange(rowNum, BTC.PHASE);
    phaseCell.setHorizontalAlignment("center").setFontWeight("bold");
    var phaseColor = metrics.phase === PHASE.FLUSH ? "#ff6b6b"
                   : metrics.phase === PHASE.STALL ? "#ffd600"
                   : metrics.phase === PHASE.FLIP  ? "#00ff99"
                   : metrics.phase === PHASE.RIP   ? "#00ff99"
                   : "#9090cc";
    phaseCell.setFontColor(phaseColor);
    if (metrics.phase === PHASE.RIP) phaseCell.setFontSize(10);

    // FLUSH DEPTH
    var flushCell = sheet.getRange(rowNum, BTC.FLUSH_DEPTH);
    flushCell.setHorizontalAlignment("center");
    flushCell.setFontColor(
      metrics.flushDepthPct < -BT.FLUSH_MIN_PCT ? "#ff6b6b" :
      metrics.flushDepthPct > 0.1               ? "#00ff99" : "#9090cc"
    );

    // FLUSH SPEED
    var speedCell = sheet.getRange(rowNum, BTC.FLUSH_SPEED);
    speedCell.setHorizontalAlignment("center");
    speedCell.setFontColor(metrics.flushFast ? "#ffd600" : "#9090cc");

    // VOL SIGNAL
    var volCell = sheet.getRange(rowNum, BTC.VOL_SIGNAL);
    volCell.setHorizontalAlignment("center");
    volCell.setFontColor(
      (metrics.volPct > 0 && metrics.volPct < BT.VOLUME_WEAK_PCT) ? "#ffd600" :
      metrics.volPct >= 100 ? "#ff6b6b" : "#9090cc"
    );

    // VIX — color by regime
    var vixCell = sheet.getRange(rowNum, BTC.VIX);
    vixCell.setHorizontalAlignment("center").setFontWeight("bold");
    if (vixData) {
      vixCell.setFontColor(
        vixData.regime === "LOW"      ? "#00ff99" :
        vixData.regime === "NORMAL"   ? "#aaffaa" :
        vixData.regime === "ELEVATED" ? "#ffd600" : "#ff6b6b"
      );
    }

    // ES FUTURES — color by trend
    var esCell = sheet.getRange(rowNum, BTC.ES_TREND);
    esCell.setHorizontalAlignment("center").setFontWeight("bold");
    if (esData) {
      esCell.setFontColor(
        esData.trend === "FADING"   ? "#00ff99" :  // fading = trap setup = good
        esData.trend === "CLIMBING" ? "#ff6b6b" :  // climbing = flush may continue
        "#ffd600"                                   // flat = neutral
      );
    }

    // CONFIDENCE
    var conf      = metrics.confidence;
    var confColor = conf >= 75 ? "#00ff99"
                  : conf >= 50 ? "#ffd600"
                  : conf >= 30 ? "#ff9944"
                  : "#ff6b6b";
    sheet.getRange(rowNum, BTC.CONFIDENCE)
      .setHorizontalAlignment("center")
      .setFontColor(confColor).setFontWeight("bold").setFontSize(10);

    // ENTRY SIGNAL
    var entryCell = sheet.getRange(rowNum, BTC.ENTRY_SIGNAL);
    entryCell.setHorizontalAlignment("center");
    if (metrics.entrySignal.indexOf("BUY CALLS") !== -1) {
      entryCell.setBackground("#003300").setFontColor("#00ff99")
               .setFontWeight("bold").setFontSize(10);
    } else if (metrics.entrySignal.indexOf("WATCH") !== -1) {
      entryCell.setFontColor("#ffd600").setFontWeight("bold");
    } else if (metrics.entrySignal.indexOf("MISSED") !== -1) {
      entryCell.setFontColor("#ff6b6b");
    } else if (metrics.entrySignal.indexOf("NOT TODAY") !== -1) {
      entryCell.setFontColor("#555577");
    } else {
      entryCell.setFontColor("#9090cc");
    }

    // TARGET PRICE
    sheet.getRange(rowNum, BTC.TARGET_PRICE)
      .setFontColor("#ffd600").setHorizontalAlignment("center").setFontWeight("bold");

    // OVERNIGHT
    sheet.getRange(rowNum, BTC.OVERNIGHT)
      .setFontColor("#8888bb").setFontSize(8).setHorizontalAlignment("left");

    // AI MEMO
    sheet.getRange(rowNum, BTC.AI_MEMO)
      .setFontColor("#aaaacc").setFontSize(8).setWrap(true).setHorizontalAlignment("left");

  } catch (e) {
    Logger.log("applyBearTrapRowFormat ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CST HELPER
// ─────────────────────────────────────────────────────────────
function toCSTDate(etDate) {
  var cstStr = etDate.toLocaleString("en-US", { timeZone: "America/Chicago" });
  return new Date(cstStr);
}

// ─────────────────────────────────────────────────────────────
// RESET DAILY FLAGS
// ─────────────────────────────────────────────────────────────
function resetDailyBearTrapFlags() {
  var keys = [
    "BT_DAY_OPEN", "BT_SESSION_HIGH", "BT_SESSION_LOW",
    "BT_FLUSH_LOW", "BT_MAX_FLUSH_PCT", "BT_FLIP_DETECTED",
    "BT_FLIP_PRICE", "BT_FLIP_TIME", "BT_RIP_DETECTED",
    "BT_OVERNIGHT_HIGH", "BT_OVERNIGHT_LOW", "BT_PREMARKET_CLOSE",
    "BT_OVERNIGHT_TAGGED", "BT_LAST_CONFIDENCE", "BT_LAST_PHASE",
    "BT_SIGNAL_ISSUED", "BT_SIGNAL_PRICE", "BT_RECENT_TICKS",
    "BT_PREOPEN_WRITTEN", "BT_OPEN_TIME_MIN",
    "BT_LAST_AI_PHASE", "BT_LAST_AI_CONF_BAND", "BT_LAST_AI_SIGNAL",
    "BT_AI_CALL_COUNT"
  ];
  keys.forEach(function(k) { setFlag(k, ""); });
  Logger.log("Bear Trap daily flags reset.");
}
