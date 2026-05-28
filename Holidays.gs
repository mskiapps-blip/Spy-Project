// ============================================================
// FILE: Holidays.gs
// PURPOSE: Fetches and caches US market holidays using the
//          free Nasdaq trading calendar API (no key needed).
//          Holidays are saved to the HOLIDAYS sheet and
//          checked each trigger run.
// ============================================================

// ─────────────────────────────────────────────────────────────
// FREE HOLIDAY API — Nasdaq Market Calendar
// Returns NYSE holiday dates for a given year.
// No API key required.
// ─────────────────────────────────────────────────────────────
var NASDAQ_CALENDAR_URL = "https://api.nasdaq.com/api/calendar/tradingholidays?year=";

// ─────────────────────────────────────────────────────────────
// FETCH AND SAVE HOLIDAYS to the HOLIDAYS sheet.
// Call this once a year (or via menu).
// Fetches current year + next year for coverage.
// ─────────────────────────────────────────────────────────────
function fetchAndSaveHolidays() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName(SHEET_HOLIDAYS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_HOLIDAYS);
  }

  // Clear old data
  sheet.clearContents();
  sheet.appendRow(["Holiday Date (YYYY-MM-DD)", "Holiday Name"]);

  var currentYear = new Date().getFullYear();
  var years = [currentYear, currentYear + 1];
  var rows = [];

  for (var y = 0; y < years.length; y++) {
    var year = years[y];
    try {
      var url = NASDAQ_CALENDAR_URL + year;
      var options = {
        muteHttpExceptions: true,
        headers: {
          // Nasdaq requires a basic browser-like user-agent
          "User-Agent": "Mozilla/5.0"
        }
      };
      var response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() !== 200) {
        Logger.log("Nasdaq holiday fetch failed for " + year + ": " + response.getResponseCode());
        // Fallback: use hardcoded NYSE holidays
        var fallback = getFallbackHolidays(year);
        rows = rows.concat(fallback);
        continue;
      }

      var json = JSON.parse(response.getContentText());
      var holidays = json.data && json.data.rows ? json.data.rows : [];

      for (var i = 0; i < holidays.length; i++) {
        var h = holidays[i];
        // Nasdaq returns dates like "Jan 01, 2025" — convert to YYYY-MM-DD
        var dateStr = parseNasdaqDate(h.date || h.eventDate || "");
        var name    = h.eventName || h.description || "Holiday";
        if (dateStr) {
          rows.push([dateStr, name]);
        }
      }

    } catch (e) {
      Logger.log("fetchAndSaveHolidays ERROR for " + year + ": " + e.toString());
      // Fallback holidays
      var fallback = getFallbackHolidays(year);
      rows = rows.concat(fallback);
    }
  }

  // Write all rows at once for efficiency
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  styleHolidaySheet(sheet);
  Logger.log("Holidays saved: " + rows.length + " entries.");
  SpreadsheetApp.getUi().alert("✅ Holidays updated! " + rows.length + " dates saved.");
}

// ─────────────────────────────────────────────────────────────
// CHECK: Is today a market holiday?
// Reads from HOLIDAYS sheet. Returns true/false.
// ─────────────────────────────────────────────────────────────
function isTodayHoliday(easternDate) {
  var dateStr = formatDateKey(easternDate); // "YYYY-MM-DD"
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName(SHEET_HOLIDAYS);

  // If no holiday sheet exists yet, auto-fetch
  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log("No holiday data found — fetching now.");
    fetchAndSaveHolidays();
    sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  }

  if (!sheet || sheet.getLastRow() <= 1) return false;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === dateStr) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// HELPER: Parse Nasdaq date strings like "Jan 01, 2025"
// Returns "YYYY-MM-DD" or "" on failure
// ─────────────────────────────────────────────────────────────
function parseNasdaqDate(str) {
  try {
    if (!str) return "";
    // Try direct parse first
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      return formatDateKey(d);
    }
    return "";
  } catch (e) {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER: Format date as "YYYY-MM-DD"
// ─────────────────────────────────────────────────────────────
function formatDateKey(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// ─────────────────────────────────────────────────────────────
// FALLBACK: Hardcoded NYSE holidays when API fails.
// Update these annually if needed.
// ─────────────────────────────────────────────────────────────
function getFallbackHolidays(year) {
  // Standard NYSE holidays — dates may shift for observed holidays
  // This is a best-effort fallback only
  var map = {
    2025: [
      ["2025-01-01", "New Year's Day"],
      ["2025-01-20", "MLK Day"],
      ["2025-02-17", "Presidents' Day"],
      ["2025-04-18", "Good Friday"],
      ["2025-05-26", "Memorial Day"],
      ["2025-06-19", "Juneteenth"],
      ["2025-07-04", "Independence Day"],
      ["2025-09-01", "Labor Day"],
      ["2025-11-27", "Thanksgiving"],
      ["2025-12-25", "Christmas"]
    ],
    2026: [
      ["2026-01-01", "New Year's Day"],
      ["2026-01-19", "MLK Day"],
      ["2026-02-16", "Presidents' Day"],
      ["2026-04-03", "Good Friday"],
      ["2026-05-25", "Memorial Day"],
      ["2026-06-19", "Juneteenth"],
      ["2026-07-03", "Independence Day (observed)"],
      ["2026-09-07", "Labor Day"],
      ["2026-11-26", "Thanksgiving"],
      ["2026-12-25", "Christmas"]
    ]
  };
  return map[year] || [];
}

// ─────────────────────────────────────────────────────────────
// STYLE: Basic formatting for the HOLIDAYS sheet
// ─────────────────────────────────────────────────────────────
function styleHolidaySheet(sheet) {
  var header = sheet.getRange(1, 1, 1, 2);
  header.setBackground("#0d0d2b")
        .setFontColor("#00e5ff")
        .setFontWeight("bold")
        .setFontSize(11);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 250);
}
