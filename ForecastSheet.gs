// ============================================================
// FILE: ForecastSheet.gs
// PURPOSE: 📡 FORECAST — AI 30-minute SPY price forecasting.
//
//  FEATURES:
//    1. Forecast Table  — 14 rows (8:30am–3:00pm CST, every 30min)
//                         Each row: time slot, predicted price,
//                         confidence (1–10), AI memo, actual price
//                         (filled in as the day progresses).
//    2. Intraday Chart  — Line chart: solid actual price line +
//                         dashed forecast line. Uses a single
//                         contiguous helper range (cols H–J,
//                         hidden) to avoid multi-range chart
//                         rendering failures in Google Sheets.
//
//  ACCURACY IMPROVEMENTS:
//    1. DIFF HISTORY FEEDBACK — Last 3 days of AM/PM avg diff
//       injected into every prompt via buildDiffHistoryContext()
//       from ForecastAccuracyLog.gs, so AI self-corrects bias.
//    2. VIX-AWARE CONFIDENCE — High VIX crushes PM confidence;
//       low VIX allows holding confidence further out.
//    3. SLOT LOCKING / MID-DAY RE-ANCHOR — Already-filled
//       actual slots are locked (not overwritten). Only future
//       slots are re-forecasted. Past actuals are passed to AI
//       as hard anchors.
//    4. INTRADAY BIAS DETECTION — First 4+ completed slots'
//       running avg diff injected into remaining-slot prompt.
//    5. ACCURACY LOGGER — logForecastAccuracy() called on every
//       actual-price fill. Locked at 3:00 PM CST EOD slot.
//
//  CHART FIX:
//    Multi-range addRange() is unreliable in Google Sheets API
//    and was causing empty chart boxes. Solution: a hidden
//    chart-data helper block (cols 8–10, rows 5–19) is written
//    with Time / Predicted / Actual as a single contiguous
//    range. The chart uses ONLY this one range. This is the
//    robust pattern that always renders correctly.
//
//  All times displayed in CST 12-hour format.
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
  DATA_END_ROW:     19,
  GAP2_ROW:         20,
  CHART_ANCHOR_ROW: 22,

  // Visible columns
  COL_TIME:         1,   // A
  COL_PRED:         2,   // B
  COL_CONF:         3,   // C
  COL_MEMO:         4,   // D
  COL_ACTUAL:       5,   // E
  COL_DIFF:         6,   // F
  COL_GAP:          7,   // G — spacer

  // Hidden chart-data helper columns (never shown to user)
  COL_CH_TIME:      8,   // H — chart: time label
  COL_CH_PRED:      9,   // I — chart: predicted price
  COL_CH_ACTUAL:    10,  // J — chart: actual price

  TOTAL_COLS:       10,

  MARKET_OPEN_MIN:  510,   // 8:30 CST
  MARKET_CLOSE_MIN: 900,   // 3:00 CST
  EARLY_AM_MIN:     480,   // 8:00 CST

  MARKET_INTERVAL_MIN:    30,
  OVERNIGHT_INTERVAL_MIN: 240,
  COOLDOWN_MIN:           120,

  SLOT_COUNT: 14
  // [510,540,570,600,630,660,690,720,750,780,810,840,870,900]
};

// Market session slots — CST minutes from midnight
var FORECAST_SLOTS = (function() {
  var slots = [];
  for (var m = FC.MARKET_OPEN_MIN; m <= FC.MARKET_CLOSE_MIN; m += 30) {
    slots.push(m);
  }
  return slots;
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
//
// Weekends / overnight: use FC_LAST_RUN_TS (Unix ms timestamp)
// so elapsed time is accurate across day boundaries and the
// full Fri→Sat→Sun→Mon span. Minutes-of-day (FC_LAST_RUN_MINS)
// only works reliably within a single calendar day.
//
// Market hours: still use FC_LAST_RUN_MINS (30-min cadence,
// always within the same session day — no wraparound risk).
// ─────────────────────────────────────────────────────────────
function shouldFireForecast(now) {
  try {
    var cstMins   = fcGetCSTMins(now);
    var dow       = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    var isWeekend = (dow === 0 || dow === 6);
    var nowMs     = now.getTime();

    // ── Weekends: use real timestamp for elapsed ───────────
    if (isWeekend) {
      var lastTsStr = getFlag("FC_LAST_RUN_TS");
      var lastTs    = (lastTsStr && lastTsStr !== "") ? parseInt(lastTsStr) : 0;
      if (isNaN(lastTs)) lastTs = 0;
      var elapsedMs  = lastTs > 0 ? nowMs - lastTs : 99999999;
      var elapsedMin = elapsedMs / 60000;
      Logger.log("FC weekend check: elapsedMin=" + Math.round(elapsedMin) +
                 " threshold=" + FC.OVERNIGHT_INTERVAL_MIN);
      return elapsedMin >= FC.OVERNIGHT_INTERVAL_MIN;
    }

    // ── Weekday: use minutes-of-day for market-hours cadence ─
    var lastRunStr = getFlag("FC_LAST_RUN_MINS");
    var lastRun    = (lastRunStr && lastRunStr !== "") ? parseInt(lastRunStr) : -9999;
    if (isNaN(lastRun)) lastRun = -9999;

    // Also check timestamp for overnight/after-hours weekday
    // so a forecast that ran Friday afternoon doesn't block Monday morning
    var lastTsWd   = getFlag("FC_LAST_RUN_TS");
    var lastTsMsWd = (lastTsWd && lastTsWd !== "") ? parseInt(lastTsWd) : 0;
    var tsElapsed  = lastTsMsWd > 0 ? (nowMs - lastTsMsWd) / 60000 : 99999;

    var elapsed = (lastRun < 0)
      ? 9999
      : (cstMins >= lastRun ? cstMins - lastRun : (1440 - lastRun) + cstMins);

    // Pre-market early AM window (8:00–8:30 CST)
    if (cstMins >= FC.EARLY_AM_MIN && cstMins < FC.MARKET_OPEN_MIN) {
      var earlyFired = getFlag("FC_EARLY_AM_FIRED_TODAY");
      var todayStr   = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
      // Also allow if it's been >2 hrs since last run (catches Mon morning after weekend)
      return (earlyFired !== todayStr &&
              (elapsed >= FC.COOLDOWN_MIN || tsElapsed >= FC.COOLDOWN_MIN));
    }

    // Active market hours (8:30–3:00 CST): 30-min cadence
    if (cstMins >= FC.MARKET_OPEN_MIN && cstMins < FC.MARKET_CLOSE_MIN) {
      return elapsed >= FC.MARKET_INTERVAL_MIN;
    }

    // After hours / overnight weekday: use real timestamp
    return tsElapsed >= FC.OVERNIGHT_INTERVAL_MIN;

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

    if (!shouldAllowAICall(AI_FEATURE.FORECAST)) {
      Logger.log("FC: AI quota exceeded — skipping forecast.");
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

    // Cache VIX for accuracy log
    if (vixData && vixData.price > 0) {
      setFlag("FC_LAST_VIX", vixData.price.toFixed(1));
    }

    // Read existing actuals for slot-locking
    var existingActuals = [];
    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var cell = sheet.getRange(FC.DATA_START_ROW + i, FC.COL_ACTUAL).getValue();
      existingActuals[i] = (cell && cell !== "" && !isNaN(parseFloat(cell)))
        ? parseFloat(cell) : null;
    }

    var prompt = buildForecastPrompt(data, now, cstMins, vixData, esData,
                                     mbSetup, mbFlush, mbFlip, mbRip, mbEod,
                                     mbRationale, recentContext, timeStr,
                                     existingActuals);

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4000, temperature: 0.3 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("FC Gemini error: " + resp.getResponseCode() + " — " +
                 resp.getContentText().substring(0, 200));
      recordAICall(AI_FEATURE.FORECAST, false);
      return;
    }

    recordAICall(AI_FEATURE.FORECAST, true);

    var json    = JSON.parse(resp.getContentText());
    var rawText = json.candidates
               && json.candidates[0]
               && json.candidates[0].content
               && json.candidates[0].content.parts
               && json.candidates[0].content.parts[0]
                ? json.candidates[0].content.parts[0].text.trim()
                : null;

    if (!rawText) { Logger.log("FC: Gemini returned empty content."); return; }

    var clean = rawText.replace(/```json|```/gi, "").trim();

    var parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      Logger.log("FC: JSON parse error — " + parseErr.message +
                 "\nRaw: " + clean.substring(0, 300));
      return;
    }

    if (!parsed || !parsed.slots || !Array.isArray(parsed.slots)) {
      Logger.log("FC: Unexpected JSON shape — missing slots array.");
      return;
    }

    writeForecastRows(sheet, parsed.slots, now, cstMins, existingActuals);
    updateChartHelperRange(sheet);
    buildForecastChart(sheet);

    var nextMins = cstMins + (
      (cstMins >= FC.MARKET_OPEN_MIN && cstMins < FC.MARKET_CLOSE_MIN)
        ? FC.MARKET_INTERVAL_MIN : FC.OVERNIGHT_INTERVAL_MIN
    );
    sheet.getRange(FC.META_ROW, 1, 1, FC.COL_DIFF).merge()
      .setValue("🕐  Last updated: " + timeStr + " CST  ·  Next update: ~" +
                fcMinsToLabel(nextMins % 1440) + " CST")
      .setFontColor(FC_COLOR.TXT_META).setFontSize(9)
      .setHorizontalAlignment("center").setBackground(FC_COLOR.BG_BANNER);

    setFlag("FC_LAST_RUN_MINS", cstMins.toString());
    setFlag("FC_LAST_RUN_TS",   now.getTime().toString());  // real timestamp for cross-day elapsed

    var dow = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    if (dow !== 0 && dow !== 6 &&
        cstMins >= FC.EARLY_AM_MIN && cstMins < FC.MARKET_OPEN_MIN) {
      setFlag("FC_EARLY_AM_FIRED_TODAY", todayStr);
    }

    Logger.log("FC: Forecast generated and chart rebuilt at " + timeStr);

  } catch (e) {
    Logger.log("generateForecast ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD FORECAST PROMPT
//
// Improvements integrated:
//   1. DIFF HISTORY — from buildDiffHistoryContext() in AccuracyLog
//   2. VIX-AWARE CONFIDENCE DECAY — injected as prompt rule
//   3. SLOT LOCKING — past actuals passed as anchors; AI only
//      generates future slots; locked rows not overwritten
//   4. INTRADAY BIAS — running avg of completed-slot diffs
//      injected if 4+ actuals exist
// ─────────────────────────────────────────────────────────────
function buildForecastPrompt(data, now, cstMins, vixData, esData,
                              mbSetup, mbFlush, mbFlip, mbRip, mbEod,
                              mbRationale, recentContext, timeStr,
                              existingActuals) {

  var vixStr = vixData ? vixData.price.toFixed(1) + " [" + vixData.regime + "]" : "unknown";
  var esStr  = esData  ? "$" + esData.price.toFixed(2) + " " + esData.trend    : "unknown";
  var vixVal = vixData ? vixData.price : 0;

  // ── S/R levels ────────────────────────────────────────────
  var s1 = getFlag("SESSION_LAST_S1") || "—";
  var s2 = getFlag("SESSION_LAST_S2") || "—";
  var r1 = getFlag("SESSION_LAST_R1") || "—";
  var r2 = getFlag("SESSION_LAST_R2") || "—";

  // ── Bear Trap context ─────────────────────────────────────
  var btPhase = getFlag("BT_LAST_PHASE")       || "—";
  var btConf  = getFlag("BT_LAST_CONFIDENCE")  || "—";
  var btFlip  = getFlag("BT_FLIP_DETECTED")    === "YES" ? "YES" : "NO";
  var btRip   = getFlag("BT_RIP_DETECTED")     === "YES" ? "YES" : "NO";
  var btOHTag = getFlag("BT_OVERNIGHT_TAGGED") === "YES" ? "YES" : "NO";

  // ── Volume context ────────────────────────────────────────
  var volStr = "—";
  if (data.volumeToday > 0 && data.avgVol30 > 0) {
    var volPct = Math.round((data.volumeToday / data.avgVol30) * 100);
    volStr = volPct + "% of 30d avg (" +
             (volPct >= 100 ? "above avg — conviction" : "below avg — caution") + ")";
  }

  // ── VWAP distance ─────────────────────────────────────────
  var vwapStr = "—";
  if (data.vwap && data.vwap > 0) {
    var vwapDist = ((data.price - data.vwap) / data.vwap * 100).toFixed(2);
    vwapStr = "$" + data.vwap.toFixed(2) + " (" + vwapDist + "% " +
              (data.price >= data.vwap ? "above" : "below") + ")";
  }

  // ── Morning Brief context ─────────────────────────────────
  var mbStr = "";
  if (mbFlush > 0 || mbFlip > 0 || mbRip > 0 || mbEod > 0) {
    mbStr = "Morning Brief setup: " + mbSetup + "\n" +
            "  Flush target: $" + (mbFlush > 0 ? mbFlush.toFixed(2) : "n/a") + "\n" +
            "  Flip zone:    $" + (mbFlip  > 0 ? mbFlip.toFixed(2)  : "n/a") + "\n" +
            "  Rip target:   $" + (mbRip   > 0 ? mbRip.toFixed(2)   : "n/a") + "\n" +
            "  EOD target:   $" + (mbEod   > 0 ? mbEod.toFixed(2)   : "n/a") + "\n" +
            (mbRationale ? "  Rationale: " + mbRationale + "\n" : "");
  }

  // ── IMPROVEMENT #3: Slot locking — build anchor context ──
  // Count which slots already have actuals; build anchor list
  // Only future slots need to be forecast.
  var lockedCount      = 0;
  var anchorLines      = [];
  var firstFutureSlot  = 0;
  var completedDiffs   = [];

  for (var i = 0; i < FC.SLOT_COUNT; i++) {
    var actual = existingActuals ? existingActuals[i] : null;
    if (actual && actual > 0) {
      lockedCount++;
      anchorLines.push(fcMinsToLabel(FORECAST_SLOTS[i]) + ": ACTUAL=$" + actual.toFixed(2));

      // Collect diffs for intraday bias detection
      // We'd need the predicted price too — read it from flags or accept approximation
      // We pass this via the running diff avg computed below
    } else {
      if (lockedCount > 0 && firstFutureSlot === 0) firstFutureSlot = i;
    }
  }
  if (firstFutureSlot === 0 && lockedCount === 0) firstFutureSlot = 0;

  // ── IMPROVEMENT #4: Intraday bias detection ───────────────
  // Read today's intraday bias from the accuracy log sheet if ≥4 actuals
  var intradayBiasStr = "";
  if (lockedCount >= 4) {
    try {
      var ss       = SpreadsheetApp.getActiveSpreadsheet();
      var logSheet = ss.getSheetByName(SHEET_FC_ACCURACY);
      var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");

      if (logSheet) {
        var lastRow = logSheet.getLastRow();
        if (lastRow >= 4) {
          // Find today's row
          var searchStart = Math.max(4, lastRow - 5);
          var dateVals    = logSheet.getRange(searchStart, FCA.DATE,
                            lastRow - searchStart + 1, 1).getValues();
          for (var d = dateVals.length - 1; d >= 0; d--) {
            if (dateVals[d][0] === todayStr) {
              var todayRow  = searchStart + d;
              var amAvgNow  = logSheet.getRange(todayRow, FCA.AM_AVG).getValue();
              var dayAvgNow = logSheet.getRange(todayRow, FCA.DAY_AVG).getValue();
              if (amAvgNow !== "—" && amAvgNow !== "" && !isNaN(parseFloat(amAvgNow))) {
                var amV  = parseFloat(amAvgNow);
                var dayV = parseFloat(dayAvgNow) || 0;
                intradayBiasStr =
                  "INTRADAY BIAS (today so far, " + lockedCount + " slots completed):\n" +
                  "  Running avg diff: " + (dayV >= 0 ? "+" : "") + dayV.toFixed(2) + "\n" +
                  "  AM avg diff:      " + (amV  >= 0 ? "+" : "") + amV.toFixed(2) + "\n" +
                  "  " + (Math.abs(dayV) > 0.20
                    ? (dayV > 0
                        ? "AI is running BEARISH today — raise remaining slot prices accordingly."
                        : "AI is running BULLISH today — lower remaining slot prices accordingly.")
                    : "Bias is within tolerance — no major adjustment needed.") + "\n";
              }
              break;
            }
          }
        }
      }
    } catch (e) {
      Logger.log("FC: Intraday bias read error: " + e.message);
    }
  }

  // ── IMPROVEMENT #1: Diff history from accuracy log ────────
  var diffHistory = "";
  try {
    diffHistory = buildDiffHistoryContext();
  } catch (e) {
    Logger.log("FC: buildDiffHistoryContext error: " + e.message);
  }

  // ── IMPROVEMENT #2: VIX-aware confidence rule ─────────────
  var vixConfRule;
  if (vixVal >= 25) {
    vixConfRule = "VIX is ELEVATED (" + vixVal.toFixed(1) + " ≥ 25): " +
                  "max confidence 7 for any slot. " +
                  "Cap PM slots (after 12:00 PM) at confidence 5. " +
                  "Reflect high uncertainty in all memos.";
  } else if (vixVal >= 18) {
    vixConfRule = "VIX is MODERATE (" + vixVal.toFixed(1) + ", 18–24): " +
                  "normal confidence decay. " +
                  "PM slots (after 1:00 PM) max confidence 7.";
  } else if (vixVal > 0) {
    vixConfRule = "VIX is LOW (" + vixVal.toFixed(1) + " < 18): " +
                  "confidence can remain higher further out. " +
                  "PM slots may hold confidence up to 8 if signals align.";
  } else {
    vixConfRule = "VIX unknown — apply normal confidence decay (higher near-term, lower far out).";
  }

  // ── Build slot instructions ───────────────────────────────
  var slotLabels = FORECAST_SLOTS.map(function(m) { return fcMinsToLabel(m); }).join(", ");

  // Future-only slot list (slots that still need prediction)
  var futureSlotsNeeded = [];
  for (var fi = 0; fi < FC.SLOT_COUNT; fi++) {
    if (!existingActuals || !existingActuals[fi] || existingActuals[fi] <= 0) {
      futureSlotsNeeded.push(fcMinsToLabel(FORECAST_SLOTS[fi]));
    }
  }

  var anchorContext = anchorLines.length > 0
    ? "=== LOCKED ACTUALS (DO NOT change these — generate future slots only) ===\n" +
      anchorLines.join("\n") + "\n\n"
    : "";

  var intradaySection = intradayBiasStr
    ? "=== TODAY'S INTRADAY BIAS ===\n" + intradayBiasStr + "\n"
    : "";

  var diffSection = diffHistory
    ? diffHistory + "\n\n"
    : "";

  // Build the slot template — only for future slots
  var slotTemplate = futureSlotsNeeded.map(function(lbl) {
    return '{"time":"' + lbl + '","price":0.00,"conf":5,"memo":"16 words max"}';
  }).join(",\n");

  // If all slots are locked (shouldn't happen but guard it)
  if (futureSlotsNeeded.length === 0) {
    Logger.log("FC: All slots locked — skipping generation.");
    return null;
  }

  var prompt =
    "You are a quantitative SPY price analyst. Current time: " + timeStr + " CST.\n\n" +
    "=== CURRENT MARKET DATA ===\n" +
    "SPY price: $" + data.price.toFixed(2) + "\n" +
    "Prev close: $" + (data.prevClose || data.price).toFixed(2) + "\n" +
    "Day open:   $" + (data.dayOpen   || data.price).toFixed(2) + "\n" +
    "Day high:   $" + (data.dayHigh   || data.price).toFixed(2) + "\n" +
    "Day low:    $" + (data.dayLow    || data.price).toFixed(2) + "\n" +
    "VWAP: " + vwapStr + "\n" +
    "Volume: " + volStr + "\n" +
    "VIX: " + vixStr + "\n" +
    "ES Futures: " + esStr + "\n\n" +
    "=== SUPPORT & RESISTANCE ===\n" +
    "S1 (nearest support):    " + s1 + "\n" +
    "S2 (next support):       " + s2 + "\n" +
    "R1 (nearest resistance): " + r1 + "\n" +
    "R2 (next resistance):    " + r2 + "\n\n" +
    "=== BEAR TRAP STATUS ===\n" +
    "Phase: " + btPhase + "\n" +
    "Confidence: " + btConf + "%\n" +
    "Flip detected: " + btFlip + "\n" +
    "Rip detected: " + btRip + "\n" +
    "Overnight high tagged: " + btOHTag + "\n\n" +
    (mbStr ? "=== MORNING BRIEF CONTEXT ===\n" + mbStr + "\n" : "") +
    (recentContext ? "=== RECENT PRICE ACTION (last 12 ticks) ===\n" + recentContext + "\n\n" : "") +
    anchorContext +
    intradaySection +
    diffSection +
    "=== INSTRUCTIONS ===\n" +
    "Generate SPY price forecasts for these " + futureSlotsNeeded.length +
    " remaining slots: " + futureSlotsNeeded.join(", ") + ".\n\n" +
    "STRICT RULES — you MUST follow these exactly:\n" +
    "  1. Return ONLY raw JSON, no markdown, no backticks, no extra text.\n" +
    "  2. Every memo MUST be 16 words or less.\n" +
    "  3. Only generate the " + futureSlotsNeeded.length +
            " future slots listed — do not include locked actuals.\n" +
    "  4. Price to 2 decimal places, conf is integer 1–10.\n" +
    "  5. Use S/R levels and Bear Trap phase to inform price targets.\n" +
    "  6. VIX CONFIDENCE RULE: " + vixConfRule + "\n" +
    "  7. Apply bias correction from accuracy history and intraday bias above.\n\n" +
    "Return this exact structure:\n" +
    '{"slots":[\n' + slotTemplate + '\n]}';

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
//
// IMPROVEMENT #3: Slot locking
// — If a slot already has an actual price, its PRED/CONF/MEMO
//   are NOT overwritten. Only future slots get new AI values.
// — existingActuals[] is passed in so we know which to skip.
// ─────────────────────────────────────────────────────────────
function writeForecastRows(sheet, slots, now, cstMins, existingActuals) {
  try {
    // Build a map of AI slot output keyed by time label
    // (AI now returns only future slots, so map them by label)
    var slotMap = {};
    slots.forEach(function(aiSlot) {
      if (aiSlot && aiSlot.time) {
        slotMap[aiSlot.time.trim()] = aiSlot;
      }
    });

    for (var s = 0; s < FC.SLOT_COUNT; s++) {
      var row      = FC.DATA_START_ROW + s;
      var slotMins = FORECAST_SLOTS[s];
      var label    = fcMinsToLabel(slotMins);
      var actual   = existingActuals ? existingActuals[s] : null;

      // Always write the time label
      sheet.getRange(row, FC.COL_TIME).setValue(label);

      // Always keep the DIFF formula live
      sheet.getRange(row, FC.COL_DIFF).setFormula(
        '=IF(E' + row + '="","—",E' + row + '-B' + row + ')'
      );

      // SLOT LOCKING: if actual exists, skip overwriting pred/conf/memo
      if (actual && actual > 0) {
        applyForecastRowFormat(sheet, row, s, slotMins, cstMins, null, null, actual);
        continue;
      }

      // Future slot — write AI values if we have them
      var aiSlot = slotMap[label];
      if (!aiSlot) {
        // AI didn't return this slot — leave as-is
        applyForecastRowFormat(sheet, row, s, slotMins, cstMins, null, null, null);
        continue;
      }

      var pred = parseFloat(aiSlot.price || 0) || 0;
      var conf = parseInt(aiSlot.conf    || 5) || 5;
      var memo = (aiSlot.memo || "").toString().substring(0, 80);

      if (pred > 0) sheet.getRange(row, FC.COL_PRED).setValue(pred);
      sheet.getRange(row, FC.COL_CONF).setValue(conf);
      sheet.getRange(row, FC.COL_MEMO).setValue(memo);

      applyForecastRowFormat(sheet, row, s, slotMins, cstMins, conf, pred, null);
    }

    Logger.log("FC: Forecast rows written (" + FC.SLOT_COUNT + " slots, " +
               Object.keys(slotMap).length + " new AI slots).");
  } catch (e) {
    Logger.log("writeForecastRows ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FILL ACTUAL PRICES
//
// Called every 5-min tick during market hours.
// Fills actual price for slots whose time has passed.
// Calls logForecastAccuracy() after each fill (dynamic updates).
// Calls logForecastAccuracy(isEOD=true) when 3:00 PM fills.
// Also calls buildForecastChart() to refresh the chart line.
// ─────────────────────────────────────────────────────────────
function fillActualPrices(sheet, data, now) {
  try {
    var cstMins = fcGetCSTMins(now);
    var dow     = parseInt(Utilities.formatDate(now, "America/Chicago", "u"), 10) % 7;
    if (dow === 0 || dow === 6) return;
    if (cstMins < FC.MARKET_OPEN_MIN) return;

    var anyFilled = false;

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

        var isCurrent = Math.abs(cstMins - slotMins) <= 15;
        var rowBg = isCurrent ? FC_COLOR.BG_CURRENT : FC_COLOR.BG_PAST;
        sheet.getRange(row, 1, 1, FC.TOTAL_COLS).setBackground(rowBg);

        anyFilled = true;

        // EOD lock-in: 3:00 PM slot (last slot, index 13)
        if (i === FC.SLOT_COUNT - 1) {
          Logger.log("FC: 3:00 PM slot filled — triggering EOD accuracy lock.");
          try { logForecastAccuracy(now, true); } catch (e) {
            Logger.log("FC: logForecastAccuracy EOD error: " + e.message);
          }
        }

      } else if (val !== "" && val !== null) {
        // Already filled — keep row styling current
        var isCur = Math.abs(cstMins - slotMins) <= 15;
        var bg    = cstMins > slotMins + 15 ? FC_COLOR.BG_PAST
                  : isCur ? FC_COLOR.BG_CURRENT
                  : (i % 2 === 0 ? FC_COLOR.BG_ROW : FC_COLOR.BG_ROW_ALT);
        sheet.getRange(row, 1, 1, FC.TOTAL_COLS).setBackground(bg);
      }
    }

    // Dynamic accuracy log update (not EOD) whenever any new actual filled
    if (anyFilled) {
      try { logForecastAccuracy(now, false); } catch (e) {
        Logger.log("FC: logForecastAccuracy intraday error: " + e.message);
      }
      updateChartHelperRange(sheet);
      buildForecastChart(sheet);
    }

  } catch (e) {
    Logger.log("fillActualPrices ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// UPDATE CHART HELPER RANGE
//
// CHART FIX: Writes a contiguous 3-column block at cols H–J
// (COL_CH_TIME=8, COL_CH_PRED=9, COL_CH_ACTUAL=10).
// Row 5 = headers. Rows 6–19 = data.
// The chart uses ONLY this single range — no multi-range hacks.
// Columns H–J are hidden so the user never sees them.
// ─────────────────────────────────────────────────────────────
function updateChartHelperRange(sheet) {
  try {
    // Header row
    sheet.getRange(FC.HEADER_ROW, FC.COL_CH_TIME,   1, 1).setValue("Time");
    sheet.getRange(FC.HEADER_ROW, FC.COL_CH_PRED,   1, 1).setValue("AI Forecast");
    sheet.getRange(FC.HEADER_ROW, FC.COL_CH_ACTUAL, 1, 1).setValue("Actual SPY");

    // Data rows
    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var srcRow  = FC.DATA_START_ROW + i;
      var destRow = FC.DATA_START_ROW + i;

      var timeVal   = sheet.getRange(srcRow, FC.COL_TIME).getValue();
      var predVal   = sheet.getRange(srcRow, FC.COL_PRED).getValue();
      var actualVal = sheet.getRange(srcRow, FC.COL_ACTUAL).getValue();

      // Time label
      sheet.getRange(destRow, FC.COL_CH_TIME).setValue(timeVal || fcMinsToLabel(FORECAST_SLOTS[i]));

      // Predicted — only numeric values; "—" becomes blank
      var pred = parseFloat(predVal);
      sheet.getRange(destRow, FC.COL_CH_PRED).setValue(!isNaN(pred) && pred > 0 ? pred : "");

      // Actual — only numeric values; blank if not yet filled
      var actual = parseFloat(actualVal);
      sheet.getRange(destRow, FC.COL_CH_ACTUAL).setValue(!isNaN(actual) && actual > 0 ? actual : "");
    }

    // Hide helper columns so user only sees cols A–F
    sheet.hideColumns(FC.COL_GAP, FC.TOTAL_COLS - FC.COL_DIFF);

    Logger.log("FC: Chart helper range updated.");
  } catch (e) {
    Logger.log("updateChartHelperRange ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD / REFRESH FORECAST CHART
//
// FIX: Uses a SINGLE contiguous range (cols H–J, rows 5–19)
// instead of three separate addRange() calls. The Google Sheets
// chart API reliably renders a single range; multi-range causes
// the blank chart box seen on 5/30/2026.
//
// Series 0 (col I, AI Forecast)  → gold dashed line
// Series 1 (col J, Actual SPY)   → cyan solid line
// ─────────────────────────────────────────────────────────────
function buildForecastChart(sheet) {
  try {
    // Remove all existing charts
    var existing = sheet.getCharts();
    existing.forEach(function(c) { sheet.removeChart(c); });

    // ── Compute Y-axis bounds from helper range data ──────
    var allPrices = [];
    for (var i = 0; i < FC.SLOT_COUNT; i++) {
      var row  = FC.DATA_START_ROW + i;
      var pred = parseFloat(sheet.getRange(row, FC.COL_CH_PRED).getValue());
      var act  = parseFloat(sheet.getRange(row, FC.COL_CH_ACTUAL).getValue());
      if (!isNaN(pred) && pred > 0) allPrices.push(pred);
      if (!isNaN(act)  && act  > 0) allPrices.push(act);
    }

    var yMin, yMax;
    if (allPrices.length > 0) {
      var dataMin = Math.min.apply(null, allPrices);
      var dataMax = Math.max.apply(null, allPrices);
      var range   = dataMax - dataMin;
      var pad     = Math.max(1.5, range * 0.18);
      var win     = Math.max(4, range + pad * 2);
      var mid     = (dataMin + dataMax) / 2;
      yMin = Math.floor((mid - win / 2) * 100) / 100;
      yMax = Math.ceil( (mid + win / 2) * 100) / 100;
    } else {
      yMin = 740;
      yMax = 770;
    }

    Logger.log("FC: Chart Y-axis $" + yMin + " – $" + yMax);

    // ── Single contiguous range: rows 5–19, cols H–J ─────
    var numRows    = FC.DATA_END_ROW - FC.HEADER_ROW + 1;  // 15 rows (header + 14 data)
    var chartRange = sheet.getRange(FC.HEADER_ROW, FC.COL_CH_TIME, numRows, 3);

    var chart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(chartRange)
      .setPosition(FC.CHART_ANCHOR_ROW, 1, 0, 0)
      .setOption("title",
        "SPY Intraday: Actual vs AI Forecast  ·  " +
        Utilities.formatDate(new Date(), "America/Chicago", "M/d/yyyy"))
      .setOption("width",  900)
      .setOption("height", 320)
      .setOption("useFirstColumnAsDomain", true)
      .setOption("interpolateNulls", true)
      .setOption("series", {
        0: { color: "#ffd740", lineWidth: 2,
             lineDashStyle: [6, 3], labelInLegend: "🤖 AI Forecast" },
        1: { color: "#00e5ff", lineWidth: 3,
             labelInLegend: "📈 Actual SPY" }
      })
      .setOption("backgroundColor",  { fill: "#0d0d2b" })
      .setOption("titleTextStyle",    { color: "#00e5ff", fontSize: 12, bold: true })
      .setOption("hAxis", {
        textStyle:  { color: "#7070aa", fontSize: 9 },
        gridlines:  { color: "#1a1a3e" },
        title:      "Time (CST)",
        titleTextStyle: { color: "#5a5a8a" }
      })
      .setOption("vAxis", {
        textStyle:  { color: "#7070aa", fontSize: 9 },
        gridlines:  { color: "#1a1a3e" },
        title:      "SPY Price ($)",
        titleTextStyle: { color: "#5a5a8a" },
        format:     "$#,##0.00",
        viewWindow: { min: yMin, max: yMax }
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
    Logger.log("FC: Chart inserted successfully.");
  } catch (e) {
    Logger.log("buildForecastChart ERROR: " + e.message + "\n" + e.stack);
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

    // Only style visible cols A–F to avoid touching hidden helper cols
    sheet.getRange(row, 1, 1, FC.COL_DIFF)
      .setBackground(rowBg).setFontFamily(BT_FONT.DATA)
      .setFontSize(9).setVerticalAlignment("middle");

    sheet.getRange(row, FC.COL_TIME)
      .setFontColor(isCurrent ? "#00e5ff" : FC_COLOR.TXT_TIME)
      .setFontWeight(isCurrent ? "bold" : "normal")
      .setHorizontalAlignment("center");

    if (pred && pred > 0) {
      sheet.getRange(row, FC.COL_PRED)
        .setFontColor(FC_COLOR.TXT_PRED).setFontFamily(BT_FONT.MONO)
        .setFontWeight("bold").setFontSize(10)
        .setNumberFormat("$#,##0.00").setHorizontalAlignment("center");
    }

    if (conf) {
      var confColor = conf >= 8 ? FC_COLOR.TXT_CONF_HI
                    : conf >= 5 ? FC_COLOR.TXT_CONF_MID
                    : FC_COLOR.TXT_CONF_LOW;
      sheet.getRange(row, FC.COL_CONF)
        .setFontColor(confColor).setFontWeight("bold")
        .setFontSize(10).setHorizontalAlignment("center");
    }

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
// RESET DAILY FLAGS
// ─────────────────────────────────────────────────────────────
function resetDailyForecastFlags() {
  var keys = ["FC_LAST_RUN_MINS", "FC_LAST_RUN_TS", "FC_EARLY_AM_FIRED_TODAY", "FC_LAST_VIX"];
  keys.forEach(function(k) { setFlag(k, ""); });
  Logger.log("FC: Daily forecast flags reset.");
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
  if (sheet.getMaxColumns() < neededCols)
    sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  if (sheet.getMaxRows() < neededRows)
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());

  sheet.getRange(1, 1, neededRows, neededCols).setBackground(FC_COLOR.BG_SHEET);

  // Row 1: Banner
  sheet.getRange(FC.BANNER_ROW, 1, 1, FC.COL_DIFF).merge()
    .setValue("📡  S P Y   F O R E C A S T   ·   A I   3 0 - M I N   P R I C E   P A T H")
    .setBackground(FC_COLOR.BG_BANNER).setFontColor(FC_COLOR.TXT_BANNER)
    .setFontWeight("bold").setFontSize(14).setFontFamily(BT_FONT.BANNER)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(FC.BANNER_ROW, 40);

  // Row 2: Subtitle
  sheet.getRange(FC.SUBTITLE_ROW, 1, 1, FC.COL_DIFF).merge()
    .setValue("AI predicts SPY price at each 30-min mark · Updates every 30 min market hours · 4 hrs overnight/weekend · 8:00 AM CST pre-market preview")
    .setBackground(FC_COLOR.BG_BANNER).setFontColor(FC_COLOR.TXT_META)
    .setFontSize(8).setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(FC.SUBTITLE_ROW, 18);

  // Row 3: Meta
  sheet.getRange(FC.META_ROW, 1, 1, FC.COL_DIFF).merge()
    .setValue("🕐  Not yet generated — will fire at next scheduled update")
    .setBackground(FC_COLOR.BG_BANNER).setFontColor(FC_COLOR.TXT_META)
    .setFontSize(9).setHorizontalAlignment("center");
  sheet.setRowHeight(FC.META_ROW, 18);

  // Row 4: Gap
  sheet.getRange(FC.GAP_ROW, 1, 1, FC.COL_DIFF).setBackground("#0a0a12");
  sheet.setRowHeight(FC.GAP_ROW, 4);

  // Row 5: Headers (visible cols A–F only)
  var headers = [
    ["⏱ TIME (CST)", "🤖 PREDICTED", "💡 CONF", "📝 AI MEMO", "💰 ACTUAL", "📊 DIFF"]
  ];
  sheet.getRange(FC.HEADER_ROW, 1, 1, FC.COL_DIFF).setValues(headers)
    .setBackground(FC_COLOR.BG_HEADER).setFontColor(FC_COLOR.TXT_HEADER)
    .setFontWeight("bold").setFontSize(9).setFontFamily(BT_FONT.HEADER)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(FC.HEADER_ROW, 26);

  // Rows 6–19: 14 data slots
  for (var i = 0; i < FC.SLOT_COUNT; i++) {
    var row      = FC.DATA_START_ROW + i;
    var slotMins = FORECAST_SLOTS[i];
    var rowBg    = i % 2 === 0 ? FC_COLOR.BG_ROW : FC_COLOR.BG_ROW_ALT;

    sheet.getRange(row, 1, 1, FC.COL_DIFF).setBackground(rowBg);
    sheet.getRange(row, FC.COL_TIME).setValue(fcMinsToLabel(slotMins))
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
  sheet.getRange(FC.GAP2_ROW, 1, 1, FC.COL_DIFF).setBackground("#0a0a12");
  sheet.setRowHeight(FC.GAP2_ROW, 6);

  // Header notes
  sheet.getRange(FC.HEADER_ROW, FC.COL_CONF).setNote(
    "💡 CONFIDENCE (1–10)\n─────────────────\n" +
    "8–10 = High confidence\n5–7  = Moderate\n1–4  = Low\n\n" +
    "Adjusts based on VIX regime:\n" +
    "High VIX (≥25) caps PM slots at 5.\n" +
    "Low VIX (<18) allows higher PM confidence."
  );
  sheet.getRange(FC.HEADER_ROW, FC.COL_DIFF).setNote(
    "📊 DIFF\n─────────────────\n" +
    "Actual − Predicted.\n" +
    "Positive = SPY beat forecast (AI underestimated).\n" +
    "Negative = SPY missed forecast (AI overestimated).\n" +
    "Blank until actual fills.\n\n" +
    "Daily diffs logged → 📈 FC ACCURACY LOG\n" +
    "Fed back into next-day AI prompt for bias correction."
  );

  sheet.setFrozenRows(FC.HEADER_ROW);
  applyForecastColumnWidths(sheet);

  // Initialize chart helper range and build chart
  updateChartHelperRange(sheet);
  buildForecastChart(sheet);

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
  // COL_GAP (7) and helper cols (8–10) are hidden
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRIES
// ─────────────────────────────────────────────────────────────
function setupForecastSheetFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupForecastSheet(ss);
  // Also ensure accuracy log exists
  if (!ss.getSheetByName(SHEET_FC_ACCURACY)) {
    setupFCAccuracySheet(ss);
  }
  SpreadsheetApp.getUi().alert(
    "📡 FORECAST SHEET\n\n" +
    "✅ Sheet created and ready!\n\n" +
    "HOW IT WORKS:\n" +
    "• Pre-market preview: ~8:00 AM CST (if not run in 2 hrs)\n" +
    "• Market hours: updates every 30 min (8:30 AM–3:00 PM)\n" +
    "• Overnight/weekend: every 4 hours\n" +
    "• Actual prices fill automatically every 5-min tick\n" +
    "• Locked slots not overwritten on re-forecast\n" +
    "• Chart shows gold forecast line + cyan actual line\n\n" +
    "ACCURACY FEATURES:\n" +
    "• Last 3-day diff history fed into every prompt\n" +
    "• VIX-aware confidence decay\n" +
    "• Intraday bias detection (4+ actuals → self-correct)\n" +
    "• Mid-day slot locking (actuals = anchors)\n" +
    "• Daily accuracy logged → 📈 FC ACCURACY LOG\n\n" +
    "AI CONTEXT INCLUDES:\n" +
    "• SPY OHLC, VWAP, volume\n" +
    "• S1/S2/R1/R2 support & resistance\n" +
    "• Bear Trap phase + confidence\n" +
    "• VIX + ES futures\n" +
    "• Morning Brief targets\n" +
    "• Last 12 SPY LOG ticks\n" +
    "• 3-day forecast error history"
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
      "\n\nCheck the 📡 FORECAST sheet.\n" +
      "Gold = AI forecast · Cyan = Actual price.\n" +
      "Chart uses a single contiguous data range (reliable fix)."
    );
  } catch (e) {
    Logger.log("runManualForecast ERROR: " + e.message);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message + "\n\nSee Apps Script logs.");
  }
}

// ─────────────────────────────────────────────────────────────
// ENSURE FC ACCURACY SHEET EXISTS (called from ensureSheetsExist)
// ─────────────────────────────────────────────────────────────
function ensureFCAccuracySheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_FC_ACCURACY)) {
    setupFCAccuracySheet(ss);
  }
}
