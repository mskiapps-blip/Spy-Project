// ============================================================
// FILE: Code.gs
// PURPOSE: Main entry point. Handles the 5-minute trigger,
//          market open/close checks, and wires everything together.
// ============================================================

// ─────────────────────────────────────────────────────────────
// GLOBAL SHEET / TAB NAMES  (change here if you rename tabs)
// ─────────────────────────────────────────────────────────────
var SHEET_LOG      = "SPY LOG";
var SHEET_CONFIG   = "CONFIG";
var SHEET_HOLIDAYS = "HOLIDAYS";

// ─────────────────────────────────────────────────────────────
// MARKET HOURS  (Eastern Time)
// ─────────────────────────────────────────────────────────────
var MARKET_OPEN_HOUR  = 9;
var MARKET_OPEN_MIN   = 30;
var MARKET_CLOSE_HOUR = 16;
var MARKET_CLOSE_MIN  = 0;

// ─────────────────────────────────────────────────────────────
// LARGE MOVEMENT THRESHOLD  (absolute % change that fires AI)
// ─────────────────────────────────────────────────────────────
var LARGE_MOVE_THRESHOLD = 0.75;

// ─────────────────────────────────────────────────────────────
// BYPASS MARKET HOURS CHECK FOR MANUAL/TEST RUNS
// Set to true to always log a tick regardless of time/day.
// Set back to false for live production use.
// ─────────────────────────────────────────────────────────────
var BYPASS_MARKET_HOURS = false;

// ─────────────────────────────────────────────────────────────
// MAIN 5-MINUTE TRIGGER FUNCTION
// ─────────────────────────────────────────────────────────────
function runEvery5Minutes() {
  try {
    var now = getCurrentEasternTime();
    Logger.log("runEvery5Minutes fired at ET: " + now.toString());

    if (!BYPASS_MARKET_HOURS) {
      // ── Skip weekends ──────────────────────────────────────
      var dayOfWeek = now.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        Logger.log("Weekend — skipping.");
        setFlag("MARKET_OPEN_TODAY", "NO");
        return;
      }

      // ── Skip holidays ─────────────────────────────────────
      if (isTodayHoliday(now)) {
        Logger.log("Holiday — skipping.");
        setFlag("MARKET_OPEN_TODAY", "NO");
        return;
      }

      // ── Check market hours ───────────────────────────────
      if (!isMarketOpen(now)) {
        var h = now.getHours();
        var m = now.getMinutes();
        if (h === MARKET_CLOSE_HOUR && m < 10) {
          finalizeDaySummary();
        }
        Logger.log("Market closed at ET " + h + ":" + m + " — skipping.");
        setFlag("MARKET_OPEN_TODAY", "NO");
        return;
      }
    } else {
      Logger.log("BYPASS_MARKET_HOURS = true — skipping time checks.");
    }

    // ── Market is open (or bypassed) — fetch & log ───────────
    setFlag("MARKET_OPEN_TODAY", "YES");

    var data = fetchSPYData();
    if (!data) {
      Logger.log("fetchSPYData returned null — skipping tick.");
      return;
    }
    Logger.log("SPY price fetched: " + data.price);

    logTick(data, now);
    Logger.log("Tick logged successfully.");

  } catch (e) {
    Logger.log("runEvery5Minutes ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// MANUAL TEST RUN — always logs one tick regardless of time.
// Called from the menu "Run Now (Manual Tick)".
// ─────────────────────────────────────────────────────────────
function runManualTick() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Make sure sheets exist before anything else
    ensureSheetsExist(ss);

    var now = getCurrentEasternTime();
    Logger.log("Manual tick at ET: " + now.toString());

    var data = fetchSPYData();
    if (!data) {
      SpreadsheetApp.getUi().alert("❌ Could not fetch SPY data.\nCheck Apps Script execution logs for details.");
      return;
    }
    Logger.log("SPY price: " + data.price);

    logTick(data, now);
    SpreadsheetApp.getUi().alert("✅ Tick logged!\nSPY: $" + data.price.toFixed(2) + "\nCheck the SPY LOG sheet.");

  } catch (e) {
    Logger.log("runManualTick ERROR: " + e.message + "\n" + e.stack);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message + "\n\nSee Apps Script logs for details.");
  }
}

// ─────────────────────────────────────────────────────────────
// ENSURE SHEETS EXIST — lightweight check, no styling
// Called before any write operation to prevent null sheet errors
// ─────────────────────────────────────────────────────────────
function ensureSheetsExist(ss) {
  if (!ss.getSheetByName(SHEET_LOG)) {
    var s = ss.insertSheet(SHEET_LOG);
    s.setTabColor("#00bcd4");
  }
  if (!ss.getSheetByName(SHEET_CONFIG)) {
    var c = ss.insertSheet(SHEET_CONFIG);
    c.setTabColor("#ffd600");
    // Write header row
    c.appendRow(["KEY", "VALUE", "NOTES"]);
  }
  if (!ss.getSheetByName(SHEET_HOLIDAYS)) {
    var h = ss.insertSheet(SHEET_HOLIDAYS);
    h.appendRow(["Holiday Date (YYYY-MM-DD)", "Holiday Name"]);
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER: Is the market currently open?
// ─────────────────────────────────────────────────────────────
function isMarketOpen(easternDate) {
  var h = easternDate.getHours();
  var m = easternDate.getMinutes();
  var totalMins = h * 60 + m;
  var openMins  = MARKET_OPEN_HOUR  * 60 + MARKET_OPEN_MIN;
  var closeMins = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MIN;
  return totalMins >= openMins && totalMins < closeMins;
}

// ─────────────────────────────────────────────────────────────
// HELPER: Get current Eastern Time as a Date object
// ─────────────────────────────────────────────────────────────
function getCurrentEasternTime() {
  var now = new Date();
  var etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(etString);
}

// ─────────────────────────────────────────────────────────────
// HELPER: Set a key-value flag in CONFIG sheet
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

// ─────────────────────────────────────────────────────────────
// HELPER: Get a flag value from CONFIG sheet
// ─────────────────────────────────────────────────────────────
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
    .addItem("🗑️  Clear Logger Data",       "clearLogData")
    .addItem("📅  Refresh Holidays",         "fetchAndSaveHolidays")
    .addItem("🔧  Setup Sheets",             "setupSheets")
    .addItem("▶️  Run Now (Manual Tick)",    "runManualTick")
    .addSeparator()
    .addItem("⏰  Install 5-Min Trigger",    "installTrigger")
    .addItem("🛑  Remove All Triggers",      "removeAllTriggers")
    .addToUi();
}

// ─────────────────────────────────────────────────────────────
// TRIGGER MANAGEMENT
// ─────────────────────────────────────────────────────────────
function installTrigger() {
  removeAllTriggers();
  ScriptApp.newTrigger("runEvery5Minutes")
    .timeBased()
    .everyMinutes(5)
    .create();
  SpreadsheetApp.getUi().alert("✅ 5-minute trigger installed!");
}

function removeAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}

// ─────────────────────────────────────────────────────────────
// CLEAR LOG DATA
// ─────────────────────────────────────────────────────────────
function clearLogData() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    "⚠️ Clear All Log Data?",
    "This will erase all logged ticks. Headers stay. Continue?",
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(SHEET_LOG);
  if (!log) { ui.alert("Sheet '" + SHEET_LOG + "' not found."); return; }

  var lastRow = log.getLastRow();
  // Keep rows 1 and 2 (banner + headers), delete everything after
  if (lastRow > 2) {
    log.deleteRows(3, lastRow - 2);
  }

  setFlag("DAY_OPEN_PRICE",   "");
  setFlag("PREV_PRICE",       "");
  setFlag("PREV_CLOSE_PRICE", "");
  setFlag("PRICE_HISTORY",    "");
  setFlag("AVG_TICK_SIZE",    "");
  setFlag("TICK_COUNT",       "");

  ui.alert("✅ Log cleared!");
}
