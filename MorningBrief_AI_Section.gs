// ============================================================
// FILE: MorningBrief_AI_Section.gs
// ============================================================
//
//  TIER 2 OBSERVABILITY UPDATE
//  ───────────────────────────
//  This file contains the pre-market Gemini call. Replace
//  callGeminiForBrief() in your deployed MorningBrief code.
//
//  Changes vs prior version:
//    • Output tokens 200 → 2500 (was the worst truncation
//      offender — JSON brief was getting cut off mid-rationale)
//    • shouldAllowAICall() before fetch
//    • recordAICall() on every success & failure path
//    • Morning Brief is CRITICAL — never blocked by soft cap
// ============================================================


// ─────────────────────────────────────────────────────────────
// MORNING BRIEF — pre-market Gemini call (1×/day at 8:25 am cst)
// Critical feature: bypasses soft cap.
//
// Token estimate: ~180 in, ~250 typical out (cap 2500)
// ─────────────────────────────────────────────────────────────
function callGeminiForBrief(price, prevClose, ohigh, olow, pmClose,
                             gapPct, vixData, esData, ohTagged, preConf) {
  try {
    if (!shouldAllowAICall(AI_FEATURE.MORNING_BRIEF)) {
      Logger.log("MB: AI skipped by quota guard.");
      return null;
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      Logger.log("MB: No GEMINI_API_KEY");
      return null;
    }

    var vixStr = vixData ? vixData.price.toFixed(1) + " [" + vixData.regime + "]" : "unknown";
    var esStr  = esData  ? esData.trend + " ($" + esData.price.toFixed(2) + ")" : "unknown";

    // ── Historical context from scorecard flags ───────────────
    var winRate    = getFlag("SC_ROLLING_WIN_RATE")     || "unknown";
    var patRate    = getFlag("SC_ROLLING_PATTERN_RATE") || "unknown";
    var totalDays  = getFlag("SC_TOTAL_DAYS")           || "unknown";

    // Yesterday's EOD result (set at EOD reset, persists to next morning)
    var lastGrade  = getFlag("SC_LAST_GRADE")           || "unknown";
    var lastClose  = getFlag("SC_LAST_CLOSE_VS_OPEN")   || "unknown";

    var prompt =
      "SPY pre-market Bear Trap analysis. Provide ONLY a JSON object, no other text, no markdown.\n\n" +
      "=== TODAY'S PRE-MARKET DATA ===\n" +
      "SPY last: $" + price.toFixed(2) + "\n" +
      "Prev close: $" + prevClose.toFixed(2) + "\n" +
      "Overnight high: $" + (ohigh > 0 ? ohigh.toFixed(2) : "unknown") + "\n" +
      "Overnight low: $"  + (olow  > 0 ? olow.toFixed(2)  : "unknown") + "\n" +
      "Pre-market close: $" + pmClose.toFixed(2) + "\n" +
      "Gap vs prev close: " + gapPct.toFixed(2) + "%\n" +
      "VIX: " + vixStr + "\n" +
      "ES futures: " + esStr + "\n" +
      "Overnight high tagged: " + (ohTagged ? "YES" : "NO") + "\n" +
      "Pre-market Bear Trap confidence: " + preConf + "%\n\n" +
      "=== HISTORICAL CONTEXT (last 20 trading days) ===\n" +
      "Win rate (signal + pattern): " + winRate + "%\n" +
      "Pattern appearance rate: " + patRate + "%\n" +
      "Total days tracked: " + totalDays + "\n" +
      "Yesterday's result: " + lastGrade + "\n" +
      "Yesterday's close vs open: " + lastClose + "\n\n" +
      "=== INSTRUCTIONS ===\n" +
      "Use the historical context to calibrate confidence — if win rate is high and pattern\n" +
      "has appeared frequently, lean toward BEAR_TRAP when signals align. If win rate is low\n" +
      "or pattern rarely appears, lean toward CHOPPY or AVOID unless signals are very strong.\n\n" +
      "Return this exact JSON (no markdown, no backticks, no extra keys):\n" +
      "{\n" +
      "  \"setupType\": \"BEAR_TRAP\" or \"BULL\" or \"CHOPPY\" or \"AVOID\",\n" +
      "  \"flushTarget\": <SPY price if flush expected, else 0>,\n" +
      "  \"flipZone\": <SPY price where reversal expected, else 0>,\n" +
      "  \"ripTarget\": <SPY price target if rip plays out, else 0>,\n" +
      "  \"eodTarget\": <expected SPY close price>,\n" +
      "  \"rationale\": \"<one sentence, max 25 words, cite the strongest signal driving the call>\"\n" +
      "}";

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2500, temperature: 0.2 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("MB Gemini error: " + resp.getResponseCode() + " — " + resp.getContentText().substring(0, 200));
      recordAICall(AI_FEATURE.MORNING_BRIEF, false);
      return null;
    }

    var json = JSON.parse(resp.getContentText());
    var raw  = json.candidates
            && json.candidates[0]
            && json.candidates[0].content
            && json.candidates[0].content.parts
            && json.candidates[0].content.parts[0]
             ? json.candidates[0].content.parts[0].text.trim()
             : null;

    if (!raw) {
      Logger.log("MB: Gemini returned empty content.");
      recordAICall(AI_FEATURE.MORNING_BRIEF, false);
      return null;
    }

    Logger.log("MB raw response: " + raw);

    // Strip any accidental markdown fences
    var clean = raw.replace(/```json|```/g, "").trim();

    try {
      var parsed = JSON.parse(clean);

      // Validate required fields
      if (!parsed.setupType || parsed.eodTarget === undefined) {
        Logger.log("MB: JSON missing required fields — " + clean);
        recordAICall(AI_FEATURE.MORNING_BRIEF, false);
        return null;
      }

      // Normalize setupType to display label
      var setupLabels = {
        "BEAR_TRAP": MB.SETUP_BEAR_TRAP,
        "BULL":      MB.SETUP_BULL,
        "CHOPPY":    MB.SETUP_CHOPPY,
        "AVOID":     MB.SETUP_AVOID
      };
      parsed.setupType = setupLabels[parsed.setupType] || parsed.setupType;

      Logger.log("MB parsed: " + JSON.stringify(parsed));
      recordAICall(AI_FEATURE.MORNING_BRIEF, true);
      return parsed;

    } catch (parseErr) {
      Logger.log("MB JSON parse error: " + parseErr.message + " raw=" + clean);
      recordAICall(AI_FEATURE.MORNING_BRIEF, false);
      return null;
    }

  } catch (e) {
    Logger.log("callGeminiForBrief ERROR: " + e.message);
    recordAICall(AI_FEATURE.MORNING_BRIEF, false);
    return null;
  }
}


// ─────────────────────────────────────────────────────────────
// INTEGRATION NOTES — these two flag-writes still required
// elsewhere in your code (carried over from prior version):
//
// 1. Logger.gs, inside logTick(), after computing S/R:
//      setFlag("SESSION_LAST_S1", formatZone(srZones.supports[0]));
//      setFlag("SESSION_LAST_R1", formatZone(srZones.resistances[0]));
//
// 2. Scorecard.gs end of updateScorecardStats():
//      cacheSessionContextFlags(winRate, windowWinRate, patternRate, dataRows);
//
//    And in logToScorecard() before resetDailyBearTrapFlags():
//      setFlag("SC_LAST_GRADE", grade);
//      setFlag("SC_LAST_CLOSE_VS_OPEN", closeVsOpen.toFixed(2) + "%");
// ─────────────────────────────────────────────────────────────
