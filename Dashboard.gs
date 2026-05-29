// ============================================================
// FILE: Dashboard.gs
// PURPOSE: 🖥️ MISSION CONTROL — Card-grid dashboard.
//
//  LAYOUT — card grid using columns as layout tools:
//
//    Col:  A    B         C    D         E    F         G    H
//          gap  CARD-L    gap  CARD-R    gap  (wide)    gap  (end)
//    Widths: 8  310       8   310        8   (varies)   8
//
//  ROW STRUCTURE:
//    Rows 1-2   : Banner + subtitle
//    Rows 3     : gap
//    Rows 4-11  : ROW 1 CARDS — SPY Price (left) | Market Status (right)
//    Row  12    : gap
//    Rows 13-20 : ROW 2 CARDS — AI Status (left) | ES Futures (right)
//    Row  21    : gap
//    Rows 22-32 : FULL-WIDTH — AI Briefing card
//    Row  33    : gap
//
//  All times CST 12-hour format.
// ============================================================

var SHEET_DASHBOARD = "🖥️ DASHBOARD";

// ─────────────────────────────────────────────────────────────
// PALETTE
// ─────────────────────────────────────────────────────────────
var DB = {
  // Sheet base
  BG_SHEET:     "#0e0e1a",   // overall sheet background

  // Banner
  BG_BANNER:    "#070712",
  TXT_BANNER:   "#00e5ff",
  TXT_SUB:      "#2a2a55",

  // Card backgrounds
  BG_CARD:      "#13132a",   // card body
  BG_GAP:       "#0e0e1a",   // gap columns/rows — same as sheet
  BG_DIVIDER:   "#1a1a35",   // subtle inner divider rows

  // Card header backgrounds (per section)
  HDR_SPY:      "#001e3c",   // deep navy
  HDR_MKT:      "#002918",   // deep forest green
  HDR_AI:       "#1a0a30",   // deep purple
  HDR_ES:       "#2a1800",   // deep amber
  HDR_BRIEF:    "#1e0a00",   // deep orange-brown

  // Card header text
  TXT_HDR_SPY:  "#29b6f6",   // sky blue
  TXT_HDR_MKT:  "#4caf50",   // green
  TXT_HDR_AI:   "#ab47bc",   // purple
  TXT_HDR_ES:   "#ffa726",   // amber
  TXT_HDR_BRIEF:"#ff7043",   // orange

  // Card accent left-border column color (1 col wide inside card)
  ACC_SPY:      "#0077bb",
  ACC_MKT:      "#005533",
  ACC_AI:       "#5500aa",
  ACC_ES:       "#aa6600",
  ACC_BRIEF:    "#cc3300",

  // Value text
  TXT_PRIMARY:  "#e8eaf6",   // big values
  TXT_SECONDARY:"#7986cb",   // labels / sub-values
  TXT_DIM:      "#3d3d6b",   // very dim metadata
  TXT_CYAN:     "#00e5ff",
  TXT_GREEN:    "#00e676",
  TXT_RED:      "#ff5252",
  TXT_GOLD:     "#ffd740",
  TXT_ORANGE:   "#ff9100",
  TXT_PURPLE:   "#e040fb",
  TXT_SILVER:   "#90a4ae",

  // Terminal (briefing)
  BG_TERM:      "#080810",
  TXT_TERM:     "#ffe082"
};

// ─────────────────────────────────────────────────────────────
// COLUMN MAP
// A=1 B=2 C=3 D=4 E=5 F=6 G=7 H=8
//  gap  L-card  gap  R-card  gap  wide   gap  end
//   1     2      3     4      5    6      7    8
// ─────────────────────────────────────────────────────────────
var DC = {
  GAP_L:   1,   // 8px gap
  CARD_L:  2,   // 310px — left card
  GAP_M:   3,   // 8px gap
  CARD_R:  4,   // 310px — right card
  GAP_R:   5,   // 8px gap
  WIDE:    6,   // 636px — full-width card (spans to col 6 only, cols 2-6 merged)
  GAP_END: 7    // 8px end cap
};

// ─────────────────────────────────────────────────────────────
// ROW MAP
// ─────────────────────────────────────────────────────────────
var DR = {
  BANNER:      1,
  SUBTITLE:    2,
  GAP_1:       3,

  // Row 1 of cards: SPY + Market
  SPY_HDR:     4,
  SPY_BIG:     5,
  SPY_CHANGE:  6,
  SPY_DIV:     7,
  SPY_PREV:    8,
  SPY_TIME:    9,
  SPY_PAD:     10,
  GAP_2:       11,

  // Row 2 of cards: AI + ES
  AI_HDR:      12,
  AI_MODE:     13,
  AI_WATCH:    14,
  AI_DIV:      15,
  AI_NEXT:     16,
  AI_PAD:      17,
  GAP_3:       18,

  // Full-width ES card
  ES_HDR:      19,
  ES_PRICE:    20,
  ES_ALIGN:    21,
  ES_DIV:      22,
  ES_SIGNAL:   23,
  ES_ACTION:   24,
  ES_PAD:      25,
  GAP_4:       26,

  // Full-width briefing card
  BR_HDR:      27,
  BR_META:     28,
  BR_TEXT:     29,   // tall merged — the message
  BR_PAD:      37,   // rows 29–36 consumed by tall merged cell
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
// MAIN ENTRY
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

    writeSPYCard(sheet, data, cst);
    writeMarketCard(sheet, cstMins, dow);
    writeAICard(sheet, cstMins, dow);
    writeESCard(sheet, esData);
    writeBriefCard(sheet, data, esData, vixData, cst, cstMins, dow, shouldBrief);

    // Subtitle
    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mm a").toLowerCase();
    var dateStr = Utilities.formatDate(cst, "America/Chicago", "EEE MMM d, yyyy");
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
// CARD HELPER — writes a card header bar
// ─────────────────────────────────────────────────────────────
function writeCardHeader(sheet, row, col, label, bgColor, txtColor, isWide) {
  var span = isWide ? 5 : 1; // wide = cols 2-6, normal = single col
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

// Card body row — label on top left (small), value below
function writeCardField(sheet, row, col, labelTxt, valueTxt, valueFg, valueSz, isMerged) {
  // Write directly into the cell; label is set via note-style small text above value
  // We use two sub-rows: label row + value row
  sheet.getRange(row, col).setValue(valueTxt)
    .setFontColor(valueFg || DB.TXT_PRIMARY)
    .setFontSize(valueSz || 12)
    .setFontWeight("bold")
    .setVerticalAlignment("bottom")
    .setHorizontalAlignment("left")
    .setBackground(DB.BG_CARD);
}

// ─────────────────────────────────────────────────────────────
// CARD 1 — SPY PRICE  (left, rows 4–10)
// ─────────────────────────────────────────────────────────────
function writeSPYCard(sheet, data, cst) {
  try {
    var price     = data ? (data.price     || 0) : 0;
    var prevClose = data ? (data.prevClose || price) : 0;
    var change    = price - prevClose;
    var changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    var isUp      = change >= 0;
    var priceFg   = isUp ? DB.TXT_GREEN : DB.TXT_RED;
    var arrow     = isUp ? "▲" : "▼";
    var sign      = isUp ? "+" : "";

    var col = DC.CARD_L;

    // Header
    sheet.getRange(DR.SPY_HDR, col).setValue("  💰  SPY — LAST PRICE")
      .setBackground(DB.HDR_SPY).setFontColor(DB.TXT_HDR_SPY)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_HDR, 28);

    // Big price
    sheet.getRange(DR.SPY_BIG, col)
      .setValue(price > 0 ? "$" + price.toFixed(2) : "—")
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_CYAN)
      .setFontSize(26).setFontWeight("bold").setFontFamily("Roboto Mono")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_BIG, 44);

    // Change row
    var changeStr = price > 0
      ? arrow + "  " + sign + change.toFixed(2) + "   (" + sign + changePct.toFixed(2) + "%)"
      : "—";
    sheet.getRange(DR.SPY_CHANGE, col)
      .setValue(changeStr)
      .setBackground(DB.BG_CARD).setFontColor(priceFg)
      .setFontSize(14).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_CHANGE, 30);

    // Divider
    sheet.getRange(DR.SPY_DIV, col).setValue("")
      .setBackground(DB.BG_DIVIDER);
    sheet.setRowHeight(DR.SPY_DIV, 2);

    // Prev close
    sheet.getRange(DR.SPY_PREV, col)
      .setValue(prevClose > 0 ? "prev close  $" + prevClose.toFixed(2) : "—")
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_PREV, 22);

    // Timestamp
    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mm a").toLowerCase();
    sheet.getRange(DR.SPY_TIME, col)
      .setValue("as of  " + timeStr + " cst")
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_DIM)
      .setFontSize(8).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.SPY_TIME, 18);

    // Padding
    sheet.getRange(DR.SPY_PAD, col).setValue("").setBackground(DB.BG_CARD);
    sheet.setRowHeight(DR.SPY_PAD, 10);

  } catch (e) { Logger.log("writeSPYCard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 2 — MARKET STATUS  (right, rows 4–10)
// ─────────────────────────────────────────────────────────────
function writeMarketCard(sheet, cstMins, dow) {
  try {
    var s   = getMarketStatus(cstMins, dow);
    var col = DC.CARD_R;

    // Header
    sheet.getRange(DR.SPY_HDR, col).setValue("  🏛️  MARKET STATUS")
      .setBackground(DB.HDR_MKT).setFontColor(DB.TXT_HDR_MKT)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    // Status label
    sheet.getRange(DR.SPY_BIG, col).setValue(s.label)
      .setBackground(DB.BG_CARD).setFontColor(s.color)
      .setFontSize(16).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    // Countdown
    sheet.getRange(DR.SPY_CHANGE, col).setValue(s.countdown)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_GOLD)
      .setFontSize(13).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    // Divider
    sheet.getRange(DR.SPY_DIV, col).setValue("").setBackground(DB.BG_DIVIDER);

    // Session
    sheet.getRange(DR.SPY_PREV, col).setValue(s.session)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setHorizontalAlignment("left").setVerticalAlignment("middle");

    // Next event
    sheet.getRange(DR.SPY_TIME, col).setValue(s.next)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_GOLD)
      .setFontSize(8).setHorizontalAlignment("left").setVerticalAlignment("middle")
      .setWrap(true);

    // Padding
    sheet.getRange(DR.SPY_PAD, col).setValue("").setBackground(DB.BG_CARD);

  } catch (e) { Logger.log("writeMarketCard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 3 — AI STATUS  (left, rows 12–17)
// ─────────────────────────────────────────────────────────────
function writeAICard(sheet, cstMins, dow) {
  try {
    var ai  = getAIStatus(cstMins, dow);
    var col = DC.CARD_L;

    sheet.getRange(DR.AI_HDR, col).setValue("  🤖  AI SYSTEM STATUS")
      .setBackground(DB.HDR_AI).setFontColor(DB.TXT_HDR_AI)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.AI_HDR, 28);

    sheet.getRange(DR.AI_MODE, col).setValue(ai.mode)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_PURPLE)
      .setFontSize(13).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.AI_MODE, 30);

    sheet.getRange(DR.AI_WATCH, col).setValue(ai.waiting)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setWrap(true)
      .setHorizontalAlignment("left").setVerticalAlignment("top");
    sheet.setRowHeight(DR.AI_WATCH, 36);

    sheet.getRange(DR.AI_DIV, col).setValue("").setBackground(DB.BG_DIVIDER);
    sheet.setRowHeight(DR.AI_DIV, 2);

    sheet.getRange(DR.AI_NEXT, col).setValue("▶  " + ai.nextAction)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_GOLD)
      .setFontSize(9).setFontWeight("bold").setWrap(true)
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.AI_NEXT, 30);

    sheet.getRange(DR.AI_PAD, col).setValue("").setBackground(DB.BG_CARD);
    sheet.setRowHeight(DR.AI_PAD, 10);

  } catch (e) { Logger.log("writeAICard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 4 — ES FUTURES  (right, rows 12–17)
// ─────────────────────────────────────────────────────────────
function writeESCard(sheet, esData) {
  try {
    var al  = getESAlignmentStatus(esData);
    var col = DC.CARD_R;

    var esPrice = esData ? "$" + esData.price.toFixed(2) : "—";
    var esChg   = esData ? (esData.changePct >= 0 ? "+" : "") + esData.changePct.toFixed(2) + "%" : "—";
    var esTrend = esData ? esData.trend : "—";
    var esFg    = esData ? (esData.changePct >= 0 ? DB.TXT_GREEN : DB.TXT_RED) : DB.TXT_DIM;
    var trendFg = esTrend === "FADING" ? DB.TXT_GREEN
                : esTrend === "CLIMBING" ? DB.TXT_RED : DB.TXT_GOLD;

    sheet.getRange(DR.AI_HDR, col).setValue("  📡  ES FUTURES")
      .setBackground(DB.HDR_ES).setFontColor(DB.TXT_HDR_ES)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    // Price + change on same row
    sheet.getRange(DR.AI_MODE, col)
      .setValue(esPrice + "   " + esChg + "   " + esTrend)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_PRIMARY)
      .setFontSize(13).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    sheet.getRange(DR.AI_WATCH, col).setValue(al.label)
      .setBackground(DB.BG_CARD).setFontColor(al.color)
      .setFontSize(11).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    sheet.getRange(DR.AI_DIV, col).setValue("").setBackground(DB.BG_DIVIDER);

    sheet.getRange(DR.AI_NEXT, col).setValue(al.action)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_GOLD)
      .setFontSize(9).setFontWeight("bold").setWrap(true)
      .setHorizontalAlignment("left").setVerticalAlignment("middle");

    sheet.getRange(DR.AI_PAD, col).setValue("").setBackground(DB.BG_CARD);

  } catch (e) { Logger.log("writeESCard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 5 — ES DETAIL (full-width, rows 19–25)
// ─────────────────────────────────────────────────────────────
function writeESDetailCard(sheet, esData) {
  try {
    var al = getESAlignmentStatus(esData);

    // Header (wide)
    sheet.getRange(DR.ES_HDR, DC.CARD_L, 1, 3).merge()
      .setValue("  🎯  BEAR TRAP ALIGNMENT — FULL ANALYSIS")
      .setBackground(DB.HDR_ES).setFontColor(DB.TXT_HDR_ES)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.ES_HDR, 28);

    // Alignment label
    sheet.getRange(DR.ES_PRICE, DC.CARD_L, 1, 3).merge()
      .setValue(al.label)
      .setBackground(DB.BG_CARD).setFontColor(al.color)
      .setFontSize(15).setFontWeight("bold")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.ES_PRICE, 32);

    // Signal reason
    sheet.getRange(DR.ES_ALIGN, DC.CARD_L, 1, 3).merge()
      .setValue("SIGNAL:  " + al.reason)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setWrap(true)
      .setHorizontalAlignment("left").setVerticalAlignment("top");
    sheet.setRowHeight(DR.ES_ALIGN, 40);

    // Divider
    sheet.getRange(DR.ES_DIV, DC.CARD_L, 1, 3).merge()
      .setValue("").setBackground(DB.BG_DIVIDER);
    sheet.setRowHeight(DR.ES_DIV, 2);

    // Playbook
    sheet.getRange(DR.ES_SIGNAL, DC.CARD_L, 1, 3).merge()
      .setValue("PLAYBOOK:  " + al.action)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_GOLD)
      .setFontSize(9).setFontWeight("bold").setWrap(true)
      .setHorizontalAlignment("left").setVerticalAlignment("top");
    sheet.setRowHeight(DR.ES_SIGNAL, 36);

    // Padding
    sheet.getRange(DR.ES_ACTION, DC.CARD_L, 1, 3).merge()
      .setValue("").setBackground(DB.BG_CARD);
    sheet.setRowHeight(DR.ES_ACTION, 8);

    // Fill gap cols for this section
    for (var r = DR.ES_HDR; r <= DR.ES_ACTION; r++) {
      sheet.getRange(r, DC.GAP_L).setBackground(DB.BG_GAP);
      sheet.getRange(r, DC.GAP_M).setBackground(DB.BG_GAP);
      sheet.getRange(r, DC.GAP_R).setBackground(DB.BG_GAP);
      sheet.getRange(r, DC.GAP_END).setBackground(DB.BG_GAP);
    }

  } catch (e) { Logger.log("writeESDetailCard ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// CARD 6 — AI BRIEFING (full-width, rows 27–37)
// ─────────────────────────────────────────────────────────────
function writeBriefCard(sheet, data, esData, vixData, cst, cstMins, dow, shouldBrief) {
  try {
    var briefText    = getFlag("DASHBOARD_BRIEF_TEXT") || "";
    var briefTime    = getFlag("DASHBOARD_BRIEF_TIME") || "";
    var nextBriefStr = getNextBriefTimeStr(cstMins, dow);

    if (shouldBrief) {
      var newBrief = callGeminiForDashboardBrief(data, esData, vixData, cst, cstMins, dow);
      if (newBrief) {
        briefText = newBrief;
        briefTime = Utilities.formatDate(cst, "America/Chicago", "h:mm a").toLowerCase();
        setFlag("DASHBOARD_BRIEF_TEXT",      briefText);
        setFlag("DASHBOARD_BRIEF_TIME",      briefTime);
        setFlag("DASHBOARD_LAST_BRIEF_MINS", cstMins.toString());
      }
    }

    if (!briefText || briefText === "") {
      briefText = buildFallbackBriefText(esData, cst, cstMins, dow, nextBriefStr);
      briefTime = Utilities.formatDate(cst, "America/Chicago", "h:mm a").toLowerCase();
    }

    var postedStr = briefTime ? briefTime + " cst" : "—";

    // Header
    sheet.getRange(DR.BR_HDR, DC.CARD_L, 1, 3).merge()
      .setValue("  🧠  AI MISSION BRIEFING")
      .setBackground(DB.HDR_BRIEF).setFontColor(DB.TXT_HDR_BRIEF)
      .setFontWeight("bold").setFontSize(10).setFontFamily("Trebuchet MS")
      .setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.BR_HDR, 28);

    // Meta row — posted + next
    sheet.getRange(DR.BR_META, DC.CARD_L, 1, 3).merge()
      .setValue("posted  " + postedStr + "          next update  " + nextBriefStr)
      .setBackground(DB.BG_CARD).setFontColor(DB.TXT_SECONDARY)
      .setFontSize(9).setHorizontalAlignment("left").setVerticalAlignment("middle");
    sheet.setRowHeight(DR.BR_META, 22);

    // Big terminal text
    sheet.getRange(DR.BR_TEXT, DC.CARD_L, 8, 3).merge()
      .setValue(briefText)
      .setBackground(DB.BG_TERM).setFontColor(DB.TXT_TERM)
      .setFontSize(11).setFontFamily("Roboto Mono")
      .setWrap(true).setVerticalAlignment("top").setHorizontalAlignment("left");
    sheet.setRowHeight(DR.BR_TEXT, 160);
    for (var r2 = DR.BR_TEXT + 1; r2 < DR.BR_TEXT + 8; r2++) {
      sheet.setRowHeight(r2, 10);
    }

    // Padding
    sheet.getRange(DR.BR_PAD, DC.CARD_L, 1, 3).merge()
      .setValue("").setBackground(DB.BG_CARD);
    sheet.setRowHeight(DR.BR_PAD, 10);

    // Fill gap cols
    for (var rb = DR.BR_HDR; rb <= DR.BR_PAD; rb++) {
      sheet.getRange(rb, DC.GAP_L).setBackground(DB.BG_GAP);
      sheet.getRange(rb, DC.GAP_M).setBackground(DB.BG_GAP);
      sheet.getRange(rb, DC.GAP_R).setBackground(DB.BG_GAP);
      if (sheet.getMaxColumns() >= DC.GAP_END) {
        sheet.getRange(rb, DC.GAP_END).setBackground(DB.BG_GAP);
      }
    }

  } catch (e) { Logger.log("writeBriefCard ERROR: " + e.message); }
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
  if (cstMins < 570)  return "MARKET_OPEN";
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
      session:   "Weekend — markets closed",
      countdown: "",
      next:      "Pre-market Monday ~3:00am cst  ·  Open 8:30am cst",
      color:     DB.TXT_DIM
    };
  }
  if (cstMins >= 180 && cstMins < 510) {
    return {
      label:     "PRE-MARKET  🌅",
      session:   "Pre-market session active",
      countdown: "Opens in " + (510 - cstMins) + " min",
      next:      "Regular session opens 8:30am cst",
      color:     DB.TXT_ORANGE
    };
  }
  if (cstMins >= 510 && cstMins < 900) {
    return {
      label:     "MARKET OPEN  🟢",
      session:   "Regular trading session",
      countdown: "Closes in " + (900 - cstMins) + " min",
      next:      "Market closes 3:00pm cst",
      color:     DB.TXT_GREEN
    };
  }
  if (cstMins >= 900 && cstMins < 1260) {
    return {
      label:     "AFTER HOURS  🌙",
      session:   "Extended / after-hours session",
      countdown: "",
      next:      "Pre-market opens ~3:00am cst tomorrow",
      color:     DB.TXT_PURPLE
    };
  }
  return {
    label:     "OVERNIGHT  🔒",
    session:   "All sessions closed",
    countdown: "",
    next:      "Pre-market opens ~3:00am cst",
    color:     DB.TXT_DIM
  };
}

// ─────────────────────────────────────────────────────────────
// AI STATUS
// ─────────────────────────────────────────────────────────────
function getAIStatus(cstMins, dow) {
  if (dow === 0 || dow === 6) return {
    mode: "💤  STANDBY — Weekend",
    waiting: "Markets closed. Briefings every 4 hours.",
    nextAction: "Full monitoring resumes Monday 6:00am cst"
  };
  if (cstMins < 360) return {
    mode: "🌙  OVERNIGHT WATCH",
    waiting: "Monitoring ES futures + overnight price action",
    nextAction: "Pre-market coaching begins 6:00am cst"
  };
  if (cstMins < 480) return {
    mode: "👁️  PRE-MARKET WATCH",
    waiting: "Overnight context forming — not yet actionable",
    nextAction: "Emotional coaching ramps up at 8:00am cst"
  };
  if (cstMins < 510) return {
    mode: "⚠️  PRE-OPEN COACHING — HIGH ALERT",
    waiting: "ES trend + Bear Trap setup alignment",
    nextAction: "Market opens 8:30am cst — STAY PATIENT · WATCH FOR TRAP"
  };
  if (cstMins < 555) return {
    mode: "🪤  BEAR TRAP WATCH — ACTIVE",
    waiting: "Flush → volume stall → momentum flip sequence",
    nextAction: "Active window until 9:15am cst · DO NOT buy during flush"
  };
  if (cstMins < 570) return {
    mode: "⚡  BEAR TRAP — LATE WINDOW",
    waiting: "Late flip signal or pattern failure",
    nextAction: "Critical window closes 9:15am cst"
  };
  if (cstMins < 900) return {
    mode: "📈  INTRADAY MONITOR",
    waiting: "Intraday price action + momentum",
    nextAction: "EOD brief fires at 3:00pm cst"
  };
  return {
    mode: "📊  EOD WIND-DOWN",
    waiting: "Day summary + signal accuracy review",
    nextAction: "Overnight watch begins · Next active ~6:00am cst"
  };
}

// ─────────────────────────────────────────────────────────────
// ES ALIGNMENT
// ─────────────────────────────────────────────────────────────
function getESAlignmentStatus(esData) {
  if (!esData) return {
    label:  "❓  UNKNOWN — No ES Data",
    reason: "ES futures data unavailable. Cannot assess Bear Trap alignment.",
    action: "Proceed with caution. Check data connection.",
    color:  DB.TXT_DIM
  };
  var trend = esData.trend;
  var pct   = esData.changePct;

  if (trend === "FADING" && pct < -ES_ALIGN.VOID_DROP_PCT) return {
    label:  "❌  VOID — Strategy Off Today",
    reason: "ES down " + Math.abs(pct).toFixed(2) + "% and FADING hard. Real distribution, not a manufactured flush.",
    action: "SKIP Bear Trap today. Do NOT buy calls. Wait for a cleaner setup.",
    color:  DB.TXT_RED
  };
  if (trend === "CLIMBING" && pct > ES_ALIGN.CAUTION_RISE_PCT) return {
    label:  "🚫  CAUTION — Flush May Follow Through",
    reason: "ES up " + pct.toFixed(2) + "% and CLIMBING. Flush here could be real selling.",
    action: "Reduce conviction. Require >80% confidence. Smaller size.",
    color:  DB.TXT_ORANGE
  };
  if (trend === "FLAT" && pct < -ES_ALIGN.MONITOR_PCT) return {
    label:  "⚠️  MONITOR — Ambiguous Setup",
    reason: "ES flat but " + Math.abs(pct).toFixed(2) + "% below overnight high. OH tag not confirmed.",
    action: "Watch for ES recovery toward overnight high before open.",
    color:  DB.TXT_GOLD
  };
  if (trend === "FADING") return {
    label:  "✅  ALIGNED — Classic Bear Trap Setup",
    reason: "ES FADING from overnight high (" + pct.toFixed(2) + "%). Textbook setup conditions present.",
    action: "Stay ready. Watch for: flush in first 15 min → stall → flip. Enter calls on flip ONLY.",
    color:  DB.TXT_GREEN
  };
  return {
    label:  "✅  ALIGNED — ES Flat Near Highs",
    reason: "ES FLAT (" + pct.toFixed(2) + "%). Consolidating near highs — valid Bear Trap precondition.",
    action: "Setup live. Watch for morning flush. Require >65% confidence before entering calls.",
    color:  DB.TXT_GREEN
  };
}

// ─────────────────────────────────────────────────────────────
// FALLBACK BRIEF TEXT
// ─────────────────────────────────────────────────────────────
function buildFallbackBriefText(esData, cst, cstMins, dow, nextBriefStr) {
  var timeStr  = Utilities.formatDate(cst, "America/Chicago", "h:mm a").toLowerCase();
  var esStatus = esData
    ? "ES " + (esData.changePct >= 0 ? "+" : "") + esData.changePct.toFixed(2) + "% · " + esData.trend
    : "ES data loading";
  var mode = getDashboardBriefMode(cstMins, dow);

  if (dow === 0 || dow === 6)
    return "Markets are closed — it's the weekend. " + timeStr + " cst.\n\n" + esStatus + ". Nothing actionable. System is watching.\n\nNext briefing: " + nextBriefStr;
  if (mode === "OVERNIGHT")
    return "Markets are closed. It is " + timeStr + " cst.\n\n" + esStatus + ". Overnight — nothing to act on. System is watching.\n\nNext briefing: " + nextBriefStr;
  if (mode === "PRE_MARKET_EARLY")
    return "Pre-market is underway. It is " + timeStr + " cst.\n\n" + esStatus + ". Market opens at 8:30am cst. Do not make any trades yet.\n\nNext briefing: " + nextBriefStr;
  if (mode === "PRE_MARKET_HOT")
    return "Market opens soon. It is " + timeStr + " cst.\n\n" + esStatus + ". Danger zone for impulse trades. Breathe. Watch for the Bear Trap — do NOT jump in at open.\n\nNext briefing: " + nextBriefStr;
  if (mode === "MARKET_OPEN")
    return "Market is open. " + timeStr + " cst — Bear Trap window is ACTIVE.\n\n" + esStatus + ". Watch flush → stall → flip. Do not chase.\n\nNext briefing: " + nextBriefStr;
  return "Market open. " + timeStr + " cst.\n\n" + esStatus + ". Intraday session underway.\n\nNext briefing: " + nextBriefStr;
}

// ─────────────────────────────────────────────────────────────
// GEMINI CALL
// ─────────────────────────────────────────────────────────────
function callGeminiForDashboardBrief(data, esData, vixData, cst, cstMins, dow) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) return null;

    var prompt = buildDashboardBriefPrompt(data, esData, vixData, cst, cstMins, dow);
    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 200, temperature: 0.6 }
    });
    var resp = UrlFetchApp.fetch(url, {
      method: "post", contentType: "application/json",
      payload: payload, muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return null;
    var json = JSON.parse(resp.getContentText());
    return json.candidates
        && json.candidates[0]
        && json.candidates[0].content
        && json.candidates[0].content.parts
        && json.candidates[0].content.parts[0]
         ? json.candidates[0].content.parts[0].text.trim()
         : null;
  } catch (e) {
    Logger.log("callGeminiForDashboardBrief ERROR: " + e.message);
    return null;
  }
}

function buildDashboardBriefPrompt(data, esData, vixData, cst, cstMins, dow) {
  var price    = data    ? "$" + data.price.toFixed(2) : "unknown";
  var pctChg   = data    ? (data.changePct >= 0 ? "+" : "") + data.changePct.toFixed(2) + "%" : "unknown";
  var esTrend  = esData  ? esData.trend : "UNKNOWN";
  var esChgPct = esData  ? esData.changePct.toFixed(2) + "%" : "unknown";
  var vixVal   = vixData ? vixData.price.toFixed(1) + " (" + vixData.regime + ")" : "unknown";
  var timeStr  = Utilities.formatDate(cst, "America/Chicago", "h:mm a").toLowerCase();
  var nextStr  = getNextBriefTimeStr(cstMins, dow);
  var mode     = getDashboardBriefMode(cstMins, dow);
  var al       = getESAlignmentStatus(esData);

  var ctx = "You are a calm, direct trading coach. The user trades SPY options using the Bear Trap Open strategy — watching for a fake morning selloff then buying calls when the trap springs. They tend to trade impulsively before open.\n\n" +
    "Time: " + timeStr + " cst\nSPY: " + price + " (" + pctChg + ")\nES: " + esTrend + " (" + esChgPct + ")\nVIX: " + vixVal + "\nAlignment: " + al.label + "\nNext update: " + nextStr + "\n\n";

  var instr = "";
  if (mode === "OVERNIGHT" || dow === 0 || dow === 6)
    instr = "2-3 sentences: overnight context, ES summary, what to watch. Calm. End: 'Next update: " + nextStr + "'.";
  else if (mode === "PRE_MARKET_EARLY")
    instr = "2-3 sentences: overnight read, no trading yet, get focused. End: 'Next update: " + nextStr + "'.";
  else if (mode === "PRE_MARKET_HOT")
    instr = "3-4 sentences of firm emotional coaching: don't jump in, watch for Bear Trap flush, stay patient. Personal and direct. End: 'Next update: " + nextStr + "'.";
  else if (mode === "MARKET_OPEN")
    instr = "3 sentences: quick ES/SPY read, Bear Trap conditions check, patience coaching. End: 'Next update: " + nextStr + "'.";
  else
    instr = "2 sentences: intraday read + one tactical note. End: 'Next update: " + nextStr + "'.";

  return ctx + "INSTRUCTION: " + instr + "\nOnly the briefing text. No labels or headers.";
}

// ─────────────────────────────────────────────────────────────
// SHEET SETUP
// ─────────────────────────────────────────────────────────────
function setupDashboardSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_DASHBOARD);
  if (!sheet) sheet = ss.insertSheet(SHEET_DASHBOARD);

  sheet.setTabColor("#00e5ff");
  sheet.clearContents();
  sheet.clearFormats();

  // ── Ensure enough columns ─────────────────────────────────
  while (sheet.getMaxColumns() < 7) sheet.insertColumnAfter(sheet.getMaxColumns());

  // ── Column widths ─────────────────────────────────────────
  sheet.setColumnWidth(DC.GAP_L,  10);   // gap
  sheet.setColumnWidth(DC.CARD_L, 310);  // left card
  sheet.setColumnWidth(DC.GAP_M,  10);   // gap
  sheet.setColumnWidth(DC.CARD_R, 310);  // right card
  sheet.setColumnWidth(DC.GAP_R,  10);   // gap
  sheet.setColumnWidth(DC.WIDE,   10);   // unused — right end cap
  sheet.setColumnWidth(DC.GAP_END, 10);  // end

  // ── Flood entire sheet with base bg ──────────────────────
  sheet.getRange(1, 1, 50, 7).setBackground(DB.BG_SHEET);

  // ── Row 1: Banner ────────────────────────────────────────
  sheet.getRange(DR.BANNER, 1, 1, 7).merge()
    .setValue("  ⚡  S P Y   M I S S I O N   C O N T R O L")
    .setBackground(DB.BG_BANNER)
    .setFontColor(DB.TXT_BANNER)
    .setFontWeight("bold")
    .setFontSize(16)
    .setFontFamily("Georgia")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(DR.BANNER, 50);

  // ── Row 2: Subtitle ──────────────────────────────────────
  sheet.getRange(DR.SUBTITLE, 1, 1, 7).merge()
    .setValue("initializing...")
    .setBackground(DB.BG_BANNER)
    .setFontColor(DB.TXT_DIM)
    .setFontSize(8)
    .setHorizontalAlignment("center");
  sheet.setRowHeight(DR.SUBTITLE, 18);

  // ── Gap row 3 ─────────────────────────────────────────────
  sheet.getRange(DR.GAP_1, 1, 1, 7).setBackground(DB.BG_SHEET);
  sheet.setRowHeight(DR.GAP_1, 10);

  // ── Pre-fill gap column cells for card rows ───────────────
  var cardRows = [];
  for (var r = DR.SPY_HDR; r <= DR.SPY_PAD; r++) cardRows.push(r);
  for (var r = DR.AI_HDR;  r <= DR.AI_PAD;  r++) cardRows.push(r);
  for (var r = DR.ES_HDR;  r <= DR.ES_ACTION; r++) cardRows.push(r);
  for (var r = DR.BR_HDR;  r <= DR.BR_PAD;  r++) cardRows.push(r);

  for (var i = 0; i < cardRows.length; i++) {
    var rr = cardRows[i];
    sheet.getRange(rr, DC.GAP_L).setBackground(DB.BG_SHEET);
    sheet.getRange(rr, DC.GAP_M).setBackground(DB.BG_SHEET);
    sheet.getRange(rr, DC.GAP_R).setBackground(DB.BG_SHEET);
    sheet.getRange(rr, DC.WIDE).setBackground(DB.BG_SHEET);
    sheet.getRange(rr, DC.GAP_END).setBackground(DB.BG_SHEET);
  }

  // ── Gap rows between card rows ───────────────────────────
  sheet.getRange(DR.GAP_2,  1, 1, 7).setBackground(DB.BG_SHEET);
  sheet.getRange(DR.GAP_3,  1, 1, 7).setBackground(DB.BG_SHEET);
  sheet.getRange(DR.GAP_4,  1, 1, 7).setBackground(DB.BG_SHEET);
  sheet.getRange(DR.GAP_5,  1, 1, 7).setBackground(DB.BG_SHEET);
  sheet.setRowHeight(DR.GAP_2, 12);
  sheet.setRowHeight(DR.GAP_3, 12);
  sheet.setRowHeight(DR.GAP_4, 12);
  sheet.setRowHeight(DR.GAP_5, 12);

  // ── Freeze top 2 ─────────────────────────────────────────
  sheet.setFrozenRows(2);

  Logger.log("Dashboard (card layout) setup complete.");
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
    "LAYOUT:\n" +
    "  Row 1: SPY Price card  |  Market Status card\n" +
    "  Row 2: AI Status card  |  ES Futures card\n" +
    "  Row 3: Bear Trap Alignment (full width)\n" +
    "  Row 4: AI Briefing terminal (full width)\n\n" +
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
