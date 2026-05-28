// ============================================================
// FILE: AIAnalyst.gs
// PURPOSE: Calls Gemini 2.5 Flash (free tier) for large moves.
//          Designed for minimal token use on the free tier.
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
// TOKEN BUDGET — keeps free tier usage tiny
// ~40 tokens in, 120 tokens out per call
// ─────────────────────────────────────────────────────────────
var GEMINI_MAX_OUTPUT_TOKENS = 120;

// ─────────────────────────────────────────────────────────────
// COOLDOWN — minimum minutes between AI calls
// Prevents quota burn on volatile days
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

    // ── Build short prompt ────────────────────────────────────
    var prompt = buildPrompt(data.price, pctChange, tickChange, trendStr);
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
// BUILD PROMPT — ultra-short to save tokens
// ─────────────────────────────────────────────────────────────
function buildPrompt(price, pctChange, tickChange, trendStr) {
  var sign = pctChange >= 0 ? "+" : "";
  var dir  = pctChange >= 0 ? "up" : "down";
  return (
    "SPY $" + price.toFixed(2) + " (" + sign + pctChange.toFixed(2) + "% today). " +
    "Moved " + dir + " $" + Math.abs(tickChange).toFixed(2) + " this tick. " +
    "Trend: " + trendStr + ". " +
    "2 sentences: likely cause + rest-of-day implication. No disclaimers."
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
