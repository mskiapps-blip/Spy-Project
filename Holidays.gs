// ============================================================
// FILE: Holidays.gs
// PURPOSE: Fetches and caches US market holidays.
//          isTodayHoliday() is SILENT — no UI alerts, safe to
//          call from triggers. fetchAndSaveHolidays() shows an
//          alert only when called from the menu.
// ============================================================

var NASDAQ_CALENDAR_URL = "https://api.nasdaq.com/api/calendar/tradingholidays?year=";

// ─────────────────────────────────────────────────────────────
// FETCH AND SAVE HOLIDAYS — called from menu only
// ─────────────────────────────────────────────────────────────
function fetchAndSaveHolidays() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_HOLIDAYS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_HOLIDAYS);
  }

  sheet.clearContents();
  sheet.appendRow(["Holiday Date (YYYY-MM-DD)", "Holiday Name"]);

  var currentYear = new Date().getFullYear();
  var rows        = [];

  // Fetch current year and next year
  [currentYear, currentYear + 1].forEach(function(year) {
    var fetched = fetchHolidaysForYear(year);
    rows        = rows.concat(fetched);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  // Style the sheet
  var header = sheet.getRange(1, 1, 1, 2);
  header.setBackground("#0d0d2b").setFontColor("#00e5ff").setFontWeight("bold").setFontSize(11);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 250);

  Logger.log("Holidays saved: " + rows.length + " entries.");

  // Only show alert when called from the UI (menu)
  try {
    SpreadsheetApp.getUi().alert("✅ Holidays updated! " + rows.length + " dates saved.");
  } catch(e) {
    // Called from trigger context — no UI available, that's fine
    Logger.log("fetchAndSaveHolidays: no UI context (trigger), skipping alert.");
  }
}

// ─────────────────────────────────────────────────────────────
// FETCH for a single year — returns array of [dateStr, name]
// ─────────────────────────────────────────────────────────────
function fetchHolidaysForYear(year) {
  try {
    var url     = NASDAQ_CALENDAR_URL + year;
    var options = { muteHttpExceptions: true, headers: { "User-Agent": "Mozilla/5.0" } };
    var resp    = UrlFetchApp.fetch(url, options);

    if (resp.getResponseCode() === 200) {
      var json     = JSON.parse(resp.getContentText());
      var holidays = (json.data && json.data.rows) ? json.data.rows : [];
      var rows     = [];

      holidays.forEach(function(h) {
        var rawDate = h.date || h.eventDate || "";
        var dateStr = parseToYMD(rawDate);
        var name    = h.eventName || h.description || "Holiday";
        if (dateStr) rows.push([dateStr, name]);
      });

      if (rows.length > 0) {
        Logger.log("Nasdaq returned " + rows.length + " holidays for " + year);
        return rows;
      }
    }
  } catch (e) {
    Logger.log("Nasdaq API error for " + year + ": " + e.message);
  }

  // Fallback to hardcoded list
  Logger.log("Using fallback holidays for " + year);
  return getFallbackHolidays(year);
}

// ─────────────────────────────────────────────────────────────
// CHECK: Is today a market holiday? (SILENT — no UI calls)
// ─────────────────────────────────────────────────────────────
function isTodayHoliday(easternDate) {
  try {
    var dateStr = toYMD(easternDate);
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var sheet   = ss.getSheetByName(SHEET_HOLIDAYS);

    // If sheet missing or empty, silently load fallback holidays into memory
    if (!sheet || sheet.getLastRow() <= 1) {
      Logger.log("No holiday sheet — using in-memory fallback.");
      var year     = easternDate.getFullYear();
      var fallback = getFallbackHolidays(year);
      for (var i = 0; i < fallback.length; i++) {
        if (fallback[i][0] === dateStr) return true;
      }
      return false;
    }

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === dateStr) return true;
    }
    return false;

  } catch (e) {
    Logger.log("isTodayHoliday ERROR: " + e.message);
    return false; // Fail open — better to run and get no data than to block
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER: Parse a date string to "YYYY-MM-DD"
// ─────────────────────────────────────────────────────────────
function parseToYMD(str) {
  if (!str) return "";
  try {
    var d = new Date(str);
    if (!isNaN(d.getTime())) return toYMD(d);
  } catch(e) {}
  return "";
}

function toYMD(d) {
  var y   = d.getFullYear();
  var m   = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// ─────────────────────────────────────────────────────────────
// FALLBACK: Hardcoded NYSE holidays (update annually)
// ─────────────────────────────────────────────────────────────
function getFallbackHolidays(year) {
  var map = {
    2025: [
      ["2025-01-01","New Year's Day"],["2025-01-20","MLK Day"],
      ["2025-02-17","Presidents' Day"],["2025-04-18","Good Friday"],
      ["2025-05-26","Memorial Day"],["2025-06-19","Juneteenth"],
      ["2025-07-04","Independence Day"],["2025-09-01","Labor Day"],
      ["2025-11-27","Thanksgiving"],["2025-12-25","Christmas"]
    ],
    2026: [
      ["2026-01-01","New Year's Day"],["2026-01-19","MLK Day"],
      ["2026-02-16","Presidents' Day"],["2026-04-03","Good Friday"],
      ["2026-05-25","Memorial Day"],["2026-06-19","Juneteenth"],
      ["2026-07-03","Independence Day (observed)"],["2026-09-07","Labor Day"],
      ["2026-11-26","Thanksgiving"],["2026-12-25","Christmas"]
    ]
  };
  return map[year] || [];
}
