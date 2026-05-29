// ============================================================
// FILE: ForecastSheet.gs
// PURPOSE: 📡 FORECAST — AI 30-minute SPY price forecasting.
// ============================================================

var SHEET_FORECAST = "📡 FORECAST";

// ─────────────────────────────────────────────────────────────
// LAYOUT CONSTANTS
// ─────────────────────────────────────────────────────────────
var FC = {
  BANNER_ROW:       1,
  SUBTITLE_ROW:     2,
  META_ROW:         3,
  GAP_ROW:          4,
  HEADER_ROW:       5,
  DATA_START_ROW:   6,   // rows 6–19 = 14 forecast slots
  DATA_END_ROW:     19,  // row 19 = last data row (3:00 PM)
  GAP2_ROW:         20,  // gap AFTER data, before chart
  CHART_ANCHOR_ROW: 22,  // chart placed here — clear of data

  COL_TIME:         1,
  COL_PRED:         2,
  COL_CONF:         3,
  COL_MEMO:         4,
  COL_ACTUAL:       5,
  COL_DIFF:         6,

  TOTAL_COLS:       6,

  MARKET_OPEN_MIN:  510,   // 8:30 CST
  MARKET_CLOSE_MIN: 900,   // 3:00 CST
  EARLY_AM_MIN:     480,   // 8:00 CST

  MARKET_INTERVAL_MIN:    30,
  OVERNIGHT_INTERVAL_MIN: 240,
  COOLDOWN_MIN:           120,

  SLOT_COUNT: 14   // 8:30, 9:00, 9:30, 10:00, 10:30, 11:00, 11:30,
                   // 12:00, 12:30, 1:00, 1:30, 2:00, 2:30, 3:00 = 14
};

// Market session slots — CST minutes from midnight
var FORECAST_SLOTS = (function() {
  var slots = [];
  for (var m = FC.MARKET_OPEN_MIN; m <= FC.MARKET_CLOSE_MIN; m += 30) {
    slots.push(m);
  }
  return slots; // [510, 540, 570, 600, 630, 660, 690, 720, 750, 780, 810, 840, 870, 900]
})();

// ─────────────────────────────────────────────────────────────
// COLORS
// ─────────────────────────────────────────────────────────────
var FC_COLOR = {
  BG_SHEET:    "#0e0e1a",
  BG_BANNER:   "#070712",
  BG_HEADER:   "#0d0d2b",
  BG_ROW:      "#0a0a14",
  BG_ROW_ALT:  "#0d0d1a",
  BG_CURRENT:  "#001a30",
  BG_PAST:     "#080810",
  TXT_BANNER:  "#00e5ff",
  TXT_HEADER:  "#00e5ff",
  TXT_TIME:    "#7070aa",
  TXT_PRED:    "#4fc3f7",
  TXT_ACTUAL:  "#69f0ae",
  TXT_CONF_HI: "#69f0ae",
  TXT_CONF_MID:"#ffd740",
  TXT_CONF_LOW:"#ff8a65",
  TXT_MEMO:    "#9090aa",
  TXT_DIM:     "#3d3d6b",
  TXT_META:    "#5a5a8a"
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function fcMinsToLabel(totalMins) {
  var h    = Math.floor(totalMins / 60);
  var m    = totalMins % 60;
  var ampm = h >= 12 ? "PM" : "AM";
  var h12  = h % 12;
  if (h12 === 0) h12 = 12;
  var mStr = m < 10 ? "0" + m : "" + m;
  return h12 + ":" + mStr + " " + ampm;
}

function fcGetCSTMins(utcDate) {
  var h = parseInt(Utilities.formatDate(utcDate, "America/Chicago", "H"),  10);
  var m = parseInt(Utilities.formatDate(utcDate, "America/Chicago", "mm"), 10);
  return h * 60 + m;
}

// ─────────────────────────────────────────────────────────────
// SHOULD FORECAST FIRE?
// ─────────────────────────────────────────────────────────────
function shouldFireForecast(now) {
  try {
    var cstMins   = fcGetCSTMins(now);
    var dow       = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    var isWeekend = (dow === 0 || dow === 6);

    var lastRunStr = getFlag("FC_LAST_RUN_MINS");
    var lastRun    = (lastRunStr && lastRunStr !== "") ? parseInt(lastRunStr) : -9999;
    if (isNaN(lastRun)) lastRun = -9999;

    var elapsed = (lastRun < 0)
      ? 9999
      : (cstMins >= lastRun ? cstMins - lastRun : (1440 - lastRun) + cstMins);

    if (isWeekend) {
      return elapsed >= FC.OVERNIGHT_INTERVAL_MIN;
    }

    if (cstMins >= FC.EARLY_AM_MIN && cstMins < FC.MARKET_OPEN_MIN) {
      var earlyFired = getFlag("FC_EARLY_AM_FIRED_TODAY");
      var todayStr   = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
      if (earlyFired !== todayStr && elapsed >= FC.COOLDOWN_MIN) {
        return true;
      }
      return false;
    }

    if (cstMins >= FC.MARKET_OPEN_MIN && cstMins < FC.MARKET_CLOSE_MIN) {
      return elapsed >= FC.MARKET_INTERVAL_MIN;
    }

    if (cstMins < FC.EARLY_AM_MIN || cstMins >= FC.MARKET_CLOSE_MIN) {
      return elapsed >= FC.OVERNIGHT_INTERVAL_MIN;
    }

    return false;
  } catch (e) {
    Logger.log("shouldFireForecast ERROR: " + e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY
// ─────────────────────────────────────────────────────────────
function runForecastTick(data, now) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_FORECAST);
    if (!sheet) {
      setupForecastSheet(ss);
      sheet = ss.getSheetByName(SHEET_FORECAST);
    }

    fillActualPrices(sheet, data, now);

    if (shouldFireForecast(now)) {
      generateForecast(sheet, data, now);
    }

  } catch (e) {
    Logger.log("runForecastTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// GENERATE FORECAST
// ─────────────────────────────────────────────────────────────
function generateForecast(sheet, data, now) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      Logger.log("FC: No GEMINI_API_KEY — skipping forecast.");
      return;
    }

    Logger.log("FC: Generating new forecast...");

    var cstMins  = fcGetCSTMins(now);
    var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
    var timeStr  = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();

    var vixData     = fetchVIX();
    var esData      = fetchESFutures();
    var mbSetup     = getFlag("MB_SETUP_TYPE")              || "unknown";
    var mbFlush     = parseFloat(getFlag("MB_FLUSH_TARGET") || "0") || 0;
    var mbFlip      = parseFloat(getFlag("MB_FLIP_ZONE")    || "0") || 0;
    var mbRip       = parseFloat(getFlag("MB_RIP_TARGET")   || "0") || 0;
    var mbEod       = parseFloat(getFlag("MB_EOD_TARGET")   || "0") || 0;
    var mbRationale = getFlag("MB_RATIONALE")               || "";
    var recentContext = buildRecentLogContext();

    var prompt = buildForecastPrompt(data, now, cstMins, vixData, esData,
                                     mbSetup, mbFlush, mbFlip, mbRip, mbEod,
                                     mbRationale, recentContext, timeStr);

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 2500,
        temperature: 0.3
      }
    });

    var resp = UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      payload:            payload,
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("FC Gemini error: " + resp.getResponseCode() + " — " +
                 resp.getContentText().substring(0, 200));
      return;
    }

    var json    = JSON.parse(resp.getContentText());
    var rawText = json.candidates
               && json.candidates[0]
               && json.candidates[0].content
               && json.candidates[0].content.parts
               && json.candidates[0].content.parts[0]
                ? json.candidates[0].content.parts[0].text.trim()
                : null;

    if (!rawText) {
      Logger.log("FC: Gemini returned empty content.");
      return;
    }

    var clean = rawText.replace(/```json|```/gi, "").trim();

    var parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      Logger.log("FC: JSON parse error — " + parseErr.message + "\nRaw: " + clean.substring(0, 300));
      return;
    }

    if (!parsed || !parsed.slots || !Array.isArray(parsed.slots)) {
      Logger.log("FC: Unexpected JSON shape — missing slots array.");
      return;
    }

    writeForecastRows(sheet, parsed.slots, now, cstMins);

    var nextMins = cstMins + (
      (cstMins >= FC.MARKET_OPEN_MIN && cstMins < FC.MARKET_CLOSE_MIN)
        ? FC.MARKET_INTERVAL_MIN
        : FC.OVERNIGHT_INTERVAL_MIN
    );
    var nextLabel = fcMinsToLabel(nextMins % 1440);
    sheet.getRange(FC.META_ROW, 1, 1, FC.TOTAL_COLS).merge()
      .setValue("🕐  Last updated: " + timeStr + " CST  ·  Next update: ~" + nextLabel + " CST")
      .setFontColor(FC_COLOR.TXT_META).setFontSize(9)
      .setHorizontalAlignment("center").setBackground(FC_COLOR.BG_BANNER);

    setFlag("FC_LAST_RUN_MINS", cstMins.toString());

    var dow = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    var isWeekend = (dow === 0 || dow === 6);
    if (!isWeekend && cstMins >= FC.EARLY_AM_MIN && cstMins < FC.MARKET_OPEN_MIN) {
      setFlag("FC_EARLY_AM_FIRED_TODAY", todayStr);
    }

    buildForecastChart(sheet);
    Logger.log("FC: Forecast generated and chart rebuilt at " + timeStr);

  } catch (e) {
    Logger.log("generateForecast ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD FORECAST PROMPT
// All 14 slots explicitly listed in JSON template so Gemini
// cannot skip any. Slot count references updated to 14.
// ─────────────────────────────────────────────────────────────
function buildForecastPrompt(data, now, cstMins, vixData, esData,
                              mbSetup, mbFlush, mbFlip, mbRip, mbEod,
                              mbRationale, recentContext, timeStr) {

  var vixStr = vixData ? vixData.price.toFixed(1) + " [" + vixData.regime + "]" : "unknown";
  var esStr  = esData  ? "$" + esData.price.toFixed(2) + " " + esData.trend    : "unknown";

  var mbStr = "";
  if (mbFlush > 0 || mbFlip > 0 || mbRip > 0 || mbEod > 0) {
    mbStr = "Morning Brief setup: " + mbSetup + "\n" +
            "  Flush target: $" + (mbFlush > 0 ? mbFlush.toFixed(2) : "n/a") + "\n" +
            "  Flip zone:    $" + (mbFlip  > 0 ? mbFlip.toFixed(2)  : "n/a") + "\n" +
            "  Rip target:   $" + (mbRip   > 0 ? mbRip.toFixed(2)   : "n/a") + "\n" +
            "  EOD target:   $" + (mbEod   > 0 ? mbEod.toFixed(2)   : "n/a") + "\n" +
            "  Rationale:    " + mbRationale + "\n";
  }

  var slotLabels = FORECAST_SLOTS.map(function(m) { return fcMinsToLabel(m); }).join(", ");

  var prompt =
    "You are a quantitative SPY price analyst. Current time: " + timeStr + " CST.\n\n" +
    "=== CURRENT MARKET DATA ===\n" +
    "SPY price: $" + data.price.toFixed(2) + "\n" +
    "Prev close: $" + (data.prevClose || data.price).toFixed(2) + "\n" +
    "Day open: $"   + (data.dayOpen   || data.price).toFixed(2) + "\n" +
    "Day high: $"   + (data.dayHigh   || data.price).toFixed(2) + "\n" +
    "Day low: $"    + (data.dayLow    || data.price).toFixed(2) + "\n" +
    "VWAP: $"       + (data.vwap      || 0).toFixed(2) + "\n" +
    "VIX: " + vixStr + "\n" +
    "ES Futures: " + esStr + "\n\n" +
    (mbStr ? "=== MORNING BRIEF CONTEXT ===\n" + mbStr + "\n" : "") +
    (recentContext ? "=== RECENT PRICE ACTION (last 12 ticks) ===\n" + recentContext + "\n\n" : "") +
    "=== INSTRUCTIONS ===\n" +
    "Generate a full-day SPY price forecast for all 14 slots: " + slotLabels + ".\n" +
    "STRICT RULES — you MUST follow these exactly:\n" +
    "  1. Return ONLY raw JSON, no markdown, no backticks, no extra text.\n" +
    "  2. Every memo MUST be 8 words or less.\n" +
    "  3. ALL 14 slots required — do not skip any.\n" +
    "  4. Price to 2 decimal places, conf is integer 1-10.\n\n" +
    "Return this exact structure with ALL 14 slots:\n" +
    '{"slots":[' +
    '{"time":"8:30 AM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"9:00 AM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"9:30 AM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"10:00 AM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"10:30 AM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"11:00 AM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"11:30 AM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"12:00 PM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"12:30 PM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"1:00 PM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"1:30 PM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"2:00 PM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"2:30 PM","price":0.00,"conf":5,"memo":"8 words max"},' +
    '{"time":"3:00 PM","price":0.00,"conf":5,"memo":"8 words max"}' +
    ']}\n\n' +
    "All 14 slots required: " + slotLabels;

  return prompt;
}

// ─────────────────────────────────────────────────────────────
// BUILD RECENT LOG CONTEXT
// ─────────────────────────────────────────────────────────────
function buildRecentLogContext() {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName(SHEET_LOG);
    if (!log) return "";

    var lastRow = log.getLastRow();
    if (lastRow <= 2) return "";

    var startRow = Math.max(3, lastRow - 11);
    var numRows  = lastRow - startRow + 1;
    var data     = log.getRange(startRow, 1, numRows, 15).getValues();

    var lines = [];
    data.forEach(function(row) {
      var t     = row[1]  || "";
      var price = row[2]  || 0;
      var trend = row[14] || "";
      if (price > 0) {
        lines.push(t + " $" + parseFloat(price).toFixed(2) +
                   (trend ? " [" + trend.toString().replace(/[^\w\s\u2191\u2193]/g, "") + "]" : ""));
      }
    });

    return lines.join("\n");
  } catch (e) {
    Logger.log("buildRecentLogContext ERROR: " + e.message);
    return "";
  }
}

// ─────────────────────────────────────────────────────────────
// WRITE FORECAST ROWS
// ─────────────────────────────────────────────────────────────
function writeForecastRows(sheet, slots, now, cstMins) {
  try {
    var existingActuals = [];
    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var row  = FC.DATA_START_ROW + i;
      var cell = sheet.getRange(row, FC.COL_ACTUAL).getValue();
      existingActuals[i] = (cell && cell !== "" && !isNaN(parseFloat(cell)))
        ? parseFloat(cell) : null;
    }

    for (var s = 0; s < FC.SLOT_COUNT; s++) {
      var aiSlot   = slots[s] || {};
      var row      = FC.DATA_START_ROW + s;
      var slotMins = FORECAST_SLOTS[s];

      var timeLabel = fcMinsToLabel(slotMins);
      var pred      = parseFloat(aiSlot.price || 0) || 0;
      var conf      = parseInt(aiSlot.conf    || 5) || 5;
      var memo      = (aiSlot.memo || "").toString().substring(0, 80);
      var actual    = existingActuals[s];

      sheet.getRange(row, FC.COL_TIME).setValue(timeLabel);
      if (pred > 0) sheet.getRange(row, FC.COL_PRED).setValue(pred);
      sheet.getRange(row, FC.COL_CONF).setValue(conf);
      sheet.getRange(row, FC.COL_MEMO).setValue(memo);
      sheet.getRange(row, FC.COL_DIFF).setFormula(
        '=IF(E' + row + '="","—",E' + row + '-B' + row + ')'
      );

      applyForecastRowFormat(sheet, row, s, slotMins, cstMins, conf, pred, actual);
    }

    Logger.log("FC: Forecast rows written (" + FC.SLOT_COUNT + " slots).");
  } catch (e) {
    Logger.log("writeForecastRows ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FILL ACTUAL PRICES
// ─────────────────────────────────────────────────────────────
function fillActualPrices(sheet, data, now) {
  try {
    var cstMins = fcGetCSTMins(now);
    var dow     = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    if (dow === 0 || dow === 6) return;
    if (cstMins < FC.MARKET_OPEN_MIN) return;

    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var slotMins = FORECAST_SLOTS[i];
      var row      = FC.DATA_START_ROW + i;

      if (cstMins < slotMins - 2) continue;

      var cell = sheet.getRange(row, FC.COL_ACTUAL);
      var val  = cell.getValue();

      if ((val === "" || val === null) && data && data.price > 0) {
        cell.setValue(data.price)
          .setFontColor(FC_COLOR.TXT_ACTUAL)
          .setFontFamily(BT_FONT.MONO)
          .setFontWeight("bold")
          .setFontSize(10)
          .setNumberFormat("$#,##0.00")
          .setHorizontalAlignment("center");

        var rowBg = Math.abs(cstMins - slotMins) <= 15
          ? FC_COLOR.BG_CURRENT : FC_COLOR.BG_PAST;
        sheet.getRange(row, 1, 1, FC.TOTAL_COLS).setBackground(rowBg);
      }
    }
  } catch (e) {
    Logger.log("fillActualPrices ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// APPLY ROW FORMAT
// ─────────────────────────────────────────────────────────────
function applyForecastRowFormat(sheet, row, slotIdx, slotMins, cstMins, conf, pred, actual) {
  try {
    var isPast    = cstMins > slotMins + 15;
    var isCurrent = !isPast && Math.abs(cstMins - slotMins) <= 15;
    var rowBg     = isPast    ? FC_COLOR.BG_PAST
                  : isCurrent ? FC_COLOR.BG_CURRENT
                  : (slotIdx % 2 === 0 ? FC_COLOR.BG_ROW : FC_COLOR.BG_ROW_ALT);

    sheet.getRange(row, 1, 1, FC.TOTAL_COLS)
      .setBackground(rowBg).setFontFamily(BT_FONT.DATA)
      .setFontSize(9).setVerticalAlignment("middle");

    sheet.getRange(row, FC.COL_TIME)
      .setFontColor(isCurrent ? "#00e5ff" : FC_COLOR.TXT_TIME)
      .setFontWeight(isCurrent ? "bold" : "normal")
      .setHorizontalAlignment("center");

    if (pred > 0) {
      sheet.getRange(row, FC.COL_PRED)
        .setFontColor(FC_COLOR.TXT_PRED).setFontFamily(BT_FONT.MONO)
        .setFontWeight("bold").setFontSize(10)
        .setNumberFormat("$#,##0.00").setHorizontalAlignment("center");
    }

    var confColor = conf >= 8 ? FC_COLOR.TXT_CONF_HI
                  : conf >= 5 ? FC_COLOR.TXT_CONF_MID
                  : FC_COLOR.TXT_CONF_LOW;
    sheet.getRange(row, FC.COL_CONF)
      .setFontColor(confColor).setFontWeight("bold")
      .setFontSize(10).setHorizontalAlignment("center");

    sheet.getRange(row, FC.COL_MEMO)
      .setFontColor(FC_COLOR.TXT_MEMO).setFontSize(8)
      .setFontStyle("italic").setWrap(true).setHorizontalAlignment("left");

    if (actual && actual > 0) {
      sheet.getRange(row, FC.COL_ACTUAL)
        .setFontColor(FC_COLOR.TXT_ACTUAL).setFontFamily(BT_FONT.MONO)
        .setFontWeight("bold").setFontSize(10)
        .setNumberFormat("$#,##0.00").setHorizontalAlignment("center");
    }

    sheet.getRange(row, FC.COL_DIFF)
      .setFontSize(9).setFontFamily(BT_FONT.MONO)
      .setHorizontalAlignment("center")
      .setNumberFormat('[>0]"+$"#,##0.00;[<0]"-$"#,##0.00;"—"');

    sheet.setRowHeight(row, 26);
  } catch (e) {
    Logger.log("applyForecastRowFormat ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD / REFRESH FORECAST CHART
// ─────────────────────────────────────────────────────────────
function buildForecastChart(sheet) {
  try {
    var existing = sheet.getCharts();
    existing.forEach(function(c) { sheet.removeChart(c); });

    var timeRange   = sheet.getRange(FC.HEADER_ROW, FC.COL_TIME,
                                     FC.DATA_END_ROW - FC.HEADER_ROW + 1, 1);
    var predRange   = sheet.getRange(FC.HEADER_ROW, FC.COL_PRED,
                                     FC.DATA_END_ROW - FC.HEADER_ROW + 1, 1);
    var actualRange = sheet.getRange(FC.HEADER_ROW, FC.COL_ACTUAL,
                                     FC.DATA_END_ROW - FC.HEADER_ROW + 1, 1);

    var chart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(timeRange)
      .addRange(predRange)
      .addRange(actualRange)
      .setPosition(FC.CHART_ANCHOR_ROW, 1, 0, 0)
      .setOption("title", "SPY Intraday: Actual vs AI Forecast  ·  " +
                          Utilities.formatDate(new Date(), "America/Chicago", "M/d/yyyy"))
      .setOption("width",  900)
      .setOption("height", 320)
      .setOption("useFirstColumnAsDomain", true)
      .setOption("interpolateNulls", true)
      .setOption("series", {
        0: { color: "#ffd740", lineWidth: 2, lineDashStyle: [6, 3], labelInLegend: "🤖 AI Forecast" },
        1: { color: "#00e5ff", lineWidth: 3, labelInLegend: "📈 Actual SPY" }
      })
      .setOption("backgroundColor",   { fill: "#0d0d2b" })
      .setOption("titleTextStyle",     { color: "#00e5ff", fontSize: 12, bold: true })
      .setOption("hAxis", {
        textStyle: { color: "#7070aa", fontSize: 9 }, gridlines: { color: "#1a1a3e" },
        title: "Time (CST)", titleTextStyle: { color: "#5a5a8a" }
      })
      .setOption("vAxis", {
        textStyle: { color: "#7070aa", fontSize: 9 }, gridlines: { color: "#1a1a3e" },
        title: "SPY Price ($)", titleTextStyle: { color: "#5a5a8a" }, format: "$#,##0.00"
      })
      .setOption("legend", { position: "top", textStyle: { color: "#aaaacc", fontSize: 10 } })
      .setOption("chartArea", { backgroundColor: "#0a0a14", top: 40, left: 60, width: "82%", height: "72%" })
      .setOption("crosshair", { trigger: "both", color: "#3d3d6b" })
      .build();

    sheet.insertChart(chart);
    Logger.log("FC: Chart built/refreshed.");
  } catch (e) {
    Logger.log("buildForecastChart ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SETUP FORECAST SHEET
// ─────────────────────────────────────────────────────────────
function setupForecastSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_FORECAST);
  if (!sheet) sheet = ss.insertSheet(SHEET_FORECAST);
  sheet.setTabColor("#ab47bc");

  if (sheet.getLastRow() > 0) {
    Logger.log("FC: Forecast sheet already exists — skipping setup.");
    applyForecastColumnWidths(sheet);
    return sheet;
  }

  var neededCols = FC.TOTAL_COLS;
  var neededRows = FC.CHART_ANCHOR_ROW + 25;
  if (sheet.getMaxColumns() < neededCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  if (sheet.getMaxRows() < neededRows)    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());

  sheet.getRange(1, 1, neededRows, neededCols).setBackground(FC_COLOR.BG_SHEET);

  // Row 1: Banner
  sheet.getRange(FC.BANNER_ROW, 1, 1, neededCols).merge()
    .setValue("📡  S P Y   F O R E C A S T   ·   A I   3 0 - M I N   P R I C E   P A T H")
    .setBackground(FC_COLOR.BG_BANNER).setFontColor(FC_COLOR.TXT_BANNER)
    .setFontWeight("bold").setFontSize(14).setFontFamily(BT_FONT.BANNER)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(FC.BANNER_ROW, 40);

  // Row 2: Subtitle
  sheet.getRange(FC.SUBTITLE_ROW, 1, 1, neededCols).merge()
    .setValue("AI predicts SPY price at each 30-min session mark · Updates every 30 min during market hours · 4 hrs overnight/weekend · 8:00 AM CST pre-market preview")
    .setBackground(FC_COLOR.BG_BANNER).setFontColor(FC_COLOR.TXT_META)
    .setFontSize(8).setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(FC.SUBTITLE_ROW, 18);

  // Row 3: Meta
  sheet.getRange(FC.META_ROW, 1, 1, neededCols).merge()
    .setValue("🕐  Not yet generated — will fire at next scheduled update")
    .setBackground(FC_COLOR.BG_BANNER).setFontColor(FC_COLOR.TXT_META)
    .setFontSize(9).setHorizontalAlignment("center");
  sheet.setRowHeight(FC.META_ROW, 18);

  // Row 4: Gap
  sheet.getRange(FC.GAP_ROW, 1, 1, neededCols).setBackground("#0a0a12");
  sheet.setRowHeight(FC.GAP_ROW, 4);

  // Row 5: Headers
  var headers = ["⏱ TIME (CST)", "🤖 PREDICTED", "💡 CONF", "📝 AI MEMO", "💰 ACTUAL", "📊 DIFF"];
  sheet.getRange(FC.HEADER_ROW, 1, 1, neededCols).setValues([headers])
    .setBackground(FC_COLOR.BG_HEADER).setFontColor(FC_COLOR.TXT_HEADER)
    .setFontWeight("bold").setFontSize(9).setFontFamily(BT_FONT.HEADER)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(FC.HEADER_ROW, 26);

  // Rows 6–19: 14 data slots
  for (var i = 0; i < FC.SLOT_COUNT; i++) {
    var row      = FC.DATA_START_ROW + i;
    var slotMins = FORECAST_SLOTS[i];
    var label    = fcMinsToLabel(slotMins);
    var rowBg    = i % 2 === 0 ? FC_COLOR.BG_ROW : FC_COLOR.BG_ROW_ALT;

    sheet.getRange(row, 1, 1, neededCols).setBackground(rowBg);
    sheet.getRange(row, FC.COL_TIME).setValue(label)
      .setFontColor(FC_COLOR.TXT_TIME).setFontFamily(BT_FONT.DATA)
      .setFontSize(9).setHorizontalAlignment("center").setVerticalAlignment("middle");
    sheet.getRange(row, FC.COL_PRED).setValue("—")
      .setFontColor(FC_COLOR.TXT_DIM).setHorizontalAlignment("center");
    sheet.getRange(row, FC.COL_CONF).setValue("—")
      .setFontColor(FC_COLOR.TXT_DIM).setHorizontalAlignment("center");
    sheet.getRange(row, FC.COL_MEMO).setValue("Awaiting first forecast...")
      .setFontColor(FC_COLOR.TXT_DIM).setFontSize(8)
      .setFontStyle("italic").setWrap(true);
    sheet.getRange(row, FC.COL_ACTUAL).setValue("").setHorizontalAlignment("center");
    sheet.getRange(row, FC.COL_DIFF)
      .setFormula('=IF(E' + row + '="","—",E' + row + '-B' + row + ')')
      .setFontColor(FC_COLOR.TXT_DIM).setHorizontalAlignment("center");
    sheet.setRowHeight(row, 26);
  }

  // Row 20: Gap after data
  sheet.getRange(FC.GAP2_ROW, 1, 1, neededCols).setBackground("#0a0a12");
  sheet.setRowHeight(FC.GAP2_ROW, 6);

  // Header notes
  sheet.getRange(FC.HEADER_ROW, FC.COL_CONF).setNote(
    "💡 CONFIDENCE (1–10)\n─────────────────\n8–10 = High\n5–7  = Moderate\n1–4  = Low\n\nDrops for slots far in the future."
  );
  sheet.getRange(FC.HEADER_ROW, FC.COL_DIFF).setNote(
    "📊 DIFF\n─────────────────\nActual − Predicted.\nGreen = SPY beat forecast.\nRed = SPY missed.\nBlank until actual fills."
  );

  sheet.setFrozenRows(FC.HEADER_ROW);
  applyForecastColumnWidths(sheet);
  Logger.log("FC: Forecast sheet setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// COLUMN WIDTHS
// ─────────────────────────────────────────────────────────────
function applyForecastColumnWidths(sheet) {
  sheet.setColumnWidth(FC.COL_TIME,   90);
  sheet.setColumnWidth(FC.COL_PRED,   100);
  sheet.setColumnWidth(FC.COL_CONF,   70);
  sheet.setColumnWidth(FC.COL_MEMO,   420);
  sheet.setColumnWidth(FC.COL_ACTUAL, 100);
  sheet.setColumnWidth(FC.COL_DIFF,   90);
}

// ─────────────────────────────────────────────────────────────
// RESET DAILY FLAGS
// ─────────────────────────────────────────────────────────────
function resetDailyForecastFlags() {
  var keys = ["FC_LAST_RUN_MINS", "FC_EARLY_AM_FIRED_TODAY"];
  keys.forEach(function(k) { setFlag(k, ""); });
  Logger.log("FC: Daily forecast flags reset.");
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRIES
// ─────────────────────────────────────────────────────────────
function setupForecastSheetFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupForecastSheet(ss);
  SpreadsheetApp.getUi().alert(
    "📡 FORECAST SHEET\n\n" +
    "✅ Sheet created and ready!\n\n" +
    "HOW IT WORKS:\n" +
    "• Pre-market preview: ~8:00 AM CST (if not run in 2 hrs)\n" +
    "• Market hours: updates every 30 min (8:30 AM–3:00 PM)\n" +
    "• Overnight/weekend: every 4 hours\n" +
    "• Actual prices fill automatically every 5-min tick\n" +
    "• Chart rebuilds only on forecast updates (~14×/day)\n\n" +
    "CONTEXT USED:\n" +
    "• SPY LOG recent ticks\n" +
    "• VIX + ES futures\n" +
    "• Morning Brief targets (flush/flip/rip)\n" +
    "• Previous close\n\n" +
    "AI BUDGET: ~14 calls/market day · 2500 tokens each"
  );
}

function runManualForecast() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsExist(ss);

    var now  = getCurrentEasternTime();
    var data = fetchSPYData();
    if (!data) {
      SpreadsheetApp.getUi().alert("❌ Could not fetch SPY data.");
      return;
    }

    var sheet = ss.getSheetByName(SHEET_FORECAST);
    if (!sheet) {
      setupForecastSheet(ss);
      sheet = ss.getSheetByName(SHEET_FORECAST);
    }

    setFlag("FC_LAST_RUN_MINS", "");
    generateForecast(sheet, data, now);

    SpreadsheetApp.getUi().alert(
      "✅ Forecast generated!\n\nSPY: $" + data.price.toFixed(2) +
      "\n\nCheck the 📡 FORECAST sheet."
    );
  } catch (e) {
    Logger.log("runManualForecast ERROR: " + e.message);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message + "\n\nSee Apps Script logs.");
  }
}
