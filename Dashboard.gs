// ============================================================
// FILE: Dashboard.gs
// PURPOSE: 🖥️ MISSION CONTROL — Card-grid dashboard.
//
//  All times CST 12-hour format.
// ============================================================

var SHEET_DASHBOARD = "🖥️ DASHBOARD";

// ─────────────────────────────────────────────────────────────
// PALETTE
// ─────────────────────────────────────────────────────────────
var DB = {
  BG_SHEET:     "#0e0e1a",
  BG_BANNER:    "#070712",
  TXT_BANNER:   "#00e5ff",
  TXT_SUB:      "#2a2a55",
  BG_CARD:      "#13132a",
  BG_GAP:       "#0e0e1a",
  BG_DIVIDER:   "#1a1a35",
  HDR_SPY:      "#001e3c",
  HDR_MKT:      "#002918",
  HDR_AI:       "#1a0a30",
  HDR_ES:       "#2a1800",
  HDR_BRIEF:    "#1e0a00",
  TXT_HDR_SPY:  "#29b6f6",
  TXT_HDR_MKT:  "#4caf50",
  TXT_HDR_AI:   "#ab47bc",
  TXT_HDR_ES:   "#ffa726",
  TXT_HDR_BRIEF:"#ff7043",
  ACC_SPY:      "#0077bb",
  ACC_MKT:      "#005533",
  ACC_AI:       "#5500aa",
  ACC_ES:       "#aa6600",
  ACC_BRIEF:    "#cc3300",
  TXT_PRIMARY:  "#e8eaf6",
  TXT_SECONDARY:"#7986cb",
  TXT_DIM:      "#3d3d6b",
  TXT_CYAN:     "#00e5ff",
  TXT_GREEN:    "#00e676",
  TXT_RED:      "#ff5252",
  TXT_GOLD:     "#ffd740",
  TXT_ORANGE:   "#ff9100",
  TXT_PURPLE:   "#e040fb",
  TXT_SILVER:   "#90a4ae",
  BG_TERM:      "#080810",
  TXT_TERM:     "#ffe082"
};

// ─────────────────────────────────────────────────────────────
// COLUMN MAP
// ─────────────────────────────────────────────────────────────
var DC = {
  GAP_L:   1,
  CARD_L:  2,
  GAP_M:   3,
  CARD_R:  4,
  GAP_R:   5,
  WIDE:    6,
  GAP_END: 7
};

// ─────────────────────────────────────────────────────────────
// ROW MAP
// ─────────────────────────────────────────────────────────────
var DR = {
  BANNER:      1,
  SUBTITLE:    2,
  GAP_1:       3,
  SPY_HDR:     4,
  SPY_BIG:     5,
  SPY_CHANGE:  6,
  SPY_DIV:     7,
  SPY_PREV:    8,
  SPY_TIME:    9,
  SPY_PAD:     10,
  GAP_2:       11,
  AI_HDR:      12,
  AI_MODE:     13,
  AI_WATCH:    14,
  AI_DIV:      15,
  AI_NEXT:     16,
  AI_PAD:      17,
  GAP_3:       18,
  ES_HDR:      19,
  ES_PRICE:    20,
  ES_ALIGN:    21,
  ES_DIV:      22,
  ES_SIGNAL:   23,
  ES_ACTION:   24,
  ES_PAD:      25,
  GAP_4:       26,
  BR_HDR:      27,
  BR_META:     28,
  BR_TEXT:     29,
  BR_PAD:      37,
  GAP_5:       38
};

// ─────────────────────────────────────────────────────────────
// BRIEFING INTERVALS (minutes)
// ─────────────────────────────────────────────────────────────
var BRIEF_INTERVALS = {
  OVERNIGHT:        240,
  PRE_MARKET_EARLY:  30,
  PRE_MARKET_HOT:    15,
  MARKET_OPEN:       15,
  INTRADAY:          30,
  WIND_DOWN:        240
};

var ES_ALIGN = {
  VOID_DROP_PCT:    1.0,
  CAUTION_RISE_PCT: 0.5,
  MONITOR_PCT:      0.5
};

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY — FIXED
//
// toCSTDate(now) returns a plain helper object used ONLY for
// .getHours() / .getMinutes() / .getDay() logic.
//
// All Utilities.formatDate calls use `now` (raw UTC Date) directly
// because Utilities.formatDate handles timezone conversion correctly.
// Card writers (writeSPYCard, writeBriefCard, etc.) now receive
// `now` instead of `cst` so their internal formatDate calls work.
// ─────────────────────────────────────────────────────────────
function runDashboardTick(data, now) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_DASHBOARD);
    if (!sheet) {
      setupDashboardSheet(ss);
      sheet = ss.getSheetByName(SHEET_DASHBOARD);
    }

    var cst     = toCSTDate(now);
    var cstHour = cst.getHours();
    var cstMin  = cst.getMinutes();
    var cstMins = cstHour * 60 + cstMin;
    var dow     = cst.getDay();

    var esData  = fetchESFutures();
    var vixData = fetchVIX();

    var shouldBrief = shouldFireDashboardBrief(cstMins, dow);

    // Pass `now` (raw UTC Date) — not `cst` — to all card writers
    writeSPYCard(sheet, data, now);
    writeMarketCard(sheet, cstMins, dow);
    writeAICard(sheet, cstMins, dow);
    writeESCard(sheet, esData);
    writeBriefCard(sheet, data, esData, vixData, now, cstMins, dow, shouldBrief);

    // Subtitle — Utilities.formatDate works correctly on raw UTC Date
    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();
    var dateStr = Utilities.formatDate(now, "America/Chicago", "EEE MMM d, yyyy");
    sheet.getRange(DR.SUBTITLE, 1, 1, 7).merge()
      .setValue("refreshed  " + timeStr + " cst  ·  " + dateStr)
      .setFontColor(DB.TXT_DIM).setFontSize(8)
      .setHorizontalAlignment("center").setBackground(DB.BG_BANNER);

    Logger.log("Dashboard tick complete " + timeStr);
  } catch (e) {
    Logger.log("runDashboardTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// CARD HELPERS
// ─────────────────────────────────────────────────────────────
function writeCardHeader(sheet, row, col, label, bgColor, txtColor, isWide) {
  var span = isWide ? 5 : 1;
  if (isWide) {
    sheet.getRange(row, DC.CARD_L, 1, 5).merge()
      .setValue(label).setBackground(bgColor).setFontColor(txtColor)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
  } else {
    sheet.getRange(row, col).setValue(label)
      .setBackground(bgColor).setFontColor(txtColor)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
  }
  sheet.setRowHeight(row, 28);
}

function writeCardField(sheet, row, col, labelTxt, valueTxt, valueFg, valueSz, isMerged) {
  sheet.getRange(row, col).setValue(valueTxt)
    .setFontColor(valueFg || DB.TXT_PRIMARY)
    .setFontSize(valueSz || 12)
    .setFontWeight("bold")
    .setVerticalAlignment("bottom")
    .setHorizontalAlignment("left")
    .setBackground(DB.BG_CARD);
}

// ─────────────────────────────────────────────────────────────
// CARD 1 — SPY PRICE
// now = raw UTC Date for Utilities.formatDate
// ─────────────────────────────────────────────────────────────
function writeSPYCard(sheet, data, now) {
  try {
    var price     = data ? (data.price     || 0) : 0;
    var prevClose = data ? (data.prevClose || price) : 0;
    var change    = price - prevClose;
    var changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    var isUp      = change >= 0;
    var priceFg   = isUp ? DB.TXT_GREEN : DB.TXT_RED;
    var arrow     = isUp ? "▲" : "▼";
    var sign      = isUp ? "+" : "";
    var col       = DC.CARD_L;

    sheet.getRange(DR.SPY_HDR, col).setValue("  💰  SPY — LAST PRICE")
      .setBackground(DB.HDR_SPY).setFontColor(DB.TXT_HDR_SPY)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_HDR, 28);

    sheet.getRange(DR.SPY_BIG, col)
      .setValue(price > 0 ? "$" + price.toFixed(2) : "—")
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_CYAN)
      .setFontSize(26).setFontWeight("bold").setFontFamily("Roboto Mono")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_BIG, 44);

    var changeStr = price > 0
      ? arrow + "  " + sign + change.toFixed(2) + "   (" + sign + changePct.toFixed(2) + "%)"
      : "—";
    sheet.getRange(DR.SPY_CHANGE, col).setValue(changeStr)
      .setBackground(DB.BG_CARD).setFontColor(priceFg)
      .setFontSize(14).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_CHANGE, 30);

    sheet.getRange(DR.SPY_DIV, col).setValue("").setBackground(DB.BG_DIVIDER);
    sheet.setRowHeight(DR.SPY_DIV, 2);

    sheet.getRange(DR.SPY_PREV, col)
      .setValue(prevClose > 0 ? "prev close  $" + prevClose.toFixed(2) : "—")
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_PREV, 22);

    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();
    sheet.getRange(DR.SPY_TIME, col)
      .setValue("as of  " + timeStr + " cst")
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_DIM)
      .setFontSize(8).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_TIME, 18);

    sheet.getRange(DR.SPY_PAD, col).setValue("").setBackground(DB.BG_CARD);
    sheet.setRowHeight(DR.SPY_PAD, 10);

  } catch (e) { Logger.log("writeSPYCard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 2 — MARKET STATUS
// ─────────────────────────────────────────────────────────────
function writeMarketCard(sheet, cstMins, dow) {
  try {
    var s   = getMarketStatus(cstMins, dow);
    var col = DC.CARD_R;

    sheet.getRange(DR.SPY_HDR, col).setValue("  🏛️  MARKET STATUS")
      .setBackground(DB.HDR_MKT).setFontColor(DB.TXT_HDR_MKT)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    sheet.getRange(DR.SPY_BIG, col).setValue(s.label)
      .setBackground(DB.BG_CARD).setFontColor(s.color)
      .setFontSize(16).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    sheet.getRange(DR.SPY_CHANGE, col).setValue(s.session)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(11).setHorizontalAlignment("left").setVerticalAlignment("middle");

    sheet.getRange(DR.SPY_DIV, col).setValue("").setBackground(DB.BG_DIVIDER);

    sheet.getRange(DR.SPY_PREV, col).setValue(s.countdown)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setHorizontalAlignment("left").setVerticalAlignment("middle");

    sheet.getRange(DR.SPY_TIME, col).setValue(s.next)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_DIM)
      .setFontSize(8).setHorizontalAlignment("left").setVerticalAlignment("middle");

    sheet.getRange(DR.SPY_PAD, col).setValue("").setBackground(DB.BG_CARD);

    for (var r = DR.SPY_HDR; r <= DR.SPY_PAD; r++) {
      sheet.getRange(r, DC.GAP_L).setBackground(DB.BG_GAP);
      sheet.getRange(r, DC.GAP_M).setBackground(DB.BG_GAP);
      sheet.getRange(r, DC.GAP_R).setBackground(DB.BG_GAP);
      if (sheet.getMaxColumns() >= DC.GAP_END) sheet.getRange(r, DC.GAP_END).setBackground(DB.BG_GAP);
    }
  } catch (e) { Logger.log("writeMarketCard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 3 — AI STATUS
// ─────────────────────────────────────────────────────────────
function writeAICard(sheet, cstMins, dow) {
  try {
    var s   = getAIStatus(cstMins, dow);
    var col = DC.CARD_L;

    sheet.getRange(DR.AI_HDR, col).setValue("  🧠  AI STATUS")
      .setBackground(DB.HDR_AI).setFontColor(DB.TXT_HDR_AI)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.AI_HDR, 28);

    sheet.getRange(DR.AI_MODE, col).setValue(s.mode)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_PURPLE)
      .setFontSize(13).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.AI_MODE, 30);

    sheet.getRange(DR.AI_WATCH, col).setValue(s.waiting)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.AI_WATCH, 22);

    sheet.getRange(DR.AI_DIV, col).setValue("").setBackground(DB.BG_DIVIDER);
    sheet.setRowHeight(DR.AI_DIV, 2);

    sheet.getRange(DR.AI_NEXT, col).setValue(s.nextBrief)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_DIM)
      .setFontSize(8).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.AI_NEXT, 18);

    sheet.getRange(DR.AI_PAD, col).setValue("").setBackground(DB.BG_CARD);
    sheet.setRowHeight(DR.AI_PAD, 10);
  } catch (e) { Logger.log("writeAICard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 4 — ES FUTURES
// ─────────────────────────────────────────────────────────────
function writeESCard(sheet, esData) {
  try {
    var col = DC.CARD_R;

    sheet.getRange(DR.ES_HDR, col).setValue("  📡  ES FUTURES")
      .setBackground(DB.HDR_ES).setFontColor(DB.TXT_HDR_ES)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.ES_HDR, 28);

    if (!esData) {
      sheet.getRange(DR.ES_PRICE, col).setValue("—").setBackground(DB.BG_CARD).setFontColor(DB.TXT_DIM).setFontSize(20).setFontWeight("bold").setHorizontalAlignment("left").setVerticalAlignment("middle");
      sheet.setRowHeight(DR.ES_PRICE, 44);
      sheet.getRange(DR.ES_ALIGN, col).setValue("No ES data").setBackground(DB.BG_CARD).setFontColor(DB.TXT_DIM).setFontSize(10).setHorizontalAlignment("left").setVerticalAlignment("middle");
      sheet.setRowHeight(DR.ES_ALIGN, 24);
      sheet.getRange(DR.ES_DIV,    col).setValue("").setBackground(DB.BG_DIVIDER); sheet.setRowHeight(DR.ES_DIV, 2);
      sheet.getRange(DR.ES_SIGNAL, col).setValue("").setBackground(DB.BG_CARD).setFontSize(9).setFontColor(DB.TXT_DIM).setHorizontalAlignment("left").setVerticalAlignment("middle"); sheet.setRowHeight(DR.ES_SIGNAL, 22);
      sheet.getRange(DR.ES_ACTION, col).setValue("").setBackground(DB.BG_CARD).setFontSize(8).setFontColor(DB.TXT_DIM).setHorizontalAlignment("left").setVerticalAlignment("middle"); sheet.setRowHeight(DR.ES_ACTION, 18);
      sheet.getRange(DR.ES_PAD,    col).setValue("").setBackground(DB.BG_CARD); sheet.setRowHeight(DR.ES_PAD, 10);
      return;
    }

    var trendColor = esData.trend === "FADING"   ? DB.TXT_RED
                   : esData.trend === "CLIMBING" ? DB.TXT_GREEN : DB.TXT_GOLD;
    var alignTag   = esData.alignmentTag || "ES MONITOR";
    var alignColor = alignTag === "ES VOID"    ? DB.TXT_RED
                   : alignTag === "ES CAUTION" ? DB.TXT_ORANGE : DB.TXT_GOLD;
    var alignAction = alignTag === "ES VOID"    ? "❌ DO NOT TRADE — Futures voiding setup"
                    : alignTag === "ES CAUTION" ? "⚠️ Caution — Futures rising against trap"
                    : "👁️ Monitor — Futures neutral";

    sheet.getRange(DR.ES_PRICE, col).setValue("$" + esData.price.toFixed(2))
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_CYAN)
      .setFontSize(20).setFontWeight("bold").setFontFamily("Roboto Mono")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.ES_PRICE, 44);

    sheet.getRange(DR.ES_ALIGN, col).setValue(esData.trend + "  ·  " + esData.change.toFixed(2) + " pts")
      .setBackground(DB.BG_CARD).setFontColor(trendColor)
      .setFontSize(13).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.ES_ALIGN, 24);

    sheet.getRange(DR.ES_DIV, col).setValue("").setBackground(DB.BG_DIVIDER);
    sheet.setRowHeight(DR.ES_DIV, 2);

    sheet.getRange(DR.ES_SIGNAL, col).setValue(alignTag)
      .setBackground(DB.BG_CARD).setFontColor(alignColor)
      .setFontSize(11).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.ES_SIGNAL, 22);

    sheet.getRange(DR.ES_ACTION, col).setValue(alignAction)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_DIM)
      .setFontSize(8).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.ES_ACTION, 18);

    sheet.getRange(DR.ES_PAD, col).setValue("").setBackground(DB.BG_CARD);
    sheet.setRowHeight(DR.ES_PAD, 10);

    for (var r2 = DR.ES_HDR; r2 <= DR.ES_PAD; r2++) {
      sheet.getRange(r2, DC.GAP_L).setBackground(DB.BG_GAP);
      sheet.getRange(r2, DC.GAP_M).setBackground(DB.BG_GAP);
      sheet.getRange(r2, DC.GAP_R).setBackground(DB.BG_GAP);
      if (sheet.getMaxColumns() >= DC.GAP_END) sheet.getRange(r2, DC.GAP_END).setBackground(DB.BG_GAP);
    }
  } catch (e) { Logger.log("writeESCard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 5 — AI BRIEFING (full width)
// now = raw UTC Date for Utilities.formatDate
// ─────────────────────────────────────────────────────────────
function writeBriefCard(sheet, data, esData, vixData, now, cstMins, dow, shouldBrief) {
  try {
    var lastBriefMins = parseInt(getFlag("DASHBOARD_LAST_BRIEF_MINS") || "-1");
    var briefText     = getFlag("DASHBOARD_LAST_BRIEF_TEXT") || "⏳ Waiting for first briefing...";
    var briefTime     = lastBriefMins >= 0 ? minsToTimeStr(lastBriefMins) : "—";
    var nextBriefStr  = getNextBriefTimeStr(cstMins, dow);
    var postedStr     = briefTime !== "—" ? briefTime + " cst" : "—";

    if (shouldBrief) {
      var newBrief = generateDashboardBrief(data, esData, vixData, now);
      if (newBrief) {
        briefText = newBrief;
        setFlag("DASHBOARD_LAST_BRIEF_TEXT", briefText);
        setFlag("DASHBOARD_LAST_BRIEF_MINS", cstMins.toString());
        postedStr    = minsToTimeStr(cstMins) + " cst";
        nextBriefStr = getNextBriefTimeStr(cstMins, dow);
      }
    }

    sheet.getRange(DR.BR_HDR, DC.CARD_L, 1, 3).merge()
      .setValue("  🧠  AI MISSION BRIEFING")
      .setBackground(DB.HDR_BRIEF).setFontColor(DB.TXT_HDR_BRIEF)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.BR_HDR, 28);

    sheet.getRange(DR.BR_META, DC.CARD_L, 1, 3).merge()
      .setValue("posted  " + postedStr + "          next update  " + nextBriefStr)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.BR_META, 22);

    sheet.getRange(DR.BR_TEXT, DC.CARD_L, 8, 3).merge()
      .setValue(briefText)
      .setBackground(DB.BG_TERM).setFontColor(DB.TXT_TERM)
      .setFontSize(11).setFontFamily("Roboto Mono")
      .setWrap(true).setVerticalAlignment("top").setHorizontalAlignment("left");
    sheet.setRowHeight(DR.BR_TEXT, 160);
    for (var r2 = DR.BR_TEXT + 1; r2 < DR.BR_TEXT + 8; r2++) {
      sheet.setRowHeight(r2, 10);
    }

    sheet.getRange(DR.BR_PAD, DC.CARD_L, 1, 3).merge()
      .setValue("").setBackground(DB.BG_CARD);
    sheet.setRowHeight(DR.BR_PAD, 10);

    for (var rb = DR.BR_HDR; rb <= DR.BR_PAD; rb++) {
      sheet.getRange(rb, DC.GAP_L).setBackground(DB.BG_GAP);
      sheet.getRange(rb, DC.GAP_M).setBackground(DB.BG_GAP);
      sheet.getRange(rb, DC.GAP_R).setBackground(DB.BG_GAP);
      if (sheet.getMaxColumns() >= DC.GAP_END) sheet.getRange(rb, DC.GAP_END).setBackground(DB.BG_GAP);
    }

  } catch (e) { Logger.log("writeBriefCard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// GENERATE DASHBOARD BRIEF via Gemini
// now = raw UTC Date
// ─────────────────────────────────────────────────────────────
function generateDashboardBrief(data, esData, vixData, now) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return "⚙️ Add GEMINI_API_KEY in Script Properties to enable briefings.";

    var timeStr = Utilities.formatDate(now, "America/Chicago", "h:mm a").toLowerCase();
    var price   = data ? data.price : 0;
    var pctChg  = (data && data.prevClose > 0)
      ? ((price - data.prevClose) / data.prevClose * 100).toFixed(2) : "?";

    var prompt =
      "SPY dashboard brief at " + timeStr + " CST. " +
      "SPY: $" + (price > 0 ? price.toFixed(2) : "?") + " (" + pctChg + "% vs close). " +
      "VIX: " + (vixData ? vixData.price.toFixed(2) + " [" + vixData.regime + "]" : "?") + ". " +
      "ES: " + (esData ? "$" + esData.price.toFixed(2) + " " + esData.trend : "?") + ". " +
      "3-4 sentences: market status, key risk, trader action. Plain text, no bullets.";

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 200, temperature: 0.4 }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log("Dashboard brief Gemini error: " + resp.getResponseCode());
      return null;
    }

    var json = JSON.parse(resp.getContentText());
    return json.candidates
        && json.candidates[0]
        && json.candidates[0].content
        && json.candidates[0].content.parts
        && json.candidates[0].content.parts[0]
         ? json.candidates[0].content.parts[0].text.trim()
         : null;
  } catch (e) {
    Logger.log("generateDashboardBrief ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// TIME HELPERS
// ─────────────────────────────────────────────────────────────
function minsToTimeStr(totalMins) {
  totalMins = Math.floor(totalMins);
  totalMins = ((totalMins % 1440) + 1440) % 1440;
  var h    = Math.floor(totalMins / 60);
  var m    = totalMins % 60;
  var ampm = h >= 12 ? "pm" : "am";
  var h12  = h % 12;
  if (h12 === 0) h12 = 12;
  var mStr = m < 10 ? "0" + m : "" + m;
  return h12 + ":" + mStr + " " + ampm + " cst";
}

function getNextBriefTimeStr(cstMins, dow) {
  try {
    var lastMinsStr = getFlag("DASHBOARD_LAST_BRIEF_MINS");
    var lastMins    = (lastMinsStr && lastMinsStr !== "" && !isNaN(parseInt(lastMinsStr)))
                      ? parseInt(lastMinsStr) : cstMins;

    var mode     = getDashboardBriefMode(cstMins, dow);
    var interval = BRIEF_INTERVALS.OVERNIGHT;
    if      (mode === "PRE_MARKET_EARLY") interval = BRIEF_INTERVALS.PRE_MARKET_EARLY;
    else if (mode === "PRE_MARKET_HOT")   interval = BRIEF_INTERVALS.PRE_MARKET_HOT;
    else if (mode === "MARKET_OPEN")      interval = BRIEF_INTERVALS.MARKET_OPEN;
    else if (mode === "INTRADAY")         interval = BRIEF_INTERVALS.INTRADAY;
    else if (mode === "WIND_DOWN")        interval = BRIEF_INTERVALS.WIND_DOWN;

    var nextMins  = ((lastMins + interval) % 1440 + 1440) % 1440;
    var remaining = nextMins - cstMins;
    if (remaining < 0) remaining += 1440;

    var remStr = remaining <= 1  ? "now"
               : remaining <= 60 ? "~" + remaining + " min"
               : "~" + Math.round(remaining / 60) + " hr";

    return minsToTimeStr(nextMins) + "  (" + remStr + ")";
  } catch (e) {
    return "—";
  }
}

function getDashboardBriefMode(cstMins, dow) {
  if (dow === 0 || dow === 6) return "OVERNIGHT";
  if (cstMins < 360)  return "OVERNIGHT";
  if (cstMins < 480)  return "PRE_MARKET_EARLY";
  if (cstMins < 510)  return "PRE_MARKET_HOT";
  if (cstMins < 585)  return "MARKET_OPEN";
  if (cstMins < 900)  return "INTRADAY";
  return "WIND_DOWN";
}

function shouldFireDashboardBrief(cstMins, dow) {
  try {
    var lastMinsStr = getFlag("DASHBOARD_LAST_BRIEF_MINS");
    var lastMins    = (lastMinsStr && lastMinsStr !== "") ? parseInt(lastMinsStr) : -9999;
    var mode        = getDashboardBriefMode(cstMins, dow);

    var interval = BRIEF_INTERVALS.OVERNIGHT;
    if      (mode === "PRE_MARKET_EARLY") interval = BRIEF_INTERVALS.PRE_MARKET_EARLY;
    else if (mode === "PRE_MARKET_HOT")   interval = BRIEF_INTERVALS.PRE_MARKET_HOT;
    else if (mode === "MARKET_OPEN")      interval = BRIEF_INTERVALS.MARKET_OPEN;
    else if (mode === "INTRADAY")         interval = BRIEF_INTERVALS.INTRADAY;
    else if (mode === "WIND_DOWN")        interval = BRIEF_INTERVALS.WIND_DOWN;

    var elapsed = (lastMins < 0 || isNaN(lastMins))
      ? 99999
      : (cstMins >= lastMins ? cstMins - lastMins : (1440 - lastMins) + cstMins);

    return elapsed >= interval;
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// MARKET STATUS
// ─────────────────────────────────────────────────────────────
function getMarketStatus(cstMins, dow) {
  if (dow === 0 || dow === 6) {
    return {
      label:     "CLOSED  ·  " + (dow === 6 ? "Saturday" : "Sunday"),
      countdown: "Markets reopen Monday 8:30am cst",
      session:   "Weekend — no active session",
      next:      "Pre-market opens Monday 4:00am cst",
      color:     DB.TXT_DIM
    };
  }
  if (cstMins < 240) return {
    label: "🌙  OVERNIGHT", countdown: "Pre-market opens at 4:00am cst",
    session: "Overnight — no active session", next: "Next: pre-market 4:00am cst", color: DB.TXT_DIM
  };
  if (cstMins < 510) return {
    label: "👁️  PRE-MARKET", countdown: "Market opens at 8:30am cst",
    session: "Pre-market session active", next: "Bear Trap window: 8:30–9:30am cst", color: DB.TXT_GOLD
  };
  if (cstMins < 570) return {
    label: "🪤  BEAR TRAP ACTIVE", countdown: "Window closes at 9:30am cst",
    session: "Active window — watch flush → stall → flip", next: "DO NOT buy during flush phase", color: DB.TXT_GREEN
  };
  if (cstMins < 585) return {
    label: "⚡  LATE WINDOW", countdown: "Window closes at 9:30am cst",
    session: "Late Bear Trap window — or invalidated", next: "EOD brief fires at 3:00pm cst", color: DB.TXT_ORANGE
  };
  if (cstMins < 900) return {
    label: "📈  MARKET OPEN", countdown: "Intraday session underway",
    session: "Regular session", next: "EOD brief fires at 3:00pm cst", color: DB.TXT_CYAN
  };
  if (cstMins < 960) return {
    label: "📊  EOD WIND-DOWN", countdown: "Market closes at 3:00pm cst",
    session: "Late session", next: "Overnight watch begins after close", color: DB.TXT_DIM
  };
  return {
    label: "🔒  AFTER HOURS", countdown: "Market closed",
    session: "After-hours session", next: "Pre-market opens tomorrow 4:00am cst", color: DB.TXT_DIM
  };
}

// ─────────────────────────────────────────────────────────────
// AI STATUS
// ─────────────────────────────────────────────────────────────
function getAIStatus(cstMins, dow) {
  if (dow === 0 || dow === 6) return {
    mode: "💤  WEEKEND — MONITORING ONLY",
    waiting: "No active trading. ES futures + overnight context only.",
    nextBrief: getNextBriefTimeStr(cstMins, dow)
  };
  if (cstMins < 240) return {
    mode: "💤  OVERNIGHT — STANDBY",
    waiting: "Monitoring ES futures overnight.",
    nextBrief: getNextBriefTimeStr(cstMins, dow)
  };
  if (cstMins < 505) return {
    mode: "👁️  PRE-MARKET — WATCHING",
    waiting: "Morning brief fires at 8:25am cst.",
    nextBrief: getNextBriefTimeStr(cstMins, dow)
  };
  if (cstMins < 510) return {
    mode: "🔔  MORNING BRIEF — IMMINENT",
    waiting: "Generating morning brief now...",
    nextBrief: getNextBriefTimeStr(cstMins, dow)
  };
  if (cstMins < 570) return {
    mode: "🪤  BEAR TRAP — ACTIVE",
    waiting: "Monitoring flush → stall → flip pattern.",
    nextBrief: getNextBriefTimeStr(cstMins, dow)
  };
  if (cstMins < 900) return {
    mode: "📊  INTRADAY — TRACKING",
    waiting: "Briefings every 30 min. Watching key levels.",
    nextBrief: getNextBriefTimeStr(cstMins, dow)
  };
  if (cstMins < 960) return {
    mode: "🏁  EOD — GRADING",
    waiting: "Grading morning brief accuracy.",
    nextBrief: getNextBriefTimeStr(cstMins, dow)
  };
  return {
    mode: "🔒  AFTER HOURS — STANDBY",
    waiting: "Session closed. Overnight monitoring begins.",
    nextBrief: getNextBriefTimeStr(cstMins, dow)
  };
}

// ─────────────────────────────────────────────────────────────
// SETUP DASHBOARD SHEET
// ─────────────────────────────────────────────────────────────
function setupDashboardSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_DASHBOARD);
  if (!sheet) sheet = ss.insertSheet(SHEET_DASHBOARD);
  sheet.setTabColor("#00bcd4");

  // Ensure 7 columns
  if (sheet.getMaxColumns() < 7) sheet.insertColumnsAfter(sheet.getMaxColumns(), 7 - sheet.getMaxColumns());

  // Column widths
  sheet.setColumnWidth(DC.GAP_L,   8);
  sheet.setColumnWidth(DC.CARD_L, 310);
  sheet.setColumnWidth(DC.GAP_M,   8);
  sheet.setColumnWidth(DC.CARD_R, 310);
  sheet.setColumnWidth(DC.GAP_R,   8);
  sheet.setColumnWidth(DC.WIDE,   310);
  sheet.setColumnWidth(DC.GAP_END,  8);

  // Ensure enough rows
  if (sheet.getMaxRows() < 40) sheet.insertRowsAfter(sheet.getMaxRows(), 40 - sheet.getMaxRows());

  // Base background
  sheet.getRange(1, 1, 40, 7).setBackground(DB.BG_SHEET);

  // Banner
  sheet.getRange(DR.BANNER, 1, 1, 7).merge()
    .setValue("🖥️  MISSION CONTROL  ·  SPY TRACKER")
    .setBackground(DB.BG_BANNER).setFontColor(DB.TXT_BANNER)
    .setFontWeight("bold").setFontSize(16).setFontFamily("Trebuchet MS")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(DR.BANNER, 36);

  // Subtitle placeholder
  sheet.getRange(DR.SUBTITLE, 1, 1, 7).merge()
    .setValue("loading...")
    .setFontColor(DB.TXT_DIM).setFontSize(8)
    .setHorizontalAlignment("center").setBackground(DB.BG_BANNER);
  sheet.setRowHeight(DR.SUBTITLE, 16);

  // Gap rows
  [DR.GAP_1, DR.GAP_2, DR.GAP_3, DR.GAP_4, DR.GAP_5].forEach(function(r) {
    sheet.getRange(r, 1, 1, 7).setBackground(DB.BG_GAP);
    sheet.setRowHeight(r, 6);
  });

  sheet.setFrozenRows(2);
  Logger.log("Dashboard sheet setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRY
// ─────────────────────────────────────────────────────────────
function setupDashboardSheetFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setupDashboardSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🖥️ MISSION CONTROL\n\n" +
    "✅ Dashboard created!\n\n" +
    "Bear Trap active window: 8:30–9:30am cst\n\n" +
    "Run 'Refresh Dashboard Now' to populate."
  );
}

// ─────────────────────────────────────────────────────────────
// MANUAL REFRESH
// ─────────────────────────────────────────────────────────────
function runManualDashboardRefresh() {
  try {
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheetsExist(ss);
    var now  = getCurrentEasternTime();
    var data = fetchSPYData();
    if (!data) {
      SpreadsheetApp.getUi().alert("❌ Could not fetch SPY data.");
      return;
    }
    setFlag("DASHBOARD_LAST_BRIEF_MINS", "-9999");
    runDashboardTick(data, now);
    SpreadsheetApp.getUi().alert("✅ Dashboard refreshed!\nSPY: $" + data.price.toFixed(2));
  } catch (e) {
    Logger.log("runManualDashboardRefresh ERROR: " + e.message);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message);
  }
}
