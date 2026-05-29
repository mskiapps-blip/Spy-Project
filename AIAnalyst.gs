// ============================================================
// FILE: AIAnalyst.gs
// PURPOSE: Calls Gemini 2.5 Flash (free tier) for large moves.
//          Now includes richer session context in every prompt:
//          VWAP distance, S/R levels, and rolling scorecard stats.
//
//  SETUP: Add your key in Apps Script →
//         Project Settings → Script Properties
//         Property name: GEMINI_API_KEY
//         Get free key: https://aistudio.google.com/app/apikey
// ============================================================

var GEMINI_MODEL    = "gemini-2.5-flash-preview-05-20";
var GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/"
                    + GEMINI_MODEL + ":generateContent";

// ─────────────────────────────────────────────────────────────
// TOKEN BUDGET
// ~120 tokens in (up from ~40), 160 tokens out (up from 120).
// Still ~280 tokens/call — well under free tier.
// ─────────────────────────────────────────────────────────────
var GEMINI_MAX_OUTPUT_TOKENS = 160;

// ─────────────────────────────────────────────────────────────
// COOLDOWN — minimum minutes between AI calls
// ─────────────────────────────────────────────────────────────
var AI_COOLDOWN_MINUTES = 15;

// ─────────────────────────────────────────────────────────────
// MAIN: Returns a short AI memo string, or null on skip/failure
// ─────────────────────────────────────────────────────────────
function getAIMemo(data, pctChange, tickChange, trendStr, now) {
  try {
    // ── Cooldown check ────────────────────────────────────────
    if (!isAICooldownClear(now)) {
      Logger.log("AI cooldown active — skipping memo.");
      return null;
    }

    // ── API key check ─────────────────────────────────────────
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      Logger.log("GEMINI_API_KEY not set in Script Properties.");
      return "⚙️ Add GEMINI_API_KEY in Script Properties to enable AI memos.";
    }

    // ── Build enriched prompt ─────────────────────────────────
    var prompt = buildPrompt(data, pctChange, tickChange, trendStr);
    Logger.log("AI prompt: " + prompt);

    // ── Call Gemini ───────────────────────────────────────────
    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        temperature: 0.4
      }
    });

    var resp = UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      payload:            payload,
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    Logger.log("Gemini response code: " + code);

    if (code !== 200) {
      Logger.log("Gemini error: " + resp.getContentText().substring(0, 200));
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
      setFlag("LAST_AI_CALL_TIME", now.getTime().toString());
      return "🤖 " + text;
    }
    return null;

  } catch (e) {
    Logger.log("getAIMemo ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD PROMPT — enriched with VWAP, S/R zones, session context
// ─────────────────────────────────────────────────────────────
function buildPrompt(data, pctChange, tickChange, trendStr) {
  var sign    = pctChange >= 0 ? "+" : "";
  var dir     = pctChange >= 0 ? "up" : "down";
  var vwap    = data.vwap || 0;
  var vwapStr = vwap > 0
    ? "$" + vwap.toFixed(2) + " (" + ((data.price - vwap) / vwap * 100).toFixed(2) + "% " + (data.price >= vwap ? "above" : "below") + ")"
    : "unknown";

  // Pull S/R context from flags saved by Logger.gs
  var s1 = getFlag("SESSION_LAST_S1") || "—";
  var r1 = getFlag("SESSION_LAST_R1") || "—";

  var sessionCtx = buildSessionContext();

  return (
    "SPY large-move alert.\n" +
    "Price: $" + data.price.toFixed(2) + " (" + sign + pctChange.toFixed(2) + "% today).\n" +
    "Tick: moved " + dir + " $" + Math.abs(tickChange).toFixed(2) + " this bar.\n" +
    "VWAP: " + vwapStr + "\n" +
    "Nearest support: " + s1 + "\n" +
    "Nearest resistance: " + r1 + "\n" +
    "Trend: " + trendStr + "\n" +
    sessionCtx + "\n" +
    "2 sentences: likely cause of this move + what to watch for rest of day. No disclaimers."
  );
}

// ─────────────────────────────────────────────────────────────
// COOLDOWN CHECK
// ─────────────────────────────────────────────────────────────
function isAICooldownClear(now) {
  var lastStr = getFlag("LAST_AI_CALL_TIME");
  if (!lastStr || lastStr === "") return true;
  var last    = parseInt(lastStr);
  if (isNaN(last)) return true;
  return (now.getTime() - last) / 60000 >= AI_COOLDOWN_MINUTES;
}

// ─────────────────────────────────────────────────────────────
// BUILD SESSION CONTEXT — shared helper used by all three AI
// prompt builders. Pulls rolling scorecard stats and intraday
// session state from flags. Kept compact: ~40-50 extra tokens.
//
// IMPORTANT: Logger.gs must call setFlag("SESSION_LAST_S1", ...)
//            and setFlag("SESSION_LAST_R1", ...) each tick so
//            this function always has fresh S/R data to read.
//            See Logger.gs integration note below.
// ─────────────────────────────────────────────────────────────
function buildSessionContext() {
  try {
    var winRate    = getFlag("SC_ROLLING_WIN_RATE")     || "?";
    var patRate    = getFlag("SC_ROLLING_PATTERN_RATE") || "?";
    var totalDays  = getFlag("SC_TOTAL_DAYS")           || "?";
    var mbSetup    = getFlag("MB_SETUP_TYPE")           || "unknown";
    var mbRationale = getFlag("MB_RATIONALE")           || "";

    var parts = [];
    if (winRate !== "?")   parts.push("20d win rate: " + winRate + "%");
    if (patRate !== "?")   parts.push("pattern rate: " + patRate + "%");
    if (totalDays !== "?") parts.push("days tracked: " + totalDays);
    if (mbSetup !== "unknown") parts.push("morning setup: " + mbSetup);
    if (mbRationale)       parts.push("brief: " + mbRationale);

    return parts.length > 0 ? "Historical context: " + parts.join(" | ") + "." : "";
  } catch (e) {
    Logger.log("buildSessionContext ERROR: " + e.message);
    return "";
  }
}

// ─────────────────────────────────────────────────────────────
// SCORECARD CONTEXT REFRESH — call this from updateScorecardStats()
// in Scorecard.gs after stats are recalculated, to cache the
// rolling numbers as flags for buildSessionContext() to read.
//
// Add this call at the end of updateScorecardStats():
//   cacheSessionContextFlags(winRate, windowWinRate, patternRate, dataRows);
// ─────────────────────────────────────────────────────────────
function cacheSessionContextFlags(allTimeWinRate, rollingWinRate, patternRate, totalDays) {
  try {
    // Use rolling 20-day win rate as the primary signal (more relevant)
    setFlag("SC_ROLLING_WIN_RATE",     rollingWinRate.toString());
    setFlag("SC_ROLLING_PATTERN_RATE", patternRate.toString());
    setFlag("SC_TOTAL_DAYS",           totalDays.toString());
    Logger.log("Session context flags cached: winRate=" + rollingWinRate +
               "% patRate=" + patternRate + "% days=" + totalDays);
  } catch (e) {
    Logger.log("cacheSessionContextFlags ERROR: " + e.message);
  }
}
