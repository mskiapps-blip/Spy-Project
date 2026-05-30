// ============================================================
// FILE: Code.gs  — PATCH INSTRUCTIONS
// ============================================================
//
//  FOUR CHANGES NEEDED in your existing Code.gs file.
//
// ─────────────────────────────────────────────────────────────
// CHANGE 1 of 4 — Add sheet name constant at the top
//
// FIND the block of GLOBAL SHEET NAMES at the top of Code.gs:
//     var SHEET_FORECAST = "📡 FORECAST";
//
// ADD this line immediately after it:
//     var SHEET_AI_HEALTH = "🤖 AI HEALTH";
//
// ─────────────────────────────────────────────────────────────
// CHANGE 2 of 4 — runEvery5Minutes()
//
// FIND this block near the bottom of runEvery5Minutes():
//     logTick(data, now);
//     Logger.log("Tick logged successfully.");
//
//     runBearTrapTick(data, now);
//     runMorningBriefTick(data, now);
//     runDashboardTick(data, now);
//     runForecastTick(data, now);
//
// REPLACE WITH:
//     logTick(data, now);
//     Logger.log("Tick logged successfully.");
//
//     runBearTrapTick(data, now);
//     runMorningBriefTick(data, now);
//     runDashboardTick(data, now);
//     runForecastTick(data, now);
//     runAIHealthTick(now);                // ← ADD THIS LINE
//
// ─────────────────────────────────────────────────────────────
// CHANGE 3 of 4 — ensureSheetsExist()
//
// FIND the last if-block in ensureSheetsExist():
//     if (!ss.getSheetByName(SHEET_FORECAST)) {
//       setupForecastSheet(ss);
//     }
//
// ADD immediately after it:
//     if (!ss.getSheetByName(SHEET_AI_HEALTH)) {
//       setupAIHealthSheet(ss);
//     }
//
// ─────────────────────────────────────────────────────────────
// CHANGE 4 of 4 — onOpen() menu
//
// FIND this line in onOpen():
//     .addItem("🤖  Show AI Health",  "showAIHealthFromMenu")
//
// REPLACE WITH these three lines:
//     .addItem("🤖  Setup AI Health Sheet",    "setupAIHealthSheetFromMenu")
//     .addItem("🤖  Refresh AI Health Now",    "runManualAIHealthRefresh")
//     .addItem("🤖  Show AI Health Popup",     "showAIHealthFromMenu")
//
// ─────────────────────────────────────────────────────────────
// SUMMARY OF CHANGES:
//   • SHEET_AI_HEALTH constant added alongside other sheet names
//   • runAIHealthTick(now) called on every full market tick
//   • ensureSheetsExist() creates the AI Health sheet on first run
//   • Menu gets Setup + Refresh + popup options for AI Health
// ─────────────────────────────────────────────────────────────
