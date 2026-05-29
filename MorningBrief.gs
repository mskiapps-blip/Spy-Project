// ============================================================
// FILE: MorningBrief.gs
// PURPOSE: 🌅 MORNING BRIEF — pre-market AI price prediction
//          system. Fires once at 8:25 CST.
//  All times in CST 12-hour format.
// ============================================================

var SHEET_MORNING_BRIEF = "🌅 MORNING BRIEF";

// ─────────────────────────────────────────────────────────────
// TIMING
// ─────────────────────────────────────────────────────────────
var MB = {
  BRIEF_HOUR:        8,
  BRIEF_MIN:         25,
  BRIEF_WINDOW_MIN:  4,
  EOD_HOUR:          15,
  EOD_MIN:           0,
  EOD_WINDOW_MIN:    10,
  HIT_TOLERANCE_PCT: 0.15,
  CHART_DATA_START_ROW: 20,
  SETUP_BEAR_TRAP: "🪤 BEAR TRAP",
  SETUP_BULL:      "📈 BULL DAY",
  SETUP_CHOPPY:    "↔️ CHOPPY",
  SETUP_AVOID:     "⛔ AVOID"
};

// ─────────────────────────────────────────────────────────────
// COLUMNS
// ─────────────────────────────────────────────────────────────
var MBC = {
  TIME:         1,
  ACTUAL_PRICE: 2,
  FLUSH_TARGET: 3,
  FLIP_ZONE:    4,
  RIP_TARGET:   5,
  EOD_TARGET:   6,
  HIT_FLAG:     7
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
// MAIN ENTRY — FIXED
//
// toCSTDate(now) returns a safe helper for .getHours()/.getMinutes() only.
// All Utilities.formatDate calls use `now` (raw UTC Date) directly.
// Downstream functions (generateMorningBrief, trackPriceTick,
// gradeEODAccuracy) all receive `now` instead of `cst`.
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

    // Use raw `now` (UTC Date) for Utilities.formatDate — always correct
    var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");

    // ── 8:25 CST: Fire the morning brief ─────────────────────
    if (totalMin >= briefMin && totalMin <= briefMin + MB.BRIEF_WINDOW_MIN) {
      var briefFired = getFlag("MB_BRIEF_FIRED_TODAY");
      if (briefFired !== todayStr) {
        generateMorningBrief(sheet, data, now, todayStr);
        setFlag("MB_BRIEF_FIRED_TODAY", todayStr);
      }
      return;
    }

    // ── During market hours: track actual price vs predictions ─
    if (totalMin >= openMin && totalMin < closeMin) {
      var briefFired2 = getFlag("MB_BRIEF_FIRED_TODAY");
      if (briefFired2 === todayStr && data) {
        trackPriceTick(sheet, data, now);
      }
      return;
    }

    // ── EOD: grade accuracy ───────────────────────────────────
    if (totalMin >= eodMin && totalMin <= eodMin + MB.EOD_WINDOW_MIN) {
      var eodFired = getFlag("MB_EOD_GRADED_TODAY");
      if (eodFired !== todayStr && data) {
        gradeEODAccuracy(sheet, data, now, todayStr);
        setFlag("MB_EOD_GRADED_TODAY", todayStr);
      }
    }

  } catch (e) {
    Logger.log("runMorningBriefTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// GENERATE MORNING BRIEF — the one daily AI call
// now = raw UTC Date
// ─────────────────────────────────────────────────────────────
function generateMorningBrief(sheet, data, now, todayStr) {
  try {
    Logger.log("MB: Generating morning brief for " + todayStr);

    var vixData = fetchVIX();
    var esData  = fetchESFutures();
    var pmData  = fetchPreMarketData();

    var overnightHigh  = pmData ? pmData.high  : 0;
    var overnightLow   = pmData ? pmData.low   : 0;
    var preMarketClose = pmData ? pmData.close  : 0;

    var prevClose = data.prevClose || 0;
    var gapPct    = prevClose > 0 && preMarketClose > 0
      ? ((preMarketClose - prevClose) / prevClose) * 100 : 0;

    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      Logger.log("MB: No GEMINI_API_KEY — writing placeholder.");
      writeBriefToSheet(sheet, now, todayStr, {
        setupType: MB.SETUP_AVOID, flushTarget: 0, flipZone: 0,
        ripTarget: 0, eodTarget: 0, rationale: "⚙️ Add GEMINI_API_KEY to enable Morning Brief."
      }, 0);
      return;
    }

    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();
    var prompt =
      "SPY Morning Brief at " + timeStr + " CST. " +
      "SPY prev close: $" + (prevClose > 0 ? prevClose.toFixed(2) : "?") + ". " +
      "Pre-mkt: $" + (preMarketClose > 0 ? preMarketClose.toFixed(2) : "?") + " (" +
        (gapPct >= 0 ? "+" : "") + gapPct.toFixed(2) + "% gap). " +
      "Overnight: H $" + (overnightHigh > 0 ? overnightHigh.toFixed(2) : "?") +
        " L $" + (overnightLow > 0 ? overnightLow.toFixed(2) : "?") + ". " +
      "VIX: " + (vixData ? vixData.price.toFixed(2) + " [" + vixData.regime + "]" : "?") + ". " +
      "ES: " + (esData ? "$" + esData.price.toFixed(2) + " " + esData.trend : "?") + ". " +
      "Respond ONLY as JSON (no markdown): " +
      '{"setupType":"🪤 BEAR TRAP or 📈 BULL DAY or ↔️ CHOPPY or ⛔ AVOID",' +
      '"flushTarget":0.00,"flipZone":0.00,"ripTarget":0.00,"eodTarget":0.00,' +
      '"rationale":"1-2 sentences","preMarketConf":50}';

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 250, temperature: 0.3 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("MB Gemini error: " + resp.getResponseCode());
      return;
    }

    var json    = JSON.parse(resp.getContentText());
    var rawText = json.candidates
               && json.candidates[0]
               && json.candidates[0].content
               && json.candidates[0].content.parts
               && json.candidates[0].content.parts[0]
                ? json.candidates[0].content.parts[0].text.trim() : "";

    var pred;
    try {
      var clean = rawText.replace(/```json|```/g, "").trim();
      pred = JSON.parse(clean);
    } catch (e) {
      Logger.log("MB: JSON parse failed — " + e.message + " raw: " + rawText);
      pred = {
        setupType: MB.SETUP_CHOPPY, flushTarget: 0, flipZone: 0,
        ripTarget: 0, eodTarget: 0, rationale: rawText.substring(0, 120),
        preMarketConf: 40
      };
    }

    var preConf = pred.preMarketConf || 50;
    setFlag("MB_SETUP_TYPE",   pred.setupType   || MB.SETUP_CHOPPY);
    setFlag("MB_FLUSH_TARGET", (pred.flushTarget || 0).toString());
    setFlag("MB_FLIP_ZONE",    (pred.flipZone    || 0).toString());
    setFlag("MB_RIP_TARGET",   (pred.ripTarget   || 0).toString());
    setFlag("MB_EOD_TARGET",   (pred.eodTarget   || 0).toString());
    setFlag("MB_RATIONALE",    pred.rationale    || "");
    setFlag("MB_HITS",         "0");
    setFlag("MB_TOTAL_TARGETS", "4");

    writeBriefToSheet(sheet, now, todayStr, pred, preConf);
    writeBriefSummaryToBearTrap(data, now, pred, preConf);
    buildOrRefreshChart(sheet);

    Logger.log("MB: Brief generated — " + pred.setupType);
  } catch (e) {
    Logger.log("generateMorningBrief ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// WRITE BRIEF TO SHEET
// now = raw UTC Date
// ─────────────────────────────────────────────────────────────
function writeBriefToSheet(sheet, now, todayStr, pred, preConf) {
  try {
    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();

    // Clear any existing content rows 5–18
    if (sheet.getLastRow() >= 5) {
      sheet.getRange(5, 1, Math.max(1, Math.min(14, sheet.getLastRow() - 4)), 10).clearContent();
    }

    var setupBg = pred.setupType === MB.SETUP_BEAR_TRAP ? "#3e0000"
                : pred.setupType === MB.SETUP_BULL      ? "#003e00"
                : pred.setupType === MB.SETUP_AVOID     ? "#1a0a00"
                : "#1a1a2a";
    var setupFg = pred.setupType === MB.SETUP_BEAR_TRAP ? "#ff6b6b"
                : pred.setupType === MB.SETUP_BULL      ? "#69f0ae"
                : pred.setupType === MB.SETUP_AVOID     ? "#ff9944"
                : "#aaaacc";

    // Row 5: header
    sheet.getRange(5, 1, 1, 7).merge()
      .setValue("🌅 MORNING BRIEF  ·  " + todayStr + "  ·  Generated at " + timeStr + " CST")
      .setBackground("#0f0800").setFontColor("#ff9800")
      .setFontWeight("bold").setFontSize(11)
      .setHorizontalAlignment("center");
    sheet.setRowHeight(5, 28);

    // Row 6: setup type
    sheet.getRange(6, 1, 1, 4).merge()
      .setValue(pred.setupType)
      .setBackground(setupBg).setFontColor(setupFg)
      .setFontWeight("bold").setFontSize(16)
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    sheet.getRange(6, 5, 1, 3).merge()
      .setValue("Pre-mkt confidence: " + preConf + "%")
      .setBackground(setupBg).setFontColor("#888888")
      .setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle");
    sheet.setRowHeight(6, 40);

    // Row 7: rationale
    sheet.getRange(7, 1, 1, 7).merge()
      .setValue(pred.rationale || "")
      .setBackground("#0a0a18").setFontColor("#aaaacc")
      .setFontSize(10).setWrap(true)
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(7, 40);

    // Row 8: targets header
    sheet.getRange(8, 1, 1, 7).merge()
      .setValue("📊 PRICE TARGETS")
      .setBackground("#111120").setFontColor("#555577")
      .setFontSize(9).setHorizontalAlignment("center");
    sheet.setRowHeight(8, 20);

    var targets = [
      ["📉 FLUSH TARGET", pred.flushTarget],
      ["⚡ FLIP ZONE",    pred.flipZone],
      ["🚀 RIP TARGET",   pred.ripTarget],
      ["🎯 EOD TARGET",   pred.eodTarget]
    ];
    targets.forEach(function(t, i) {
      var rowNum = 9 + i;
      sheet.getRange(rowNum, 1, 1, 3).merge()
        .setValue(t[0])
        .setBackground("#0d0d1a").setFontColor("#7070aa")
        .setFontSize(10).setHorizontalAlignment("right").setVerticalAlignment("middle");
      sheet.getRange(rowNum, 4, 1, 4).merge()
        .setValue(t[1] > 0 ? "$" + t[1].toFixed(2) : "—")
        .setBackground("#0d0d1a").setFontColor(t[1] > 0 ? "#00e5ff" : "#333355")
        .setFontFamily("Roboto Mono").setFontSize(14).setFontWeight("bold")
        .setHorizontalAlignment("left").setVerticalAlignment("middle");
      sheet.setRowHeight(rowNum, 28);
    });

    // Row 13: divider
    sheet.getRange(13, 1, 1, 7).merge().setValue("").setBackground("#222230");
    sheet.setRowHeight(13, 4);

    // Row 14–19: chart data header section
    sheet.getRange(14, 1, 1, 7).merge()
      .setValue("📈 INTRADAY TRACKING — actual price vs targets (auto-updated every 5 min)")
      .setBackground("#080810").setFontColor("#444466")
      .setFontSize(8).setHorizontalAlignment("center");
    sheet.setRowHeight(14, 18);

    // Chart headers row (row 19 = MB.CHART_DATA_START_ROW - 1)
    var hdrRow = MB.CHART_DATA_START_ROW - 1;
    sheet.getRange(hdrRow, 1, 1, MB_CHART_HEADERS.length)
      .setValues([MB_CHART_HEADERS])
      .setBackground("#0d0d2b").setFontColor("#00e5ff")
      .setFontWeight("bold").setFontSize(9)
      .setHorizontalAlignment("center");
    sheet.setRowHeight(hdrRow, 24);

    Logger.log("MB: Brief written to sheet.");
  } catch (e) {
    Logger.log("writeBriefToSheet ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// WRITE SUMMARY PANEL TO BEAR TRAP SHEET
// now = raw UTC Date
// ─────────────────────────────────────────────────────────────
function writeBriefSummaryToBearTrap(data, now, pred, preConf) {
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var btSheet = ss.getSheetByName(SHEET_BEAR_TRAP);
    if (!btSheet) return;

    var timeStr  = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();
    var todayStr = Utilities.formatDate(now, "America/Chicago", "yyyy-MM-dd");
    var lastSumm = getFlag("MB_BT_SUMMARY_WRITTEN");
    if (lastSumm === todayStr) return;

    var setupBg = pred.setupType === MB.SETUP_BEAR_TRAP ? "#3e0000"
                : pred.setupType === MB.SETUP_BULL      ? "#003e00"
                : pred.setupType === MB.SETUP_AVOID     ? "#1a0a00"
                : "#1a1a2a";
    var setupFg = pred.setupType === MB.SETUP_BEAR_TRAP ? "#ff6b6b"
                : pred.setupType === MB.SETUP_BULL      ? "#69f0ae"
                : pred.setupType === MB.SETUP_AVOID     ? "#ff9944"
                : "#aaaacc";

    var summRow1 = new Array(BT_HEADERS.length).fill("");
    summRow1[0] = timeStr + " BRIEF";
    summRow1[1] = pred.setupType;
    summRow1[2] = "Pre-mkt conf: " + preConf + "%";
    summRow1[3] = pred.rationale;

    var targStr =
      (pred.flushTarget > 0 ? "Flush: $" + pred.flushTarget.toFixed(2) + "  " : "") +
      (pred.flipZone    > 0 ? "Flip: $"  + pred.flipZone.toFixed(2)    + "  " : "") +
      (pred.ripTarget   > 0 ? "Rip: $"   + pred.ripTarget.toFixed(2)   + "  " : "") +
      (pred.eodTarget   > 0 ? "EOD: $"   + pred.eodTarget.toFixed(2)          : "");

    var summRow2 = new Array(BT_HEADERS.length).fill("");
    summRow2[0] = "TARGETS";
    summRow2[1] = targStr || "No targets generated";

    btSheet.appendRow(summRow1);
    var r1 = btSheet.getLastRow();
    btSheet.getRange(r1, 1, 1, BT_HEADERS.length)
      .setBackground(setupBg).setFontColor(setupFg)
      .setFontFamily(BT_FONT.DATA).setFontSize(9).setWrap(true);
    btSheet.getRange(r1, 2).setFontWeight("bold").setFontSize(11);
    btSheet.setRowHeight(r1, 30);

    btSheet.appendRow(summRow2);
    var r2 = btSheet.getLastRow();
    btSheet.getRange(r2, 1, 1, BT_HEADERS.length)
      .setBackground("#0d0d1a").setFontColor("#7070aa")
      .setFontFamily(BT_FONT.MONO).setFontSize(9);
    btSheet.setRowHeight(r2, 22);

    setFlag("MB_BT_SUMMARY_WRITTEN", todayStr);
    Logger.log("MB: Summary panel written to Bear Trap sheet.");
  } catch (e) {
    Logger.log("writeBriefSummaryToBearTrap ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// TRACK PRICE TICK
// now = raw UTC Date
// ─────────────────────────────────────────────────────────────
function trackPriceTick(sheet, data, now) {
  try {
    var price       = data.price;
    var flushTarget = parseFloat(getFlag("MB_FLUSH_TARGET")) || 0;
    var flipZone    = parseFloat(getFlag("MB_FLIP_ZONE"))    || 0;
    var ripTarget   = parseFloat(getFlag("MB_RIP_TARGET"))   || 0;
    var eodTarget   = parseFloat(getFlag("MB_EOD_TARGET"))   || 0;
    var hitCount    = parseInt(getFlag("MB_HITS") || "0");

    var hitThis  = false;
    var hitLabel = "";
    var targets  = [
      { price: flushTarget, label: "📉 Flush" },
      { price: flipZone,    label: "⚡ Flip"  },
      { price: ripTarget,   label: "🚀 Rip"   },
      { price: eodTarget,   label: "🎯 EOD"   }
    ];

    targets.forEach(function(t) {
      if (t.price <= 0) return;
      var diff = Math.abs((price - t.price) / t.price) * 100;
      if (diff <= MB.HIT_TOLERANCE_PCT) {
        var hitKey = "MB_HIT_" + t.label.replace(/[^a-zA-Z]/g, "");
        if (getFlag(hitKey) !== "YES") {
          hitThis = true;
          hitLabel += t.label + " ";
          setFlag(hitKey, "YES");
          hitCount++;
        }
      }
    });

    if (hitThis) setFlag("MB_HITS", hitCount.toString());

    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();
    var row = [
      timeStr, price,
      flushTarget > 0 ? flushTarget : "",
      flipZone    > 0 ? flipZone    : "",
      ripTarget   > 0 ? ripTarget   : "",
      eodTarget   > 0 ? eodTarget   : "",
      hitThis ? "✅ " + hitLabel.trim() : ""
    ];

    sheet.appendRow(row);
    var newRow = sheet.getLastRow();
    applyChartDataRowFormat(sheet, newRow, hitThis, price, flushTarget, ripTarget, eodTarget);
    Logger.log("MB: tick logged price=" + price + " hits=" + hitCount);
  } catch (e) {
    Logger.log("trackPriceTick ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// GRADE EOD ACCURACY
// now = raw UTC Date
// ─────────────────────────────────────────────────────────────
function gradeEODAccuracy(sheet, data, now, todayStr) {
  try {
    var hits  = parseInt(getFlag("MB_HITS")          || "0");
    var total = parseInt(getFlag("MB_TOTAL_TARGETS") || "4");
    if (total === 0) total = 4;
    var accuracy = Math.round((hits / total) * 100);

    var grade = accuracy >= 75 ? "🏆 EXCELLENT (" + accuracy + "%)"
              : accuracy >= 50 ? "✅ GOOD ("       + accuracy + "%)"
              : accuracy >= 25 ? "⚠️ FAIR ("       + accuracy + "%)"
              : "❌ POOR ("                         + accuracy + "%)";

    var summRow = MB.CHART_DATA_START_ROW - 2;
    if (sheet.getLastRow() >= summRow) {
      var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();
      sheet.getRange(summRow, 1, 1, 7).merge()
        .setValue("EOD GRADE  ·  " + grade + "  ·  " + hits + "/" + total + " targets hit  ·  " + timeStr + " CST")
        .setBackground(accuracy >= 50 ? "#003e00" : "#3e0000")
        .setFontColor(accuracy >= 50 ? "#69f0ae"  : "#ff6b6b")
        .setFontWeight("bold").setFontSize(10)
        .setHorizontalAlignment("center");
    }

    buildOrRefreshChart(sheet);
    updateBearTrapSummaryWithEOD(data, now, grade, hits, total, accuracy);
    resetDailyMorningBriefFlags();
    Logger.log("MB: EOD graded — " + grade + " " + hits + "/" + total + " " + accuracy + "%");
  } catch (e) {
    Logger.log("gradeEODAccuracy ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// UPDATE BEAR TRAP SUMMARY WITH EOD RESULT
// now = raw UTC Date
// ─────────────────────────────────────────────────────────────
function updateBearTrapSummaryWithEOD(data, now, grade, hits, total, accuracy) {
  try {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var btSheet = ss.getSheetByName(SHEET_BEAR_TRAP);
    if (!btSheet) return;

    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mma").toLowerCase();
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
      .setBackground(gradeBg).setFontColor("#e0e0ff")
      .setFontFamily(BT_FONT.DATA).setFontSize(9);
    btSheet.getRange(r, 2).setFontWeight("bold").setFontSize(10);
    btSheet.setRowHeight(r, 22);
  } catch (e) {
    Logger.log("updateBearTrapSummaryWithEOD ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD OR REFRESH CHART
// ─────────────────────────────────────────────────────────────
function buildOrRefreshChart(sheet) {
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < MB.CHART_DATA_START_ROW) return;

    var charts = sheet.getCharts();
    charts.forEach(function(c) { sheet.removeChart(c); });

    var dataRange = sheet.getRange(MB.CHART_DATA_START_ROW - 1, 1, lastRow - MB.CHART_DATA_START_ROW + 2, 6);

    var chart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(dataRange)
      .setPosition(15, 1, 0, 0)
      .setOption("title", "SPY Actual vs Morning Brief Targets")
      .setOption("width", 900)
      .setOption("height", 300)
      .setOption("series", {
        0: { color: "#00e5ff", lineWidth: 3, labelInLegend: "Actual SPY" },
        1: { color: "#ff5252", lineWidth: 1, lineDashStyle: [4, 4], labelInLegend: "Flush" },
        2: { color: "#ffd740", lineWidth: 1, lineDashStyle: [4, 4], labelInLegend: "Flip" },
        3: { color: "#00e676", lineWidth: 1, lineDashStyle: [4, 4], labelInLegend: "Rip" },
        4: { color: "#e040fb", lineWidth: 1, lineDashStyle: [4, 4], labelInLegend: "EOD" }
      })
      .setOption("backgroundColor", "#0d0d2b")
      .setOption("titleTextStyle", { color: "#00e5ff" })
      .setOption("hAxis", { textStyle: { color: "#7070aa" } })
      .setOption("vAxis", { textStyle: { color: "#7070aa" } })
      .setOption("legend", { textStyle: { color: "#aaaacc" } })
      .build();

    sheet.insertChart(chart);
    Logger.log("MB: Chart built/refreshed.");
  } catch (e) {
    Logger.log("buildOrRefreshChart ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// FORMAT CHART DATA ROW
// ─────────────────────────────────────────────────────────────
function applyChartDataRowFormat(sheet, rowNum, isHit, price, flushTarget, ripTarget, eodTarget) {
  try {
    sheet.setRowHeight(rowNum, 22);
    var rowBg = rowNum % 2 === 0 ? "#0d0d1a" : "#0a0a12";
    sheet.getRange(rowNum, 1, 1, MB_CHART_HEADERS.length)
      .setBackground(rowBg).setFontColor("#9090aa")
      .setFontFamily(BT_FONT.DATA).setFontSize(9).setVerticalAlignment("middle");
    sheet.getRange(rowNum, MBC.TIME).setFontColor(BT_COLOR.TEXT_DIM).setHorizontalAlignment("center");
    sheet.getRange(rowNum, MBC.ACTUAL_PRICE).setFontFamily(BT_FONT.MONO).setFontColor(BT_COLOR.TEXT_PRICE).setFontWeight("bold").setFontSize(10).setNumberFormat("$#,##0.00").setHorizontalAlignment("center");
    [MBC.FLUSH_TARGET, MBC.FLIP_ZONE, MBC.RIP_TARGET, MBC.EOD_TARGET].forEach(function(col) {
      sheet.getRange(rowNum, col).setFontFamily(BT_FONT.MONO).setFontColor("#555577").setFontSize(8).setNumberFormat("$#,##0.00").setHorizontalAlignment("center");
    });
    if (isHit) {
      sheet.getRange(rowNum, MBC.HIT_FLAG).setFontColor(BT_COLOR.TEXT_GREEN).setFontWeight("bold").setFontSize(10).setBackground("#001a08");
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

// ─────────────────────────────────────────────────────────────
// SETUP SHEET
// ─────────────────────────────────────────────────────────────
function setupMorningBriefSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_MORNING_BRIEF);
  if (!sheet) sheet = ss.insertSheet(SHEET_MORNING_BRIEF);
  sheet.setTabColor("#e65100");

  if (sheet.getLastRow() > 0) {
    Logger.log("Morning Brief sheet already exists.");
    return sheet;
  }

  var totalCols = MB_CHART_HEADERS.length + 8;
  sheet.appendRow(["🌅  Morning Brief  ·  AI Price Predictions  ·  Fires at 8:25 CST"]);
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setBackground("#0f0800").setFontColor("#ff9800")
    .setFontWeight("bold").setFontSize(15).setFontFamily(BT_FONT.BANNER)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 42);

  sheet.appendRow(["Gemini analyzes overnight highs, VIX, ES futures, and gap context to predict the day's key SPY price levels. Updated once at 8:25 CST. Targets marked ✅ when SPY comes within 0.15%."]);
  sheet.getRange(2, 1, 1, totalCols).merge()
    .setBackground("#130800").setFontColor("#cc6600")
    .setFontSize(9).setFontStyle("italic")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(2, 22);

  sheet.appendRow([""]);
  sheet.getRange(3, 1, 1, totalCols).merge().setBackground("#0a0a18");
  sheet.setRowHeight(3, 4);

  sheet.appendRow([""]);
  sheet.getRange(4, 1, 1, totalCols).merge().setBackground("#0a0a18");
  sheet.setRowHeight(4, 20);

  sheet.setFrozenRows(2);
  Logger.log("Morning Brief sheet setup complete.");
  return sheet;
}

function setupMorningBriefSheetFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupMorningBriefSheet(ss);
  SpreadsheetApp.getUi().alert("✅ Morning Brief sheet created!\n\nWill populate at 8:25 CST on next market day.");
}
