// ============================================================
// FILE: AIAnalyst.gs
// PURPOSE: Calls Gemini 2.5 Flash (free tier) when SPY makes
//          a large move (>= LARGE_MOVE_THRESHOLD%).
//          Prompt is kept SHORT to minimize token usage.
//          The AI returns a brief note on likely cause and
//          what it might mean for the rest of the session.
// ============================================================

// ─────────────────────────────────────────────────────────────
// GEMINI API SETTINGS
// ─────────────────────────────────────────────────────────────

// ⚠️  IMPORTANT: Store your Gemini API key in Script Properties!
//     Go to: Extensions → Apps Script → Project Settings
//     → Script Properties → Add: GEMINI_API_KEY = <your key>
//     FREE TIER KEY: https://aistudio.google.com/app/apikey

var GEMINI_MODEL   = "gemini-2.5-flash-preview-05-20";
var GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/"
                     + GEMINI_MODEL + ":generateContent";

// ─────────────────────────────────────────────────────────────
// TOKEN BUDGET — keep prompts tiny to stay on free tier
// ─────────────────────────────────────────────────────────────
var GEMINI_MAX_OUTPUT_TOKENS = 120;   // ~2-3 short sentences is enough

// ─────────────────────────────────────────────────────────────
// RATE LIMIT GUARD — don't call AI more than once per N minutes
// to avoid burning free quota on every large-move tick.
// ─────────────────────────────────────────────────────────────
var AI_COOLDOWN_MINUTES = 15;   // Minimum minutes between AI calls

// ─────────────────────────────────────────────────────────────
// MAIN: Get a short AI memo for a large SPY movement.
// Returns a string (the memo) or null on failure / cooldown.
// ─────────────────────────────────────────────────────────────
function getAIMemo(data, pctChange, tickChange, trendStr, now) {
  try {
    // ── Check cooldown ────────────────────────────────────────
    if (!isAICooldownClear(now)) {
      Logger.log("AI cooldown active — skipping memo.");
      return null;
    }

    // ── Get API key from Script Properties ────────────────────
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      Logger.log("GEMINI_API_KEY not set in Script Properties.");
      return "⚙️ Set GEMINI_API_KEY in Script Properties to enable AI memos.";
    }

    // ── Build a SHORT prompt to save tokens ──────────────────
    var direction = pctChange >= 0 ? "up" : "down";
    var prompt    = buildPrompt(data.price, pctChange, tickChange, trendStr, direction);

    // ── Call Gemini API ───────────────────────────────────────
    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        temperature:     0.4   // Lower = more factual, less creative
      }
    };

    var options = {
      method:             "post",
      contentType:        "application/json",
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var code     = response.getResponseCode();

    if (code !== 200) {
      Logger.log("Gemini API error: " + code + " — " + response.getContentText());
      return null;
    }

    var json = JSON.parse(response.getContentText());
    var text = json.candidates
             && json.candidates[0]
             && json.candidates[0].content
             && json.candidates[0].content.parts
             && json.candidates[0].content.parts[0]
             ? json.candidates[0].content.parts[0].text.trim()
             : null;

    if (text) {
      // Record time of last AI call for cooldown tracking
      setFlag("LAST_AI_CALL_TIME", now.getTime().toString());
      Logger.log("AI memo generated: " + text.substring(0, 60) + "...");
      return "🤖 " + text;
    }

    return null;

  } catch (e) {
    Logger.log("getAIMemo ERROR: " + e.toString());
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD PROMPT — ultra-short to minimize token usage.
// Gemini gets exactly the data it needs, nothing more.
// ─────────────────────────────────────────────────────────────
function buildPrompt(price, pctChange, tickChange, trendStr, direction) {
  var sign = pctChange >= 0 ? "+" : "";
  return (
    "SPY is $" + price.toFixed(2) + ", " +
    sign + pctChange.toFixed(2) + "% today. " +
    "Moved " + direction + " " + Math.abs(tickChange).toFixed(2) + " pts this tick. " +
    "Trend: " + trendStr + ". " +
    "In 2 short sentences: what likely caused this move and what might it mean for the rest of today? " +
    "Be specific and concise. No disclaimers."
  );
}

// ─────────────────────────────────────────────────────────────
// COOLDOWN CHECK: Returns true if enough time has passed
// since the last AI call.
// ─────────────────────────────────────────────────────────────
function isAICooldownClear(now) {
  var lastCallStr = getFlag("LAST_AI_CALL_TIME");
  if (!lastCallStr) return true; // No previous call

  var lastCall    = parseInt(lastCallStr);
  if (isNaN(lastCall)) return true;

  var elapsedMins = (now.getTime() - lastCall) / 60000;
  return elapsedMins >= AI_COOLDOWN_MINUTES;
}
