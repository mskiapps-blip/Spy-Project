// ============================================================
// FILE: SheetSetup.gs
// PURPOSE: Creates and styles all required sheets.
//          Run ONCE via menu: ⚡ SPY TRACKER → Setup Sheets
//          Safe to re-run — won't duplicate data.
// ============================================================

// ─────────────────────────────────────────────────────────────
// SCI-FI THEME COLORS
// ─────────────────────────────────────────────────────────────
var THEME = {
  BG_DEEP:     "#0d0d2b",
  BG_MID:      "#1a1a3e",
  ACCENT_CYAN: "#00e5ff",
  ACCENT_GOLD: "#ffd600",
  TEXT_DIM:    "#9090aa"
};

// ─────────────────────────────────────────────────────────────
// MAIN SETUP — run once from menu
// ─────────────────────────────────────────────────────────────
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var logSheet     = getOrCreateSheet(ss, SHEET_LOG);
  var configSheet  = getOrCreateSheet(ss, SHEET_CONFIG);
  var holidaySheet = getOrCreateSheet(ss, SHEET_HOLIDAYS);

  setupLogSheet(ss, logSheet);
  setupConfigSheet(configSheet);
  setupHolidaySheet(holidaySheet);

  // ── Write fallback holidays directly — no network call during setup.
  // ── Users can refresh live data anytime via Menu → 📅 Refresh Holidays.
  var yr = new Date().getFullYear();
  var fallbackRows = getFallbackHolidays(yr).concat(getFallbackHolidays(yr + 1));
  var holidaySheet2 = ss.getSheetByName(SHEET_HOLIDAYS);
  if (holidaySheet2 && holidaySheet2.getLastRow() <= 1 && fallbackRows.length > 0) {
    holidaySheet2.getRange(2, 1, fallbackRows.length, 2).setValues(fallbackRows);
  }
  var holidayNote = "✅ Holidays loaded from built-in list (2025–2026).";

  // ── Forecast sheet ────────────────────────────────────────
  if (!ss.getSheetByName(SHEET_FORECAST)) {
    setupForecastSheet(ss);
  }

// ── AI Health sheet ───────────────────────────────────────
  if (!ss.getSheetByName(SHEET_AI_HEALTH)) {
    setupAIHealthSheet(ss);
  }

  SpreadsheetApp.getUi().alert(
    "🚀 SPY TRACKER READY!\n\n" +
    "✅ Sheets created and themed.\n" +
    holidayNote + "\n" +
    "✅ CONFIG initialized.\n\n" +
    "NEXT STEPS:\n" +
    "1. Add GEMINI_API_KEY in:\n" +
    "   Extensions → Apps Script → Project Settings\n" +
    "   → Script Properties → Add property\n\n" +
    "2. Install trigger:\n" +
    "   Menu → ⚡ SPY TRACKER → Install 5-Min Trigger\n\n" +
    "3. Test: Menu → ⚡ SPY TRACKER → Run Now (Manual Tick)"
  );

}

// ─────────────────────────────────────────────────────────────
// Fetch holidays silently — only runs if the sheet is empty.
// Throws on network failure so callers can catch it.
// NOTE: Not called during setupSheets() to avoid hanging on
//       the Nasdaq API. Called only from fetchAndSaveHolidays()
//       which is triggered manually via the menu.
// ─────────────────────────────────────────────────────────────
function fetchHolidaysSilent() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  if (!sheet) sheet = ss.insertSheet(SHEET_HOLIDAYS);

  // Already populated — nothing to do
  if (sheet.getLastRow() > 1) {
    Logger.log("fetchHolidaysSilent: sheet already has data, skipping.");
    return;
  }

  sheet.clearContents();
  sheet.appendRow(["Holiday Date (YYYY-MM-DD)", "Holiday Name"]);

  var currentYear = new Date().getFullYear();
  var rows = [];
  [currentYear, currentYear + 1].forEach(function(year) {
    rows = rows.concat(fetchHolidaysForYear(year));
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  Logger.log("fetchHolidaysSilent: " + rows.length + " holidays loaded.");
}

// ─────────────────────────────────────────────────────────────
// SPY LOG sheet setup
// Row 1: Sci-fi banner (merged)
// Row 2: Column headers
// Row 3+: Data
// ─────────────────────────────────────────────────────────────
function setupLogSheet(ss, sheet) {
  sheet.setTabColor(THEME.ACCENT_CYAN);

  if (sheet.getLastRow() > 0) {
    Logger.log("SPY LOG already has content — skipping header write.");
    applyColumnWidths(sheet);
    addVolumeHeaderNotes(sheet);
    return;
  }

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.appendRow(["⚡ S P Y   R E A L - T I M E   S C A N N E R  ⚡   |   MARKET INTELLIGENCE SYSTEM v1.0"]);
  var banner = sheet.getRange(1, 1, 1, HEADERS.length);
  banner.merge()
    .setValue("⚡ S P Y   R E A L - T I M E   S C A N N E R  ⚡   |   MARKET INTELLIGENCE SYSTEM v1.0")
    .setBackground(THEME.BG_DEEP)
    .setFontColor(THEME.ACCENT_CYAN)
    .setFontWeight("bold")
    .setFontSize(13)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  // ── Row 2: Headers ────────────────────────────────────────
  sheet.appendRow(HEADERS);
  var headerRow = sheet.getRange(2, 1, 1, HEADERS.length);
  headerRow
    .setBackground(THEME.BG_MID)
    .setFontColor(THEME.ACCENT_CYAN)
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(2, 28);

  sheet.setFrozenRows(2);
  applyColumnWidths(sheet);
  addVolumeHeaderNotes(sheet);

  Logger.log("SPY LOG sheet setup complete.");
}

// ─────────────────────────────────────────────────────────────
// CONFIG sheet setup
// ─────────────────────────────────────────────────────────────
function setupConfigSheet(sheet) {
  sheet.setTabColor(THEME.ACCENT_GOLD);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["KEY", "VALUE", "NOTES"]);
  }

  sheet.getRange(1, 1, 1, 3)
    .setBackground(THEME.BG_DEEP)
    .setFontColor(THEME.ACCENT_GOLD)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 350);

  if (sheet.getLastRow() <= 1) {
    var defaults = [
      ["MARKET_OPEN_TODAY", "UNKNOWN",  "YES / NO — set by trigger"],
      ["PREV_PRICE",        "",         "Last logged SPY price"],
      ["PREV_CLOSE_PRICE",  "",         "Previous session close"],
      ["DAY_OPEN_PRICE",    "",         "Price at first tick of the day"],
      ["PRICE_HISTORY",     "",         "Comma-separated closes for EMA calc"],
      ["AVG_TICK_SIZE",     "",         "Rolling exponential avg tick size"],
      ["TICK_COUNT",        "",         "Ticks logged today"],
      ["LAST_AI_CALL_TIME", "",         "Unix ms timestamp of last Gemini call"]
    ];
    sheet.getRange(2, 1, defaults.length, 3).setValues(defaults);
  }
}

// ─────────────────────────────────────────────────────────────
// HOLIDAYS sheet styling
// ─────────────────────────────────────────────────────────────
function setupHolidaySheet(sheet) {
  sheet.setTabColor("#ff6b6b");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Holiday Date (YYYY-MM-DD)", "Holiday Name"]);
  }
  sheet.getRange(1, 1, 1, 2)
    .setBackground(THEME.BG_DEEP)
    .setFontColor(THEME.ACCENT_CYAN)
    .setFontWeight("bold")
    .setFontSize(11);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 250);
}

// ─────────────────────────────────────────────────────────────
// HELPER: Get or create a sheet by name
// ─────────────────────────────────────────────────────────────
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}
