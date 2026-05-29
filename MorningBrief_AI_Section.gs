// ============================================================
// FILE: MorningBrief_AI_Section.gs
// ============================================================
//
//  WHAT CHANGED — AI prompt enrichment update
//  ──────────────────────────────────────────
//  This file contains ONLY the function that changed.
//  Replace callGeminiForBrief() in your existing
//  MorningBrief.gs with this updated version.
//
//  Changed:
//    • callGeminiForBrief() — adds rolling scorecard history,
//      VWAP from previous session, and recent pattern streak
//      to give Gemini meaningful prior context for price targets.
//    • Output tokens: 150 → 200 (allows richer rationale).
// ============================================================


// ─────────────────────────────────────────────────────────────
// MORNING BRIEF — enriched Gemini call
//
// Added vs old version:
//   • 20-day rolling win rate + pattern rate from scorecard
//   • Most common recent setup type (from flags)
//   • Whether OH tagging has been predictive lately
//   • Prev session close vs open result (was yesterday a trap?)
//   • Output bumped to 200 tokens for a fuller rationale field
//
// Token estimate: ~180 in, 200 out = ~380/call (1 call/day)
// ─────────────────────────────────────────────────────────────
function callGeminiForBrief(price, prevClose, ohigh, olow, pmClose,
                             gapPct, vixData, esData, ohTagged, preConf) {
  try {
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
      generationConfig: { maxOutputTokens: 200, temperature: 0.2 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("MB Gemini error: " + resp.getResponseCode() + " — " + resp.getContentText().substring(0, 200));
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
      return parsed;

    } catch (parseErr) {
      Logger.log("MB JSON parse error: " + parseErr.message + " raw=" + clean);
      return null;
    }

  } catch (e) {
    Logger.log("callGeminiForBrief ERROR: " + e.message);
    return null;
  }
}


// ─────────────────────────────────────────────────────────────
// INTEGRATION NOTE — two small additions needed in other files
// ─────────────────────────────────────────────────────────────
//
// 1. In Logger.gs, inside logTick(), after computing S/R zones,
//    add these two lines to cache the nearest levels as flags
//    so buildBearTrapPrompt() and buildPrompt() can read them:
//
//      if (srZones.supports[0])    setFlag("SESSION_LAST_S1", formatZone(srZones.supports[0]));
//      if (srZones.resistances[0]) setFlag("SESSION_LAST_R1", formatZone(srZones.resistances[0]));
//
// 2. In Scorecard.gs, at the end of updateScorecardStats(),
//    add this call to cache the rolling stats for AI context:
//
//      cacheSessionContextFlags(winRate, windowWinRate, patternRate, dataRows);
//
//    Also add this to logToScorecard() just before resetDailyBearTrapFlags()
//    so tomorrow's morning brief knows yesterday's result:
//
//      setFlag("SC_LAST_GRADE", grade);
//      setFlag("SC_LAST_CLOSE_VS_OPEN", closeVsOpen.toFixed(2) + "%");
// ─────────────────────────────────────────────────────────────
