// ============================================================
// FILE: Code.gs
// PURPOSE: Main entry point. Handles the 5-minute trigger,
//          market open/close checks, and wires everything together.
//          Includes: 🪤 Bear Trap, 📊 Scorecard, 🌅 Morning Brief,
//          🖥️ Dashboard, 📡 Forecast, 🤖 AI Health, 📈 FC Accuracy Log.
// ============================================================

// ─────────────────────────────────────────────────────────────
// GLOBAL SHEET NAMES
// ─────────────────────────────────────────────────────────────
var SHEET_LOG           = "SPY LOG";
var SHEET_CONFIG        = "CONFIG";
var SHEET_HOLIDAYS      = "HOLIDAYS";
var SHEET_DASHBOARD     = "🖥️ DASHBOARD";
var SHEET_FORECAST      = "📡 FORECAST";
var SHEET_AI_HEALTH     = "🤖 AI HEALTH";
var SHEET_FC_ACCURACY   = "📈 FC ACCURACY LOG";   // ← Forecast Accuracy Log

// ─────────────────────────────────────────────────────────────
// MARKET HOURS (Eastern Time)
// ─────────────────────────────────────────────────────────────
var MARKET_OPEN_HOUR  = 9;
var MARKET_OPEN_MIN   = 30;
var MARKET_CLOSE_HOUR = 16;
var MARKET_CLOSE_MIN  = 0;

// ─────────────────────────────────────────────────────────────
// LARGE MOVE THRESHOLD — fires AI memo in main SPY LOG
// ─────────────────────────────────────────────────────────────
var LARGE_MOVE_THRESHOLD = 0.45;

// ─────────────────────────────────────────────────────────────
// BYPASS MARKET HOURS — set true for testing, false for live
// ─────────────────────────────────────────────────────────────
var BYPASS_MARKET_HOURS = false;

// ─────────────────────────────────────────────────────────────
// MAIN 5-MINUTE TRIGGER
// ─────────────────────────────────────────────────────────────
function runEvery5Minutes() {
  try {
    var now = getCurrentEasternTime(); // raw UTC Date
    Logger.log("runEvery5Minutes fired at UTC: " + now.toString());

    if (!BYPASS_MARKET_HOURS) {

      var dayOfWeek = parseInt(Utilities.formatDate(now, "America/New_York", "u"), 10) % 7;

      // ── Weekends: dashboard + forecast + health ────────────
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        Logger.log("Weekend — running dashboard + forecast + health only.");
        setFlag("MARKET_OPEN_TODAY", "NO");
        var wkData = fetchSPYData();
        if (wkData) {
          runDashboardTick(wkData, now);
          runForecastTick(wkData, now);
        }
        runAIHealthTick(now);
        return;
      }

      // ── Holidays: dashboard + forecast + health ────────────
      if (isTodayHoliday(now)) {
        Logger.log("Holiday — running dashboard + forecast + health only.");
        setFlag("MARKET_OPEN_TODAY", "NO");
        var hlData = fetchSPYData();
        if (hlData) {
          runDashboardTick(hlData, now);
          runForecastTick(hlData, now);
        }
        runAIHealthTick(now);
        return;
      }

      // ── Market closed: overnight dashboard + EOD hooks ────
      if (!isMarketOpen(now)) {
        var etH = parseInt(Utilities.formatDate(now, "America/New_York", "H"),  10);
        var etM = parseInt(Utilities.formatDate(now, "America/New_York", "mm"), 10);
        if (etH === MARKET_CLOSE_HOUR && etM < 10) {
          finalizeDaySummary();
        }
        Logger.log("Market closed at ET " + etH + ":" + etM);
        setFlag("MARKET_OPEN_TODAY", "NO");

        var closingData = fetchSPYData();
        if (closingData) {
          runBearTrapTick(closingData, now);
          runMorningBriefTick(closingData, now);
          runDashboardTick(closingData, now);
          runForecastTick(closingData, now);
        }
        runAIHealthTick(now);
        return;
      }

      // ── Pre-market Morning Brief window (8:25 CST = 9:25 ET)
      var etHour = parseInt(Utilities.formatDate(now, "America/New_York", "H"),  10);
      var etMin  = parseInt(Utilities.formatDate(now, "America/New_York", "mm"), 10);
      var etMins = etHour * 60 + etMin;
      if (etMins >= 565 && etMins < 570) {
        var preData = fetchSPYData();
        if (preData) {
          runMorningBriefTick(preData, now);
          runDashboardTick(preData, now);
          runForecastTick(preData, now);
        }
        runAIHealthTick(now);
        return;
      }

    } else {
      Logger.log("BYPASS_MARKET_HOURS = true — skipping time checks.");
    }

    // ── Market is open (or bypassed) — full tick ──────────────
    setFlag("MARKET_OPEN_TODAY", "YES");

    var data = fetchSPYData();
    if (!data) {
      Logger.log("fetchSPYData returned null — skipping tick.");
      return;
    }
    Logger.log("SPY price fetched: " + data.price);

    logTick(data, now);
    Logger.log("Tick logged successfully.");

    runBearTrapTick(data, now);
    runMorningBriefTick(data, now);
    runDashboardTick(data, now);
    runForecastTick(data, now);
    runAIHealthTick(now);               // ← AI Health always runs last

  } catch (e) {
    Logger.log("runEvery5Minutes ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// MANUAL TICK
// ─────────────────────────────────────────────────────────────
function runManualTick() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsExist(ss);

    var logSheet = ss.getSheetByName(SHEET_LOG);
    if (logSheet) addVolumeHeaderNotes(logSheet);

    var now = getCurrentEasternTime();
    Logger.log("Manual tick at UTC: " + now.toString());

    var data = fetchSPYData();
    if (!data) {
      SpreadsheetApp.getUi().alert("❌ Could not fetch SPY data.\nCheck Apps Script logs.");
      return;
    }
    Logger.log("SPY price: " + data.price);

    logTick(data, now);
    runBearTrapTick(data, now);
    runMorningBriefTick(data, now);
    runDashboardTick(data, now);
    runForecastTick(data, now);
    runAIHealthTick(now);

    SpreadsheetApp.getUi().alert(
      "✅ Tick logged!\n" +
      "SPY: $" + data.price.toFixed(2) + "\n\n" +
      "Check:\n" +
      "  🖥️ DASHBOARD\n" +
      "  📈 SPY LOG\n" +
      "  🌅 MORNING BRIEF\n" +
      "  🪤 BEAR TRAP\n" +
      "  📊 SCORECARD\n" +
      "  📡 FORECAST\n" +
      "  📈 FC ACCURACY LOG\n" +
      "  🤖 AI HEALTH"
    );

  } catch (e) {
    Logger.log("runManualTick ERROR: " + e.message + "\n" + e.stack);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message + "\n\nSee Apps Script logs.");
  }
}

// ─────────────────────────────────────────────────────────────
// MANUAL MORNING BRIEF
// ─────────────────────────────────────────────────────────────
function runManualMorningBrief() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsExist(ss);

    var now  = getCurrentEasternTime();
    var data = fetchSPYData();
    if (!data) {
      SpreadsheetApp.getUi().alert("❌ Could not fetch SPY data.");
      return;
    }

    var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
    var sheet    = ss.getSheetByName(SHEET_MORNING_BRIEF);
    if (!sheet) {
      setupMorningBriefSheet(ss);
      sheet = ss.getSheetByName(SHEET_MORNING_BRIEF);
    }

    setFlag("MB_BRIEF_FIRED_TODAY", "");
    generateMorningBrief(sheet, data, now, todayStr);
    setFlag("MB_BRIEF_FIRED_TODAY", todayStr);

    SpreadsheetApp.getUi().alert(
      "✅ Morning Brief generated!\n\n" +
      "Check the 🌅 MORNING BRIEF sheet.\n" +
      "Summary panel also written to 🪤 BEAR TRAP."
    );
  } catch (e) {
    Logger.log("runManualMorningBrief ERROR: " + e.message);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ENSURE ALL SHEETS EXIST
// ─────────────────────────────────────────────────────────────
function ensureSheetsExist(ss) {
  if (!ss.getSheetByName(SHEET_LOG)) {
    ss.insertSheet(SHEET_LOG).setTabColor("#00bcd4");
  }
  if (!ss.getSheetByName(SHEET_CONFIG)) {
    var c = ss.insertSheet(SHEET_CONFIG);
    c.setTabColor("#ffd600");
    c.appendRow(["KEY", "VALUE", "NOTES"]);
  }
  if (!ss.getSheetByName(SHEET_HOLIDAYS)) {
    ss.insertSheet(SHEET_HOLIDAYS)
      .appendRow(["Holiday Date (YYYY-MM-DD)", "Holiday Name"]);
  }
  if (!ss.getSheetByName(SHEET_BEAR_TRAP)) {
    setupBearTrapSheet(ss);
  }
  if (!ss.getSheetByName(SHEET_SCORECARD)) {
    setupScorecardSheet(ss);
  }
  if (!ss.getSheetByName(SHEET_MORNING_BRIEF)) {
    setupMorningBriefSheet(ss);
  }
  if (!ss.getSheetByName(SHEET_DASHBOARD)) {
    setupDashboardSheet(ss);
  }
  if (!ss.getSheetByName(SHEET_FORECAST)) {
    setupForecastSheet(ss);
  }
  if (!ss.getSheetByName(SHEET_AI_HEALTH)) {
    setupAIHealthSheet(ss);
  }
  if (!ss.getSheetByName(SHEET_FC_ACCURACY)) {       // ← FC Accuracy Log
    setupFCAccuracySheet(ss);
  }
}

// ─────────────────────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚡ SPY TRACKER")
    .addItem("🗑️  Clear Logger Data",            "clearLogData")
    .addItem("📅  Refresh Holidays",              "fetchAndSaveHolidays")
    .addSeparator()
    .addItem("🔧  Setup All Sheets",              "setupSheets")
    .addItem("🖥️  Setup Dashboard",               "setupDashboardSheetFromMenu")
    .addItem("🌅  Setup Morning Brief Sheet",     "setupMorningBriefSheetFromMenu")
    .addItem("🪤  Setup Bear Trap Sheet",         "setupBearTrapSheetFromMenu")
    .addItem("📊  Setup Scorecard Sheet",         "setupScorecardSheetFromMenu")
    .addItem("📡  Setup Forecast Sheet",          "setupForecastSheetFromMenu")
    .addItem("📈  Setup FC Accuracy Log",         "setupFCAccuracySheetFromMenu")  // ← NEW
    .addItem("🤖  Setup AI Health Sheet",         "setupAIHealthSheetFromMenu")
    .addSeparator()
    .addItem("▶️  Run Now (Manual Tick)",         "runManualTick")
    .addItem("🖥️  Refresh Dashboard Now",         "runManualDashboardRefresh")
    .addItem("🌅  Run Morning Brief Now",         "runManualMorningBrief")
    .addItem("📡  Run Forecast Now",              "runManualForecast")
    .addItem("🤖  Refresh AI Health Now",         "runManualAIHealthRefresh")
    .addSeparator()
    .addItem("⏰  Install 5-Min Trigger",         "installTrigger")
    .addItem("🛑  Remove All Triggers",           "removeAllTriggers")
    .addItem("🤖  Show AI Health Popup",          "showAIHealthFromMenu")
    .addToUi();
}

// ─────────────────────────────────────────────────────────────
// TRIGGER MANAGEMENT
// ─────────────────────────────────────────────────────────────
function installTrigger() {
  removeAllTriggers();
  ScriptApp.newTrigger("runEvery5Minutes")
    .timeBased().everyMinutes(5).create();
  SpreadsheetApp.getUi().alert("✅ 5-minute trigger installed!\n\nRuns every 5 minutes.");
}

function removeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}

// ─────────────────────────────────────────────────────────────
// FINALIZE DAY SUMMARY (called at market close)
// ─────────────────────────────────────────────────────────────
function finalizeDaySummary() {
  try {
    var todayFlag = getFlag("DAY_FINALIZED");
    var now       = getCurrentEasternTime();
    var todayStr  = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
    if (todayFlag === todayStr) return;

    setFlag("TICK_COUNT",    "0");
    setFlag("DAY_OPEN_PRICE", "");
    setFlag("DAY_FINALIZED",  todayStr);
    resetDailyForecastFlags();
    Logger.log("Day finalized: " + todayStr);
  } catch (e) {
    Logger.log("finalizeDaySummary ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CLEAR LOG DATA
// ─────────────────────────────────────────────────────────────
function clearLogData() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    "⚠️ Clear All Log Data?",
    "This will erase all logged ticks from SPY LOG and BEAR TRAP. Headers stay. Continue?",
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var log = ss.getSheetByName(SHEET_LOG);
  if (log && log.getLastRow() > 2) {
    log.deleteRows(3, log.getLastRow() - 2);
  }

  var bt = ss.getSheetByName(SHEET_BEAR_TRAP);
  if (bt && bt.getLastRow() > 3) {
    bt.deleteRows(4, bt.getLastRow() - 3);
  }

  ui.alert("✅ Log data cleared.\n\nSPY LOG and BEAR TRAP reset. Headers preserved.");
}
