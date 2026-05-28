// ============================================================
// FILE: MorningBrief.gs
// PURPOSE: 🌅 MORNING BRIEF — pre-market AI price prediction
//          system. Fires once at 8:25 CST (5 min before open).
//
//  WHAT IT DOES:
//    1. At 8:25 CST: calls Gemini ONCE with all available
//       pre-market context (overnight H/L, VIX, ES, gap, VWAP)
//    2. Gemini returns 5 structured price targets + setup type
//    3. Targets written to 🌅 MORNING BRIEF sheet + summary
//       panel on 🪤 BEAR TRAP sheet
//    4. Every 5-min tick during the day checks actual SPY price
//       against predictions — marks ✅ when hit within ±0.15%
//    5. Line chart on MORNING BRIEF plots actual price vs targets
//    6. EOD grades accuracy: how many targets were hit
//
//  AI BUDGET: 1 call at 8:25 CST (morning brief)
//             This is in addition to Bear Trap calls.
//             Total daily budget: ~12 calls max.
//
//  All times in CST 12-hour format.
// ============================================================

var SHEET_MORNING_BRIEF = "🌅 MORNING BRIEF";

// ─────────────────────────────────────────────────────────────
// TIMING
// Brief fires at 8:25 CST — 5 min before market open
// ─────────────────────────────────────────────────────────────
var MB = {
  BRIEF_HOUR:        8,
  BRIEF_MIN:         25,
  BRIEF_WINDOW_MIN:  4,    // fire within 4 min of 8:25
  EOD_HOUR:          15,
  EOD_MIN:           0,
  EOD_WINDOW_MIN:    10,

  // Hit tolerance: prediction counts as hit if within ±0.15%
  HIT_TOLERANCE_PCT: 0.15,

  // Chart data starts at this row on the MORNING BRIEF sheet
  CHART_DATA_START_ROW: 20,

  // Setup type labels
  SETUP_BEAR_TRAP: "🪤 BEAR TRAP",
  SETUP_BULL:      "📈 BULL DAY",
  SETUP_CHOPPY:    "↔️ CHOPPY",
  SETUP_AVOID:     "⛔ AVOID"
};

// ─────────────────────────────────────────────────────────────
// MORNING BRIEF COLUMNS (chart data section, row 20+)
// ─────────────────────────────────────────────────────────────
var MBC = {
  TIME:         1,  // A — CST 12hr
  ACTUAL_PRICE: 2,  // B — SPY actual price
  FLUSH_TARGET: 3,  // C — predicted flush level (horizontal ref)
  FLIP_ZONE:    4,  // D — predicted flip zone
  RIP_TARGET:   5,  // E — predicted rip target
  EOD_TARGET:   6,  // F — predicted EOD level
  HIT_FLAG:     7   // G — ✅ if any target hit this tick
};

var MB_CHART_HEADERS = [
  "⏱ TIME (CST)",
  "💰 ACTUAL SPY",
  "📉 FLUSH TARGET",
  "⚡ FLIP ZONE",
  "🚀 RIP TARGET",
  "🎯 EOD TARGET",
  "✅ HIT"
];

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY — called from runEvery5Minutes() in Code.gs
// Handles: pre-brief window, 8:25 CST brief, intraday tracking
// ─────────────────────────────────────────────────────────────
function runMorningBriefTick(data, now) {
  try {
    var cst      = toCSTDate(now);
    var cstHour  = cst.getHours();
    var cstMin   = cst.getMinutes();
    var totalMin = cstHour * 60 + cstMin;

    var briefMin = MB.BRIEF_HOUR * 60 + MB.BRIEF_MIN;
    var openMin  = BT.OPEN_HOUR  * 60 + BT.OPEN_MIN;
    var eodMin   = MB.EOD_HOUR   * 60 + MB.EOD_MIN;
    var closeMin = BT.EOD_HOUR   * 60 + BT.EOD_MIN;

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_MORNING_BRIEF);
    if (!sheet) {
      setupMorningBriefSheet(ss);
      sheet = ss.getSheetByName(SHEET_MORNING_BRIEF);
    }

    var todayStr = Utilities.formatDate(cst, "America/Chicago", "yyyy-MM-dd");

    // ── 8:25 CST: Fire the morning brief ─────────────────────
    if (totalMin >= briefMin && totalMin <= briefMin + MB.BRIEF_WINDOW_MIN) {
      var briefFired = getFlag("MB_BRIEF_FIRED_TODAY");
      if (briefFired !== todayStr) {
        generateMorningBrief(sheet, data, cst, todayStr);
        setFlag("MB_BRIEF_FIRED_TODAY", todayStr);
      }
      return;
    }

    // ── During market hours: track actual price vs predictions ─
    if (totalMin >= openMin && totalMin < closeMin) {
      var briefFired = getFlag("MB_BRIEF_FIRED_TODAY");
      if (briefFired === todayStr && data) {
        trackPriceTick(sheet, data, cst);
      }
      return;
    }

    // ── EOD: grade accuracy ───────────────────────────────────
    if (totalMin >= eodMin && totalMin <= eodMin + MB.EOD_WINDOW_MIN) {
      var eodFired = getFlag("MB_EOD_GRADED_TODAY");
      if (eodFired !== todayStr && data) {
        gradeEODAccuracy(sheet, data, cst, todayStr);
        setFlag("MB_EOD_GRADED_TODAY", todayStr);
      }
    }

  } catch (e) {
    Logger.log("runMorningBriefTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// GENERATE MORNING BRIEF — the one daily AI call
// Writes predictions to sheet, builds chart, updates Bear Trap
// summary panel
// ─────────────────────────────────────────────────────────────
function generateMorningBrief(sheet, data, cst, todayStr) {
  try {
    Logger.log("MB: Generating morning brief for " + todayStr);

    // ── Gather all context ────────────────────────────────────
    var vixData  = fetchVIX();
    var esData   = fetchESFutures();
    var pmData   = fetchPreMarketData();

    var overnightHigh    = pmData ? pmData.high  : 0;
    var overnightLow     = pmData ? pmData.low   : 0;
    var preMarketClose   = pmData ? pmData.close : data.price;
    var overnightTagged  = getFlag("BT_OVERNIGHT_TAGGED") === "YES";
    var prevClose        = data.prevClose || data.price;
    var gapPct           = prevClose > 0
      ? ((preMarketClose - prevClose) / prevClose) * 100 : 0;

    // Pre-market confidence proxy (before open)
    // Uses overnight tag + VIX + ES — same logic as Bear Trap score
    var preConf = 0;
    if (overnightTagged)                              preConf += 25;
    if (vixData && vixData.regime === "NORMAL")       preConf += 15;
    if (vixData && vixData.regime === "FEAR")         preConf -= 20;
    if (esData  && esData.trend   === "FADING")       preConf += 20;
    if (esData  && esData.trend   === "CLIMBING")     preConf -= 15;
    if (Math.abs(gapPct) < 0.3 && gapPct >= -0.1)    preConf += 10;
    preConf = Math.max(0, Math.min(100, preConf));

    // ── Call Gemini ───────────────────────────────────────────
    var predictions = callGeminiForBrief(
      data.price, prevClose, overnightHigh, overnightLow,
      preMarketClose, gapPct, vixData, esData, overnightTagged, preConf
    );

    if (!predictions) {
      Logger.log("MB: Gemini returned null — using fallback estimates");
      predictions = buildFallbackPredictions(data.price, preConf, overnightTagged);
    }

    // ── Store predictions as flags for hit tracking ───────────
    setFlag("MB_SETUP_TYPE",    predictions.setupType);
    setFlag("MB_PRE_CONF",      preConf.toString());
    setFlag("MB_FLUSH_TARGET",  predictions.flushTarget.toString());
    setFlag("MB_FLIP_ZONE",     predictions.flipZone.toString());
    setFlag("MB_RIP_TARGET",    predictions.ripTarget.toString());
    setFlag("MB_EOD_TARGET",    predictions.eodTarget.toString());
    setFlag("MB_RATIONALE",     predictions.rationale);
    setFlag("MB_HITS",          "0");
    setFlag("MB_TOTAL_TARGETS", "4");

    // ── Write to MORNING BRIEF sheet ─────────────────────────
    writeBriefToSheet(sheet, data, cst, predictions, preConf,
                      overnightHigh, overnightLow, gapPct,
                      vixData, esData, todayStr);

    // ── Write summary panel to BEAR TRAP sheet ────────────────
    writeBriefSummaryToBearTrap(data, cst, predictions, preConf);

    // ── Build or refresh the chart ────────────────────────────
    buildOrRefreshChart(sheet);

    Logger.log("MB: Brief complete — setup=" + predictions.setupType +
               " flushTarget=" + predictions.flushTarget +
               " ripTarget=" + predictions.ripTarget);

  } catch (e) {
    Logger.log("generateMorningBrief ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// CALL GEMINI FOR STRUCTURED PREDICTIONS
// Returns: { setupType, flushTarget, flipZone, ripTarget,
//            eodTarget, rationale }
// Prompt is tight — numbers only in, numbers only out.
// ~80 tokens in, ~120 tokens out.
// ─────────────────────────────────────────────────────────────
function callGeminiForBrief(price, prevClose, ohigh, olow, pmClose,
                             gapPct, vixData, esData, ohTagged, preConf) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      Logger.log("MB: No GEMINI_API_KEY");
      return null;
    }

    var vixStr = vixData ? vixData.price.toFixed(1) + "/" + vixData.regime : "unknown";
    var esStr  = esData  ? esData.trend : "unknown";

    var prompt =
      "SPY pre-market analysis. Provide ONLY a JSON object, no other text.\n" +
      "SPY last: $" + price.toFixed(2) + "\n" +
      "Prev close: $" + prevClose.toFixed(2) + "\n" +
      "Overnight high: $" + (ohigh > 0 ? ohigh.toFixed(2) : "unknown") + "\n" +
      "Overnight low: $"  + (olow  > 0 ? olow.toFixed(2)  : "unknown") + "\n" +
      "Pre-market close: $" + pmClose.toFixed(2) + "\n" +
      "Gap vs prev close: " + gapPct.toFixed(2) + "%\n" +
      "VIX: " + vixStr + "\n" +
      "ES futures: " + esStr + "\n" +
      "Overnight high tagged: " + (ohTagged ? "YES" : "NO") + "\n" +
      "Pre-market Bear Trap confidence: " + preConf + "%\n\n" +
      "Return this exact JSON (no markdown, no backticks):\n" +
      "{\n" +
      "  \"setupType\": \"BEAR_TRAP\" or \"BULL\" or \"CHOPPY\" or \"AVOID\",\n" +
      "  \"flushTarget\": <SPY price if flush expected, else 0>,\n" +
      "  \"flipZone\": <SPY price where reversal expected, else 0>,\n" +
      "  \"ripTarget\": <SPY price target if rip plays out, else 0>,\n" +
      "  \"eodTarget\": <expected SPY close price>,\n" +
      "  \"rationale\": \"<one sentence, max 20 words>\"\n" +
      "}";

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.2 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("MB Gemini error: " + resp.getResponseCode());
      return null;
    }

    var json = JSON.parse(resp.getContentText());
    var raw  = json.candidates
            && json.candidates[0]
            && json.candidates[0].content
            && json.candidates[0].content.parts
            && json.candidates[0].content.parts[0]
             ? json.candidates[0].content.parts[0].text.trim()
             : null;

    if (!raw) return null;

    // Strip markdown fences if Gemini added them
    raw = raw.replace(/```json|```/g, "").trim();

    var parsed = JSON.parse(raw);

    // Map setupType string to our label constants
    var setupLabel = MB.SETUP_BEAR_TRAP;
    if      (parsed.setupType === "BULL")   setupLabel = MB.SETUP_BULL;
    else if (parsed.setupType === "CHOPPY") setupLabel = MB.SETUP_CHOPPY;
    else if (parsed.setupType === "AVOID")  setupLabel = MB.SETUP_AVOID;

    return {
      setupType:   setupLabel,
      flushTarget: parseFloat(parsed.flushTarget) || 0,
      flipZone:    parseFloat(parsed.flipZone)    || 0,
      ripTarget:   parseFloat(parsed.ripTarget)   || 0,
      eodTarget:   parseFloat(parsed.eodTarget)   || price,
      rationale:   String(parsed.rationale || "").substring(0, 120)
    };

  } catch (e) {
    Logger.log("callGeminiForBrief ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// FALLBACK PREDICTIONS — used if Gemini call fails
// Pure math, no AI. Gives the sheet something to track.
// ─────────────────────────────────────────────────────────────
function buildFallbackPredictions(price, preConf, ohTagged) {
  var isTrap = preConf >= 40 || ohTagged;
  return {
    setupType:   isTrap ? MB.SETUP_BEAR_TRAP : MB.SETUP_CHOPPY,
    flushTarget: isTrap ? Math.round((price * 0.9975) * 100) / 100 : 0,
    flipZone:    isTrap ? Math.round((price * 0.9970) * 100) / 100 : 0,
    ripTarget:   isTrap ? Math.round((price * 1.0030) * 100) / 100 : 0,
    eodTarget:   Math.round((price * 1.0015) * 100) / 100,
    rationale:   "Fallback estimate — Gemini unavailable. Based on pre-market math."
  };
}

// ─────────────────────────────────────────────────────────────
// WRITE BRIEF TO MORNING BRIEF SHEET
// Top section: header panel with predictions (rows 4–17)
// Bottom section: chart data table starts at row MB.CHART_DATA_START_ROW
// ─────────────────────────────────────────────────────────────
function writeBriefToSheet(sheet, data, cst, pred, preConf,
                            ohigh, olow, gapPct, vixData, esData, todayStr) {
  try {
    // Clear the prediction panel (rows 4–17) before writing
    var panelRows = 14;
    sheet.getRange(4, 1, panelRows, 8).clearContent().clearFormat();

    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();
    var dateStr = Utilities.formatDate(cst, "America/Chicago", "MMMM d, yyyy");
    var vixStr  = vixData ? vixData.price.toFixed(2) + "  [" + vixData.regime + "]" : "—";
    var esStr   = esData  ? esData.trend : "—";

    // Setup type color
    var setupBg = pred.setupType === MB.SETUP_BEAR_TRAP ? "#3e0000"
                : pred.setupType === MB.SETUP_BULL      ? "#003e00"
                : pred.setupType === MB.SETUP_AVOID     ? "#1a0a00"
                : "#1a1a1a";
    var setupFg = pred.setupType === MB.SETUP_BEAR_TRAP ? "#ff6b6b"
                : pred.setupType === MB.SETUP_BULL      ? "#69f0ae"
                : pred.setupType === MB.SETUP_AVOID     ? "#ff9944"
                : "#aaaaaa";

    // ── Panel layout ──────────────────────────────────────────
    // Each entry: [label, value, labelCol, valueCol, row]
    var rows = [
      { r: 4,  label: "📅  Date",              val: dateStr + "  ·  Brief issued at " + timeStr + " CST" },
      { r: 5,  label: "🎯  Setup Type",         val: pred.setupType,   highlight: true },
      { r: 6,  label: "💪  Pre-Market Confidence", val: preConf + "%"  },
      { r: 7,  label: "💬  AI Rationale",       val: pred.rationale    },
      { r: 8,  label: "",                        val: ""                },
      { r: 9,  label: "── PRICE TARGETS ──",    val: ""                },
      { r: 10, label: "📉  Flush Target",        val: pred.flushTarget > 0 ? "$" + pred.flushTarget.toFixed(2) : "No flush expected" },
      { r: 11, label: "⚡  Flip Zone",           val: pred.flipZone    > 0 ? "$" + pred.flipZone.toFixed(2)    : "—" },
      { r: 12, label: "🚀  Rip Target",          val: pred.ripTarget   > 0 ? "$" + pred.ripTarget.toFixed(2)   : "—" },
      { r: 13, label: "🎯  EOD Target",          val: pred.eodTarget   > 0 ? "$" + pred.eodTarget.toFixed(2)   : "—" },
      { r: 14, label: "",                        val: ""                },
      { r: 15, label: "── MARKET CONTEXT ──",   val: ""                },
      { r: 16, label: "😨  VIX",                val: vixStr            },
      { r: 17, label: "📡  ES Futures",         val: esStr             }
    ];

    rows.forEach(function(entry) {
      var labelCell = sheet.getRange(entry.r, 1);
      var valCell   = sheet.getRange(entry.r, 2, 1, 6);
      valCell.merge();

      labelCell
        .setValue(entry.label)
        .setFontFamily(BT_FONT.HEADER)
        .setFontSize(9)
        .setFontColor("#7a7a9a")
        .setHorizontalAlignment("right")
        .setVerticalAlignment("middle");

      valCell
        .setValue(entry.val)
        .setFontFamily(BT_FONT.DATA)
        .setFontSize(10)
        .setFontColor("#d0d0e8")
        .setHorizontalAlignment("left")
        .setVerticalAlignment("middle");

      if (entry.highlight) {
        valCell
          .setBackground(setupBg)
          .setFontColor(setupFg)
          .setFontWeight("bold")
          .setFontSize(12)
          .setFontFamily(BT_FONT.HEADER);
      }

      if (String(entry.label).indexOf("──") !== -1) {
        labelCell.setFontColor("#555577").setFontStyle("italic");
        valCell.setFontColor("#555577");
      }

      sheet.setRowHeight(entry.r, 24);
    });

    // ── Column A width ────────────────────────────────────────
    sheet.setColumnWidth(1, 175);

    // ── Write chart data header row ───────────────────────────
    var hdRow = MB.CHART_DATA_START_ROW;
    if (sheet.getRange(hdRow, 1).getValue() === "") {
      sheet.appendRow([]); // ensure we're past row 17
      sheet.getRange(hdRow, 1, 1, MB_CHART_HEADERS.length)
        .setValues([MB_CHART_HEADERS])
        .setBackground("#1c0505")
        .setFontColor("#ff6b6b")
        .setFontWeight("bold")
        .setFontFamily(BT_FONT.HEADER)
        .setFontSize(9)
        .setHorizontalAlignment("center");
      sheet.setRowHeight(hdRow, 26);
    }

    // Write the prediction levels as horizontal reference columns
    // These stay constant all day — actual price updates each tick
    setFlag("MB_CHART_PRED_ROW", (hdRow + 1).toString()); // first data row

    Logger.log("MB: Brief panel written to sheet.");
  } catch (e) {
    Logger.log("writeBriefToSheet ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// WRITE SUMMARY PANEL TO BEAR TRAP SHEET
// A compact 3-row panel inserted at the top of the data section
// (after the 3 header rows) so you see it first thing at 8:25
// ─────────────────────────────────────────────────────────────
function writeBriefSummaryToBearTrap(data, cst, pred, preConf) {
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var btSheet = ss.getSheetByName(SHEET_BEAR_TRAP);
    if (!btSheet) return;

    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();

    // Check if we already wrote a summary today
    var todayStr  = Utilities.formatDate(cst, "America/Chicago", "yyyy-MM-dd");
    var lastSumm  = getFlag("MB_BT_SUMMARY_WRITTEN");
    if (lastSumm === todayStr) return;

    var setupBg = pred.setupType === MB.SETUP_BEAR_TRAP ? "#3e0000"
                : pred.setupType === MB.SETUP_BULL      ? "#003e00"
                : pred.setupType === MB.SETUP_AVOID     ? "#1a0a00"
                : "#1a1a2a";
    var setupFg = pred.setupType === MB.SETUP_BEAR_TRAP ? "#ff6b6b"
                : pred.setupType === MB.SETUP_BULL      ? "#69f0ae"
                : pred.setupType === MB.SETUP_AVOID     ? "#ff9944"
                : "#aaaacc";

    // Row 1 of summary: setup type + confidence + rationale
    var summRow1 = new Array(BT_HEADERS.length).fill("");
    summRow1[0] = timeStr + " BRIEF";
    summRow1[1] = pred.setupType;
    summRow1[2] = "Pre-mkt conf: " + preConf + "%";
    summRow1[3] = pred.rationale;

    // Row 2: price targets inline
    var targStr =
      (pred.flushTarget > 0 ? "Flush: $" + pred.flushTarget.toFixed(2) + "  " : "") +
      (pred.flipZone    > 0 ? "Flip: $"  + pred.flipZone.toFixed(2)    + "  " : "") +
      (pred.ripTarget   > 0 ? "Rip: $"   + pred.ripTarget.toFixed(2)   + "  " : "") +
      "EOD: $" + pred.eodTarget.toFixed(2);

    var summRow2 = new Array(BT_HEADERS.length).fill("");
    summRow2[0] = "Targets";
    summRow2[1] = targStr;

    // Separator row
    var sepRow = new Array(BT_HEADERS.length).fill("");
    sepRow[0] = "─── MORNING BRIEF ───";

    btSheet.appendRow(sepRow);
    var sr = btSheet.getLastRow();
    btSheet.getRange(sr, 1, 1, BT_HEADERS.length)
      .setBackground("#0d0d1a")
      .setFontColor("#555577")
      .setFontSize(8)
      .setFontStyle("italic")
      .setFontFamily(BT_FONT.HEADER);
    btSheet.setRowHeight(sr, 18);

    btSheet.appendRow(summRow1);
    var r1 = btSheet.getLastRow();
    btSheet.getRange(r1, 1, 1, BT_HEADERS.length)
      .setBackground(setupBg)
      .setFontColor(setupFg)
      .setFontFamily(BT_FONT.DATA)
      .setFontSize(9)
      .setVerticalAlignment("middle");
    btSheet.getRange(r1, 2)
      .setFontWeight("bold")
      .setFontSize(10)
      .setFontFamily(BT_FONT.HEADER);
    btSheet.setRowHeight(r1, 24);

    btSheet.appendRow(summRow2);
    var r2 = btSheet.getLastRow();
    btSheet.getRange(r2, 1, 1, BT_HEADERS.length)
      .setBackground("#0d0d1a")
      .setFontColor("#888899")
      .setFontFamily(BT_FONT.MONO)
      .setFontSize(9)
      .setVerticalAlignment("middle");
    btSheet.getRange(r2, 2).setFontColor(BT_COLOR.TEXT_GOLD).setFontWeight("bold");
    btSheet.setRowHeight(r2, 22);

    setFlag("MB_BT_SUMMARY_WRITTEN", todayStr);
    Logger.log("MB: Bear Trap summary panel written.");
  } catch (e) {
    Logger.log("writeBriefSummaryToBearTrap ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// TRACK PRICE TICK — called every 5 min during market hours
// Appends actual price to chart data table
// Checks if any prediction was hit this tick
// ─────────────────────────────────────────────────────────────
function trackPriceTick(sheet, data, cst) {
  try {
    var price       = data.price;
    var flushTarget = parseFloat(getFlag("MB_FLUSH_TARGET")) || 0;
    var flipZone    = parseFloat(getFlag("MB_FLIP_ZONE"))    || 0;
    var ripTarget   = parseFloat(getFlag("MB_RIP_TARGET"))   || 0;
    var eodTarget   = parseFloat(getFlag("MB_EOD_TARGET"))   || 0;
    var hitCount    = parseInt(getFlag("MB_HITS") || "0");

    // Check each target for a hit (within ±0.15%)
    var hitThis  = false;
    var hitLabel = "";
    var targets  = [
      { price: flushTarget, label: "📉 Flush"  },
      { price: flipZone,    label: "⚡ Flip"   },
      { price: ripTarget,   label: "🚀 Rip"    },
      { price: eodTarget,   label: "🎯 EOD"    }
    ];

    targets.forEach(function(t) {
      if (t.price <= 0) return;
      var diff = Math.abs((price - t.price) / t.price) * 100;
      if (diff <= MB.HIT_TOLERANCE_PCT) {
        // Only count a target as hit once
        var hitKey = "MB_HIT_" + t.label.replace(/[^a-zA-Z]/g, "");
        if (getFlag(hitKey) !== "YES") {
          hitThis = true;
          hitLabel += t.label + " ";
          setFlag(hitKey, "YES");
          hitCount++;
        }
      }
    });

    if (hitThis) {
      setFlag("MB_HITS", hitCount.toString());
    }

    // Append to chart data table
    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();
    var row = [
      timeStr,
      price,
      flushTarget > 0 ? flushTarget : "",
      flipZone    > 0 ? flipZone    : "",
      ripTarget   > 0 ? ripTarget   : "",
      eodTarget   > 0 ? eodTarget   : "",
      hitThis ? "✅ " + hitLabel.trim() : ""
    ];

    sheet.appendRow(row);
    var newRow = sheet.getLastRow();
    applyChartDataRowFormat(sheet, newRow, hitThis, price,
                            flushTarget, ripTarget, eodTarget);

    Logger.log("MB: tick logged price=" + price + " hits=" + hitCount);
  } catch (e) {
    Logger.log("trackPriceTick ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD OR REFRESH CHART
// Creates a line chart on the Morning Brief sheet.
// Actual SPY price = solid blue line.
// Flush, Flip, Rip, EOD targets = dashed reference lines.
// Chart auto-expands as new rows are added.
// ─────────────────────────────────────────────────────────────
function buildOrRefreshChart(sheet) {
  try {
    // Remove any existing charts on this sheet first
    var charts = sheet.getCharts();
    charts.forEach(function(c) { sheet.removeChart(c); });

    var lastRow = Math.max(sheet.getLastRow(), MB.CHART_DATA_START_ROW + 2);

    // Data range: time (col A) + all price columns (B through G)
    var dataRange = sheet.getRange(
      MB.CHART_DATA_START_ROW,        // header row
      MBC.TIME,                        // col A
      lastRow - MB.CHART_DATA_START_ROW + 1,
      MB_CHART_HEADERS.length
    );

    var chart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(dataRange)
      .setOption("title", "SPY Actual vs AI Predictions  ·  " +
                 Utilities.formatDate(new Date(), "America/Chicago", "M/d/yyyy"))
      .setOption("titleTextStyle", {
        fontName: "Trebuchet MS",
        fontSize: 13,
        color:    "#d0d0e8",
        bold:     true
      })
      .setOption("backgroundColor",    "#0a0a12")
      .setOption("chartArea.backgroundColor", "#0a0a12")
      .setOption("legendTextStyle",    { color: "#9090aa", fontName: "Arial", fontSize: 9 })
      .setOption("hAxis.textStyle",    { color: "#7a7a9a", fontName: "Arial", fontSize: 8 })
      .setOption("vAxis.textStyle",    { color: "#7a7a9a", fontName: "Arial", fontSize: 8 })
      .setOption("hAxis.gridlines",    { color: "#1a1a2a", count: 6 })
      .setOption("vAxis.gridlines",    { color: "#1a1a2a" })
      .setOption("hAxis.baselineColor","#2a2a3a")
      .setOption("vAxis.baselineColor","#2a2a3a")
      .setOption("colors", [
        "#4fc3f7",   // Actual SPY — cool blue, solid
        "#ff5252",   // Flush target — red dashed
        "#ffca28",   // Flip zone — gold dashed
        "#69f0ae",   // Rip target — green dashed
        "#ce93d8"    // EOD target — soft purple dashed
      ])
      .setOption("series", {
        0: { lineWidth: 2, lineDashStyle: []          }, // Actual — solid
        1: { lineWidth: 1, lineDashStyle: [4, 4]      }, // Flush — dashed
        2: { lineWidth: 1, lineDashStyle: [4, 4]      }, // Flip — dashed
        3: { lineWidth: 1, lineDashStyle: [4, 4]      }, // Rip — dashed
        4: { lineWidth: 1, lineDashStyle: [2, 6]      }  // EOD — dotted
      })
      .setOption("legend.position", "bottom")
      .setOption("curveType", "none")
      .setOption("pointSize", 0)
      .setOption("lineWidth", 2)
      // Position the chart below the data table
      .setPosition(MB.CHART_DATA_START_ROW + 2, 9, 0, 0)
      .setNumColumns(MB_CHART_HEADERS.length)
      .setNumRows(lastRow - MB.CHART_DATA_START_ROW + 1)
      .build();

    sheet.insertChart(chart);
    Logger.log("MB: Chart built/refreshed.");
  } catch (e) {
    Logger.log("buildOrRefreshChart ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// GRADE EOD ACCURACY
// Fires at 3:00 CST — checks how many predictions were hit,
// writes grade row, refreshes chart with full day data
// ─────────────────────────────────────────────────────────────
function gradeEODAccuracy(sheet, data, cst, todayStr) {
  try {
    var hits        = parseInt(getFlag("MB_HITS")         || "0");
    var total       = parseInt(getFlag("MB_TOTAL_TARGETS")|| "4");
    var setupType   = getFlag("MB_SETUP_TYPE")  || "—";
    var preConf     = getFlag("MB_PRE_CONF")    || "0";
    var flushTarget = parseFloat(getFlag("MB_FLUSH_TARGET")) || 0;
    var ripTarget   = parseFloat(getFlag("MB_RIP_TARGET"))   || 0;
    var eodTarget   = parseFloat(getFlag("MB_EOD_TARGET"))   || 0;
    var rationale   = getFlag("MB_RATIONALE")   || "—";

    var accuracy    = total > 0 ? Math.round((hits / total) * 100) : 0;
    var timeStr     = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();

    // EOD actual vs predicted
    var eodDiff     = eodTarget > 0
      ? ((data.price - eodTarget) / eodTarget) * 100 : 0;
    var eodHit      = Math.abs(eodDiff) <= MB.HIT_TOLERANCE_PCT * 2;

    var grade     = accuracy >= 75 ? "🎯 EXCELLENT"
                  : accuracy >= 50 ? "✅ GOOD"
                  : accuracy >= 25 ? "⚠️ PARTIAL"
                  : "❌ MISSED";
    var gradeBg   = accuracy >= 75 ? "#003e00"
                  : accuracy >= 50 ? "#1a3a00"
                  : accuracy >= 25 ? "#3a2a00"
                  : "#3e0000";

    // Write EOD grade row to chart data section
    var eodRow = [
      timeStr + " EOD",
      data.price,
      flushTarget > 0 ? flushTarget : "",
      "",
      ripTarget   > 0 ? ripTarget   : "",
      eodTarget   > 0 ? eodTarget   : "",
      grade + "  " + hits + "/" + total + " targets hit  (" + accuracy + "%)"
    ];

    sheet.appendRow(eodRow);
    var er = sheet.getLastRow();
    sheet.getRange(er, 1, 1, MB_CHART_HEADERS.length)
      .setBackground(gradeBg)
      .setFontColor("#e0e0ff")
      .setFontFamily(BT_FONT.HEADER)
      .setFontSize(9)
      .setFontWeight("bold");
    sheet.getRange(er, MBC.HIT_FLAG)
      .setFontSize(10)
      .setFontColor("#ffca28");
    sheet.setRowHeight(er, 28);

    // Update EOD target cell color based on accuracy
    sheet.getRange(er, 2)
      .setFontFamily(BT_FONT.MONO)
      .setFontColor(eodHit ? "#69f0ae" : "#ff8a65")
      .setFontWeight("bold");

    // Refresh chart with full day data
    buildOrRefreshChart(sheet);

    // Update Bear Trap summary panel with EOD grade
    updateBearTrapSummaryWithEOD(data, cst, grade, hits, total, accuracy);

    // Reset daily Morning Brief flags
    resetDailyMorningBriefFlags();

    Logger.log("MB: EOD graded — " + grade + " " + hits + "/" + total + " " + accuracy + "%");
  } catch (e) {
    Logger.log("gradeEODAccuracy ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// UPDATE BEAR TRAP SUMMARY WITH EOD RESULT
// ─────────────────────────────────────────────────────────────
function updateBearTrapSummaryWithEOD(data, cst, grade, hits, total, accuracy) {
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var btSheet = ss.getSheetByName(SHEET_BEAR_TRAP);
    if (!btSheet) return;

    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mma").toLowerCase();
    var gradeBg = accuracy >= 75 ? "#003e00"
                : accuracy >= 50 ? "#1a3a00"
                : accuracy >= 25 ? "#3a2a00" : "#3e0000";

    var summRow = new Array(BT_HEADERS.length).fill("");
    summRow[0] = timeStr + " BRIEF EOD";
    summRow[1] = grade;
    summRow[2] = hits + "/" + total + " targets hit  (" + accuracy + "%)";
    summRow[3] = "SPY close: $" + data.price.toFixed(2);

    btSheet.appendRow(summRow);
    var r = btSheet.getLastRow();
    btSheet.getRange(r, 1, 1, BT_HEADERS.length)
      .setBackground(gradeBg)
      .setFontColor("#e0e0ff")
      .setFontFamily(BT_FONT.DATA)
      .setFontSize(9);
    btSheet.getRange(r, 2).setFontWeight("bold").setFontSize(10);
    btSheet.setRowHeight(r, 22);
  } catch (e) {
    Logger.log("updateBearTrapSummaryWithEOD ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FORMAT CHART DATA ROW
// ─────────────────────────────────────────────────────────────
function applyChartDataRowFormat(sheet, rowNum, isHit, price,
                                  flushTarget, ripTarget, eodTarget) {
  try {
    sheet.setRowHeight(rowNum, 22);

    var rowBg = rowNum % 2 === 0 ? "#0d0d1a" : "#0a0a12";
    sheet.getRange(rowNum, 1, 1, MB_CHART_HEADERS.length)
      .setBackground(rowBg)
      .setFontColor("#9090aa")
      .setFontFamily(BT_FONT.DATA)
      .setFontSize(9)
      .setVerticalAlignment("middle");

    // Time
    sheet.getRange(rowNum, MBC.TIME)
      .setFontColor(BT_COLOR.TEXT_DIM)
      .setHorizontalAlignment("center");

    // Actual price — prominent
    sheet.getRange(rowNum, MBC.ACTUAL_PRICE)
      .setFontFamily(BT_FONT.MONO)
      .setFontColor(BT_COLOR.TEXT_PRICE)
      .setFontWeight("bold")
      .setFontSize(10)
      .setNumberFormat("$#,##0.00")
      .setHorizontalAlignment("center");

    // Target columns — smaller, dimmed
    [MBC.FLUSH_TARGET, MBC.FLIP_ZONE, MBC.RIP_TARGET, MBC.EOD_TARGET].forEach(function(col) {
      sheet.getRange(rowNum, col)
        .setFontFamily(BT_FONT.MONO)
        .setFontColor("#555577")
        .setFontSize(8)
        .setNumberFormat("$#,##0.00")
        .setHorizontalAlignment("center");
    });

    // Hit flag — bright if hit
    if (isHit) {
      sheet.getRange(rowNum, MBC.HIT_FLAG)
        .setFontColor(BT_COLOR.TEXT_GREEN)
        .setFontWeight("bold")
        .setFontSize(10)
        .setBackground("#001a08");
    }

  } catch (e) {
    Logger.log("applyChartDataRowFormat ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// RESET DAILY FLAGS
// ─────────────────────────────────────────────────────────────
function resetDailyMorningBriefFlags() {
  var keys = [
    "MB_SETUP_TYPE", "MB_PRE_CONF", "MB_FLUSH_TARGET",
    "MB_FLIP_ZONE",  "MB_RIP_TARGET", "MB_EOD_TARGET",
    "MB_RATIONALE",  "MB_HITS", "MB_TOTAL_TARGETS",
    "MB_CHART_PRED_ROW", "MB_BT_SUMMARY_WRITTEN",
    "MB_HIT_Flush", "MB_HIT_Flip", "MB_HIT_Rip", "MB_HIT_EOD"
  ];
  keys.forEach(function(k) { setFlag(k, ""); });
  Logger.log("Morning Brief daily flags reset.");
}
