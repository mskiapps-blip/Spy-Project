// ============================================================
// FILE: BearTrapTracker.gs
// PURPOSE: 🪤 THE BEAR TRAP OPEN — pattern detection system.
//
//  All times in CST 12-hour format.
//
//  FIXES applied (2025-05-30):
//
//  FIX 1 — Invalidation return moved inside the once-daily gate.
//    Previously the outer `return` fired on every tick once
//    invalidated, silencing the sheet all day. Now only the
//    first invalidation tick returns early; all later ticks
//    fall through and keep logging normally.
//
//  FIX 2 — AI memo truncation check.
//    Gemini was being called with maxOutputTokens: 140 (sticky
//    note sized). It ran out of space mid-sentence and the half-
//    finished memo was saved as-is. Now uses 2000 tokens and
//    validates that the response ends with sentence-ending
//    punctuation before saving. Truncated = thrown away.
//
//  FIX 3 — Poisoned gate fix.
//    BT_LAST_AI_PHASE / BT_LAST_AI_SIGNAL / BT_LAST_AI_CONF_BAND
//    were being updated in shouldFireAI() BEFORE the AI call
//    happened. A failed or truncated call would permanently update
//    the gate state so it thought "nothing has changed" — locking
//    out all future AI memos for the rest of the day.
//    Now those flags are only written after a successful, validated
//    response comes back.
// ============================================================

var SHEET_BEAR_TRAP = "🪤 BEAR TRAP";

// ─────────────────────────────────────────────────────────────
// TIMING CONSTANTS — all in CST
// ─────────────────────────────────────────────────────────────
var BT = {
  OPEN_HOUR:               8,
  OPEN_MIN:                30,
  ACTIVE_END_HOUR:         9,
  ACTIVE_END_MIN:          30,
  EOD_HOUR:                15,
  EOD_MIN:                 0,
  EOD_WINDOW_MIN:          10,
  FLUSH_MIN_PCT:           0.20,
  FLUSH_STRONG_PCT:        0.40,
  VOLUME_WEAK_PCT:         90,
  MOMENTUM_FLIP_PCT:       0.05,
  OVERNIGHT_TAG_PCT:       0.15,
  CALL_CONFIRM_PCT:        0.10,
  FLUSH_FAST_PCT_PER_BAR:  0.15,
  FLUSH_SLOW_PCT_PER_BAR:  0.05,
  SCORE_VIX_NORMAL:        10
};

// ─────────────────────────────────────────────────────────────
// PHASE LABELS
// ─────────────────────────────────────────────────────────────
var PHASE = {
  PRE_OPEN: "PRE-OPEN",
  WATCH:    "WATCHING",
  FLUSH:    "FLUSHING 📉",
  STALL:    "STALLING ⏸️",
  FLIP:     "FLIPPING ⚡",
  RIP:      "RIPPING 🚀"
};

// ─────────────────────────────────────────────────────────────
// AI gate
// ─────────────────────────────────────────────────────────────
var AI_PHASE_CHANGE_GATE = true;

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
      var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
      if (eodFired !== todayStr) {
        writeEODBrief(sheet, data, now);
        setFlag("BT_EOD_FIRED_TODAY", todayStr);
      }
      return;
    }

    // ── Pre-open panel (before 8:30 CST) ─────────────────────
    if (totalMin < openMin) {
      if (data) updatePreOpenPanel(sheet, data, now);
      return;
    }

    // ── Outside active window (after 9:30 CST) ───────────────
    if (totalMin > activeEndMin) return;

    if (!data) return;

    // ── Fetch VIX + ES ────────────────────────────────────────
    var vixData = fetchVIX();
    var esData  = fetchESFutures();

    // ── Compute metrics ───────────────────────────────────────
    var metrics = computeBearTrapMetrics(data, cst, vixData, esData);

    // ── Early invalidation check ──────────────────────────────
    // FIX 1: `return` is now INSIDE the once-daily gate.
    // First invalidation tick → write row and return.
    // All later ticks → skip write, fall through, keep logging.
    var invalidReason = getActiveWindowInvalidationReason(vixData, esData, metrics);
    if (invalidReason) {
      var todayStr2    = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
      var invalidFired = getFlag("BT_INVALID_FIRED_TODAY");
      if (invalidFired !== todayStr2) {
        writeInvalidationRow(sheet, data, now, invalidReason);
        setFlag("BT_INVALID_FIRED_TODAY", todayStr2);
        return; // ← only exits on the FIRST invalidation tick
      }
      // already fired today — fall through and keep logging
    }

    // ── AI memo — gated ───────────────────────────────────────
    var aiMemo = null;
    if (shouldFireAI(metrics)) {
      aiMemo = getBearTrapAIMemo(metrics, data, vixData, esData, now);
    }

    // ── Build row ─────────────────────────────────────────────
    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();

    var flushStr      = metrics.flushDepthPct !== 0
      ? (metrics.flushDepthPct < 0 ? "" : "+") + metrics.flushDepthPct.toFixed(2) + "%"
      : "—";
    var flushSpeedStr = metrics.flushSpeedStr || "—";
    var volStr        = metrics.volPct > 0 ? metrics.volPct.toFixed(0) + "% of pace" : "—";
    var vixStr        = vixData ? vixData.price.toFixed(2) + " [" + vixData.regime + "]" : "—";
    var esStr         = esData  ? "$" + esData.price.toFixed(2) + " " + esData.trend    : "—";
    var confStr       = Math.min(metrics.confidence, 100) + "%";
    var targetStr     = metrics.targetPrice ? "$" + metrics.targetPrice.toFixed(2) : "—";

    var row = [
      timeStr,
      data.price,
      metrics.trapAlert || "—",
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
// SHOULD FIRE AI
// FIX 3: conf band flag is NO LONGER updated here.
// It is only updated inside getBearTrapAIMemo() after a
// successful, validated response. This prevents a failed or
// truncated call from poisoning the gate and locking out all
// future memos for the rest of the day.
// ─────────────────────────────────────────────────────────────
function shouldFireAI(metrics) {
  if (!AI_PHASE_CHANGE_GATE) return true;

  var callCount = parseInt(getFlag("BT_AI_CALL_COUNT") || "0");
  if (callCount >= 10) return false;

  var lastPhase  = getFlag("BT_LAST_AI_PHASE")      || "";
  var lastSignal = getFlag("BT_LAST_AI_SIGNAL")     || "";
  var lastConf   = parseInt(getFlag("BT_LAST_AI_CONF_BAND") || "-1");

  var confBand = Math.floor(metrics.confidence / 25);

  var phaseChanged  = metrics.phase !== lastPhase;
  var signalChanged = metrics.entrySignal !== lastSignal;
  var confChanged   = confBand !== lastConf;

  // NOTE: we do NOT write BT_LAST_AI_CONF_BAND here anymore.
  // That write only happens in getBearTrapAIMemo() on success.
  return phaseChanged || signalChanged || confChanged;
}

// ─────────────────────────────────────────────────────────────
// AI MEMO — intraday
// FIX 2: maxOutputTokens raised to 2000 (was 140 — sticky note).
// FIX 2: truncation check — must end with . ! or ? and be ≥ 40
//         chars. Garbage in = nothing saved.
// FIX 3: gate flags (phase, signal, confBand) only written on
//         a clean, validated response — never on failure.
// ─────────────────────────────────────────────────────────────
function getBearTrapAIMemo(metrics, data, vixData, esData, now) {
  try {
    if (!shouldAllowAICall(AI_FEATURE.BEAR_TRAP)) {
      Logger.log("BT: AI skipped by quota guard.");
      return null;
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return "⚙️ Add GEMINI_API_KEY to enable AI memos.";

    var prompt = buildBearTrapPrompt(metrics, data, vixData, esData);
    Logger.log("BT AI prompt (" + prompt.length + " chars): " + prompt);

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.3 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      payload:            payload,
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    Logger.log("BT Gemini response code: " + code);

    if (code !== 200) {
      Logger.log("BT Gemini error: " + resp.getContentText().substring(0, 200));
      recordAICall(AI_FEATURE.BEAR_TRAP, false);
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

    // ── FIX 2: Truncation check ───────────────────────────────
    // Throw away anything too short or mid-sentence.
    if (!text || text.length < 40) {
      Logger.log("BT: AI memo rejected — too short (" + (text ? text.length : 0) + " chars).");
      recordAICall(AI_FEATURE.BEAR_TRAP, false);
      return null;
    }
    var lastChar = text[text.length - 1];
    if (lastChar !== "." && lastChar !== "!" && lastChar !== "?") {
      Logger.log("BT: AI memo rejected — appears truncated, ends with: '" + lastChar + "' | text: " + text.substring(0, 80));
      recordAICall(AI_FEATURE.BEAR_TRAP, false);
      return null;
    }

    // ── FIX 3: Only update gate flags on clean success ────────
    var callCount = parseInt(getFlag("BT_AI_CALL_COUNT") || "0");
    setFlag("BT_AI_CALL_COUNT",    (callCount + 1).toString());
    setFlag("BT_LAST_AI_PHASE",    metrics.phase);
    setFlag("BT_LAST_AI_SIGNAL",   metrics.entrySignal);
    setFlag("BT_LAST_AI_CONF_BAND", Math.floor(metrics.confidence / 25).toString());

    recordAICall(AI_FEATURE.BEAR_TRAP, true);
    return "🤖 " + text;

  } catch (e) {
    Logger.log("getBearTrapAIMemo ERROR: " + e.message);
    recordAICall(AI_FEATURE.BEAR_TRAP, false);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD BEAR TRAP PROMPT — enriched
// ─────────────────────────────────────────────────────────────
function buildBearTrapPrompt(metrics, data, vixData, esData) {
  var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";

  var vwap    = data.vwap || parseFloat(getFlag("DAY_VWAP")) || 0;
  var vwapStr = vwap > 0
    ? "$" + vwap.toFixed(2) + " (" + ((data.price - vwap) / vwap * 100).toFixed(2) + "% " +
      (data.price >= vwap ? "above" : "below") + ")"
    : "unknown";

  var s1 = getFlag("SESSION_LAST_S1") || "—";
  var r1 = getFlag("SESSION_LAST_R1") || "—";

  var mbSetup     = getFlag("MB_SETUP_TYPE")       || "unknown";
  var mbRationale = getFlag("MB_RATIONALE")        || "";
  var mbFlush     = parseFloat(getFlag("MB_FLUSH_TARGET")) || 0;
  var mbFlip      = parseFloat(getFlag("MB_FLIP_ZONE"))    || 0;

  var sessionCtx = buildSessionContext();

  return (
    "SPY Bear Trap detector.\n" +
    "Price: $" + data.price.toFixed(2) +
      " | Phase: " + metrics.phase +
      " | Conf: " + metrics.confidence + "%\n" +
    "Flush: " + Math.abs(metrics.maxFlushPct).toFixed(2) + "%" +
      " speed: " + (metrics.flushFast ? "FAST" : "SLOW") +
      " | Vol: " + (metrics.volPct > 0 ? metrics.volPct.toFixed(0) + "% of pace" : "unknown") + "\n" +
    "VIX: " + (vixData ? vixData.price.toFixed(1) + " [" + vixData.regime + "]" : "unknown") +
      " | ES: " + (esData ? esData.trend : "unknown") + "\n" +
    "OH tagged: " + (overnightTagged ? "YES" : "NO") +
      " | Flip: " + (metrics.flipDetected ? "YES" : "NO") + "\n" +
    "VWAP: " + vwapStr + "\n" +
    "S1 (support): " + s1 + "\n" +
    "R1 (resistance): " + r1 + "\n" +
    "Morning brief: " + mbSetup + (mbRationale ? " — " + mbRationale : "") + "\n" +
    (mbFlush > 0 ? "Predicted flush target: $" + mbFlush.toFixed(2) + "\n" : "") +
    (mbFlip  > 0 ? "Predicted flip zone: $"    + mbFlip.toFixed(2)  + "\n" : "") +
    sessionCtx + "\n" +
    "2 sentences: assess trap probability at this phase + specific level or signal to watch for next."
  );
}

// ─────────────────────────────────────────────────────────────
// EOD AI MEMO
// Same truncation check as intraday memo.
// Gate flags not relevant here (EOD fires once), but still
// validates response before saving.
// ─────────────────────────────────────────────────────────────
function getEODAIMemo(ctx) {
  try {
    if (!shouldAllowAICall(AI_FEATURE.BEAR_TRAP_EOD)) {
      Logger.log("BT EOD: AI skipped by quota guard.");
      return null;
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return null;

    var mbSetup       = getFlag("MB_SETUP_TYPE")               || "unknown";
    var mbFlushTarget = parseFloat(getFlag("MB_FLUSH_TARGET"))  || 0;
    var winRate       = getFlag("SC_ROLLING_WIN_RATE")          || "?";
    var patRate       = getFlag("SC_ROLLING_PATTERN_RATE")      || "?";
    var totalDays     = getFlag("SC_TOTAL_DAYS")                || "?";

    var prompt =
      "Bear Trap EOD debrief.\n" +
      "Result: " + ctx.grade + "\n" +
      "Peak confidence: " + ctx.confidence + "%" +
        " | Signal issued: " + ctx.signalIssued +
        (ctx.signalPrice > 0 ? " @ $" + ctx.signalPrice.toFixed(2) : "") + "\n" +
      "Max flush: " + Math.abs(ctx.maxFlush).toFixed(2) + "%" +
        (mbFlushTarget > 0 ? " (brief predicted $" + mbFlushTarget.toFixed(2) + ")" : "") + "\n" +
      "Flip: " + ctx.flipDetected + " at " + ctx.flipTime + "\n" +
      "Rip confirmed: " + ctx.ripDetected + "\n" +
      "Overnight high tagged: " + ctx.overnightTagged + "\n" +
      "Close vs open: " + ctx.closeVsOpen.toFixed(2) + "%\n" +
      "Morning brief setup: " + mbSetup + "\n" +
      "Rolling win rate: " + winRate + "% over " + totalDays + " days" +
        (patRate !== "?" ? " | Pattern rate: " + patRate + "%" : "") + "\n" +
      "AI calls used today: " + ctx.aiCallsUsed + "/10\n" +
      "2 sentences: grade today's pattern quality and one lesson for tomorrow.";

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.4 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("BT EOD Gemini error: " + resp.getResponseCode());
      recordAICall(AI_FEATURE.BEAR_TRAP_EOD, false);
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

    // Truncation check
    if (!text || text.length < 40) {
      Logger.log("BT EOD: memo rejected — too short.");
      recordAICall(AI_FEATURE.BEAR_TRAP_EOD, false);
      return null;
    }
    var lastChar = text[text.length - 1];
    if (lastChar !== "." && lastChar !== "!" && lastChar !== "?") {
      Logger.log("BT EOD: memo rejected — truncated, ends with: '" + lastChar + "'");
      recordAICall(AI_FEATURE.BEAR_TRAP_EOD, false);
      return null;
    }

    recordAICall(AI_FEATURE.BEAR_TRAP_EOD, true);
    return "🤖 EOD: " + text;

  } catch (e) {
    Logger.log("getEODAIMemo ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// EARLY INVALIDATION CHECK
// ─────────────────────────────────────────────────────────────
function getActiveWindowInvalidationReason(vixData, esData, metrics) {
  if (esData && esData.alignmentTag === "ES VOID") {
    return "ES futures fading hard — real distribution, not a trap";
  }
  if (vixData && vixData.regime === "FEAR") {
    return "VIX in FEAR regime — flush likely real selling";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// PRE-OPEN PANEL
// ─────────────────────────────────────────────────────────────
function updatePreOpenPanel(sheet, data, now) {
  try {
    var pmData = fetchPreMarketData();
    if (!pmData) return;

    setFlag("BT_OVERNIGHT_HIGH",  pmData.high.toString());
    setFlag("BT_OVERNIGHT_LOW",   pmData.low.toString());
    setFlag("BT_PREMARKET_CLOSE", pmData.close.toString());

    var priceDiffPct = Math.abs((data.price - pmData.high) / pmData.high) * 100;
    if (priceDiffPct <= BT.OVERNIGHT_TAG_PCT) {
      setFlag("BT_OVERNIGHT_TAGGED", "YES");
    }

    var lastPreOpen = getFlag("BT_PREOPEN_WRITTEN");
    var todayStr    = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
    if (lastPreOpen === todayStr) return;

    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();
    var tagStr  = priceDiffPct <= BT.OVERNIGHT_TAG_PCT ? "🚨 HIGH TAGGED" : "—";
    var summary = "PM High: $" + pmData.high.toFixed(2)
                + "  PM Low: $" + pmData.low.toFixed(2)
                + "  Last: $"   + pmData.close.toFixed(2);

    var vixData = fetchVIX();
    var esData  = fetchESFutures();
    var vixStr  = vixData ? vixData.price.toFixed(2) + " [" + vixData.regime + "]" : "—";
    var esStr   = esData  ? "$" + esData.price.toFixed(2) + " " + esData.trend    : "—";

    var preRow = new Array(BT_HEADERS.length).fill("—");
    preRow[BTC.TIME - 1]         = timeStr;
    preRow[BTC.PRICE - 1]        = data.price;
    preRow[BTC.PHASE - 1]        = PHASE.PRE_OPEN;
    preRow[BTC.VIX - 1]          = vixStr;
    preRow[BTC.ES_TREND - 1]     = esStr;
    preRow[BTC.ENTRY_SIGNAL - 1] = tagStr;
    preRow[BTC.OVERNIGHT - 1]    = summary;
    preRow[BTC.AI_MEMO - 1]      = "⏳ Watching pre-market...";

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
// EOD BRIEF — fires once at 3:00 CST, logs to SCORECARD
// ─────────────────────────────────────────────────────────────
function writeEODBrief(sheet, data, now) {
  try {
    var confidence      = getFlag("BT_LAST_CONFIDENCE")  || "0";
    var signalIssued    = getFlag("BT_SIGNAL_ISSUED")    || "NO";
    var signalPrice     = parseFloat(getFlag("BT_SIGNAL_PRICE"))  || 0;
    var flipTime        = getFlag("BT_FLIP_TIME")         || "—";
    var maxFlush        = parseFloat(getFlag("BT_MAX_FLUSH_PCT"))  || 0;
    var dayOpen         = parseFloat(getFlag("BT_DAY_OPEN"))       || 0;
    var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
    var ripDetected     = getFlag("BT_RIP_DETECTED")  === "YES";
    var flipDetected    = getFlag("BT_FLIP_DETECTED") === "YES";
    var aiCallCount     = getFlag("BT_AI_CALL_COUNT") || "0";

    var patternPlayed = ripDetected && flipDetected && Math.abs(maxFlush) >= BT.FLUSH_MIN_PCT;
    var grade, gradeColor;

    if      (patternPlayed && signalIssued === "YES")  { grade = "✅ CONFIRMED + SIGNAL CORRECT";    gradeColor = "#1a4a1a"; }
    else if (patternPlayed && signalIssued !== "YES")  { grade = "⚠️ PATTERN PLAYED — SIGNAL MISSED"; gradeColor = "#4a3a00"; }
    else if (!patternPlayed && signalIssued === "YES") { grade = "❌ SIGNAL ISSUED — NO PATTERN";     gradeColor = "#4a1a1a"; }
    else                                               { grade = "➡️ NO PATTERN TODAY";               gradeColor = "#1a1a3e"; }

    var closeVsOpen = dayOpen > 0 ? ((data.price - dayOpen) / dayOpen) * 100 : 0;

    var eodMemo = getEODAIMemo({
      confidence:      confidence,
      signalIssued:    signalIssued,
      signalPrice:     signalPrice,
      maxFlush:        maxFlush,
      flipTime:        flipTime,
      ripDetected:     ripDetected,
      flipDetected:    flipDetected,
      overnightTagged: overnightTagged,
      closeVsOpen:     closeVsOpen,
      grade:           grade,
      aiCallsUsed:     aiCallCount
    });

    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();

    var summaryRow = new Array(BT_HEADERS.length).fill("—");
    summaryRow[BTC.TIME - 1]         = timeStr + " EOD";
    summaryRow[BTC.PRICE - 1]        = data.price;
    summaryRow[BTC.TRAP_ALERT - 1]   = grade;
    summaryRow[BTC.PHASE - 1]        = "EOD BRIEF";
    summaryRow[BTC.CONFIDENCE - 1]   = parseInt(confidence);
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

    logToScorecard(now, confidence, signalIssued, signalPrice,
                   patternPlayed, grade, maxFlush, closeVsOpen,
                   overnightTagged, aiCallCount);

    resetDailyBearTrapFlags();
    Logger.log("EOD Brief written: " + grade);

  } catch (e) {
    Logger.log("writeEODBrief ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// WRITE INVALIDATION ROW
// ─────────────────────────────────────────────────────────────
function writeInvalidationRow(sheet, data, now, reason) {
  try {
    var timeStr    = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();
    var invalidRow = new Array(BT_HEADERS.length).fill("—");
    invalidRow[BTC.TIME - 1]         = timeStr;
    invalidRow[BTC.PRICE - 1]        = data.price;
    invalidRow[BTC.TRAP_ALERT - 1]   = "🚫 INVALIDATED — " + reason;
    invalidRow[BTC.PHASE - 1]        = "VOID";
    invalidRow[BTC.ENTRY_SIGNAL - 1] = "❌ NO TRADE TODAY";
    invalidRow[BTC.AI_MEMO - 1]      = "Strategy voided. " + reason;

    sheet.appendRow(invalidRow);
    var r = sheet.getLastRow();
    sheet.getRange(r, 1, 1, BT_HEADERS.length)
      .setBackground("#2a0000").setFontColor("#ff8080")
      .setFontSize(9).setFontWeight("bold");
    sheet.setRowHeight(r, 24);
    Logger.log("Invalidation row written: " + reason);
  } catch (e) {
    Logger.log("writeInvalidationRow ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// COMPUTE BEAR TRAP METRICS
// ─────────────────────────────────────────────────────────────
function computeBearTrapMetrics(data, cst, vixData, esData) {
  var price   = data.price;
  var dayOpen = parseFloat(getFlag("BT_DAY_OPEN")) || 0;
  if (dayOpen === 0) {
    dayOpen = price;
    setFlag("BT_DAY_OPEN", dayOpen.toString());
  }

  var sessionHigh = parseFloat(getFlag("BT_SESSION_HIGH")) || price;
  var sessionLow  = parseFloat(getFlag("BT_SESSION_LOW"))  || price;
  if (price > sessionHigh) { sessionHigh = price; setFlag("BT_SESSION_HIGH", sessionHigh.toString()); }
  if (price < sessionLow)  { sessionLow  = price; setFlag("BT_SESSION_LOW",  sessionLow.toString());  }

  var localHigh       = parseFloat(getFlag("BT_LOCAL_HIGH"))        || 0;
  var localHighMin    = parseInt(getFlag("BT_LOCAL_HIGH_MIN") || "0");
  var localHighLocked = getFlag("BT_LOCAL_HIGH_LOCKED") === "YES";
  var nowMins         = cst.getHours() * 60 + cst.getMinutes();

  if (!localHighLocked) {
    if (price > localHigh) {
      localHigh    = price;
      localHighMin = nowMins;
      setFlag("BT_LOCAL_HIGH",     localHigh.toString());
      setFlag("BT_LOCAL_HIGH_MIN", localHighMin.toString());
    }
  }

  var flushAnchor   = localHigh > 0 ? localHigh : dayOpen;
  var flushDepthPct = flushAnchor > 0 ? ((price - flushAnchor) / flushAnchor) * 100 : 0;

  var maxFlushPct = parseFloat(getFlag("BT_MAX_FLUSH_PCT")) || 0;
  if (flushDepthPct < maxFlushPct) {
    maxFlushPct = flushDepthPct;
    setFlag("BT_MAX_FLUSH_PCT", maxFlushPct.toString());
    setFlag("BT_FLUSH_LOW", price.toString());
    if (!localHighLocked) {
      setFlag("BT_LOCAL_HIGH_LOCKED", "YES");
      localHighLocked = true;
    }
  }

  var flushStartMin = parseInt(getFlag("BT_FLUSH_START_MIN") || "0");
  if (flushStartMin === 0 && Math.abs(flushDepthPct) >= BT.FLUSH_MIN_PCT) {
    flushStartMin = nowMins;
    setFlag("BT_FLUSH_START_MIN", flushStartMin.toString());
  }

  var flushRefMin    = flushStartMin > 0 ? flushStartMin : localHighMin;
  var barsInFlush    = Math.max(1, Math.round((nowMins - flushRefMin) / 5));
  var flushPctPerBar = barsInFlush > 0 ? Math.abs(maxFlushPct) / barsInFlush : 0;

  var flushFast = false;
  var flushSpeedStr;
  if (Math.abs(maxFlushPct) < BT.FLUSH_MIN_PCT) {
    flushSpeedStr = "—";
  } else if (flushPctPerBar >= BT.FLUSH_FAST_PCT_PER_BAR) {
    flushSpeedStr = "⚡ FAST (" + flushPctPerBar.toFixed(3) + "%/bar)";
    flushFast = true;
  } else if (flushPctPerBar >= BT.FLUSH_SLOW_PCT_PER_BAR) {
    flushSpeedStr = "📊 MOD (" + flushPctPerBar.toFixed(3) + "%/bar)";
  } else {
    flushSpeedStr = "🐌 SLOW (" + flushPctPerBar.toFixed(3) + "%/bar)";
  }

  var volPct  = 0;
  var volWeak = false;
  if (data.volumeToday > 0 && data.avgVol30 > 0) {
    var minutesSinceOpen = Math.max(1, nowMins - (BT.OPEN_HOUR * 60 + BT.OPEN_MIN));
    var expectedVol      = (data.avgVol30 / 390) * minutesSinceOpen;
    volPct  = expectedVol > 0 ? (data.volumeToday / expectedVol) * 100 : 0;
    volWeak = volPct < BT.VOLUME_WEAK_PCT;
  }

  var overnightHigh   = parseFloat(getFlag("BT_OVERNIGHT_HIGH")) || 0;
  var overnightLow    = parseFloat(getFlag("BT_OVERNIGHT_LOW"))  || 0;
  var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
  var overnightStr    = buildOvernightStr(price, overnightHigh, overnightLow, dayOpen);

  var recentTicksRaw = getFlag("BT_RECENT_TICKS") || "";
  var recentTicks    = recentTicksRaw ? recentTicksRaw.split(",").map(parseFloat) : [];
  recentTicks.push(price);
  if (recentTicks.length > 3) recentTicks.shift();
  setFlag("BT_RECENT_TICKS", recentTicks.join(","));

  var tickPct = recentTicks.length >= 2
    ? ((recentTicks[recentTicks.length - 1] - recentTicks[0]) / recentTicks[0]) * 100
    : 0;

  var flipDetected = getFlag("BT_FLIP_DETECTED") === "YES";
  var ripDetected  = getFlag("BT_RIP_DETECTED")  === "YES";
  var flushExists  = Math.abs(maxFlushPct) >= BT.FLUSH_MIN_PCT;
  var flushStrong  = Math.abs(maxFlushPct) >= BT.FLUSH_STRONG_PCT;

  var prevPrice     = parseFloat(getFlag("PREV_PRICE")) || 0;
  var singleTickPct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

  if (!flipDetected && flushExists && singleTickPct >= BT.MOMENTUM_FLIP_PCT && price < flushAnchor) {
    flipDetected = true;
    setFlag("BT_FLIP_DETECTED", "YES");
    setFlag("BT_FLIP_PRICE",    price.toString());
  }

  if (!ripDetected && flipDetected) {
    var flipPrice = parseFloat(getFlag("BT_FLIP_PRICE")) || 0;
    if (flipPrice > 0 && price > flipPrice * 1.002) {
      ripDetected = true;
      setFlag("BT_RIP_DETECTED", "YES");
    }
  }

  var phase;
  if (ripDetected)       { phase = PHASE.RIP; }
  else if (flipDetected) { phase = PHASE.FLIP; }
  else if (flushExists)  {
    var stalling = Math.abs(tickPct) < 0.05 && recentTicks.length >= 3;
    phase = stalling ? PHASE.STALL : PHASE.FLUSH;
  }
  else { phase = PHASE.WATCH; }

  var score = 0;
  if (overnightTagged)                                     score += 20;
  if (flushExists)                                         score += 15;
  if (flushStrong)                                         score += 10;
  if (flushFast)                                           score += 15;
  if (volWeak && flushExists)                              score += 15;
  if (flipDetected)                                        score += 15;
  if (ripDetected)                                         score += 10;
  if (vixData && vixData.regime === "NORMAL")              score += BT.SCORE_VIX_NORMAL;
  if (esData  && esData.trend === "FADING" && flushExists) score += 10;
  if (esData  && esData.alignmentTag === "ES CAUTION")     score -= 10;
  if (esData  && esData.alignmentTag === "ES VOID")        score -= 30;
  if (vixData && vixData.regime === "FEAR")                score -= 20;
  score = Math.max(0, Math.min(100, score));

  setFlag("BT_LAST_CONFIDENCE", score.toString());

  var trapAlert   = "—";
  var entrySignal = "—";
  var targetPrice = null;

  if (ripDetected) {
    trapAlert   = "🚀 RIP CONFIRMED — Manage position";
    entrySignal = "🚀 RIP IN PROGRESS";
  } else if (score >= 75 && flipDetected) {
    targetPrice = flushExists
      ? Math.round(parseFloat(getFlag("BT_FLUSH_LOW") || price) * (1 + BT.CALL_CONFIRM_PCT / 100) * 100) / 100
      : null;
    trapAlert   = "✅ ENTER CALLS NOW — Target $" + (targetPrice ? targetPrice.toFixed(2) : "?");
    entrySignal = "✅ BUY CALLS — Conf " + score + "%";
  } else if (flipDetected) {
    targetPrice = flushExists
      ? Math.round(parseFloat(getFlag("BT_FLUSH_LOW") || price) * (1 + BT.CALL_CONFIRM_PCT / 100) * 100) / 100
      : null;
    entrySignal = "👀 WATCH — Flip @ $" + (targetPrice ? targetPrice.toFixed(2) : "?");
    trapAlert   = "⚡ FLIP DETECTED — Watch $" + (targetPrice ? targetPrice.toFixed(2) : "?");
  } else if (score >= 50 && flushExists && phase === PHASE.STALL) {
    entrySignal = "🟡 PATTERN FORMING (" + score + "%)";
    trapAlert   = "⚠️ STALL — DO NOT BUY PUTS — Wait for flip";
  } else if (score >= 50 && flushExists) {
    entrySignal = "🟡 PATTERN FORMING (" + score + "%)";
    trapAlert   = "🚨 DO NOT BUY PUTS — Bear Trap " + score + "% confidence";
  } else if (score >= 35 && flushExists) {
    entrySignal = "👁 WATCHING (" + score + "%)";
    trapAlert   = "⚠️ POSSIBLE TRAP — Avoid puts for now";
  } else if (score < 25 && flushExists) {
    entrySignal = "❌ NOT TODAY";
    trapAlert   = "—";
  } else if (!flushExists) {
    trapAlert = "—";
  }

  if (entrySignal.indexOf("BUY") !== -1) {
    setFlag("BT_SIGNAL_ISSUED", "YES");
    setFlag("BT_SIGNAL_PRICE",  price.toString());
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
    trapAlert:     trapAlert,
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
// FORMAT ONE DATA ROW
// ─────────────────────────────────────────────────────────────
function applyBearTrapRowFormat(sheet, rowNum, metrics, vixData, esData) {
  try {
    sheet.setRowHeight(rowNum, 26);

    var rowBg = (rowNum % 2 === 0) ? BT_COLOR.ROW_EVEN : BT_COLOR.ROW_ODD;

    if      (metrics.ripDetected)                              rowBg = BT_COLOR.ROW_RIP;
    else if (metrics.entrySignal.indexOf("BUY") !== -1)        rowBg = BT_COLOR.ROW_BUY;
    else if (metrics.flipDetected)                             rowBg = BT_COLOR.ROW_FLIP;
    else if (metrics.phase === PHASE.STALL)                    rowBg = BT_COLOR.ROW_STALL;
    else if (metrics.confidence >= 50 && metrics.flushExists)  rowBg = BT_COLOR.ROW_FLUSH;

    sheet.getRange(rowNum, 1, 1, BT_HEADERS.length).setBackground(rowBg);

    sheet.getRange(rowNum, BTC.TIME).setFontColor(BT_COLOR.TEXT_DIM).setFontSize(9).setFontFamily(BT_FONT.MONO).setHorizontalAlignment("center");
    sheet.getRange(rowNum, BTC.PRICE).setFontColor(BT_COLOR.TEXT_PRIMARY).setFontSize(10).setFontFamily(BT_FONT.MONO).setFontWeight("bold").setHorizontalAlignment("center");

    var trapCell = sheet.getRange(rowNum, BTC.TRAP_ALERT);
    trapCell.setFontSize(9).setFontWeight("bold").setWrap(false);
    if      (metrics.ripDetected)                              trapCell.setFontColor(BT_COLOR.TEXT_GREEN);
    else if (metrics.entrySignal.indexOf("BUY") !== -1)        trapCell.setFontColor(BT_COLOR.TEXT_GREEN);
    else if (metrics.flipDetected)                             trapCell.setFontColor(BT_COLOR.TEXT_GOLD);
    else if (metrics.confidence >= 50 && metrics.flushExists)  trapCell.setFontColor(BT_COLOR.TEXT_RED);
    else                                                       trapCell.setFontColor(BT_COLOR.TEXT_DIM);

    sheet.getRange(rowNum, BTC.PHASE).setFontColor(BT_COLOR.TEXT_SECONDARY).setFontSize(9).setHorizontalAlignment("center");
    sheet.getRange(rowNum, BTC.FLUSH_DEPTH).setFontFamily(BT_FONT.MONO).setFontColor(
      metrics.flushDepthPct < -0.40 ? BT_COLOR.TEXT_RED :
      metrics.flushDepthPct < 0     ? BT_COLOR.TEXT_GOLD : BT_COLOR.TEXT_DIM
    ).setFontSize(9).setHorizontalAlignment("center");
    sheet.getRange(rowNum, BTC.FLUSH_SPEED).setFontColor(BT_COLOR.TEXT_DIM).setFontSize(8).setHorizontalAlignment("center");
    sheet.getRange(rowNum, BTC.VOLUME).setFontColor(BT_COLOR.TEXT_SECONDARY).setFontSize(9).setHorizontalAlignment("center");

    if (vixData) {
      sheet.getRange(rowNum, BTC.VIX).setFontSize(9).setHorizontalAlignment("center")
        .setFontColor(
          vixData.regime === "FEAR"     ? BT_COLOR.TEXT_RED   :
          vixData.regime === "ELEVATED" ? BT_COLOR.TEXT_GOLD  :
          vixData.regime === "NORMAL"   ? BT_COLOR.TEXT_GREEN : BT_COLOR.TEXT_DIM
        );
    }
    if (esData) {
      sheet.getRange(rowNum, BTC.ES_TREND).setFontSize(9).setHorizontalAlignment("center")
        .setFontColor(
          esData.alignmentTag === "ES VOID"   ? BT_COLOR.TEXT_RED   :
          esData.trend        === "FADING"    ? BT_COLOR.TEXT_GREEN :
          esData.trend        === "CLIMBING"  ? BT_COLOR.TEXT_RED   : BT_COLOR.TEXT_GOLD
        );
    }

    var conf = metrics.confidence;
    sheet.getRange(rowNum, BTC.CONFIDENCE)
      .setHorizontalAlignment("center").setFontFamily(BT_FONT.MONO).setFontWeight("bold").setFontSize(10)
      .setFontColor(conf >= 75 ? BT_COLOR.TEXT_GREEN : conf >= 50 ? BT_COLOR.TEXT_GOLD : conf >= 30 ? "#ff8a65" : BT_COLOR.TEXT_RED);

    var entryCell = sheet.getRange(rowNum, BTC.ENTRY_SIGNAL);
    entryCell.setHorizontalAlignment("center").setFontSize(9);
    if      (metrics.entrySignal.indexOf("BUY CALLS") !== -1) { entryCell.setBackground("#1b5e20").setFontColor("#ffffff").setFontWeight("bold").setFontSize(10); }
    else if (metrics.entrySignal.indexOf("WATCH")     !== -1 ||
             metrics.entrySignal.indexOf("FLIP")      !== -1) { entryCell.setFontColor(BT_COLOR.TEXT_GOLD).setFontWeight("bold"); }
    else if (metrics.entrySignal.indexOf("RIP")       !== -1) { entryCell.setFontColor(BT_COLOR.TEXT_GREEN).setFontWeight("bold"); }
    else if (metrics.entrySignal.indexOf("NOT TODAY") !== -1) { entryCell.setFontColor(BT_COLOR.TEXT_DIM); }
    else                                                       { entryCell.setFontColor("#7a7a9a"); }

    sheet.getRange(rowNum, BTC.TARGET_PRICE).setFontFamily(BT_FONT.MONO).setFontColor(BT_COLOR.TEXT_GOLD).setFontWeight("bold").setFontSize(9).setHorizontalAlignment("center");
    sheet.getRange(rowNum, BTC.OVERNIGHT).setFontColor("#5a5a7a").setFontSize(8).setHorizontalAlignment("left");
    sheet.getRange(rowNum, BTC.AI_MEMO).setFontColor("#7a7a9a").setFontSize(8).setFontStyle("italic").setWrap(true).setHorizontalAlignment("left");

  } catch (e) {
    Logger.log("applyBearTrapRowFormat ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CST HELPER
// ─────────────────────────────────────────────────────────────
function toCSTDate(utcDate) {
  var h   = parseInt(Utilities.formatDate(utcDate, "America/Chicago", "H"),  10);
  var m   = parseInt(Utilities.formatDate(utcDate, "America/Chicago", "mm"), 10);
  var dow = parseInt(Utilities.formatDate(utcDate, "America/Chicago", "u"),  10) % 7;
  return {
    _utc:       utcDate,
    getHours:   function() { return h;   },
    getMinutes: function() { return m;   },
    getDay:     function() { return dow; },
    getTime:    function() { return utcDate.getTime(); }
  };
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
    "BT_LOCAL_HIGH", "BT_LOCAL_HIGH_MIN", "BT_LOCAL_HIGH_LOCKED",
    "BT_FLUSH_START_MIN",
    "BT_LAST_AI_PHASE", "BT_LAST_AI_CONF_BAND", "BT_LAST_AI_SIGNAL",
    "BT_AI_CALL_COUNT",
    "BT_INVALID_FIRED_TODAY"
  ];
  keys.forEach(function(k) { setFlag(k, ""); });
  Logger.log("Bear Trap daily flags reset.");
}
