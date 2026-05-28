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
// MARKET HOURS  (Eastern Time — adjust if needed)
// ─────────────────────────────────────────────────────────────
var MARKET_OPEN_HOUR  = 9;
var MARKET_OPEN_MIN   = 30;
var MARKET_CLOSE_HOUR = 16;
var MARKET_CLOSE_MIN  = 0;

// ─────────────────────────────────────────────────────────────
// LARGE MOVEMENT THRESHOLD  (absolute % change that fires AI)
// ─────────────────────────────────────────────────────────────
var LARGE_MOVE_THRESHOLD = 0.75;   // e.g. 0.75 = ±0.75%

// ─────────────────────────────────────────────────────────────
// MAIN 5-MINUTE TRIGGER FUNCTION
// Set your Apps Script time-based trigger to call this every 5 min.
// ─────────────────────────────────────────────────────────────
function runEvery5Minutes() {
  try {
    var now = getCurrentEasternTime();

    // ── 1. Skip weekends ──────────────────────────────────────
    var dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      Logger.log("Weekend — skipping.");
      setFlag("MARKET_OPEN_TODAY", "NO");
      return;
    }

    // ── 2. Skip holidays ─────────────────────────────────────
    if (isTodayHoliday(now)) {
      Logger.log("Holiday — skipping.");
      setFlag("MARKET_OPEN_TODAY", "NO");
      return;
    }

    // ── 3. Check if within market hours ──────────────────────
    if (!isMarketOpen(now)) {
      // If we just passed close, finalize the day summary
      var hour = now.getHours();
      var min  = now.getMinutes();
      if (hour === MARKET_CLOSE_HOUR && min < 10) {
        finalizeDaySummary();
      }
      Logger.log("Market closed — skipping.");
      setFlag("MARKET_OPEN_TODAY", "NO");
      return;
    }

    // ── 4. Market is open — fetch & log ──────────────────────
    setFlag("MARKET_OPEN_TODAY", "YES");
    var data = fetchSPYData();
    if (!data) {
      Logger.log("fetchSPYData returned null — skipping tick.");
      return;
    }

    logTick(data, now);

  } catch (e) {
    Logger.log("runEvery5Minutes ERROR: " + e.toString());
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
// Apps Script runs in UTC; we shift to ET (UTC-5 / UTC-4 DST)
// ─────────────────────────────────────────────────────────────
function getCurrentEasternTime() {
  var now = new Date();
  // Use Intl to get correct ET offset (handles DST automatically)
  var etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(etString);
}

// ─────────────────────────────────────────────────────────────
// HELPER: Simple key-value flag store in CONFIG sheet
// ─────────────────────────────────────────────────────────────
function setFlag(key, value) {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) return;
  var data = config.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) {
      config.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  // Key not found — append it
  config.appendRow([key, value]);
}

function getFlag(key) {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) return null;
  var data = config.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// MENU: Added to the spreadsheet on open
// ─────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚡ SPY TRACKER")
    .addItem("🗑️  Clear Logger Data",       "clearLogData")
    .addItem("📅  Refresh Holidays",         "fetchAndSaveHolidays")
    .addItem("🔧  Setup Sheets",             "setupSheets")
    .addItem("▶️  Run Now (Manual Tick)",    "runEvery5Minutes")
    .addSeparator()
    .addItem("⏰  Install 5-Min Trigger",    "installTrigger")
    .addItem("🛑  Remove All Triggers",      "removeAllTriggers")
    .addToUi();
}

// ─────────────────────────────────────────────────────────────
// TRIGGER MANAGEMENT
// ─────────────────────────────────────────────────────────────
function installTrigger() {
  // Remove existing to avoid duplicates
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
// CLEAR LOG DATA  (keeps headers, wipes data rows)
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
  if (lastRow > 1) {
    log.deleteRows(2, lastRow - 1);
  }

  // Reset daily flags
  setFlag("DAY_OPEN_PRICE",   "");
  setFlag("PREV_PRICE",       "");
  setFlag("PREV_CLOSE_PRICE", "");

  ui.alert("✅ Log cleared!");
}
