// ============================================================
// FILE: ForecastSheet.gs
// PURPOSE: 📡 FORECAST — AI 30-minute SPY price forecasting.
//
//  FEATURES:
//    1. Forecast Table  — 13 rows (8:30am–3:00pm CST, every 30min)
//                         Each row: time slot, predicted price,
//                         confidence (1–10), AI memo, actual price
//                         (filled in as the day progresses).
//    2. Intraday Chart  — Line chart: solid actual price line +
//                         ghost forecast line. X-axis always spans
//                         full session 8:30am–3:00pm CST.
//
//  UPDATE CADENCE:
//    • Market open (Mon–Fri 8:30am–3:00pm CST): every 30 minutes.
//    • ~8:00am CST (pre-market preview): fires if not run in 2hrs.
//    • Overnight / weekend / after-hours: every 4 hours,
//      but skipped if last run was under 2 hours ago.
//
//  ACTUAL PRICE FILL:
//    • Every 5-minute tick (runForecastTick) fills in the actual
//      price column for any slot whose time has passed.
//    • Chart rebuild happens only when the forecast updates.
//
//  AI BUDGET:
//    • 1 Gemini call per forecast update (compact JSON response).
//    • ~200 tokens in, ~400 tokens out per call.
//    • At 13 calls/market day = ~7,800 tokens — well under free tier.
//    • Off-hours: max 6 calls/day at 4hr intervals.
//
//  All times displayed in CST 12-hour format.
// ============================================================

var SHEET_FORECAST = "📡 FORECAST";

// ─────────────────────────────────────────────────────────────
// LAYOUT CONSTANTS
// ─────────────────────────────────────────────────────────────
var FC = {
  // Sheet structure rows
  BANNER_ROW:       1,
  SUBTITLE_ROW:     2,
  META_ROW:         3,   // "Last updated at X · next update at Y"
  GAP_ROW:          4,
  HEADER_ROW:       5,
  DATA_START_ROW:   6,   // rows 6–18 = 13 forecast slots
  DATA_END_ROW:     19,
  GAP2_ROW:         19,
  CHART_ANCHOR_ROW: 23,  // chart placed here

  // Columns
  COL_TIME:         1,   // 30-min slot label  e.g. "8:30 AM"
  COL_PRED:         2,   // AI predicted price
  COL_CONF:         3,   // confidence 1–10
  COL_MEMO:         4,   // AI rationale memo
  COL_ACTUAL:       5,   // actual price filled by tick
  COL_DIFF:         6,   // diff = actual - predicted (auto-formula)

  TOTAL_COLS:       6,

  // Timing (CST minutes)
  MARKET_OPEN_MIN:  510,   // 8:30 CST
  MARKET_CLOSE_MIN: 900,   // 3:00 CST
  EARLY_AM_MIN:     480,   // 8:00 CST — pre-market preview window

  // Cadence
  MARKET_INTERVAL_MIN:    30,   // forecast refresh during market hours
  OVERNIGHT_INTERVAL_MIN: 240,  // 4 hours off-hours
  COOLDOWN_MIN:           120,  // skip if run within 2 hours

  // Slot count
  SLOT_COUNT: 14   // 8:30, 9:00, 9:30 … 3:00 = 13 half-hour slots
};

// Market session slots — CST minutes from midnight
var FORECAST_SLOTS = (function() {
  var slots = [];
  for (var m = FC.MARKET_OPEN_MIN; m <= FC.MARKET_CLOSE_MIN; m += 30) {
    slots.push(m);
  }
  return slots; // [510, 540, 570, ... 900]
})();

// ─────────────────────────────────────────────────────────────
// COLORS — inherits the sci-fi dark theme used across sheets
// ─────────────────────────────────────────────────────────────
var FC_COLOR = {
  BG_SHEET:    "#0e0e1a",
  BG_BANNER:   "#070712",
  BG_HEADER:   "#0d0d2b",
  BG_ROW:      "#0a0a14",
  BG_ROW_ALT:  "#0d0d1a",
  BG_FUTURE:   "#0a0a14",   // not yet reached
  BG_CURRENT:  "#001a30",   // current active slot
  BG_PAST:     "#080810",   // slot has passed
  TXT_BANNER:  "#00e5ff",
  TXT_HEADER:  "#00e5ff",
  TXT_TIME:    "#7070aa",
  TXT_PRED:    "#4fc3f7",   // cyan — predicted price
  TXT_ACTUAL:  "#69f0ae",   // green — actual price
  TXT_CONF_HI: "#69f0ae",   // conf 8–10
  TXT_CONF_MID:"#ffd740",   // conf 5–7
  TXT_CONF_LOW:"#ff8a65",   // conf 1–4
  TXT_MEMO:    "#9090aa",
  TXT_DIFF_POS:"#69f0ae",
  TXT_DIFF_NEG:"#ff5252",
  TXT_DIM:     "#3d3d6b",
  TXT_META:    "#5a5a8a"
};

// ─────────────────────────────────────────────────────────────
// HELPERS — time conversions
// ─────────────────────────────────────────────────────────────

// Convert CST minutes-from-midnight to "h:mm AM/PM" display string
function fcMinsToLabel(totalMins) {
  var h    = Math.floor(totalMins / 60);
  var m    = totalMins % 60;
  var ampm = h >= 12 ? "PM" : "AM";
  var h12  = h % 12;
  if (h12 === 0) h12 = 12;
  var mStr = m < 10 ? "0" + m : "" + m;
  return h12 + ":" + mStr + " " + ampm;
}

// Get current CST minutes-from-midnight from a raw UTC Date
function fcGetCSTMins(utcDate) {
  var h = parseInt(Utilities.formatDate(utcDate, "America/Chicago", "H"),  10);
  var m = parseInt(Utilities.formatDate(utcDate, "America/Chicago", "mm"), 10);
  return h * 60 + m;
}

// ─────────────────────────────────────────────────────────────
// SHOULD FORECAST FIRE?
// Returns true if it's time to run a new forecast generation.
// ─────────────────────────────────────────────────────────────
function shouldFireForecast(now) {
  try {
    var cstMins = fcGetCSTMins(now);
    var dow     = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    var isWeekend = (dow === 0 || dow === 6);

    // Read when we last ran a forecast (stored as CST total minutes)
    var lastRunStr = getFlag("FC_LAST_RUN_MINS");
    var lastRun    = (lastRunStr && lastRunStr !== "") ? parseInt(lastRunStr) : -9999;
    if (isNaN(lastRun)) lastRun = -9999;

    // Elapsed since last run — handle midnight rollover
    var elapsed = (lastRun < 0)
      ? 9999
      : (cstMins >= lastRun ? cstMins - lastRun : (1440 - lastRun) + cstMins);

    // ── Weekend / holiday off-hours: every 4 hours, 2hr cooldown ──
    if (isWeekend) {
      return elapsed >= FC.OVERNIGHT_INTERVAL_MIN;
    }

    // ── 8:00 AM CST pre-market preview — fire if not run in 2 hrs ─
    if (cstMins >= FC.EARLY_AM_MIN && cstMins < FC.MARKET_OPEN_MIN) {
      var earlyFired = getFlag("FC_EARLY_AM_FIRED_TODAY");
      var todayStr   = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
      if (earlyFired !== todayStr && elapsed >= FC.COOLDOWN_MIN) {
        return true;
      }
      return false;
    }

    // ── Market open: every 30 minutes ─────────────────────────
    if (cstMins >= FC.MARKET_OPEN_MIN && cstMins < FC.MARKET_CLOSE_MIN) {
      return elapsed >= FC.MARKET_INTERVAL_MIN;
    }

    // ── After-hours / pre-market (not the 8am window): 4hr ───
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
// MAIN ENTRY — called from runEvery5Minutes() in Code.gs
// Does two things every tick:
//   1. Fill in actual prices for elapsed slots (always, cheap)
//   2. Fire a new AI forecast if cadence says it's time (occasional)
// ─────────────────────────────────────────────────────────────
function runForecastTick(data, now) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_FORECAST);
    if (!sheet) {
      setupForecastSheet(ss);
      sheet = ss.getSheetByName(SHEET_FORECAST);
    }

    // ── Always: fill actual prices for past slots ─────────────
    fillActualPrices(sheet, data, now);

    // ── Maybe: fire a new AI forecast ─────────────────────────
    if (shouldFireForecast(now)) {
      generateForecast(sheet, data, now);
    }

  } catch (e) {
    Logger.log("runForecastTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// GENERATE FORECAST — the AI call + table write + chart rebuild
// ─────────────────────────────────────────────────────────────
function generateForecast(sheet, data, now) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      Logger.log("FC: No GEMINI_API_KEY — skipping forecast.");
      return;
    }

    Logger.log("FC: Generating new forecast...");

    var cstMins = fcGetCSTMins(now);
    var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
    var timeStr  = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();

    // ── Gather context ────────────────────────────────────────
    var vixData = fetchVIX();
    var esData  = fetchESFutures();

    // Morning Brief targets (from flags set by MorningBrief.gs)
    var mbSetup     = getFlag("MB_SETUP_TYPE")    || "unknown";
    var mbFlush     = parseFloat(getFlag("MB_FLUSH_TARGET") || "0") || 0;
    var mbFlip      = parseFloat(getFlag("MB_FLIP_ZONE")    || "0") || 0;
    var mbRip       = parseFloat(getFlag("MB_RIP_TARGET")   || "0") || 0;
    var mbEod       = parseFloat(getFlag("MB_EOD_TARGET")   || "0") || 0;
    var mbRationale = getFlag("MB_RATIONALE")     || "";

    // Recent SPY LOG data — last 12 rows (up to 1 hour of 5min ticks)
    var recentContext = buildRecentLogContext();

    // Build the prompt
    var prompt = buildForecastPrompt(data, now, cstMins, vixData, esData,
                                     mbSetup, mbFlush, mbFlip, mbRip, mbEod,
                                     mbRationale, recentContext, timeStr);

    // ── Call Gemini ───────────────────────────────────────────
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

    // Strip markdown fences if present
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

    // ── Write forecast to sheet ───────────────────────────────
    writeForecastRows(sheet, parsed.slots, now, cstMins);

    // ── Update meta row ───────────────────────────────────────
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

    // ── Update cadence flags ──────────────────────────────────
    setFlag("FC_LAST_RUN_MINS", cstMins.toString());

    var dow = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    var isWeekend = (dow === 0 || dow === 6);
    if (!isWeekend && cstMins >= FC.EARLY_AM_MIN && cstMins < FC.MARKET_OPEN_MIN) {
      setFlag("FC_EARLY_AM_FIRED_TODAY", todayStr);
    }

    // ── Rebuild chart (only on forecast update) ───────────────
    buildForecastChart(sheet);

    Logger.log("FC: Forecast generated and chart rebuilt at " + timeStr);

  } catch (e) {
    Logger.log("generateForecast ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD FORECAST PROMPT
// Returns a compact prompt asking Gemini to return JSON with
// 13 30-min price slots. Kept tight to minimize token spend.
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

  // Build the slot list so Gemini knows which times to cover
  var slotLabels = FORECAST_SLOTS.map(function(m) { return fcMinsToLabel(m); }).join(", ");

  var prompt =
    "You are a quantitative SPY price analyst. Current time: " + timeStr + " CST.\n\n" +
    "=== CURRENT MARKET DATA ===\n" +
    "SPY price: $" + data.price.toFixed(2) + "\n" +
    "Prev close: $" + (data.prevClose || data.price).toFixed(2) + "\n" +
    "Day open: $"   + (data.dayOpen  || data.price).toFixed(2)  + "\n" +
    "Day high: $"   + (data.dayHigh  || data.price).toFixed(2)  + "\n" +
    "Day low: $"    + (data.dayLow   || data.price).toFixed(2)  + "\n" +
    "VWAP: $"       + (data.vwap     || 0).toFixed(2) + "\n" +
    "VIX: " + vixStr + "\n" +
    "ES Futures: " + esStr + "\n\n" +
    (mbStr ? "=== MORNING BRIEF CONTEXT ===\n" + mbStr + "\n" : "") +
    (recentContext ? "=== RECENT PRICE ACTION (last 12 ticks) ===\n" + recentContext + "\n\n" : "") +
"=== INSTRUCTIONS ===\n" +
"Generate a full-day SPY price forecast for all 13 slots: " + slotLabels + ".\n" +
"STRICT RULES — you MUST follow these exactly:\n" +
"  1. Return ONLY raw JSON, no markdown, no backticks, no extra text.\n" +
"  2. Every memo MUST be 8 words or less. Examples: 'gap holds', 'profit taking', 'VWAP test', 'fades lower'.\n" +
"  3. All 13 slots required, no exceptions.\n" +
"  4. Price to 2 decimal places, conf is integer 1-10.\n\n" +
"Return this exact structure:\n" +
'{"slots":[{"time":"8:30 AM","price":0.00,"conf":5,"memo":"8 words"},{"time":"9:00 AM","price":0.00,"conf":5,"memo":"8 words"},{"time":"9:30 AM","price":0.00,"conf":5,"memo":"8 words"},{"time":"10:00 AM","price":0.00,"conf":5,"memo":"8 words"},{"time":"10:30 AM","price":0.00,"conf":5,"memo":"8 words"},{"time":"11:00 AM","price":0.00,"conf":5,"memo":"8 words"},{"time":"11:30 AM","price":0.00,"conf":5,"memo":"8 words"},{"time":"12:00 PM","price":0.00,"conf":5,"memo":"8 words"},{"time":"12:30 PM","price":0.00,"conf":5,"memo":"8 words"},{"time":"1:00 PM","price":0.00,"conf":5,"memo":"8 words"},{"time":"1:30 PM","price":0.00,"conf":5,"memo":"8 words"},{"time":"2:00 PM","price":0.00,"conf":5,"memo":"8 words"},{"time":"3:00 PM","price":0.00,"conf":5,"memo":"8 words"}]}' +
"\n\nAll 13 slots required: " + slotLabels;

  return prompt;
}

// ─────────────────────────────────────────────────────────────
// BUILD RECENT LOG CONTEXT
// Reads last 12 rows from SPY LOG and returns a compact string
// for the AI prompt. Minimal tokens — just time + price.
// ─────────────────────────────────────────────────────────────
function buildRecentLogContext() {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var log = ss.getSheetByName(SHEET_LOG);
    if (!log) return "";

    var lastRow = log.getLastRow();
    if (lastRow <= 2) return "";   // header rows only

    var startRow = Math.max(3, lastRow - 11);   // last 12 data rows
    var numRows  = lastRow - startRow + 1;

    // Columns: 2=TIME, 3=PRICE, 15=TREND
    var data = log.getRange(startRow, 1, numRows, 15).getValues();

    var lines = [];
    data.forEach(function(row) {
      var t     = row[1] || "";   // TIME
      var price = row[2] || 0;    // PRICE
      var trend = row[14] || "";  // TREND
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
// Writes the 13 AI-generated slots into the data table.
// Preserves any actual prices already filled in for past slots.
// ─────────────────────────────────────────────────────────────
function writeForecastRows(sheet, slots, now, cstMins) {
  try {
    // Build a map of time-label → slot index for fast lookup
    var slotMap = {};
    FORECAST_SLOTS.forEach(function(mins, idx) {
      slotMap[fcMinsToLabel(mins)] = idx;
    });

    // Read existing actuals so we don't overwrite them
    var existingActuals = [];
    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var row   = FC.DATA_START_ROW + i;
      var cell  = sheet.getRange(row, FC.COL_ACTUAL).getValue();
      existingActuals[i] = (cell && cell !== "" && !isNaN(parseFloat(cell)))
        ? parseFloat(cell) : null;
    }

    // Write each slot
    for (var s = 0; s < FC.SLOT_COUNT; s++) {
      var aiSlot = slots[s] || {};
      var row    = FC.DATA_START_ROW + s;
      var slotMins = FORECAST_SLOTS[s];

      var timeLabel = fcMinsToLabel(slotMins);
      var pred      = parseFloat(aiSlot.price || 0) || 0;
      var conf      = parseInt(aiSlot.conf || 5)    || 5;
      var memo      = (aiSlot.memo || "").toString().substring(0, 80);

      // Keep existing actual if already filled
      var actual = existingActuals[s];

      sheet.getRange(row, FC.COL_TIME).setValue(timeLabel);
      if (pred > 0) {
        sheet.getRange(row, FC.COL_PRED).setValue(pred);
      }
      sheet.getRange(row, FC.COL_CONF).setValue(conf);
      sheet.getRange(row, FC.COL_MEMO).setValue(memo);

      // Set DIFF formula (shows "—" when actual is empty)
      sheet.getRange(row, FC.COL_DIFF).setFormula(
        '=IF(E' + row + '="","—",E' + row + '-B' + row + ')'
      );

      // Apply row formatting
      applyForecastRowFormat(sheet, row, s, slotMins, cstMins, conf, pred, actual);
    }

    Logger.log("FC: Forecast rows written.");
  } catch (e) {
    Logger.log("writeForecastRows ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FILL ACTUAL PRICES
// Called every 5-min tick. Finds any slot whose time has passed
// and fills in the current SPY price if the cell is empty.
// ─────────────────────────────────────────────────────────────
function fillActualPrices(sheet, data, now) {
  try {
    var cstMins = fcGetCSTMins(now);

    // Only fill during or after market hours on a trading day
    var dow = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    if (dow === 0 || dow === 6) return;
    if (cstMins < FC.MARKET_OPEN_MIN) return;

    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var slotMins = FORECAST_SLOTS[i];
      var row      = FC.DATA_START_ROW + i;

      // Only fill slots whose time has passed or is current (within 5 min)
      if (cstMins < slotMins - 2) continue;

      var cell = sheet.getRange(row, FC.COL_ACTUAL);
      var val  = cell.getValue();

      // Only fill if empty and we have a price
      if ((val === "" || val === null) && data && data.price > 0) {
        cell.setValue(data.price)
          .setFontColor(FC_COLOR.TXT_ACTUAL)
          .setFontFamily(BT_FONT.MONO)
          .setFontWeight("bold")
          .setFontSize(10)
          .setNumberFormat("$#,##0.00")
          .setHorizontalAlignment("center");

        // Highlight current slot row
        if (Math.abs(cstMins - slotMins) <= 15) {
          sheet.getRange(row, 1, 1, FC.TOTAL_COLS)
            .setBackground(FC_COLOR.BG_CURRENT);
        } else {
          sheet.getRange(row, 1, 1, FC.TOTAL_COLS)
            .setBackground(FC_COLOR.BG_PAST);
        }
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
    // Base background based on slot state
    var isPast    = cstMins > slotMins + 15;
    var isCurrent = !isPast && Math.abs(cstMins - slotMins) <= 15;
    var rowBg = isPast    ? FC_COLOR.BG_PAST
              : isCurrent ? FC_COLOR.BG_CURRENT
              : (slotIdx % 2 === 0 ? FC_COLOR.BG_ROW : FC_COLOR.BG_ROW_ALT);

    sheet.getRange(row, 1, 1, FC.TOTAL_COLS)
      .setBackground(rowBg)
      .setFontFamily(BT_FONT.DATA)
      .setFontSize(9)
      .setVerticalAlignment("middle");

    // TIME
    sheet.getRange(row, FC.COL_TIME)
      .setFontColor(isCurrent ? "#00e5ff" : FC_COLOR.TXT_TIME)
      .setFontWeight(isCurrent ? "bold" : "normal")
      .setHorizontalAlignment("center");

    // PREDICTED PRICE
    if (pred > 0) {
      sheet.getRange(row, FC.COL_PRED)
        .setFontColor(FC_COLOR.TXT_PRED)
        .setFontFamily(BT_FONT.MONO)
        .setFontWeight("bold")
        .setFontSize(10)
        .setNumberFormat("$#,##0.00")
        .setHorizontalAlignment("center");
    }

    // CONFIDENCE
    var confColor = conf >= 8 ? FC_COLOR.TXT_CONF_HI
                  : conf >= 5 ? FC_COLOR.TXT_CONF_MID
                  : FC_COLOR.TXT_CONF_LOW;
    sheet.getRange(row, FC.COL_CONF)
      .setFontColor(confColor)
      .setFontWeight("bold")
      .setFontSize(10)
      .setHorizontalAlignment("center");

    // MEMO
    sheet.getRange(row, FC.COL_MEMO)
      .setFontColor(FC_COLOR.TXT_MEMO)
      .setFontSize(8)
      .setFontStyle("italic")
      .setWrap(true)
      .setHorizontalAlignment("left");

    // ACTUAL PRICE — only if filled
    if (actual && actual > 0) {
      sheet.getRange(row, FC.COL_ACTUAL)
        .setFontColor(FC_COLOR.TXT_ACTUAL)
        .setFontFamily(BT_FONT.MONO)
        .setFontWeight("bold")
        .setFontSize(10)
        .setNumberFormat("$#,##0.00")
        .setHorizontalAlignment("center");
    }

    // DIFF
    sheet.getRange(row, FC.COL_DIFF)
      .setFontSize(9)
      .setFontFamily(BT_FONT.MONO)
      .setHorizontalAlignment("center")
      .setNumberFormat("[>0]+$#,##0.00;[<0]-$#,##0.00;\"—\"");

    sheet.setRowHeight(row, 26);

  } catch (e) {
    Logger.log("applyForecastRowFormat ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD / REFRESH FORECAST CHART
// Two series: actual SPY (solid cyan) + forecast (dashed gold).
// X-axis labels = 13 time slot labels (8:30 AM … 3:00 PM).
// Called only when a new forecast is generated.
// ─────────────────────────────────────────────────────────────
function buildForecastChart(sheet) {
  try {
    // Remove any existing charts
    var existing = sheet.getCharts();
    existing.forEach(function(c) { sheet.removeChart(c); });

    var lastDataRow = FC.DATA_END_ROW;

    // We need columns: A (time labels), B (predicted), E (actual)
    // Build a 3-column helper range for the chart:
    //   col A = time labels (X axis)
    //   col B = predicted prices (series 1)
    //   col E = actual prices (series 2)
    // Google Sheets chart uses the first column as X-axis labels
    // when using setOption("useFirstColumnAsDomain", true).

    var timeRange  = sheet.getRange(FC.HEADER_ROW, FC.COL_TIME,
                                    FC.DATA_END_ROW - FC.HEADER_ROW + 1, 1);
    var predRange  = sheet.getRange(FC.HEADER_ROW, FC.COL_PRED,
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
        // Series 0 = Predicted (gold dashed — ghost line)
        0: {
          color:         "#ffd740",
          lineWidth:     2,
          lineDashStyle: [6, 3],
          labelInLegend: "🤖 AI Forecast"
        },
        // Series 1 = Actual (solid cyan — real price)
        1: {
          color:         "#00e5ff",
          lineWidth:     3,
          labelInLegend: "📈 Actual SPY"
        }
      })
      .setOption("backgroundColor",   { fill: "#0d0d2b" })
      .setOption("titleTextStyle",     { color: "#00e5ff", fontSize: 12, bold: true })
      .setOption("hAxis", {
        textStyle:      { color: "#7070aa", fontSize: 9 },
        gridlines:      { color: "#1a1a3e" },
        title:          "Time (CST)",
        titleTextStyle: { color: "#5a5a8a" }
      })
      .setOption("vAxis", {
        textStyle:       { color: "#7070aa", fontSize: 9 },
        gridlines:       { color: "#1a1a3e" },
        title:           "SPY Price ($)",
        titleTextStyle:  { color: "#5a5a8a" },
        format:          "$#,##0.00"
      })
      .setOption("legend", {
        position:  "top",
        textStyle: { color: "#aaaacc", fontSize: 10 }
      })
      .setOption("chartArea", {
        backgroundColor: "#0a0a14",
        top: 40, left: 60, width: "82%", height: "72%"
      })
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
// Creates and styles the sheet. Safe to re-run.
// ─────────────────────────────────────────────────────────────
function setupForecastSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_FORECAST);
  if (!sheet) sheet = ss.insertSheet(SHEET_FORECAST);

  sheet.setTabColor("#ab47bc");   // purple — distinct from other sheets

  if (sheet.getLastRow() > 0) {
    Logger.log("FC: Forecast sheet already exists — skipping setup.");
    applyForecastColumnWidths(sheet);
    return sheet;
  }

  // Ensure enough columns and rows
  var neededCols = FC.TOTAL_COLS;
  if (sheet.getMaxColumns() < neededCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  }
  var neededRows = FC.CHART_ANCHOR_ROW + 25;
  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  }

  // ── Base sheet background ─────────────────────────────────
  sheet.getRange(1, 1, neededRows, neededCols).setBackground(FC_COLOR.BG_SHEET);

  // ── Row 1: Banner ─────────────────────────────────────────
  sheet.getRange(FC.BANNER_ROW, 1, 1, neededCols).merge()
    .setValue("📡  S P Y   F O R E C A S T   ·   A I   3 0 - M I N   P R I C E   P A T H")
    .setBackground(FC_COLOR.BG_BANNER)
    .setFontColor(FC_COLOR.TXT_BANNER)
    .setFontWeight("bold")
    .setFontSize(14)
    .setFontFamily(BT_FONT.BANNER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(FC.BANNER_ROW, 40);

  // ── Row 2: Subtitle ───────────────────────────────────────
  sheet.getRange(FC.SUBTITLE_ROW, 1, 1, neededCols).merge()
    .setValue("AI predicts SPY price at each 30-min session mark · Updates every 30 min during market hours · 4 hrs overnight/weekend · 8:00 AM CST pre-market preview")
    .setBackground(FC_COLOR.BG_BANNER)
    .setFontColor(FC_COLOR.TXT_META)
    .setFontSize(8)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(FC.SUBTITLE_ROW, 18);

  // ── Row 3: Meta (last updated) ────────────────────────────
  sheet.getRange(FC.META_ROW, 1, 1, neededCols).merge()
    .setValue("🕐  Not yet generated — will fire at next scheduled update")
    .setBackground(FC_COLOR.BG_BANNER)
    .setFontColor(FC_COLOR.TXT_META)
    .setFontSize(9)
    .setHorizontalAlignment("center");
  sheet.setRowHeight(FC.META_ROW, 18);

  // ── Row 4: Gap ────────────────────────────────────────────
  sheet.getRange(FC.GAP_ROW, 1, 1, neededCols).setBackground("#0a0a12");
  sheet.setRowHeight(FC.GAP_ROW, 4);

  // ── Row 5: Column headers ─────────────────────────────────
  var headers = ["⏱ TIME (CST)", "🤖 PREDICTED", "💡 CONF", "📝 AI MEMO", "💰 ACTUAL", "📊 DIFF"];
  sheet.getRange(FC.HEADER_ROW, 1, 1, neededCols).setValues([headers])
    .setBackground(FC_COLOR.BG_HEADER)
    .setFontColor(FC_COLOR.TXT_HEADER)
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontFamily(BT_FONT.HEADER)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(FC.HEADER_ROW, 26);

  // ── Rows 6–18: Data rows (13 slots, placeholder) ──────────
  for (var i = 0; i < FC.SLOT_COUNT; i++) {
    var row      = FC.DATA_START_ROW + i;
    var slotMins = FORECAST_SLOTS[i];
    var label    = fcMinsToLabel(slotMins);
    var rowBg    = i % 2 === 0 ? FC_COLOR.BG_ROW : FC_COLOR.BG_ROW_ALT;

    sheet.getRange(row, 1, 1, neededCols).setBackground(rowBg);
    sheet.getRange(row, FC.COL_TIME).setValue(label)
      .setFontColor(FC_COLOR.TXT_TIME)
      .setFontFamily(BT_FONT.DATA)
      .setFontSize(9)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    sheet.getRange(row, FC.COL_PRED).setValue("—")
      .setFontColor(FC_COLOR.TXT_DIM)
      .setHorizontalAlignment("center");
    sheet.getRange(row, FC.COL_CONF).setValue("—")
      .setFontColor(FC_COLOR.TXT_DIM)
      .setHorizontalAlignment("center");
    sheet.getRange(row, FC.COL_MEMO).setValue("Awaiting first forecast...")
      .setFontColor(FC_COLOR.TXT_DIM)
      .setFontSize(8)
      .setFontStyle("italic")
      .setWrap(true);
    sheet.getRange(row, FC.COL_ACTUAL).setValue("")
      .setHorizontalAlignment("center");
    sheet.getRange(row, FC.COL_DIFF)
      .setFormula('=IF(E' + row + '="","—",E' + row + '-B' + row + ')')
      .setFontColor(FC_COLOR.TXT_DIM)
      .setHorizontalAlignment("center");
    sheet.setRowHeight(row, 26);
  }

  // ── Row 19: Gap before chart ──────────────────────────────
  sheet.getRange(FC.GAP2_ROW, 1, 1, neededCols).setBackground("#0a0a12");
  sheet.setRowHeight(FC.GAP2_ROW, 6);

  // Add header notes
  sheet.getRange(FC.HEADER_ROW, FC.COL_CONF).setNote(
    "💡 CONFIDENCE (1–10)\n─────────────────\n" +
    "8–10 = High confidence\n" +
    "5–7  = Moderate\n" +
    "1–4  = Low (far future / uncertain)\n\n" +
    "Confidence drops for slots far from current time."
  );
  sheet.getRange(FC.HEADER_ROW, FC.COL_DIFF).setNote(
    "📊 DIFF\n─────────────────\n" +
    "Actual − Predicted.\n" +
    "Green = SPY beat forecast.\n" +
    "Red = SPY missed forecast.\n" +
    "Blank until actual price is filled."
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
// RESET DAILY FLAGS — called from finalizeDaySummary in Code.gs
// ─────────────────────────────────────────────────────────────
function resetDailyForecastFlags() {
  var keys = [
    "FC_LAST_RUN_MINS",
    "FC_EARLY_AM_FIRED_TODAY"
  ];
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
    "• Chart rebuilds only on forecast updates (~13×/day)\n\n" +
    "CONTEXT USED:\n" +
    "• SPY LOG recent ticks\n" +
    "• VIX + ES futures\n" +
    "• Morning Brief targets (flush/flip/rip)\n" +
    "• Previous close\n\n" +
    "AI BUDGET: ~13 calls/market day · ~400 tokens each"
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

    // Force-clear the last run flag so it fires regardless of cadence
    setFlag("FC_LAST_RUN_MINS", "");

    generateForecast(sheet, data, now);

    SpreadsheetApp.getUi().alert(
      "✅ Forecast generated!\n\n" +
      "SPY: $" + data.price.toFixed(2) + "\n\n" +
      "Check the 📡 FORECAST sheet."
    );
  } catch (e) {
    Logger.log("runManualForecast ERROR: " + e.message);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message + "\n\nSee Apps Script logs.");
  }
}
