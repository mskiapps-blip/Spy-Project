// ============================================================
// FILE: Code.gs
// PURPOSE: Main entry point. Handles the 5-minute trigger,
//          market open/close checks, and wires everything together.
//          Includes 🪤 Bear Trap and 📊 Scorecard hooks.
// ============================================================

// ─────────────────────────────────────────────────────────────
// GLOBAL SHEET NAMES
// ─────────────────────────────────────────────────────────────
var SHEET_LOG      = "SPY LOG";
var SHEET_CONFIG   = "CONFIG";
var SHEET_HOLIDAYS = "HOLIDAYS";

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
var LARGE_MOVE_THRESHOLD = 0.75;

// ─────────────────────────────────────────────────────────────
// BYPASS MARKET HOURS — set true for testing, false for live
// ─────────────────────────────────────────────────────────────
var BYPASS_MARKET_HOURS = false;

// ─────────────────────────────────────────────────────────────
// MAIN 5-MINUTE TRIGGER
// ─────────────────────────────────────────────────────────────
function runEvery5Minutes() {
  try {
    var now = getCurrentEasternTime();
    Logger.log("runEvery5Minutes fired at ET: " + now.toString());

    if (!BYPASS_MARKET_HOURS) {
      var dayOfWeek = now.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        Logger.log("Weekend — skipping.");
        setFlag("MARKET_OPEN_TODAY", "NO");
        return;
      }

      if (isTodayHoliday(now)) {
        Logger.log("Holiday — skipping.");
        setFlag("MARKET_OPEN_TODAY", "NO");
        return;
      }

      if (!isMarketOpen(now)) {
        var h = now.getHours();
        var m = now.getMinutes();
        if (h === MARKET_CLOSE_HOUR && m < 10) {
          finalizeDaySummary();
        }
        Logger.log("Market closed at ET " + h + ":" + m + " — skipping.");
        setFlag("MARKET_OPEN_TODAY", "NO");

        // Bear Trap still needs to fire at 3:00 CST for EOD brief
        var closingData = fetchSPYData();
        if (closingData) runBearTrapTick(closingData, now);

        return;
      }
    } else {
      Logger.log("BYPASS_MARKET_HOURS = true — skipping time checks.");
    }

    setFlag("MARKET_OPEN_TODAY", "YES");

    var data = fetchSPYData();
    if (!data) {
      Logger.log("fetchSPYData returned null — skipping tick.");
      return;
    }
    Logger.log("SPY price fetched: " + data.price);

    // ── Main SPY log ──────────────────────────────────────────
    logTick(data, now);
    Logger.log("Tick logged successfully.");

    // ── Bear Trap (8:30–9:15 CST active + 3:00 CST EOD) ─────
    runBearTrapTick(data, now);

  } catch (e) {
    Logger.log("runEvery5Minutes ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// MANUAL TICK — always runs regardless of time/day
// ─────────────────────────────────────────────────────────────
function runManualTick() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsExist(ss);

    var logSheet = ss.getSheetByName(SHEET_LOG);
    if (logSheet) addVolumeHeaderNotes(logSheet);

    var now = getCurrentEasternTime();
    Logger.log("Manual tick at ET: " + now.toString());

    var data = fetchSPYData();
    if (!data) {
      SpreadsheetApp.getUi().alert("❌ Could not fetch SPY data.\nCheck Apps Script logs.");
      return;
    }
    Logger.log("SPY price: " + data.price);

    logTick(data, now);
    runBearTrapTick(data, now);

    SpreadsheetApp.getUi().alert(
      "✅ Tick logged!\n" +
      "SPY: $" + data.price.toFixed(2) + "\n\n" +
      "Check:\n" +
      "  📈 SPY LOG\n" +
      "  🪤 BEAR TRAP\n" +
      "  📊 SCORECARD"
    );

  } catch (e) {
    Logger.log("runManualTick ERROR: " + e.message + "\n" + e.stack);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message + "\n\nSee Apps Script logs.");
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
    ss.insertSheet(SHEET_HOLIDAYS).appendRow(["Holiday Date (YYYY-MM-DD)", "Holiday Name"]);
  }
  if (!ss.getSheetByName(SHEET_BEAR_TRAP)) {
    setupBearTrapSheet(ss);
  }
  if (!ss.getSheetByName(SHEET_SCORECARD)) {
    setupScorecardSheet(ss);
  }
}

// ─────────────────────────────────────────────────────────────
// MARKET OPEN CHECK
// ─────────────────────────────────────────────────────────────
function isMarketOpen(easternDate) {
  var totalMins = easternDate.getHours() * 60 + easternDate.getMinutes();
  var openMins  = MARKET_OPEN_HOUR  * 60 + MARKET_OPEN_MIN;
  var closeMins = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MIN;
  return totalMins >= openMins && totalMins < closeMins;
}

// ─────────────────────────────────────────────────────────────
// GET CURRENT EASTERN TIME
// ─────────────────────────────────────────────────────────────
function getCurrentEasternTime() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

// ─────────────────────────────────────────────────────────────
// CONFIG FLAG HELPERS
// ─────────────────────────────────────────────────────────────
function setFlag(key, value) {
  try {
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var config = ss.getSheetByName(SHEET_CONFIG);
    if (!config) return;
    var data = config.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(key)) {
        config.getRange(i + 1, 2).setValue(value);
        return;
      }
    }
    config.appendRow([key, value, ""]);
  } catch (e) {
    Logger.log("setFlag ERROR (" + key + "): " + e.message);
  }
}

function getFlag(key) {
  try {
    var ss     = SpreadsheetApp.getActiveSpreadsheet();
    var config = ss.getSheetByName(SHEET_CONFIG);
    if (!config) return null;
    var data = config.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(key)) return data[i][1];
    }
    return null;
  } catch (e) {
    Logger.log("getFlag ERROR (" + key + "): " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚡ SPY TRACKER")
    .addItem("🗑️  Clear Logger Data",         "clearLogData")
    .addItem("📅  Refresh Holidays",           "fetchAndSaveHolidays")
    .addItem("🔧  Setup Sheets",               "setupSheets")
    .addItem("🪤  Setup Bear Trap Sheet",      "setupBearTrapSheetFromMenu")
    .addItem("📊  Setup Scorecard Sheet",      "setupScorecardSheetFromMenu")
    .addItem("▶️  Run Now (Manual Tick)",      "runManualTick")
    .addSeparator()
    .addItem("⏰  Install 5-Min Trigger",      "installTrigger")
    .addItem("🛑  Remove All Triggers",        "removeAllTriggers")
    .addToUi();
}

// ─────────────────────────────────────────────────────────────
// TRIGGER MANAGEMENT
// ─────────────────────────────────────────────────────────────
function installTrigger() {
  removeAllTriggers();
  ScriptApp.newTrigger("runEvery5Minutes")
    .timeBased().everyMinutes(5).create();
  SpreadsheetApp.getUi().alert("✅ 5-minute trigger installed!");
}

function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });
}

// ─────────────────────────────────────────────────────────────
// CLEAR ALL LOG DATA
// ─────────────────────────────────────────────────────────────
function clearLogData() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    "⚠️ Clear All Log Data?",
    "Erases all logged ticks from SPY LOG and BEAR TRAP.\n" +
    "SCORECARD history is preserved.\n\nContinue?",
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Clear SPY LOG (keep rows 1–2: banner + headers)
  var log     = ss.getSheetByName(SHEET_LOG);
  if (!log) { ui.alert("Sheet '" + SHEET_LOG + "' not found."); return; }
  var lastRow = log.getLastRow();
  if (lastRow > 2) log.deleteRows(3, lastRow - 2);

  // Clear BEAR TRAP (keep rows 1–3: banner + legend + headers)
  var btSheet   = ss.getSheetByName(SHEET_BEAR_TRAP);
  var btLastRow = btSheet ? btSheet.getLastRow() : 0;
  if (btSheet && btLastRow > 3) btSheet.deleteRows(4, btLastRow - 3);

  // Reset SPY LOG state flags
  ["DAY_OPEN_PRICE", "PREV_PRICE", "PREV_CLOSE_PRICE",
   "PRICE_HISTORY",  "AVG_TICK_SIZE", "TICK_COUNT"].forEach(function(k) {
    setFlag(k, "");
  });

  // Reset Bear Trap daily flags
  resetDailyBearTrapFlags();

  ui.alert("✅ Log cleared!\nSPY LOG and 🪤 BEAR TRAP reset.\n📊 SCORECARD history preserved.");
}
