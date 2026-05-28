// ============================================================
// FILE: SheetSetup.gs
// PURPOSE: Creates and styles all required sheets.
//          Run ONCE via menu: ⚡ SPY TRACKER → Setup Sheets
//          Safe to re-run — won't duplicate data.
// ============================================================

// ─────────────────────────────────────────────────────────────
// SCI-FI THEME COLORS — change here to retheme the whole app
// ─────────────────────────────────────────────────────────────
var THEME = {
  BG_DEEP:     "#0d0d2b",   // Nearly-black navy — header bg
  BG_MID:      "#1a1a3e",   // Mid-dark navy — sub-header
  ACCENT_CYAN: "#00e5ff",   // Electric cyan — primary accent
  ACCENT_GOLD: "#ffd600",   // Gold — CONFIG header
  TEXT_DIM:    "#9090aa"    // Dimmed secondary text
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

  // Silently fetch holidays (no UI alert from within this call)
  fetchHolidaysSilent();

  SpreadsheetApp.getUi().alert(
    "🚀 SPY TRACKER READY!\n\n" +
    "✅ Sheets created and themed.\n" +
    "✅ Holidays loaded.\n" +
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
// Fetch holidays silently (no UI alert) — safe from any context
// ─────────────────────────────────────────────────────────────
function fetchHolidaysSilent() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  if (!sheet) sheet = ss.insertSheet(SHEET_HOLIDAYS);

  // Only fetch if sheet is empty
  if (sheet.getLastRow() > 1) return;

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

  // Only write banner + headers if the sheet is empty
  if (sheet.getLastRow() > 0) {
    Logger.log("SPY LOG already has content — skipping header write.");
    applyColumnWidths(sheet);
    return;
  }

  // ── Row 1: Banner ────────────────────────────────────────
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

  // ── Row 2: Headers ───────────────────────────────────────
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

  // Freeze banner + headers
  sheet.setFrozenRows(2);

  // ── Column widths ────────────────────────────────────────
  applyColumnWidths(sheet);

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

  // Style header row
  sheet.getRange(1, 1, 1, 3)
    .setBackground(THEME.BG_DEEP)
    .setFontColor(THEME.ACCENT_GOLD)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 350);

  // Write default keys only if sheet is fresh
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
