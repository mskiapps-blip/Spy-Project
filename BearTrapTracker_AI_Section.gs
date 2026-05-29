// ============================================================
// FILE: BearTrapTracker_AI_Section.gs
// ============================================================
//
//  WHAT CHANGED — AI prompt enrichment update
//  ──────────────────────────────────────────
//  This file contains ONLY the functions that changed.
//  Replace the matching functions in your existing
//  BearTrapTracker.gs with these updated versions.
//
//  Changed functions:
//    • getBearTrapAIMemo()     — output tokens 80 → 140
//    • buildBearTrapPrompt()   — adds VWAP, S/R, session context
//    • getEODAIMemo()          — adds scorecard comparison +
//                                morning brief accuracy
//
//  Everything else in BearTrapTracker.gs is unchanged.
// ============================================================


// ─────────────────────────────────────────────────────────────
// AI MEMO — fires only when gate allows (see shouldFireAI)
// Richer prompt: VWAP + S/R + historical context.
// ~130 tokens in, 140 tokens out = ~270 tokens per call.
// At 8 calls/day = ~2,160 tokens. Still well under free tier.
// ─────────────────────────────────────────────────────────────
function getBearTrapAIMemo(metrics, data, vixData, esData, cst) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return "⚙️ Add GEMINI_API_KEY to enable AI memos.";

    var prompt = buildBearTrapPrompt(metrics, data, vixData, esData);
    Logger.log("BT AI prompt (" + prompt.length + " chars): " + prompt);

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 140, temperature: 0.3 }
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
// BUILD BEAR TRAP PROMPT — enriched version
//
// Added vs old prompt:
//   • Price vs VWAP (distance + direction)
//   • Nearest support (S1) and resistance (R1) from flags
//   • Morning brief setup type + rationale
//   • 20-day rolling win rate + pattern rate from scorecard
//   • 2 sentences instead of 1 to use the extra output budget
//
// Token estimate: ~130 in, 140 out = ~270/call
// ─────────────────────────────────────────────────────────────
function buildBearTrapPrompt(metrics, data, vixData, esData) {
  var overnightTagged = getFlag("BT_OVERNIGHT_TAGGED") === "YES";

  // ── VWAP context ─────────────────────────────────────────
  var vwap    = data.vwap || parseFloat(getFlag("DAY_VWAP")) || 0;
  var vwapStr = vwap > 0
    ? "$" + vwap.toFixed(2) + " (" + ((data.price - vwap) / vwap * 100).toFixed(2) + "% " + (data.price >= vwap ? "above" : "below") + ")"
    : "unknown";

  // ── S/R levels (set by Logger.gs each tick) ───────────────
  var s1 = getFlag("SESSION_LAST_S1") || "—";
  var r1 = getFlag("SESSION_LAST_R1") || "—";

  // ── Morning brief context ─────────────────────────────────
  var mbSetup     = getFlag("MB_SETUP_TYPE") || "unknown";
  var mbRationale = getFlag("MB_RATIONALE")  || "";
  var mbFlush     = parseFloat(getFlag("MB_FLUSH_TARGET")) || 0;
  var mbFlip      = parseFloat(getFlag("MB_FLIP_ZONE"))    || 0;

  // ── Historical scorecard context ──────────────────────────
  var sessionCtx  = buildSessionContext();

  return (
    "SPY Bear Trap detector.\n" +
    "Price: $" + data.price.toFixed(2) +
      " | Phase: " + metrics.phase +
      " | Conf: " + metrics.confidence + "%\n" +
    "Flush: " + Math.abs(metrics.maxFlushPct).toFixed(2) + "%" +
      " speed:" + (metrics.flushFast ? "FAST" : "SLOW") +
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
// EOD AI BRIEF — enriched version
//
// Added vs old prompt:
//   • Morning brief accuracy (how many targets were hit)
//   • Predicted vs actual flush depth comparison
//   • Session high reached after flip
//   • Rolling win rate trend from scorecard
//   • 3-4 sentences to use the larger output budget
//
// Output tokens: 220 (up from 150) — still ~1 call/day
// ─────────────────────────────────────────────────────────────
function getEODAIMemo(ctx) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return null;

    // ── Morning brief accuracy data ───────────────────────────
    var mbSetup    = getFlag("MB_SETUP_TYPE")   || "unknown";
    var mbHits     = getFlag("MB_HITS")         || "0";
    var mbTargets  = getFlag("MB_TOTAL_TARGETS") || "4";
    var mbRipTarget = parseFloat(getFlag("MB_RIP_TARGET"))  || 0;
    var mbEodTarget = parseFloat(getFlag("MB_EOD_TARGET"))  || 0;
    var mbFlushTarget = parseFloat(getFlag("MB_FLUSH_TARGET")) || 0;

    // ── Historical scorecard context ──────────────────────────
    var winRate   = getFlag("SC_ROLLING_WIN_RATE")     || "?";
    var patRate   = getFlag("SC_ROLLING_PATTERN_RATE") || "?";
    var totalDays = getFlag("SC_TOTAL_DAYS")           || "?";

    // ── Session data ──────────────────────────────────────────
    var sessionHigh = parseFloat(getFlag("BT_SESSION_HIGH")) || 0;
    var dayOpen     = parseFloat(getFlag("BT_DAY_OPEN"))     || 0;

    var prompt =
      "Bear Trap EOD debrief.\n" +
      "Result: " + ctx.grade + "\n" +
      "Peak confidence: " + ctx.confidence + "%" +
        " | Signal: " + ctx.signalIssued + (ctx.signalPrice > 0 ? " @ $" + ctx.signalPrice.toFixed(2) : "") + "\n" +
      "Max flush: " + Math.abs(ctx.maxFlush).toFixed(2) + "%" +
        (mbFlushTarget > 0 ? " (brief predicted: $" + mbFlushTarget.toFixed(2) + ")" : "") + "\n" +
      "Flip detected: " + ctx.flipDetected + " at " + ctx.flipTime + "\n" +
      "Rip confirmed: " + ctx.ripDetected + "\n" +
      (sessionHigh > 0 && dayOpen > 0
        ? "Session high: $" + sessionHigh.toFixed(2) + " (" + ((sessionHigh - dayOpen) / dayOpen * 100).toFixed(2) + "% vs open)\n"
        : "") +
      "Close vs open: " + ctx.closeVsOpen.toFixed(2) + "% | OH tagged: " + ctx.overnightTagged + "\n" +
      "Morning brief setup: " + mbSetup +
        " | Targets hit: " + mbHits + "/" + mbTargets + "\n" +
      (mbRipTarget > 0 ? "Rip target was $" + mbRipTarget.toFixed(2) + " | EOD target was $" + mbEodTarget.toFixed(2) + "\n" : "") +
      "Historical: " + totalDays + " days tracked" +
        " | 20d win rate: " + winRate + "%" +
        " | pattern rate: " + patRate + "%\n" +
      "AI calls used today: " + ctx.aiCallsUsed + "/8\n" +
      "3-4 sentences: was this a clean Bear Trap? what was the key confirming or invalidating signal? what should I watch for tomorrow based on today's behavior?";

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 220, temperature: 0.4 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("EOD Gemini error: " + resp.getResponseCode());
      return null;
    }

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
