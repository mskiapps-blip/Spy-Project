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
//  AI memo:        1 sentence every 5 min via Gemini
//  EOD brief:      Fires at ~3:00 CST (market close)
//
//  All times displayed in CST 12-hour format.
//  Hooks into the existing runEvery5Minutes() trigger.
// ============================================================

var SHEET_BEAR_TRAP = "🪤 BEAR TRAP";

// ─────────────────────────────────────────────────────────────
// TIMING CONSTANTS — all in CST
// Market open = 8:30 CST (9:30 ET)
// Active Bear Trap window = 8:30–9:15 CST
// EOD brief window = 3:00–3:10 CST (market close)
// ─────────────────────────────────────────────────────────────
var BT = {
  OPEN_HOUR:          8,
  OPEN_MIN:           30,
  ACTIVE_END_HOUR:    9,
  ACTIVE_END_MIN:     15,
  EOD_HOUR:           15,   // 3:00 PM CST
  EOD_MIN:            0,
  EOD_WINDOW_MIN:     10,   // fire EOD brief within 10 min of close

  // Pattern detection thresholds
  FLUSH_MIN_PCT:      0.20, // minimum drop to qualify as a flush
  FLUSH_STRONG_PCT:   0.40, // strong flush (more conviction in trap)
  VOLUME_WEAK_PCT:    90,   // below 90% of expected pace = weak volume
  MOMENTUM_FLIP_PCT:  0.05, // tick must be +0.05% to count as flip
  OVERNIGHT_TAG_PCT:  0.15, // within 0.15% of overnight high = "tagged"
  CALL_CONFIRM_PCT:   0.10, // price must clear flush low + this % to confirm

  // Confidence scoring weights (must sum to 100)
  SCORE_FLUSH_EXISTS:   20, // a qualifying flush happened
  SCORE_FLUSH_STRONG:   15, // flush was >= FLUSH_STRONG_PCT
  SCORE_VOL_WEAK:       15, // volume was below pace during flush
  SCORE_ABOVE_SUPPORT:  15, // price stayed above key support (VWAP / prevClose)
  SCORE_OVERNIGHT_TAG:  20, // overnight high was tagged before open
  SCORE_MOMENTUM_FLIP:  15  // first green tick after flush detected
};

// ─────────────────────────────────────────────────────────────
// BEAR TRAP COLUMNS
// ─────────────────────────────────────────────────────────────
var BTC = {
  TIME:           1,  // A — CST 12hr
  PRICE:          2,  // B
  PHASE:          3,  // C — PRE-OPEN / FLUSH / STALL / RIP / POST
  FLUSH_DEPTH:    4,  // D — max drop from open price (%)
  VOL_SIGNAL:     5,  // E — volume vs expected pace
  CONFIDENCE:     6,  // F — 0–100 Bear Trap confidence score
  ENTRY_SIGNAL:   7,  // G — WAIT / WATCH / ✅ BUY CALLS / ⚠️ MISSED
  TARGET_PRICE:   8,  // H — specific SPY price level to confirm entry
  OVERNIGHT:      9,  // I — overnight high/low context
  AI_MEMO:        10  // J — 1-sentence Gemini commentary
};

var BT_HEADERS = [
  "⏱ TIME (CST)",
  "💰 SPY PRICE",
  "📍 PHASE",
  "📉 FLUSH DEPTH",
  "📦 VOL SIGNAL",
  "🎯 CONFIDENCE",
  "🚦 ENTRY SIGNAL",
  "🏹 TARGET PRICE",
  "🌙 OVERNIGHT",
  "🤖 AI MEMO"
];

// Phase labels
var PHASE = {
  PRE_OPEN:  "🌅 PRE-OPEN",
  FLUSH:     "📉 FLUSH",
  STALL:     "⏸ STALL",
  FLIP:      "⚡ FLIP",
  RIP:       "🚀 RIP",
  POST:      "➡️ POST-WINDOW",
  CLOSED:    "🔒 CLOSED"
};

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY — called from runEvery5Minutes() in Code.gs
// ─────────────────────────────────────────────────────────────
function runBearTrapTick(data, now) {
  try {
    var cst = toCSTDate(now);
    var ss  = SpreadsheetApp.getActiveSpreadsheet();

    // Ensure sheet exists
    var sheet = ss.getSheetByName(SHEET_BEAR_TRAP);
    if (!sheet) {
      setupBearTrapSheet(ss);
      sheet = ss.getSheetByName(SHEET_BEAR_TRAP);
    }

    var cstHour = cst.getHours();
    var cstMin  = cst.getMinutes();
    var totalMin = cstHour * 60 + cstMin;

    var openMin       = BT.OPEN_HOUR * 60 + BT.OPEN_MIN;
    var activeEndMin  = BT.ACTIVE_END_HOUR * 60 + BT.ACTIVE_END_MIN;
    var eodMin        = BT.EOD_HOUR * 60 + BT.EOD_MIN;

    // ── EOD Brief: fire once at ~3:00 CST ──────────────────
    if (totalMin >= eodMin && totalMin <= eodMin + BT.EOD_WINDOW_MIN) {
      var eodFired = getFlag("BT_EOD_FIRED_TODAY");
      var todayStr = Utilities.formatDate(cst, "America/Chicago", "yyyy-MM-dd");
      if (eodFired !== todayStr) {
        writeEODBrief(sheet, data, cst);
        setFlag("BT_EOD_FIRED_TODAY", todayStr);
      }
      return;
    }

    // ── Only run active detection during the Bear Trap window ──
    if (totalMin < openMin || totalMin > activeEndMin) {
      // Still update pre-open overnight panel if before open
      if (totalMin < openMin && data) {
        updatePreOpenPanel(sheet, data, cst);
      }
      return;
    }

    if (!data) return;

    // ── Compute all metrics ─────────────────────────────────
    var metrics = computeBearTrapMetrics(data, cst);

    // ── Build the row ───────────────────────────────────────
    var timeStr   = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();
    var phaseStr  = metrics.phase;
    var flushStr  = metrics.flushDepthPct !== null
                    ? (metrics.flushDepthPct > 0 ? "-" : "") + Math.abs(metrics.flushDepthPct).toFixed(2) + "%"
                    : "—";
    var volStr    = metrics.volPct > 0
                    ? metrics.volPct.toFixed(0) + "% of pace"
                    : "—";
    var confStr   = metrics.confidence + "%";
    var entryStr  = metrics.entrySignal;
    var targetStr = metrics.targetPrice ? "$" + metrics.targetPrice.toFixed(2) : "—";
    var overnightStr = metrics.overnightStr || "—";

    // ── AI memo every 5 min during window ──────────────────
    var aiMemo = getBearTrapAIMemo(metrics, data, cst);

    var row = [
      timeStr,
      data.price,
      phaseStr,
      flushStr,
      volStr,
      confStr,
      entryStr,
      targetStr,
      overnightStr,
      aiMemo || ""
    ];

    sheet.appendRow(row);
    var newRow = sheet.getLastRow();

    // ── Format the row ──────────────────────────────────────
    applyBearTrapRowFormat(sheet, newRow, metrics);

    Logger.log("BearTrap tick: phase=" + phaseStr + " conf=" + metrics.confidence + "% entry=" + entryStr);

  } catch (e) {
    Logger.log("runBearTrapTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// COMPUTE ALL BEAR TRAP METRICS FOR THIS TICK
// ─────────────────────────────────────────────────────────────
function computeBearTrapMetrics(data, cst) {
  var price      = data.price;
  var prevClose  = data.prevClose  || price;
  var dayOpen    = parseFloat(getFlag("BT_DAY_OPEN"))    || 0;
  var sessionHigh = parseFloat(getFlag("BT_SESSION_HIGH")) || price;
  var sessionLow  = parseFloat(getFlag("BT_SESSION_LOW"))  || price;
  var flushLow    = parseFloat(getFlag("BT_FLUSH_LOW"))    || 0;
  var flipDetected = getFlag("BT_FLIP_DETECTED") === "YES";
  var ripDetected  = getFlag("BT_RIP_DETECTED")  === "YES";

  // Set day open on first tick
  if (dayOpen === 0) {
    dayOpen = price;
    setFlag("BT_DAY_OPEN", dayOpen);
  }

  // Track session high/low
  if (price > sessionHigh) { sessionHigh = price; setFlag("BT_SESSION_HIGH", sessionHigh); }
  if (price < sessionLow || sessionLow === 0)  { sessionLow  = price; setFlag("BT_SESSION_LOW",  sessionLow);  }

  // ── Flush depth: max drop from day open ──────────────────
  var flushDepthPct = dayOpen > 0 ? ((price - dayOpen) / dayOpen) * 100 : 0;
  var maxFlushPct   = parseFloat(getFlag("BT_MAX_FLUSH_PCT")) || 0;

  // Track the deepest flush (most negative reading)
  if (flushDepthPct < maxFlushPct) {
    maxFlushPct = flushDepthPct;
    setFlag("BT_MAX_FLUSH_PCT", maxFlushPct);
    setFlag("BT_FLUSH_LOW", price);
    flushLow = price;
  }

  // ── Volume vs expected pace ───────────────────────────────
  var cstHour = cst.getHours();
  var cstMin  = cst.getMinutes();
  var elapsedMin = (cstHour * 60 + cstMin) - (BT.OPEN_HOUR * 60 + BT.OPEN_MIN);
  var sessionLen = 390; // 6.5 hours in minutes
  var dayFraction = Math.max(0.02, elapsedMin / sessionLen);
  var expectedVol = data.avgVol30 > 0 ? data.avgVol30 * dayFraction : 0;
  var volPct = expectedVol > 0 ? (data.volumeToday / expectedVol) * 100 : 0;

  // ── Overnight data ────────────────────────────────────────
  var overnightHigh = parseFloat(getFlag("BT_OVERNIGHT_HIGH")) || 0;
  var overnightLow  = parseFloat(getFlag("BT_OVERNIGHT_LOW"))  || 0;
  var overnightStr  = buildOvernightStr(price, overnightHigh, overnightLow, dayOpen);

  // ── Phase detection ───────────────────────────────────────
  var flushExists = Math.abs(maxFlushPct) >= BT.FLUSH_MIN_PCT;
  var flushStrong = Math.abs(maxFlushPct) >= BT.FLUSH_STRONG_PCT;

  // Momentum flip: current price recovering from flush low
  var prevPrice = parseFloat(getFlag("PREV_PRICE")) || 0;
  var tickPct   = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

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

  // Determine current phase
  var phase;
  if (ripDetected) {
    phase = PHASE.RIP;
  } else if (flipDetected) {
    phase = PHASE.FLIP;
  } else if (flushExists) {
    // Check if flush is stalling (tick momentum flattening)
    var recentTicks = getFlag("BT_RECENT_TICKS") || "";
    var tickArr = recentTicks.length > 0
      ? recentTicks.split(",").map(parseFloat).filter(function(v) { return !isNaN(v); })
      : [];
    tickArr.push(tickPct);
    if (tickArr.length > 4) tickArr = tickArr.slice(-4);
    setFlag("BT_RECENT_TICKS", tickArr.join(","));

    var avgRecentTick = tickArr.reduce(function(a, b) { return a + b; }, 0) / tickArr.length;
    phase = (avgRecentTick > -0.02 && avgRecentTick < 0.05) ? PHASE.STALL : PHASE.FLUSH;
  } else {
    phase = PHASE.FLUSH; // Still in early open, watching
  }

  // ── Confidence score ──────────────────────────────────────
  var score = 0;
  if (flushExists)  score += BT.SCORE_FLUSH_EXISTS;
  if (flushStrong)  score += BT.SCORE_FLUSH_STRONG;
  if (volPct > 0 && volPct < BT.VOLUME_WEAK_PCT) score += BT.SCORE_VOL_WEAK;

  // Price above key support (prevClose or VWAP)
  var vwap = data.vwap || 0;
  var keySupport = Math.max(prevClose, vwap > 0 ? vwap : 0);
  if (keySupport > 0 && price >= keySupport * 0.997) score += BT.SCORE_ABOVE_SUPPORT;

  // Overnight high tagged
  var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
  if (overnightTagged) score += BT.SCORE_OVERNIGHT_TAG;

  // Momentum flip
  if (flipDetected) score += BT.SCORE_MOMENTUM_FLIP;

  // ── Entry signal + target price ───────────────────────────
  var entrySignal = "⏳ WAIT";
  var targetPrice = null;

  if (score >= 75 && flipDetected && !ripDetected) {
    // Strong setup, flip confirmed — give specific entry target
    // Target = flip price + small buffer above flush low
    targetPrice = flushLow > 0
      ? flushLow * (1 + BT.CALL_CONFIRM_PCT / 100)
      : price * 1.001;
    entrySignal = "✅ BUY CALLS";
  } else if (score >= 60 && flipDetected) {
    targetPrice = flushLow > 0 ? flushLow * (1 + BT.CALL_CONFIRM_PCT / 100) : null;
    entrySignal = "👀 WATCH — Flip @ $" + (targetPrice ? targetPrice.toFixed(2) : "?");
  } else if (score >= 50 && flushExists) {
    entrySignal = "🟡 PATTERN FORMING (" + score + "%)";
  } else if (ripDetected && !flipDetected) {
    entrySignal = "⚠️ MISSED — Rip without clean flip";
  } else if (score < 30) {
    entrySignal = "❌ NOT TODAY";
  }

  // Save key metrics for EOD grading
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
    volPct:        volPct,
    confidence:    score,
    entrySignal:   entrySignal,
    targetPrice:   targetPrice,
    overnightStr:  overnightStr,
    flushExists:   flushExists,
    flipDetected:  flipDetected,
    ripDetected:   ripDetected,
    tickPct:       tickPct
  };
}

// ─────────────────────────────────────────────────────────────
// PRE-OPEN PANEL — updates overnight data before 8:30 CST
// Called when tick fires before market open
// ─────────────────────────────────────────────────────────────
function updatePreOpenPanel(sheet, data, cst) {
  try {
    // Fetch pre-market data
    var pmData = fetchPreMarketData();
    if (!pmData) return;

    setFlag("BT_OVERNIGHT_HIGH", pmData.high.toString());
    setFlag("BT_OVERNIGHT_LOW",  pmData.low.toString());
    setFlag("BT_PREMARKET_CLOSE", pmData.close.toString());

    // Tag if price is near overnight high
    var priceDiffPct = Math.abs((data.price - pmData.high) / pmData.high) * 100;
    if (priceDiffPct <= BT.OVERNIGHT_TAG_PCT) {
      setFlag("BT_OVERNIGHT_TAGGED", "YES");
    }

    // Write a pre-open summary row
    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();
    var tagStr  = priceDiffPct <= BT.OVERNIGHT_TAG_PCT ? "🚨 HIGH TAGGED" : "—";
    var summary = "PM High: $" + pmData.high.toFixed(2)
                + "  PM Low: $" + pmData.low.toFixed(2)
                + "  Last: $" + pmData.close.toFixed(2);

    // Only write pre-open rows if we haven't yet today
    var lastPreOpen = getFlag("BT_PREOPEN_WRITTEN");
    var todayStr = Utilities.formatDate(cst, "America/Chicago", "yyyy-MM-dd");
    if (lastPreOpen !== todayStr) {
      sheet.appendRow([
        timeStr, data.price, PHASE.PRE_OPEN,
        "—", "—", "—",
        tagStr, "—", summary, "⏳ Watching pre-market..."
      ]);
      var r = sheet.getLastRow();
      sheet.getRange(r, 1, 1, BT_HEADERS.length)
        .setBackground("#1a1a3e")
        .setFontColor("#9090cc")
        .setFontSize(9)
        .setFontStyle("italic");
      setFlag("BT_PREOPEN_WRITTEN", todayStr);
    }
  } catch (e) {
    Logger.log("updatePreOpenPanel ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FETCH PRE-MARKET DATA from Yahoo Finance
// Returns { high, low, close } for the pre-market session
// ─────────────────────────────────────────────────────────────
function fetchPreMarketData() {
  try {
    // Use 1-day chart with 5-min bars — pre-market bars are included
    var url = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=5m&range=1d&includePrePost=true";
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

    var highs  = quotes.high   || [];
    var lows   = quotes.low    || [];
    var closes = quotes.close  || [];

    // Pre-market = timestamps before 8:30 CST (13:30 UTC)
    // 8:30 CST = 14:30 UTC
    var preMarketEndUTC = 14 * 3600 + 30 * 60;

    var pmHigh  = 0;
    var pmLow   = Infinity;
    var pmClose = 0;

    for (var i = 0; i < timestamps.length; i++) {
      var ts = timestamps[i];
      // Get seconds since midnight UTC
      var d        = new Date(ts * 1000);
      var secOfDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();

      if (secOfDay < preMarketEndUTC) {
        if (highs[i]  != null && highs[i]  > pmHigh)  pmHigh  = highs[i];
        if (lows[i]   != null && lows[i]   < pmLow)   pmLow   = lows[i];
        if (closes[i] != null)                         pmClose = closes[i];
      }
    }

    if (pmHigh === 0) return null;
    if (pmLow  === Infinity) pmLow = pmHigh;

    Logger.log("Pre-market: high=" + pmHigh + " low=" + pmLow + " close=" + pmClose);
    return { high: pmHigh, low: pmLow, close: pmClose };

  } catch (e) {
    Logger.log("fetchPreMarketData ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD OVERNIGHT CONTEXT STRING for the Overnight column
// ─────────────────────────────────────────────────────────────
function buildOvernightStr(price, overnightHigh, overnightLow, dayOpen) {
  if (overnightHigh === 0) return "—";

  var distFromHigh = overnightHigh > 0
    ? ((price - overnightHigh) / overnightHigh) * 100
    : null;
  var gapFromOpen = dayOpen > 0 && overnightHigh > 0
    ? ((dayOpen - overnightHigh) / overnightHigh) * 100
    : null;

  var parts = [];
  if (overnightHigh > 0) parts.push("OH: $" + overnightHigh.toFixed(2));
  if (overnightLow  > 0) parts.push("OL: $" + overnightLow.toFixed(2));
  if (distFromHigh !== null) {
    var tag = Math.abs(distFromHigh) <= BT.OVERNIGHT_TAG_PCT ? " 🚨" : "";
    parts.push("Δ OH: " + distFromHigh.toFixed(2) + "%" + tag);
  }
  if (gapFromOpen !== null && Math.abs(gapFromOpen) > 0.05) {
    parts.push("Open gap: " + gapFromOpen.toFixed(2) + "%");
  }

  return parts.join("  |  ");
}

// ─────────────────────────────────────────────────────────────
// AI MEMO — 1 sentence via Gemini, every 5 min during window
// Ultra-short prompt to save tokens
// ─────────────────────────────────────────────────────────────
function getBearTrapAIMemo(metrics, data, cst) {
  try {
    // Use existing cooldown system but shorter for Bear Trap (5 min)
    var lastStr = getFlag("BT_LAST_AI_TIME");
    var nowMs   = cst.getTime();
    if (lastStr && lastStr !== "") {
      var last    = parseInt(lastStr);
      var elapsed = (nowMs - last) / 60000;
      if (!isNaN(last) && elapsed < 4.5) {
        Logger.log("BearTrap AI cooldown active (" + elapsed.toFixed(1) + " min)");
        return null;
      }
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return "⚙️ Add GEMINI_API_KEY to enable AI memos.";

    var prompt = buildBearTrapPrompt(metrics, data);
    Logger.log("BT AI prompt: " + prompt);

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 80,  // Ultra-short: 1 sentence
        temperature: 0.3
      }
    });

    var resp = UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      payload:            payload,
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("BT Gemini error " + resp.getResponseCode());
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

    if (text) {
      setFlag("BT_LAST_AI_TIME", nowMs.toString());
      return "🤖 " + text;
    }
    return null;

  } catch (e) {
    Logger.log("getBearTrapAIMemo ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD BEAR TRAP AI PROMPT — minimal tokens
// ─────────────────────────────────────────────────────────────
function buildBearTrapPrompt(metrics, data) {
  var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
  return (
    "SPY Bear Trap pattern detector. " +
    "SPY $" + data.price.toFixed(2) + ". " +
    "Phase: " + metrics.phase + ". " +
    "Flush: " + Math.abs(metrics.maxFlushPct).toFixed(2) + "%. " +
    "Vol: " + (metrics.volPct > 0 ? metrics.volPct.toFixed(0) + "% of pace" : "unknown") + ". " +
    "Confidence: " + metrics.confidence + "%. " +
    "Overnight high tagged: " + (overnightTagged ? "YES" : "NO") + ". " +
    "Flip detected: " + (metrics.flipDetected ? "YES" : "NO") + ". " +
    "In exactly 1 short sentence: current Bear Trap status and what trader should do right now."
  );
}

// ─────────────────────────────────────────────────────────────
// EOD BRIEF — fires once at ~3:00 CST
// Grades the morning prediction vs what actually happened
// ─────────────────────────────────────────────────────────────
function writeEODBrief(sheet, data, cst) {
  try {
    var confidence   = getFlag("BT_LAST_CONFIDENCE") || "0";
    var signalIssued = getFlag("BT_SIGNAL_ISSUED")   || "NO";
    var signalPrice  = parseFloat(getFlag("BT_SIGNAL_PRICE"))  || 0;
    var flipTime     = getFlag("BT_FLIP_TIME")        || "—";
    var maxFlush     = parseFloat(getFlag("BT_MAX_FLUSH_PCT"))  || 0;
    var sessionHigh  = parseFloat(getFlag("BT_SESSION_HIGH"))   || 0;
    var dayOpen      = parseFloat(getFlag("BT_DAY_OPEN"))       || 0;
    var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
    var ripDetected  = getFlag("BT_RIP_DETECTED") === "YES";
    var flipDetected = getFlag("BT_FLIP_DETECTED") === "YES";

    // Grade the prediction
    var patternPlayed = ripDetected && flipDetected && Math.abs(maxFlush) >= BT.FLUSH_MIN_PCT;
    var grade, gradeColor;

    if (patternPlayed && signalIssued === "YES") {
      grade      = "✅ PATTERN CONFIRMED + SIGNAL CORRECT";
      gradeColor = "#1a4a1a";
    } else if (patternPlayed && signalIssued !== "YES") {
      grade      = "⚠️ PATTERN PLAYED — SIGNAL MISSED";
      gradeColor = "#4a3a00";
    } else if (!patternPlayed && signalIssued === "YES") {
      grade      = "❌ SIGNAL ISSUED — PATTERN DID NOT PLAY";
      gradeColor = "#4a1a1a";
    } else {
      grade      = "➡️ NO PATTERN TODAY";
      gradeColor = "#1a1a3e";
    }

    // EOD gain/loss context
    var closeVsOpen = dayOpen > 0 ? ((data.price - dayOpen) / dayOpen) * 100 : 0;
    var highVsOpen  = dayOpen > 0 ? ((sessionHigh - dayOpen) / dayOpen) * 100 : 0;

    // Build AI EOD brief
    var eodMemo = getEODAIMemo({
      confidence:    confidence,
      signalIssued:  signalIssued,
      signalPrice:   signalPrice,
      currentPrice:  data.price,
      maxFlush:      maxFlush,
      flipTime:      flipTime,
      ripDetected:   ripDetected,
      flipDetected:  flipDetected,
      overnightTagged: overnightTagged,
      closeVsOpen:   closeVsOpen,
      highVsOpen:    highVsOpen,
      grade:         grade
    });

    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();

    // Separator row
    sheet.appendRow(["── EOD BRIEF ──", "", "", "", "", "", "", "", "", ""]);
    var sepRow = sheet.getLastRow();
    sheet.getRange(sepRow, 1, 1, BT_HEADERS.length)
      .setBackground(gradeColor)
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setFontSize(9)
      .setFontStyle("italic");
    sheet.setRowHeight(sepRow, 20);

    // Summary row
    var summaryRow = [
      timeStr,
      data.price,
      grade,
      "Max flush: " + Math.abs(maxFlush).toFixed(2) + "%",
      "—",
      confidence + "%",
      signalIssued === "YES" ? "Signal @ $" + signalPrice.toFixed(2) : "No signal",
      "Close vs open: " + closeVsOpen.toFixed(2) + "%",
      "OH tagged: " + (overnightTagged ? "✅ YES" : "❌ NO"),
      eodMemo || "—"
    ];

    sheet.appendRow(summaryRow);
    var eodRow = sheet.getLastRow();
    sheet.getRange(eodRow, 1, 1, BT_HEADERS.length)
      .setBackground(gradeColor)
      .setFontColor("#e0e0ff")
      .setFontSize(9)
      .setWrap(true);
    sheet.setRowHeight(eodRow, 50);

    // Reset daily flags for tomorrow
    resetDailyBearTrapFlags();

    Logger.log("EOD Brief written: " + grade);
  } catch (e) {
    Logger.log("writeEODBrief ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// EOD AI BRIEF — slightly longer (3 sentences) for end-of-day
// ─────────────────────────────────────────────────────────────
function getEODAIMemo(ctx) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return null;

    var prompt =
      "SPY Bear Trap Open pattern — end of day review. " +
      "Morning confidence score: " + ctx.confidence + "%. " +
      "Signal issued: " + ctx.signalIssued + (ctx.signalPrice > 0 ? " at $" + ctx.signalPrice.toFixed(2) : "") + ". " +
      "Max morning flush: " + Math.abs(ctx.maxFlush).toFixed(2) + "%. " +
      "Flip detected: " + ctx.flipDetected + " at " + ctx.flipTime + ". " +
      "Rip confirmed: " + ctx.ripDetected + ". " +
      "Overnight high tagged: " + ctx.overnightTagged + ". " +
      "Close vs open: " + ctx.closeVsOpen.toFixed(2) + "%. " +
      "Grade: " + ctx.grade + ". " +
      "In 2-3 sentences: was the Bear Trap prediction accurate, and what was the key signal that mattered most today?";

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
// FORMAT ONE BEAR TRAP DATA ROW
// ─────────────────────────────────────────────────────────────
function applyBearTrapRowFormat(sheet, rowNum, metrics) {
  try {
    sheet.setRowHeight(rowNum, 24);

    var fullRow = sheet.getRange(rowNum, 1, 1, BT_HEADERS.length);
    fullRow
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
      .setFontColor("#00e5ff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");

    // PHASE — color by phase
    var phaseCell = sheet.getRange(rowNum, BTC.PHASE);
    phaseCell.setHorizontalAlignment("center").setFontWeight("bold");
    if (metrics.phase === PHASE.FLUSH) {
      phaseCell.setFontColor("#ff6b6b");
    } else if (metrics.phase === PHASE.STALL) {
      phaseCell.setFontColor("#ffd600");
    } else if (metrics.phase === PHASE.FLIP) {
      phaseCell.setFontColor("#00ff99");
    } else if (metrics.phase === PHASE.RIP) {
      phaseCell.setFontColor("#00ff99").setFontSize(10);
    } else {
      phaseCell.setFontColor("#9090cc");
    }

    // FLUSH DEPTH — red for negative
    var flushCell = sheet.getRange(rowNum, BTC.FLUSH_DEPTH);
    flushCell.setHorizontalAlignment("center");
    if (metrics.flushDepthPct < -BT.FLUSH_MIN_PCT) {
      flushCell.setFontColor("#ff6b6b");
    } else if (metrics.flushDepthPct > 0.1) {
      flushCell.setFontColor("#00ff99");
    } else {
      flushCell.setFontColor("#9090cc");
    }

    // VOL SIGNAL
    var volCell = sheet.getRange(rowNum, BTC.VOL_SIGNAL);
    volCell.setHorizontalAlignment("center");
    if (metrics.volPct > 0 && metrics.volPct < BT.VOLUME_WEAK_PCT) {
      volCell.setFontColor("#ffd600"); // weak vol = yellow warning
    } else if (metrics.volPct >= 100) {
      volCell.setFontColor("#ff6b6b"); // high vol on flush = caution
    } else {
      volCell.setFontColor("#9090cc");
    }

    // CONFIDENCE — green gradient text
    var confCell   = sheet.getRange(rowNum, BTC.CONFIDENCE);
    var conf       = metrics.confidence;
    var confColor  = conf >= 75 ? "#00ff99"
                   : conf >= 50 ? "#ffd600"
                   : conf >= 30 ? "#ff9944"
                   : "#ff6b6b";
    confCell
      .setHorizontalAlignment("center")
      .setFontColor(confColor)
      .setFontWeight("bold")
      .setFontSize(10);

    // ENTRY SIGNAL — highlight BUY CALLS
    var entryCell = sheet.getRange(rowNum, BTC.ENTRY_SIGNAL);
    entryCell.setHorizontalAlignment("center");
    if (metrics.entrySignal.indexOf("BUY CALLS") !== -1) {
      entryCell
        .setBackground("#003300")
        .setFontColor("#00ff99")
        .setFontWeight("bold")
        .setFontSize(10);
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
      .setFontColor("#ffd600")
      .setHorizontalAlignment("center")
      .setFontWeight("bold");

    // OVERNIGHT
    sheet.getRange(rowNum, BTC.OVERNIGHT)
      .setFontColor("#8888bb")
      .setFontSize(8)
      .setHorizontalAlignment("left");

    // AI MEMO
    sheet.getRange(rowNum, BTC.AI_MEMO)
      .setFontColor("#aaaacc")
      .setFontSize(8)
      .setWrap(true)
      .setHorizontalAlignment("left");

  } catch (e) {
    Logger.log("applyBearTrapRowFormat ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER: Convert ET Date to CST Date object
// CST = ET - 1 hour
// ─────────────────────────────────────────────────────────────
function toCSTDate(etDate) {
  var cstStr = etDate.toLocaleString("en-US", { timeZone: "America/Chicago" });
  return new Date(cstStr);
}

// ─────────────────────────────────────────────────────────────
// RESET daily Bear Trap flags at EOD
// ─────────────────────────────────────────────────────────────
function resetDailyBearTrapFlags() {
  var keys = [
    "BT_DAY_OPEN", "BT_SESSION_HIGH", "BT_SESSION_LOW",
    "BT_FLUSH_LOW", "BT_MAX_FLUSH_PCT", "BT_FLIP_DETECTED",
    "BT_FLIP_PRICE", "BT_FLIP_TIME", "BT_RIP_DETECTED",
    "BT_OVERNIGHT_HIGH", "BT_OVERNIGHT_LOW", "BT_PREMARKET_CLOSE",
    "BT_OVERNIGHT_TAGGED", "BT_LAST_AI_TIME", "BT_LAST_CONFIDENCE",
    "BT_LAST_PHASE", "BT_SIGNAL_ISSUED", "BT_SIGNAL_PRICE",
    "BT_RECENT_TICKS", "BT_PREOPEN_WRITTEN"
  ];
  keys.forEach(function(k) { setFlag(k, ""); });
  Logger.log("Bear Trap daily flags reset.");
}
