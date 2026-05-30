// ============================================================
// FILE: Scorecard.gs
// PURPOSE: 📊 WIN/LOSS SCORECARD — tracks Bear Trap accuracy
//          over time. One row per trading day. Auto-populated
//          at EOD by writeEODBrief() in BearTrapTracker.gs.
//
//  Sheet: 📊 SCORECARD
//  Updates: Once per day at ~3:00 CST
//  No AI calls — pure data logging + formula-driven stats
// ============================================================

var SHEET_SCORECARD = "📊 SCORECARD";

// ─────────────────────────────────────────────────────────────
// SCORECARD COLUMNS
// ─────────────────────────────────────────────────────────────
var SC = {
  DATE:          1,  // A
  CONFIDENCE:    2,  // B — morning peak confidence %
  SIGNAL:        3,  // C — BUY CALLS issued? YES/NO
  SIGNAL_PRICE:  4,  // D — price when signal issued
  PATTERN_PLAYED:5,  // E — did flush→flip→rip actually happen?
  GRADE:         6,  // F — ✅ / ⚠️ / ❌ / ➡️
  MAX_FLUSH:     7,  // G — deepest flush of the day (%)
  CLOSE_VS_OPEN: 8,  // H — SPY % gain/loss open→close
  OH_TAGGED:     9,  // I — overnight high tagged? YES/NO
  AI_CALLS:      10, // J — how many AI calls were used
  RESULT:        11  // K — WIN / LOSS / NO TRADE / MISS
};

var SC_HEADERS = [
  "📅 DATE",
  "🎯 PEAK CONF %",
  "🚦 SIGNAL",
  "💲 SIGNAL PRICE",
  "🪤 PATTERN PLAYED",
  "🏆 GRADE",
  "📉 MAX FLUSH %",
  "📈 CLOSE vs OPEN",
  "🌙 OH TAGGED",
  "🤖 AI CALLS",
  "✅ RESULT"
];

// ─────────────────────────────────────────────────────────────
// LOG ONE DAY'S RESULT — called from writeEODBrief()
// ─────────────────────────────────────────────────────────────
function logToScorecard(cst, confidence, signalIssued, signalPrice,
                         patternPlayed, grade, maxFlush, closeVsOpen,
                         overnightTagged, aiCallCount) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_SCORECARD);
    if (!sheet) {
      setupScorecardSheet(ss);
      sheet = ss.getSheetByName(SHEET_SCORECARD);
    }

    var dateStr = Utilities.formatDate(cst, "America/Chicago", "M/dd/yyyy");

    // Determine result
    var result;
    if      (patternPlayed && signalIssued === "YES") result = "✅ WIN";
    else if (patternPlayed && signalIssued !== "YES") result = "😔 MISS";
    else if (!patternPlayed && signalIssued === "YES") result = "❌ LOSS";
    else                                               result = "➡️ NO TRADE";

    var row = [
      dateStr,
      parseInt(confidence),
      signalIssued === "YES" ? "YES" : "NO",
      signalPrice > 0 ? signalPrice : "—",
      patternPlayed ? "YES" : "NO",
      grade,
      Math.round(Math.abs(maxFlush) * 100) / 100,
      Math.round(closeVsOpen * 100) / 100,
      overnightTagged ? "YES" : "NO",
      parseInt(aiCallCount) || 0,
      result
    ];

    sheet.appendRow(row);
    var newRow = sheet.getLastRow();
    applyScorecardRowFormat(sheet, newRow, result, parseInt(confidence));

    // ── Cache yesterday's result for Morning Brief AI context ─
    // callGeminiForBrief() reads these to calibrate its daily
    // setup prediction based on recent performance.
    setFlag("SC_LAST_GRADE",        grade);
    setFlag("SC_LAST_CLOSE_VS_OPEN", Math.round(closeVsOpen * 100) / 100 + "%");

    // Refresh the rolling stats panel
    updateScorecardStats(sheet);

    Logger.log("Scorecard row logged: " + dateStr + " result=" + result);
  } catch (e) {
    Logger.log("logToScorecard ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ROLLING STATS — written to a fixed panel at the top
// (rows 3–12 of column M–N, to the right of the data)
// Recalculated every time a new row is added.
// ─────────────────────────────────────────────────────────────
function updateScorecardStats(sheet) {
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 4) return; // need at least 1 data row (row 4+)

    var dataStartRow = 4; // row 1=banner, 2=subheader, 3=headers, 4+=data
    var dataRows     = lastRow - dataStartRow + 1;
    if (dataRows < 1) return;

    // Read all result and confidence data
    var results     = sheet.getRange(dataStartRow, SC.RESULT,         dataRows, 1).getValues();
    var confs       = sheet.getRange(dataStartRow, SC.CONFIDENCE,     dataRows, 1).getValues();
    var signals     = sheet.getRange(dataStartRow, SC.SIGNAL,         dataRows, 1).getValues();
    var patterns    = sheet.getRange(dataStartRow, SC.PATTERN_PLAYED, dataRows, 1).getValues();
    var aiCalls     = sheet.getRange(dataStartRow, SC.AI_CALLS,       dataRows, 1).getValues();

    var wins = 0, losses = 0, misses = 0, noTrades = 0;
    var totalConf = 0, confCount = 0;
    var signalDays = 0, patternDays = 0;
    var totalAI = 0;

    // Rolling window: last 20 trading days
    var windowSize  = Math.min(20, dataRows);
    var windowStart = dataRows - windowSize;

    var windowWins = 0, windowLosses = 0, windowMisses = 0;

    for (var i = 0; i < dataRows; i++) {
      var res = String(results[i][0]);
      var conf = parseInt(confs[i][0]) || 0;
      var sig  = String(signals[i][0]);
      var pat  = String(patterns[i][0]);
      var ai   = parseInt(aiCalls[i][0]) || 0;

      if (res.indexOf("WIN")      !== -1) wins++;
      if (res.indexOf("LOSS")     !== -1) losses++;
      if (res.indexOf("MISS")     !== -1) misses++;
      if (res.indexOf("NO TRADE") !== -1) noTrades++;

      if (conf > 0) { totalConf += conf; confCount++; }
      if (sig === "YES") signalDays++;
      if (pat === "YES") patternDays++;
      totalAI += ai;

      // Rolling 20-day window
      if (i >= windowStart) {
        if (res.indexOf("WIN")  !== -1) windowWins++;
        if (res.indexOf("LOSS") !== -1) windowLosses++;
        if (res.indexOf("MISS") !== -1) windowMisses++;
      }
    }

    var totalTrades  = wins + losses;
    var winRate      = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
    var avgConf      = confCount > 0 ? Math.round(totalConf / confCount) : 0;
    var patternRate  = dataRows > 0 ? Math.round((patternDays / dataRows) * 100) : 0;
    var avgAI        = dataRows > 0 ? Math.round(totalAI / dataRows) : 0;

    var windowTrades  = windowWins + windowLosses;
    var windowWinRate = windowTrades > 0 ? Math.round((windowWins / windowTrades) * 100) : 0;

    // Write stats to the right of headers, starting at row 3, col 13 (M)
    var statsCol = SC_HEADERS.length + 2; // one blank col gap
    var statsRow = 3;

    var stats = [
      ["📊 SCORECARD STATS",     ""],
      ["─────────────────",      ""],
      ["Total days tracked:",    dataRows],
      ["",                       ""],
      ["ALL TIME",               ""],
      ["Signals issued:",        signalDays + " days"],
      ["Pattern appeared:",      patternDays + " days (" + patternRate + "%)"],
      ["Wins (signal + pattern):", wins],
      ["Losses (bad signal):",   losses],
      ["Misses (no signal):",    misses],
      ["Win rate (signals):",    winRate + "%"],
      ["Avg confidence:",        avgConf + "%"],
      ["",                       ""],
      ["LAST " + windowSize + " DAYS", ""],
      ["Wins:",                  windowWins],
      ["Losses:",                windowLosses],
      ["Misses:",                windowMisses],
      ["Win rate:",              windowWinRate + "%"],
      ["",                       ""],
      ["AVG AI CALLS/DAY:",      avgAI + " / 8 budget"]
    ];

    sheet.getRange(statsRow, statsCol, stats.length, 2).setValues(stats);

    // Style the stats panel
    var statsRange = sheet.getRange(statsRow, statsCol, stats.length, 2);
    statsRange
      .setBackground("#0d0d2b")
      .setFontColor("#9090cc")
      .setFontFamily("Courier New")
      .setFontSize(9);

    // Header
    sheet.getRange(statsRow, statsCol, 1, 2)
      .setFontColor("#ffd600").setFontWeight("bold").setFontSize(10);

    // Win rate — color by performance
    var winRateRow  = statsRow + 10;
    var winRateCell = sheet.getRange(winRateRow, statsCol + 1);
    winRateCell.setFontColor(
      winRate >= 70 ? "#00ff99" :
      winRate >= 50 ? "#ffd600" : "#ff6b6b"
    ).setFontWeight("bold");

    // Rolling win rate
    var rollingWinRateRow = statsRow + 17;
    var rollingCell = sheet.getRange(rollingWinRateRow, statsCol + 1);
    rollingCell.setFontColor(
      windowWinRate >= 70 ? "#00ff99" :
      windowWinRate >= 50 ? "#ffd600" : "#ff6b6b"
    ).setFontWeight("bold");

    // ── Cache rolling stats for AI prompt context ─────────────
    // buildSessionContext() in AIAnalyst.gs reads these flags to
    // include win rate in every AI memo and forecast prompt.
    cacheSessionContextFlags(winRate, windowWinRate, patternRate, dataRows);

    Logger.log("Scorecard stats updated: " + wins + "W/" + losses + "L, winRate=" + winRate + "%");
  } catch (e) {
    Logger.log("updateScorecardStats ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FORMAT A SCORECARD DATA ROW
// ─────────────────────────────────────────────────────────────
function applyScorecardRowFormat(sheet, rowNum, result, confidence) {
  try {
    sheet.setRowHeight(rowNum, 22);

    sheet.getRange(rowNum, 1, 1, SC_HEADERS.length)
      .setBackground("#0d0d2b")
      .setFontColor("#c0c0e0")
      .setFontFamily("Courier New")
      .setFontSize(9)
      .setVerticalAlignment("middle");

    // DATE
    sheet.getRange(rowNum, SC.DATE)
      .setFontColor("#9090cc").setHorizontalAlignment("center");

    // CONFIDENCE
    var confColor = confidence >= 75 ? "#00ff99"
                  : confidence >= 50 ? "#ffd600"
                  : confidence >= 30 ? "#ff9944" : "#ff6b6b";
    sheet.getRange(rowNum, SC.CONFIDENCE)
      .setFontColor(confColor).setFontWeight("bold")
      .setHorizontalAlignment("center");

    // SIGNAL
    var sigVal = sheet.getRange(rowNum, SC.SIGNAL).getValue();
    sheet.getRange(rowNum, SC.SIGNAL)
      .setFontColor(sigVal === "YES" ? "#00ff99" : "#555577")
      .setHorizontalAlignment("center");

    // SIGNAL PRICE
    var spVal = sheet.getRange(rowNum, SC.SIGNAL_PRICE).getValue();
    if (spVal !== "—") {
      sheet.getRange(rowNum, SC.SIGNAL_PRICE)
        .setNumberFormat("$#,##0.00").setFontColor("#ffd600")
        .setHorizontalAlignment("center");
    }

    // PATTERN PLAYED
    var patVal = sheet.getRange(rowNum, SC.PATTERN_PLAYED).getValue();
    sheet.getRange(rowNum, SC.PATTERN_PLAYED)
      .setFontColor(patVal === "YES" ? "#00ff99" : "#555577")
      .setHorizontalAlignment("center");

    // GRADE
    sheet.getRange(rowNum, SC.GRADE)
      .setFontColor("#aaaacc").setHorizontalAlignment("left");

    // MAX FLUSH %
    sheet.getRange(rowNum, SC.MAX_FLUSH)
      .setFontColor("#ff9944").setHorizontalAlignment("center")
      .setNumberFormat("0.00\"%\"");

    // CLOSE vs OPEN
    var cvo = parseFloat(sheet.getRange(rowNum, SC.CLOSE_VS_OPEN).getValue()) || 0;
    sheet.getRange(rowNum, SC.CLOSE_VS_OPEN)
      .setFontColor(cvo >= 0 ? "#00ff99" : "#ff6b6b")
      .setHorizontalAlignment("center")
      .setNumberFormat("0.00\"%\"");

    // OH TAGGED
    var ohVal = sheet.getRange(rowNum, SC.OH_TAGGED).getValue();
    sheet.getRange(rowNum, SC.OH_TAGGED)
      .setFontColor(ohVal === "YES" ? "#ffd600" : "#555577")
      .setHorizontalAlignment("center");

    // AI CALLS
    sheet.getRange(rowNum, SC.AI_CALLS)
      .setFontColor("#8888bb").setHorizontalAlignment("center");

    // RESULT — biggest visual
    var resultCell = sheet.getRange(rowNum, SC.RESULT);
    resultCell.setHorizontalAlignment("center").setFontWeight("bold").setFontSize(10);
    if      (result.indexOf("WIN")      !== -1) resultCell.setFontColor("#00ff99").setBackground("#001a00");
    else if (result.indexOf("LOSS")     !== -1) resultCell.setFontColor("#ff6b6b").setBackground("#1a0000");
    else if (result.indexOf("MISS")     !== -1) resultCell.setFontColor("#ffd600").setBackground("#1a1400");
    else                                         resultCell.setFontColor("#9090cc");

  } catch (e) {
    Logger.log("applyScorecardRowFormat ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SHEET SETUP
// ─────────────────────────────────────────────────────────────
function setupScorecardSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_SCORECARD);
  if (!sheet) sheet = ss.insertSheet(SHEET_SCORECARD);

  sheet.setTabColor("#ffd600");

  if (sheet.getLastRow() > 0) {
    Logger.log("Scorecard sheet already exists.");
    return sheet;
  }

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.appendRow(["📊  B E A R   T R A P   W I N / L O S S   S C O R E C A R D"]);
  sheet.getRange(1, 1, 1, SC_HEADERS.length).merge()
    .setBackground("#1a1400")
    .setFontColor("#ffd600")
    .setFontWeight("bold").setFontSize(13)
    .setFontFamily("Courier New")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  // ── Row 2: Sub-header ─────────────────────────────────────
  sheet.appendRow(["Results logged automatically at 3:00 CST each trading day. WIN = signal issued + pattern played. LOSS = signal issued, pattern failed. MISS = pattern played, no signal."]);
  sheet.getRange(2, 1, 1, SC_HEADERS.length).merge()
    .setBackground("#0d0d0d")
    .setFontColor("#888866")
    .setFontSize(8).setFontFamily("Courier New")
    .setHorizontalAlignment("left").setVerticalAlignment("middle")
    .setFontStyle("italic");
  sheet.setRowHeight(2, 20);

  // ── Row 3: Column headers ─────────────────────────────────
  sheet.appendRow(SC_HEADERS);
  sheet.getRange(3, 1, 1, SC_HEADERS.length)
    .setBackground("#1a1400")
    .setFontColor("#ffd600")
    .setFontWeight("bold").setFontSize(10)
    .setFontFamily("Courier New")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(3, 28);

  sheet.setFrozenRows(3);

  // ── Column widths ─────────────────────────────────────────
  var widths = [85, 90, 75, 105, 130, 220, 100, 110, 90, 80, 110];
  widths.forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });

  // Stats panel col widths
  sheet.setColumnWidth(SC_HEADERS.length + 2, 180);
  sheet.setColumnWidth(SC_HEADERS.length + 3, 100);

  // ── Header notes ──────────────────────────────────────────
  sheet.getRange(3, SC.RESULT).setNote(
    "✅ RESULT KEY\n─────────────────────\n" +
    "✅ WIN      — Signal issued AND pattern played out\n" +
    "❌ LOSS     — Signal issued, but flush continued / no rip\n" +
    "😔 MISS     — Pattern played but no signal was issued\n" +
    "➡️ NO TRADE — Neither signal nor clear pattern today\n\n" +
    "Only WIN and LOSS count toward win rate.\n" +
    "MISS days show pattern accuracy independently."
  );

  sheet.getRange(3, SC.CONFIDENCE).setNote(
    "🎯 PEAK CONFIDENCE\n─────────────────────\n" +
    "The highest confidence score reached during the 8:30–9:15 CST window.\n\n" +
    "≥75% = Strong Bear Trap signal (BUY CALLS issued)\n" +
    "50–74% = Pattern forming (watch only)\n" +
    "<50% = No clear pattern detected"
  );

  sheet.getRange(3, SC.CLOSE_VS_OPEN).setNote(
    "📈 CLOSE vs OPEN\n─────────────────────\n" +
    "SPY % change from day open to market close (3:00 CST).\n\n" +
    "Green = SPY closed higher than open (Bear Trap played)\n" +
    "Red = SPY closed lower than open (real selling day)\n\n" +
    "Cross-reference with PATTERN PLAYED to see if the rip\n" +
    "actually happened even when the signal was missed."
  );

  Logger.log("Scorecard sheet setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRY — called from SPY TRACKER menu
// ─────────────────────────────────────────────────────────────
function setupScorecardSheetFromMenu() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = setupScorecardSheet(ss);
  SpreadsheetApp.getUi().alert(
    "📊 SCORECARD\n\n" +
    "✅ Sheet created!\n\n" +
    "A new row is added automatically every trading day at ~3:00 CST.\n" +
    "Win/loss stats update in real time in the panel to the right.\n\n" +
    "Results key:\n" +
    "  ✅ WIN      — Signal issued + pattern played\n" +
    "  ❌ LOSS     — Signal issued, no follow-through\n" +
    "  😔 MISS     — Pattern played, no signal\n" +
    "  ➡️ NO TRADE — Quiet day, no pattern"
  );
}
