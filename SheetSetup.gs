// ============================================================
// FILE: SheetSetup.gs
// PURPOSE: Creates and styles all required sheets on first run.
//          Applies the sci-fi theme to the header area and
//          configures the CONFIG sheet with default values.
//          Run once via the menu: ⚡ SPY TRACKER → Setup Sheets
// ============================================================

// ─────────────────────────────────────────────────────────────
// SCI-FI THEME COLORS — change these to retheme the whole app
// ─────────────────────────────────────────────────────────────
var THEME = {
  BG_DEEP:      "#0d0d2b",   // Nearly-black navy — main header bg
  BG_MID:       "#1a1a3e",   // Mid-dark navy — sub-header
  ACCENT_CYAN:  "#00e5ff",   // Electric cyan — primary accent
  ACCENT_GOLD:  "#ffd600",   // Gold — highlight / warning
  ACCENT_GREEN: "#00ff88",   // Neon green
  ACCENT_RED:   "#ff3d5e",   // Neon red
  TEXT_MAIN:    "#e0e0ff",   // Light lavender white — body text
  TEXT_DIM:     "#9090aa",   // Dimmed — secondary text
  BORDER:       "#2a2a55"    // Subtle border color
};

// ─────────────────────────────────────────────────────────────
// MAIN SETUP FUNCTION — run once via the menu
// ─────────────────────────────────────────────────────────────
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Create sheets if they don't exist ────────────────────
  var logSheet      = getOrCreateSheet(ss, SHEET_LOG);
  var configSheet   = getOrCreateSheet(ss, SHEET_CONFIG);
  var holidaySheet  = getOrCreateSheet(ss, SHEET_HOLIDAYS);

  // ── Style each sheet ─────────────────────────────────────
  styleLogSheet(ss, logSheet);
  styleConfigSheet(configSheet);
  styleHolidaySheet(holidaySheet);

  // ── Populate CONFIG defaults ─────────────────────────────
  populateConfigDefaults(configSheet);

  // ── Fetch holidays ────────────────────────────────────────
  fetchAndSaveHolidays();

  SpreadsheetApp.getUi().alert(
    "🚀 SPY TRACKER READY!\n\n" +
    "✅ Sheets created and themed.\n" +
    "✅ Holidays loaded.\n" +
    "✅ CONFIG initialized.\n\n" +
    "Next steps:\n" +
    "1. Add your GEMINI_API_KEY in Extensions → Apps Script\n" +
    "   → Project Settings → Script Properties\n\n" +
    "2. Install the 5-min trigger:\n" +
    "   Menu → ⚡ SPY TRACKER → Install 5-Min Trigger\n\n" +
    "3. Test: Menu → ⚡ SPY TRACKER → Run Now (Manual Tick)"
  );
}

// ─────────────────────────────────────────────────────────────
// STYLE: SPY LOG sheet — sci-fi dashboard look
// ─────────────────────────────────────────────────────────────
function styleLogSheet(ss, sheet) {
  // ── Sheet-level ───────────────────────────────────────────
  sheet.setTabColor(THEME.ACCENT_CYAN);
  ss.setActiveSheet(sheet);

  // ── Title banner (row 1 is reserved for the big title) ───
  // We'll use a merged row above the headers for the banner.
  // First, insert a blank row at top if headers aren't set yet
  if (sheet.getLastRow() === 0) {
    // Insert banner row
    sheet.insertRowBefore(1);
    var bannerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    bannerRange.merge();
    bannerRange
      .setValue("⚡ S P Y   R E A L - T I M E   S C A N N E R  ⚡   |   MARKET INTELLIGENCE SYSTEM v1.0")
      .setBackground(THEME.BG_DEEP)
      .setFontColor(THEME.ACCENT_CYAN)
      .setFontWeight("bold")
      .setFontSize(13)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    sheet.setRowHeight(1, 36);

    // Write headers on row 2
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
  }

  // ── Apply column widths ───────────────────────────────────
  applyColumnWidths(sheet);

  // ── Sheet tab color ──────────────────────────────────────
  sheet.setTabColor("#00bcd4");
}

// ─────────────────────────────────────────────────────────────
// STYLE: CONFIG sheet
// ─────────────────────────────────────────────────────────────
function styleConfigSheet(sheet) {
  sheet.setTabColor("#ffd600");
  sheet.setName(SHEET_CONFIG);

  // Header
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["⚙️ KEY", "VALUE", "NOTES"]);
  }
  var header = sheet.getRange(1, 1, 1, 3);
  header
    .setBackground(THEME.BG_DEEP)
    .setFontColor(THEME.ACCENT_GOLD)
    .setFontWeight("bold")
    .setFontSize(11);

  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 350);
}

// ─────────────────────────────────────────────────────────────
// CONFIG DEFAULT VALUES — what gets pre-populated
// ─────────────────────────────────────────────────────────────
function populateConfigDefaults(sheet) {
  var defaults = [
    ["MARKET_OPEN_TODAY", "UNKNOWN",        "Set by trigger: YES / NO"],
    ["PREV_PRICE",        "",               "Last logged SPY price"],
    ["PREV_CLOSE_PRICE",  "",               "Previous session close"],
    ["DAY_OPEN_PRICE",    "",               "Price at first tick today"],
    ["PRICE_HISTORY",     "",               "Comma-separated closes for EMA"],
    ["AVG_TICK_SIZE",     "",               "Rolling avg absolute tick change"],
    ["TICK_COUNT",        "",               "Number of ticks logged today"],
    ["LAST_AI_CALL_TIME", "",               "Unix ms of last Gemini call"],
  ];

  var existing = sheet.getLastRow();
  // Only write defaults if CONFIG sheet is mostly empty
  if (existing <= 1) {
    sheet.getRange(2, 1, defaults.length, 3).setValues(defaults);
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER: Get existing sheet or create a new one
// ─────────────────────────────────────────────────────────────
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}
