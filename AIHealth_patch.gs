// ============================================================
// FILE: AIHealth.gs  — PATCH INSTRUCTIONS
// ============================================================
//
//  TWO CHANGES NEEDED in your existing AIHealth.gs file.
//
// ─────────────────────────────────────────────────────────────
// CHANGE 1 of 2 — recordAICall()
//
// FIND the entire recordAICall function and REPLACE WITH:
//
// ─────────────────────────────────────────────────────────────

function recordAICall(feature, success, detail) {
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
      appendAIHealthLog(feature, "OK", detail || "");
    } else {
      var failCount = parseInt(getFlag("AI_FAILURES_TODAY") || "0") + 1;
      setFlag("AI_FAILURES_TODAY",       failCount.toString());
      setFlag("AI_LAST_FAILURE_TIME",    nowMs.toString());
      setFlag("AI_LAST_FAILURE_FEATURE", feature);
      appendAIHealthLog(feature, "FAIL", detail || "");
    }

    var failsToday = getFlag("AI_FAILURES_TODAY") || "0";
    Logger.log("AIHealth: " + feature + " " + (success ? "✅" : "❌") +
               " | today: " + totalCalls + " calls, " + failsToday + " failures");
  } catch (e) {
    Logger.log("recordAICall ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CHANGE 2 of 2 — shouldAllowAICall()
//
// FIND the entire shouldAllowAICall function and REPLACE WITH:
//
// ─────────────────────────────────────────────────────────────

function shouldAllowAICall(feature) {
  try {
    aiResetCounterIfNewDay();

    var totalCalls = parseInt(getFlag("AI_CALLS_TODAY") || "0");

    if (totalCalls >= AI_QUOTA.DAILY_HARD_CAP) {
      Logger.log("AIHealth: HARD CAP reached (" + totalCalls + "/" +
                 AI_QUOTA.DAILY_HARD_CAP + ") — blocking " + feature);
      var skipped = parseInt(getFlag("AI_SKIPPED_TODAY") || "0") + 1;
      setFlag("AI_SKIPPED_TODAY", skipped.toString());
      appendAIHealthLog(feature, "SKIP", "hard cap reached (" + totalCalls + ")");
      return false;
    }

    if (totalCalls >= AI_QUOTA.DAILY_SOFT_CAP &&
        AI_QUOTA.NON_CRITICAL.indexOf(feature) !== -1) {
      Logger.log("AIHealth: SOFT CAP reached (" + totalCalls + "/" +
                 AI_QUOTA.DAILY_SOFT_CAP + ") — skipping non-critical: " + feature);
      var skipped2 = parseInt(getFlag("AI_SKIPPED_TODAY") || "0") + 1;
      setFlag("AI_SKIPPED_TODAY", skipped2.toString());
      appendAIHealthLog(feature, "SKIP", "soft cap — non-critical (" + totalCalls + ")");
      return false;
    }

    return true;
  } catch (e) {
    Logger.log("shouldAllowAICall ERROR: " + e.message);
    return true; // Fail open
  }
}

// ─────────────────────────────────────────────────────────────
// CHANGE 3 of 3 — aiResetCounterIfNewDay()
//
// FIND the line inside aiResetCounterIfNewDay() that reads:
//     setFlag("AI_FAILURES_TODAY", "0");
//
// ADD this line immediately after it:
//     setFlag("AI_SKIPPED_TODAY",  "0");
//
// The full function should look like:
//
// function aiResetCounterIfNewDay() {
//   try {
//     var now      = new Date();
//     var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
//     var lastDate = getFlag("AI_HEALTH_DATE");
//
//     if (lastDate === todayStr) return;
//
//     setFlag("AI_HEALTH_DATE",    todayStr);
//     setFlag("AI_CALLS_TODAY",    "0");
//     setFlag("AI_FAILURES_TODAY", "0");
//     setFlag("AI_SKIPPED_TODAY",  "0");   // ← ADD THIS LINE
//
//     for (var key in AI_FEATURE) {
//       setFlag("AI_CALLS_" + AI_FEATURE[key], "0");
//     }
//
//     Logger.log("AIHealth: Daily counters reset for " + todayStr);
//   } catch (e) {
//     Logger.log("aiResetCounterIfNewDay ERROR: " + e.message);
//   }
// }
//
// ─────────────────────────────────────────────────────────────
// SUMMARY OF CHANGES:
//   • recordAICall() now accepts optional detail string and calls
//     appendAIHealthLog() on every success and failure
//   • shouldAllowAICall() now increments AI_SKIPPED_TODAY counter
//     and calls appendAIHealthLog() with "SKIP" on both cap paths
//   • aiResetCounterIfNewDay() resets AI_SKIPPED_TODAY each day
// ─────────────────────────────────────────────────────────────
