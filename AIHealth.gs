// ============================================================
// FILE: AIHealth.gs
// PURPOSE: Tier 2 observability for all Gemini AI calls.
//          Centralizes:
//            • Daily AI call counter (auto-resets each CST day)
//            • Per-feature last-success / last-failure timestamps
//            • Failure tracking (count + last failure time)
//            • Health classification: 🟢 HEALTHY / 🟡 DEGRADED / 🔴 DOWN
//            • Soft / hard daily quota guard
//
//  Each AI call function calls:
//    1. shouldAllowAICall(feature)  — before the fetch
//    2. recordAICall(feature, true/false) — after the fetch
//
//  Balanced quota:
//    • Non-critical calls (large-move, dashboard) skip at 200/day
//    • All calls hard-block at 240/day
// ============================================================


// ─────────────────────────────────────────────────────────────
// FEATURE IDS — must match strings passed by AI call sites
// ─────────────────────────────────────────────────────────────
var AI_FEATURE = {
  LARGE_MOVE:    "LARGE_MOVE",     // AIAnalyst.gs — non-critical
  BEAR_TRAP:     "BEAR_TRAP",      // Intraday bear trap memo
  BEAR_TRAP_EOD: "BEAR_TRAP_EOD",  // EOD debrief
  MORNING_BRIEF: "MORNING_BRIEF",  // 8:25 am cst pre-market
  DASHBOARD:     "DASHBOARD",      // Mission control brief — non-critical
  FORECAST:      "FORECAST"        // 30-min forecast slots
};


// ─────────────────────────────────────────────────────────────
// QUOTA GUARD — balanced
// ─────────────────────────────────────────────────────────────
var AI_QUOTA = {
  DAILY_SOFT_CAP: 200,  // Skip non-critical above this
  DAILY_HARD_CAP: 240,  // Skip ALL above this
  NON_CRITICAL:   ["LARGE_MOVE", "DASHBOARD"]
};


// ─────────────────────────────────────────────────────────────
// HEALTH THRESHOLDS
// ─────────────────────────────────────────────────────────────
var AI_HEALTH_CFG = {
  FAILURE_WINDOW_MIN:     30,   // failures within this window count toward health
  DEGRADED_FAILURE_COUNT:  2,   // 2+ recent failures → 🟡
  DOWN_FAILURE_COUNT:      3,   // 3+ recent failures → 🔴
  DOWN_NO_SUCCESS_MIN:   120    // no successful call in >2 hr → 🔴
};


// ─────────────────────────────────────────────────────────────
// CORE — record one AI call result
//
// Call AFTER the Gemini fetch resolves.
//   feature = one of AI_FEATURE.* (string)
//   success = true if Gemini returned usable content
// ─────────────────────────────────────────────────────────────
function recordAICall(feature, success) {
  try {
    aiResetCounterIfNewDay();

    var nowMs = new Date().getTime();

    var totalCalls = parseInt(getFlag("AI_CALLS_TODAY") || "0") + 1;
    setFlag("AI_CALLS_TODAY", totalCalls.toString());

    var featureKey   = "AI_CALLS_" + feature;
    var featureCalls = parseInt(getFlag(featureKey) || "0") + 1;
    setFlag(featureKey, featureCalls.toString());

    if (success) {
      setFlag("AI_LAST_SUCCESS_" + feature, nowMs.toString());
      setFlag("AI_LAST_SUCCESS_ANY",        nowMs.toString());
    } else {
      var failCount = parseInt(getFlag("AI_FAILURES_TODAY") || "0") + 1;
      setFlag("AI_FAILURES_TODAY",       failCount.toString());
      setFlag("AI_LAST_FAILURE_TIME",    nowMs.toString());
      setFlag("AI_LAST_FAILURE_FEATURE", feature);
    }

    var failsToday = getFlag("AI_FAILURES_TODAY") || "0";
    Logger.log("AIHealth: " + feature + " " + (success ? "✅" : "❌") +
               " | today: " + totalCalls + " calls, " + failsToday + " failures");
  } catch (e) {
    Logger.log("recordAICall ERROR: " + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// QUOTA GUARD — should this call be allowed to proceed?
// Returns true to proceed, false to skip.
// Fails open on internal error so we never block the program.
// ─────────────────────────────────────────────────────────────
function shouldAllowAICall(feature) {
  try {
    aiResetCounterIfNewDay();

    var totalCalls = parseInt(getFlag("AI_CALLS_TODAY") || "0");

    if (totalCalls >= AI_QUOTA.DAILY_HARD_CAP) {
      Logger.log("AIHealth: HARD CAP reached (" + totalCalls + "/" +
                 AI_QUOTA.DAILY_HARD_CAP + ") — blocking " + feature);
      return false;
    }

    if (totalCalls >= AI_QUOTA.DAILY_SOFT_CAP &&
        AI_QUOTA.NON_CRITICAL.indexOf(feature) !== -1) {
      Logger.log("AIHealth: SOFT CAP reached (" + totalCalls + "/" +
                 AI_QUOTA.DAILY_SOFT_CAP + ") — skipping non-critical: " + feature);
      return false;
    }

    return true;
  } catch (e) {
    Logger.log("shouldAllowAICall ERROR: " + e.message);
    return true; // Fail open
  }
}


// ─────────────────────────────────────────────────────────────
// HEALTH STATUS
//
// Returns: { status, color, label, detail, calls, failures }
// ─────────────────────────────────────────────────────────────
function getAIHealthStatus() {
  try {
    aiResetCounterIfNewDay();

    var nowMs      = new Date().getTime();
    var lastFailMs = parseInt(getFlag("AI_LAST_FAILURE_TIME") || "0") || 0;
    var lastSuccMs = parseInt(getFlag("AI_LAST_SUCCESS_ANY")  || "0") || 0;
    var failsToday = parseInt(getFlag("AI_FAILURES_TODAY")    || "0");
    var callsToday = parseInt(getFlag("AI_CALLS_TODAY")       || "0");

    var minsSinceFail = lastFailMs > 0 ? (nowMs - lastFailMs) / 60000 : 99999;
    var minsSinceSucc = lastSuccMs > 0 ? (nowMs - lastSuccMs) / 60000 : 99999;
    var recentlyFailed = (minsSinceFail <= AI_HEALTH_CFG.FAILURE_WINDOW_MIN);

    // 🔴 DOWN
    var isDown = false;
    if (recentlyFailed && failsToday >= AI_HEALTH_CFG.DOWN_FAILURE_COUNT) isDown = true;
    if (lastSuccMs > 0 && minsSinceSucc > AI_HEALTH_CFG.DOWN_NO_SUCCESS_MIN) isDown = true;

    if (isDown) {
      return {
        status:   "DOWN",
        color:    "#ff5252",
        label:    "🔴 AI DOWN",
        detail:   failsToday + " fails today · last ok " + aiTimeSince(lastSuccMs),
        calls:    callsToday,
        failures: failsToday
      };
    }

    // 🟡 DEGRADED
    if (recentlyFailed && failsToday >= AI_HEALTH_CFG.DEGRADED_FAILURE_COUNT) {
      return {
        status:   "DEGRADED",
        color:    "#ffd740",
        label:    "🟡 AI DEGRADED",
        detail:   failsToday + " fails today · last fail " + aiTimeSince(lastFailMs),
        calls:    callsToday,
        failures: failsToday
      };
    }

    // 🟢 HEALTHY
    return {
      status:   "HEALTHY",
      color:    "#69f0ae",
      label:    "🟢 AI HEALTHY",
      detail:   callsToday + " calls today · " + failsToday + " fails",
      calls:    callsToday,
      failures: failsToday
    };

  } catch (e) {
    Logger.log("getAIHealthStatus ERROR: " + e.message);
    return {
      status: "UNKNOWN", color: "#7986cb", label: "⚪ AI ?",
      detail: "health check failed", calls: 0, failures: 0
    };
  }
}


// ─────────────────────────────────────────────────────────────
// SHORT BADGE — for subtitle / compact display
// ─────────────────────────────────────────────────────────────
function getAIHealthBadge() {
  try {
    var h = getAIHealthStatus();
    if (h.status === "HEALTHY")  return h.label + " · " + h.calls + " calls today";
    if (h.status === "DEGRADED") return h.label + " · " + h.failures + " fails";
    if (h.status === "DOWN")     return h.label + " · " + h.failures + " fails";
    return h.label;
  } catch (e) {
    return "⚪ AI ?";
  }
}


// ─────────────────────────────────────────────────────────────
// DAILY RESET — auto-triggered on first call of new CST day
// ─────────────────────────────────────────────────────────────
function aiResetCounterIfNewDay() {
  try {
    var now      = new Date();
    var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
    var lastDate = getFlag("AI_HEALTH_DATE");

    if (lastDate === todayStr) return;

    setFlag("AI_HEALTH_DATE",    todayStr);
    setFlag("AI_CALLS_TODAY",    "0");
    setFlag("AI_FAILURES_TODAY", "0");

    for (var key in AI_FEATURE) {
      setFlag("AI_CALLS_" + AI_FEATURE[key], "0");
    }

    Logger.log("AIHealth: Daily counters reset for " + todayStr);
  } catch (e) {
    Logger.log("aiResetCounterIfNewDay ERROR: " + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// READABLE TIME-SINCE — "5m ago" / "2h ago" / "never"
// ─────────────────────────────────────────────────────────────
function aiTimeSince(msTimestamp) {
  if (!msTimestamp || msTimestamp === 0) return "never";
  var ms = new Date().getTime() - parseInt(msTimestamp);
  if (ms < 60000) return "just now";
  var mins = Math.round(ms / 60000);
  if (mins < 60)  return mins + "m ago";
  var hrs = Math.round(mins / 60);
  if (hrs < 24)   return hrs + "h ago";
  var days = Math.round(hrs / 24);
  return days + "d ago";
}


// ─────────────────────────────────────────────────────────────
// MENU — quick health summary popup
// ─────────────────────────────────────────────────────────────
function showAIHealthFromMenu() {
  try {
    var h          = getAIHealthStatus();
    var callsToday = getFlag("AI_CALLS_TODAY")    || "0";
    var failsToday = getFlag("AI_FAILURES_TODAY") || "0";

    var lines = [];
    for (var key in AI_FEATURE) {
      var feat   = AI_FEATURE[key];
      var calls  = getFlag("AI_CALLS_" + feat) || "0";
      var lastOk = parseInt(getFlag("AI_LAST_SUCCESS_" + feat) || "0") || 0;
      lines.push("  " + feat + ":  " + calls + " calls  ·  last ok " + aiTimeSince(lastOk));
    }

    SpreadsheetApp.getUi().alert(
      "🤖 AI HEALTH STATUS\n\n" +
      h.label + "\n" +
      h.detail + "\n\n" +
      "Today: " + callsToday + " calls  ·  " + failsToday + " fails\n" +
      "Soft cap: " + AI_QUOTA.DAILY_SOFT_CAP + "  ·  Hard cap: " + AI_QUOTA.DAILY_HARD_CAP + "\n\n" +
      "PER-FEATURE:\n" +
      lines.join("\n")
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Health check failed: " + e.message);
  }
}
