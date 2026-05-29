// ============================================================
// FILE: Dashboard.gs
// PURPOSE: 🖥️ MISSION CONTROL — Sci-fi HUD dashboard.
//
//  LAYOUT (5 columns):
//    A  = accent color strip (8px — color-coded per section)
//    B  = field label (120px — small, dimmed)
//    C  = primary value (260px — large, bright)
//    D  = secondary value (180px)
//    E  = tertiary value (140px)
//
//  SECTIONS:
//    1. SPY Last Close + % Change
//    2. Market Status
//    3. AI Status
//    4. ES Futures + Bear Trap Alignment
//    5. AI Mission Briefing (emotional coaching)
//
//  BRIEFING SCHEDULE (CST):
//    Overnight / weekends : every 4 hours
//    6:00am – 7:59am      : every 30 min
//    8:00am – 8:29am      : every 15 min  ← emotional coaching
//    8:30am – 9:30am      : every 15 min  ← market open critical
//    9:31am – 2:59pm      : every 30 min
//    After 3:00pm         : every 4 hours
//
//  All times in CST 12-hour format.
// ============================================================

var SHEET_DASHBOARD = "🖥️ DASHBOARD";

// ─────────────────────────────────────────────────────────────
// PALETTE
// ─────────────────────────────────────────────────────────────
var DB = {
  // Base backgrounds
  BG_VOID:      "#020209",   // deepest black — banner bg
  BG_BASE:      "#06060f",   // sheet base
  BG_PANEL:     "#0a0a18",   // section panel rows
  BG_LABEL_ROW: "#080813",   // label rows (slightly lighter than panel)
  BG_TERMINAL:  "#050510",   // briefing text terminal

  // Section accent strip colors (column A)
  STRIP_SPY:    "#0099cc",   // cyan-blue
  STRIP_MKT:    "#007744",   // deep green
  STRIP_AI:     "#6600cc",   // purple
  STRIP_ES:     "#cc8800",   // gold
  STRIP_BRIEF:  "#cc4400",   // amber-orange

  // Section header bar backgrounds
  HDR_BG_SPY:   "#001824",
  HDR_BG_MKT:   "#001408",
  HDR_BG_AI:    "#0f0018",
  HDR_BG_ES:    "#1a1000",
  HDR_BG_BRIEF: "#180800",

  // Section header text
  HDR_TXT_SPY:   "#00ccff",
  HDR_TXT_MKT:   "#00ff88",
  HDR_TXT_AI:    "#bb88ff",
  HDR_TXT_ES:    "#ffcc00",
  HDR_TXT_BRIEF: "#ff8800",

  // Data text
  TXT_LABEL:    "#3a3a6a",   // muted blue-grey for field names
  TXT_DIM:      "#252540",   // very dim — spacers / metadata
  TXT_BASE:     "#b0b0d0",   // normal values
  TXT_BRIGHT:   "#e8e8ff",   // prominent values
  TXT_CYAN:     "#00e5ff",   // SPY price, key readings
  TXT_GREEN:    "#00e676",   // positive / aligned
  TXT_RED:      "#ff4444",   // negative / void
  TXT_GOLD:     "#ffd600",   // action items / next event
  TXT_ORANGE:   "#ff9800",   // briefing / caution
  TXT_PURPLE:   "#cc88ff",   // AI mode
  TXT_SILVER:   "#8888aa",   // secondary values

  // Special
  BANNER_TXT:   "#00e5ff",
  BANNER_SUB:   "#003344",
  TERMINAL_TXT: "#ffcc88"    // briefing text — warm amber on dark
};

// ─────────────────────────────────────────────────────────────
// BRIEFING INTERVALS (minutes between Gemini calls)
// ─────────────────────────────────────────────────────────────
var BRIEF_INTERVALS = {
  OVERNIGHT:        240,
  PRE_MARKET_EARLY:  30,
  PRE_MARKET_HOT:    15,
  MARKET_OPEN:       15,
  INTRADAY:          30,
  WIND_DOWN:        240
};

// ─────────────────────────────────────────────────────────────
// ES ALIGNMENT THRESHOLDS
// ─────────────────────────────────────────────────────────────
var ES_ALIGN = {
  VOID_DROP_PCT:    1.0,
  CAUTION_RISE_PCT: 0.5,
  MONITOR_PCT:      0.5
};

// ─────────────────────────────────────────────────────────────
// ROW MAP  (single source of truth for row numbers)
// ─────────────────────────────────────────────────────────────
var DR = {
  BANNER:        1,
  SUBTITLE:      2,
  SPACER_1:      3,

  HDR_SPY:       4,
  SPY_PRICE:     5,
  SPACER_2:      6,

  HDR_MKT:       7,
  MKT_STATUS:    8,
  MKT_NEXT:      9,
  SPACER_3:      10,

  HDR_AI:        11,
  AI_MODE:       12,
  AI_WAITING:    13,
  AI_NEXT:       14,
  SPACER_4:      15,

  HDR_ES:        16,
  ES_PRICE:      17,
  ES_ALIGN:      18,
  ES_SIGNAL:     19,
  ES_ACTION:     20,
  SPACER_5:      21,

  HDR_BRIEF:     22,
  BRIEF_META:    23,
  BRIEF_TEXT:    24,   // tall merged row — the terminal window
  SPACER_6:      32    // after brief (brief text occupies 24–31)
};

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY — called from runEvery5Minutes()
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

    // ── Write each section ────────────────────────────────────
    writeSPYSection(sheet, data);
    writeMarketSection(sheet, cstMins, dow);
    writeAISection(sheet, cstMins, dow);
    writeESSection(sheet, esData);
    writeBriefSection(sheet, data, esData, vixData, cst, cstMins, dow, shouldBrief);

    // ── Subtitle row: last refreshed ─────────────────────────
    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mm a");
    var dateStr = Utilities.formatDate(cst, "America/Chicago", "EEE, MMM d yyyy");
    sheet.getRange(DR.SUBTITLE, 1, 1, 5).merge()
      .setValue("LAST REFRESHED  ·  " + timeStr + " CST  ·  " + dateStr)
      .setFontColor(DB.TXT_LABEL)
      .setFontSize(8)
      .setHorizontalAlignment("center")
      .setBackground(DB.BG_VOID);

    Logger.log("Dashboard updated at " + timeStr + " CST");
  } catch (e) {
    Logger.log("runDashboardTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 1 — SPY PRICE  (row 5)
// ─────────────────────────────────────────────────────────────
function writeSPYSection(sheet, data) {
  try {
    var price     = data ? (data.price     || 0) : 0;
    var prevClose = data ? (data.prevClose || price) : 0;
    var change    = price - prevClose;
    var changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    var isUp      = change >= 0;
    var arrow     = isUp ? "▲" : "▼";
    var sign      = isUp ? "+" : "";
    var priceFg   = isUp ? DB.TXT_GREEN : DB.TXT_RED;

    var priceStr  = price > 0 ? "$" + price.toFixed(2) : "—";
    var changeStr = price > 0 ? arrow + " " + sign + change.toFixed(2) + "  (" + sign + changePct.toFixed(2) + "%)" : "—";
    var prevStr   = prevClose > 0 ? "prev close  $" + prevClose.toFixed(2) : "—";

    // Accent strip
    sheet.getRange(DR.SPY_PRICE, 1).setBackground(DB.STRIP_SPY);
    // Label
    sheet.getRange(DR.SPY_PRICE, 2).setValue("LAST PRICE")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    // Primary value — big price
    sheet.getRange(DR.SPY_PRICE, 3).setValue(priceStr)
      .setFontColor(DB.TXT_CYAN).setFontSize(18).setFontWeight("bold")
      .setHorizontalAlignment("left").setFontFamily("Roboto Mono");
    // Secondary — change
    sheet.getRange(DR.SPY_PRICE, 4).setValue(changeStr)
      .setFontColor(priceFg).setFontSize(12).setFontWeight("bold")
      .setHorizontalAlignment("left");
    // Tertiary — prev close
    sheet.getRange(DR.SPY_PRICE, 5).setValue(prevStr)
      .setFontColor(DB.TXT_SILVER).setFontSize(9)
      .setHorizontalAlignment("left");

    // Row bg
    sheet.getRange(DR.SPY_PRICE, 1, 1, 5).setBackground(DB.BG_PANEL);
    sheet.getRange(DR.SPY_PRICE, 1).setBackground(DB.STRIP_SPY);
    sheet.setRowHeight(DR.SPY_PRICE, 36);

  } catch (e) { Logger.log("writeSPYSection ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// SECTION 2 — MARKET STATUS  (rows 8–9)
// ─────────────────────────────────────────────────────────────
function writeMarketSection(sheet, cstMins, dow) {
  try {
    var s = getMarketStatus(cstMins, dow);

    // Row 8: status
    sheet.getRange(DR.MKT_STATUS, 1, 1, 5).setBackground(DB.BG_PANEL);
    sheet.getRange(DR.MKT_STATUS, 1).setBackground(DB.STRIP_MKT);
    sheet.getRange(DR.MKT_STATUS, 2).setValue("STATUS")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.MKT_STATUS, 3).setValue(s.label)
      .setFontColor(s.color).setFontSize(13).setFontWeight("bold");
    sheet.getRange(DR.MKT_STATUS, 4).setValue(s.session)
      .setFontColor(DB.TXT_BASE).setFontSize(10);
    sheet.getRange(DR.MKT_STATUS, 5).setValue(s.countdown)
      .setFontColor(DB.TXT_GOLD).setFontSize(9);
    sheet.setRowHeight(DR.MKT_STATUS, 28);

    // Row 9: next event
    sheet.getRange(DR.MKT_NEXT, 1, 1, 5).setBackground(DB.BG_LABEL_ROW);
    sheet.getRange(DR.MKT_NEXT, 1).setBackground(DB.STRIP_MKT);
    sheet.getRange(DR.MKT_NEXT, 2).setValue("NEXT EVENT")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.MKT_NEXT, 3, 1, 3).merge().setValue(s.next)
      .setFontColor(DB.TXT_GOLD).setFontSize(10);
    sheet.setRowHeight(DR.MKT_NEXT, 22);

  } catch (e) { Logger.log("writeMarketSection ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// SECTION 3 — AI STATUS  (rows 12–14)
// ─────────────────────────────────────────────────────────────
function writeAISection(sheet, cstMins, dow) {
  try {
    var ai = getAIStatus(cstMins, dow);

    // Row 12: mode
    sheet.getRange(DR.AI_MODE, 1, 1, 5).setBackground(DB.BG_PANEL);
    sheet.getRange(DR.AI_MODE, 1).setBackground(DB.STRIP_AI);
    sheet.getRange(DR.AI_MODE, 2).setValue("MODE")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.AI_MODE, 3).setValue(ai.mode)
      .setFontColor(DB.TXT_PURPLE).setFontSize(12).setFontWeight("bold");
    sheet.getRange(DR.AI_MODE, 4, 1, 2).merge().setValue(ai.modeDetail)
      .setFontColor(DB.TXT_SILVER).setFontSize(9);
    sheet.setRowHeight(DR.AI_MODE, 28);

    // Row 13: waiting for
    sheet.getRange(DR.AI_WAITING, 1, 1, 5).setBackground(DB.BG_LABEL_ROW);
    sheet.getRange(DR.AI_WAITING, 1).setBackground(DB.STRIP_AI);
    sheet.getRange(DR.AI_WAITING, 2).setValue("WATCHING")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.AI_WAITING, 3, 1, 3).merge().setValue(ai.waiting)
      .setFontColor(DB.TXT_BASE).setFontSize(10).setWrap(true);
    sheet.setRowHeight(DR.AI_WAITING, 22);

    // Row 14: next action
    sheet.getRange(DR.AI_NEXT, 1, 1, 5).setBackground(DB.BG_PANEL);
    sheet.getRange(DR.AI_NEXT, 1).setBackground(DB.STRIP_AI);
    sheet.getRange(DR.AI_NEXT, 2).setValue("NEXT ACTION")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.AI_NEXT, 3, 1, 3).merge().setValue(ai.nextAction)
      .setFontColor(DB.TXT_GOLD).setFontSize(10).setFontWeight("bold");
    sheet.setRowHeight(DR.AI_NEXT, 22);

  } catch (e) { Logger.log("writeAISection ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// SECTION 4 — ES FUTURES + ALIGNMENT  (rows 17–20)
// ─────────────────────────────────────────────────────────────
function writeESSection(sheet, esData) {
  try {
    var alignment = getESAlignmentStatus(esData);

    // Row 17: ES price + trend
    var esPrice   = esData ? "$" + esData.price.toFixed(2) : "—";
    var esChg     = esData ? (esData.changePct >= 0 ? "+" : "") + esData.changePct.toFixed(2) + "%" : "—";
    var esTrend   = esData ? esData.trend : "UNKNOWN";
    var esFg      = esData ? (esData.changePct >= 0 ? DB.TXT_GREEN : DB.TXT_RED) : DB.TXT_LABEL;
    var trendFg   = esTrend === "FADING" ? DB.TXT_GREEN : esTrend === "CLIMBING" ? DB.TXT_RED : DB.TXT_GOLD;

    sheet.getRange(DR.ES_PRICE, 1, 1, 5).setBackground(DB.BG_PANEL);
    sheet.getRange(DR.ES_PRICE, 1).setBackground(DB.STRIP_ES);
    sheet.getRange(DR.ES_PRICE, 2).setValue("ES FUTURES")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.ES_PRICE, 3).setValue(esPrice)
      .setFontColor(DB.TXT_BRIGHT).setFontSize(14).setFontWeight("bold")
      .setFontFamily("Roboto Mono");
    sheet.getRange(DR.ES_PRICE, 4).setValue(esChg)
      .setFontColor(esFg).setFontSize(11).setFontWeight("bold");
    sheet.getRange(DR.ES_PRICE, 5).setValue(esTrend)
      .setFontColor(trendFg).setFontSize(10).setFontWeight("bold");
    sheet.setRowHeight(DR.ES_PRICE, 30);

    // Row 18: alignment label — big prominent line
    sheet.getRange(DR.ES_ALIGN, 1, 1, 5).setBackground(DB.BG_PANEL);
    sheet.getRange(DR.ES_ALIGN, 1).setBackground(DB.STRIP_ES);
    sheet.getRange(DR.ES_ALIGN, 2).setValue("ALIGNMENT")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.ES_ALIGN, 3, 1, 3).merge().setValue(alignment.label)
      .setFontColor(alignment.color).setFontSize(13).setFontWeight("bold");
    sheet.setRowHeight(DR.ES_ALIGN, 28);

    // Row 19: signal / reason
    sheet.getRange(DR.ES_SIGNAL, 1, 1, 5).setBackground(DB.BG_LABEL_ROW);
    sheet.getRange(DR.ES_SIGNAL, 1).setBackground(DB.STRIP_ES);
    sheet.getRange(DR.ES_SIGNAL, 2).setValue("SIGNAL")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.ES_SIGNAL, 3, 1, 3).merge().setValue(alignment.reason)
      .setFontColor(DB.TXT_BASE).setFontSize(9).setWrap(true);
    sheet.setRowHeight(DR.ES_SIGNAL, 44);

    // Row 20: action
    sheet.getRange(DR.ES_ACTION, 1, 1, 5).setBackground(DB.BG_PANEL);
    sheet.getRange(DR.ES_ACTION, 1).setBackground(DB.STRIP_ES);
    sheet.getRange(DR.ES_ACTION, 2).setValue("PLAYBOOK")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.ES_ACTION, 3, 1, 3).merge().setValue(alignment.action)
      .setFontColor(DB.TXT_GOLD).setFontSize(9).setFontWeight("bold").setWrap(true);
    sheet.setRowHeight(DR.ES_ACTION, 44);

  } catch (e) { Logger.log("writeESSection ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// SECTION 5 — AI BRIEFING  (rows 23–31)
// ─────────────────────────────────────────────────────────────
function writeBriefSection(sheet, data, esData, vixData, cst, cstMins, dow, shouldBrief) {
  try {
    var briefText    = getFlag("DASHBOARD_BRIEF_TEXT")  || "";
    var briefTime    = getFlag("DASHBOARD_BRIEF_TIME")  || "";
    var nextBriefStr = getNextBriefTimeStr(cstMins, dow);

    // ── Fire Gemini if due ────────────────────────────────────
    if (shouldBrief) {
      var newBrief = callGeminiForDashboardBrief(data, esData, vixData, cst, cstMins, dow);
      if (newBrief) {
        briefText = newBrief;
        briefTime = Utilities.formatDate(cst, "America/Chicago", "h:mm a");
        setFlag("DASHBOARD_BRIEF_TEXT",      briefText);
        setFlag("DASHBOARD_BRIEF_TIME",      briefTime);
        setFlag("DASHBOARD_LAST_BRIEF_MINS", cstMins.toString());
      }
    }

    // ── Smart fallback — time-aware, never generic ────────────
    if (!briefText || briefText === "") {
      briefText = buildFallbackBriefText(esData, cst, cstMins, dow, nextBriefStr);
      briefTime = Utilities.formatDate(cst, "America/Chicago", "h:mm a");
    }

    // ── Row 23: meta row — posted time + next update ──────────
    var postedLabel = briefTime ? briefTime + " CST" : "—";
    sheet.getRange(DR.BRIEF_META, 1, 1, 5).setBackground(DB.BG_LABEL_ROW);
    sheet.getRange(DR.BRIEF_META, 1).setBackground(DB.STRIP_BRIEF);
    sheet.getRange(DR.BRIEF_META, 2).setValue("POSTED")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.BRIEF_META, 3).setValue(postedLabel)
      .setFontColor(DB.TXT_ORANGE).setFontSize(10).setFontWeight("bold");
    sheet.getRange(DR.BRIEF_META, 4).setValue("NEXT UPDATE")
      .setFontColor(DB.TXT_LABEL).setFontSize(8).setHorizontalAlignment("right");
    sheet.getRange(DR.BRIEF_META, 5).setValue(nextBriefStr)
      .setFontColor(DB.TXT_CYAN).setFontSize(9).setFontWeight("bold");
    sheet.setRowHeight(DR.BRIEF_META, 24);

    // ── Rows 24–31: terminal text block ──────────────────────
    sheet.getRange(DR.BRIEF_TEXT, 1, 8, 1).setBackground(DB.STRIP_BRIEF);
    sheet.getRange(DR.BRIEF_TEXT, 2, 8, 4).merge()
      .setValue(briefText)
      .setBackground(DB.BG_TERMINAL)
      .setFontColor(DB.TERMINAL_TXT)
      .setFontSize(11)
      .setFontFamily("Roboto Mono")
      .setWrap(true)
      .setVerticalAlignment("top")
      .setHorizontalAlignment("left");

    // Set individual rows in the terminal block height
    for (var r = DR.BRIEF_TEXT; r < DR.BRIEF_TEXT + 8; r++) {
      sheet.setRowHeight(r, 20);
    }
    // First row taller to give the text room to breathe
    sheet.setRowHeight(DR.BRIEF_TEXT, 130);

  } catch (e) { Logger.log("writeBriefSection ERROR: " + e.message); }
}

// ─────────────────────────────────────────────────────────────
// SMART FALLBACK BRIEF — time-aware, no Gemini needed
// ─────────────────────────────────────────────────────────────
function buildFallbackBriefText(esData, cst, cstMins, dow, nextBriefStr) {
  var timeStr   = Utilities.formatDate(cst, "America/Chicago", "h:mm a");
  var isWeekend = (dow === 0 || dow === 6);
  var esStatus  = esData ? "ES " + (esData.changePct >= 0 ? "+" : "") + esData.changePct.toFixed(2) + "% · " + esData.trend : "ES data loading";
  var mode      = getDashboardBriefMode(cstMins, dow);

  if (isWeekend) {
    return "Markets are closed for the weekend. It is " + timeStr + " CST.\n\n" +
           esStatus + ". Nothing actionable right now — the system is monitoring overnight futures.\n\n" +
           "Next briefing: " + nextBriefStr;
  }
  if (mode === "OVERNIGHT") {
    return "Markets are closed. It is " + timeStr + " CST.\n\n" +
           esStatus + ". Overnight session — nothing to act on yet. System is watching.\n\n" +
           "Next briefing: " + nextBriefStr;
  }
  if (mode === "PRE_MARKET_EARLY") {
    return "Pre-market is underway. It is " + timeStr + " CST.\n\n" +
           esStatus + ". Market opens at 8:30am CST. Do not make any trades yet — just observe the overnight context and get your head right.\n\n" +
           "Next briefing: " + nextBriefStr;
  }
  if (mode === "PRE_MARKET_HOT") {
    return "Market opens soon. It is " + timeStr + " CST.\n\n" +
           esStatus + ". This is the danger zone for impulsive trades. Take a breath. We are watching for a Bear Trap setup — do NOT jump in at open just because price moved overnight.\n\n" +
           "Next briefing: " + nextBriefStr;
  }
  if (mode === "MARKET_OPEN") {
    return "Market is open. It is " + timeStr + " CST — the Bear Trap window is active.\n\n" +
           esStatus + ". Watch for the flush → stall → flip sequence. Do not chase.\n\n" +
           "Next briefing: " + nextBriefStr;
  }
  return "Market is open. It is " + timeStr + " CST.\n\n" +
         esStatus + ". Intraday session underway.\n\n" +
         "Next briefing: " + nextBriefStr;
}

// ─────────────────────────────────────────────────────────────
// GEMINI CALL — dashboard briefing
// Budget: 200 output tokens max
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

    if (resp.getResponseCode() !== 200) {
      Logger.log("Dashboard Gemini error: " + resp.getResponseCode());
      return null;
    }

    var json = JSON.parse(resp.getContentText());
    var text = json.candidates
            && json.candidates[0]
            && json.candidates[0].content
            && json.candidates[0].content.parts
            && json.candidates[0].content.parts[0]
             ? json.candidates[0].content.parts[0].text.trim()
             : null;

    return text;
  } catch (e) {
    Logger.log("callGeminiForDashboardBrief ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────
function buildDashboardBriefPrompt(data, esData, vixData, cst, cstMins, dow) {
  var price     = data    ? "$" + data.price.toFixed(2) : "unknown";
  var pctChg    = data    ? (data.changePct >= 0 ? "+" : "") + data.changePct.toFixed(2) + "%" : "unknown";
  var esTrend   = esData  ? esData.trend : "UNKNOWN";
  var esChgPct  = esData  ? esData.changePct.toFixed(2) + "%" : "unknown";
  var vixVal    = vixData ? vixData.price.toFixed(1) + " (" + vixData.regime + ")" : "unknown";
  var timeStr   = Utilities.formatDate(cst, "America/Chicago", "h:mm a");
  var nextStr   = getNextBriefTimeStr(cstMins, dow);
  var mode      = getDashboardBriefMode(cstMins, dow);
  var alignment = getESAlignmentStatus(esData);

  var context =
    "You are a calm, direct trading coach. The user trades SPY options using the Bear Trap Open strategy — " +
    "waiting for a fake morning selloff, then buying calls when the trap springs. They tend to trade impulsively before open.\n\n" +
    "Time: " + timeStr + " CST\n" +
    "SPY: " + price + " (" + pctChg + ")\n" +
    "ES Futures: " + esTrend + " (" + esChgPct + ")\n" +
    "VIX: " + vixVal + "\n" +
    "Bear Trap alignment: " + alignment.label + "\n" +
    "Next briefing due: " + nextStr + "\n\n";

  var instruction = "";
  if (mode === "OVERNIGHT" || dow === 0 || dow === 6) {
    instruction = "Write 2-3 sentences: current overnight market context, what ES is doing, and what to watch for. End with 'Next update: " + nextStr + "'. Calm tone.";
  } else if (mode === "PRE_MARKET_EARLY") {
    instruction = "Write 2-3 sentences: note overnight context, remind user NOT to trade yet, tell them to get focused. End with 'Next update: " + nextStr + "'.";
  } else if (mode === "PRE_MARKET_HOT") {
    instruction = "IMPORTANT: Market opens very soon. Write 3-4 sentences of firm emotional coaching: (1) Don't jump in just because things moved overnight. (2) We are watching for a Bear Trap — fake flush before a rip. (3) Stay patient, let the pattern develop. Be direct and personal — like a coach before game time. End with 'Next update: " + nextStr + "'.";
  } else if (mode === "MARKET_OPEN") {
    instruction = "Market just opened or is in the first hour. Write 3 sentences: quick read on ES/SPY, whether Bear Trap conditions look present, and one specific patience coaching note. End with 'Next update: " + nextStr + "'.";
  } else {
    instruction = "Intraday update. Write 2 sentences: brief market read and one tactical note. End with 'Next update: " + nextStr + "'.";
  }

  return context + "INSTRUCTION: " + instruction + "\nRespond with ONLY the briefing text. No labels, no headers, no disclaimers.";
}

// ─────────────────────────────────────────────────────────────
// SHOULD FIRE BRIEF?
// ─────────────────────────────────────────────────────────────
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
    Logger.log("shouldFireDashboardBrief ERROR: " + e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// BRIEF MODE
// ─────────────────────────────────────────────────────────────
function getDashboardBriefMode(cstMins, dow) {
  if (dow === 0 || dow === 6) return "OVERNIGHT";
  if (cstMins < 360)  return "OVERNIGHT";        // before 6am
  if (cstMins < 480)  return "PRE_MARKET_EARLY"; // 6:00–7:59am
  if (cstMins < 510)  return "PRE_MARKET_HOT";   // 8:00–8:29am
  if (cstMins < 570)  return "MARKET_OPEN";      // 8:30–9:29am
  if (cstMins < 900)  return "INTRADAY";         // 9:30am–2:59pm
  return "WIND_DOWN";
}

// ─────────────────────────────────────────────────────────────
// NEXT BRIEF TIME STRING
// ─────────────────────────────────────────────────────────────
function getNextBriefTimeStr(cstMins, dow) {
  try {
    var lastMinsStr = getFlag("DASHBOARD_LAST_BRIEF_MINS");
    var lastMins    = (lastMinsStr && lastMinsStr !== "") ? parseInt(lastMinsStr) : cstMins;
    if (isNaN(lastMins)) lastMins = cstMins;

    var mode     = getDashboardBriefMode(cstMins, dow);
    var interval = BRIEF_INTERVALS.OVERNIGHT;
    if      (mode === "PRE_MARKET_EARLY") interval = BRIEF_INTERVALS.PRE_MARKET_EARLY;
    else if (mode === "PRE_MARKET_HOT")   interval = BRIEF_INTERVALS.PRE_MARKET_HOT;
    else if (mode === "MARKET_OPEN")      interval = BRIEF_INTERVALS.MARKET_OPEN;
    else if (mode === "INTRADAY")         interval = BRIEF_INTERVALS.INTRADAY;
    else if (mode === "WIND_DOWN")        interval = BRIEF_INTERVALS.WIND_DOWN;

    var nextMins = (lastMins + interval) % 1440;
    var h    = Math.floor(nextMins / 60);
    var m    = nextMins % 60;
    var ampm = h >= 12 ? "pm" : "am";
    var h12  = h % 12 || 12;
    var mStr = m < 10 ? "0" + m : "" + m;

    var remaining = nextMins >= cstMins ? nextMins - cstMins : (1440 - cstMins) + nextMins;
    var remStr = remaining <= 1   ? "now"
               : remaining <= 60  ? "~" + remaining + " min"
               : "~" + Math.round(remaining / 60) + " hr";

    return h12 + ":" + mStr + " " + ampm + " CST  (" + remStr + ")";
  } catch (e) {
    return "—";
  }
}

// ─────────────────────────────────────────────────────────────
// MARKET STATUS
// ─────────────────────────────────────────────────────────────
function getMarketStatus(cstMins, dow) {
  var isWeekend = (dow === 0 || dow === 6);

  if (isWeekend) {
    var dayName = dow === 6 ? "Saturday" : "Sunday";
    return {
      label:     "CLOSED  ·  " + dayName,
      session:   "Weekend — all sessions closed",
      countdown: "",
      next:      "Pre-market opens Monday ~3:00am CST  ·  Regular open 8:30am CST",
      color:     DB.TXT_LABEL
    };
  }
  // Pre-market 3am–8:29am (180–509)
  if (cstMins >= 180 && cstMins < 510) {
    var mins = 510 - cstMins;
    return {
      label:     "PRE-MARKET",
      session:   "Pre-market session active",
      countdown: "Opens in " + mins + " min",
      next:      "Regular session opens 8:30am CST",
      color:     DB.TXT_ORANGE
    };
  }
  // Regular session 8:30am–2:59pm (510–899)
  if (cstMins >= 510 && cstMins < 900) {
    var mins = 900 - cstMins;
    return {
      label:     "MARKET OPEN",
      session:   "Regular trading session",
      countdown: "Closes in " + mins + " min",
      next:      "Market closes 3:00pm CST",
      color:     DB.TXT_GREEN
    };
  }
  // After-hours 3pm–8:59pm (900–1259)
  if (cstMins >= 900 && cstMins < 1260) {
    return {
      label:     "AFTER HOURS",
      session:   "After-hours / extended session",
      countdown: "",
      next:      "Pre-market opens tomorrow ~3:00am CST",
      color:     DB.TXT_PURPLE
    };
  }
  // Overnight <3am or >9pm
  return {
    label:     "OVERNIGHT",
    session:   "Overnight — markets closed",
    countdown: "",
    next:      "Pre-market opens ~3:00am CST",
    color:     DB.TXT_LABEL
  };
}

// ─────────────────────────────────────────────────────────────
// AI STATUS
// ─────────────────────────────────────────────────────────────
function getAIStatus(cstMins, dow) {
  if (dow === 0 || dow === 6) {
    return {
      mode:       "STANDBY  ·  Weekend",
      modeDetail: "Briefings every 4 hours",
      waiting:    "Weekend — no market activity expected",
      nextAction: "Full monitoring resumes Monday 6:00am CST"
    };
  }
  if (cstMins < 360) return {
    mode: "OVERNIGHT WATCH", modeDetail: "Passive monitoring",
    waiting: "ES futures movement + overnight price action",
    nextAction: "Pre-market coaching begins 6:00am CST"
  };
  if (cstMins < 480) return {
    mode: "PRE-MARKET WATCH", modeDetail: "6:00am – 8:00am window",
    waiting: "Overnight context forming — not yet actionable",
    nextAction: "Emotional coaching ramps up at 8:00am CST"
  };
  if (cstMins < 510) return {
    mode: "PRE-OPEN COACHING", modeDetail: "8:00am – 8:30am  ⚠️ HIGH ALERT",
    waiting: "ES trend + Bear Trap setup conditions",
    nextAction: "Market opens 8:30am CST — STAY PATIENT · WATCH FOR TRAP"
  };
  if (cstMins < 555) return {
    mode: "BEAR TRAP WATCH  ·  ACTIVE", modeDetail: "8:30am – 9:15am window",
    waiting: "Morning flush → volume stall → momentum flip sequence",
    nextAction: "Active window runs until 9:15am CST · Do NOT buy during flush"
  };
  if (cstMins < 570) return {
    mode: "BEAR TRAP  ·  LATE WINDOW", modeDetail: "Approaching close",
    waiting: "Late flip signal or pattern failure confirmation",
    nextAction: "Critical window closes 9:15am CST"
  };
  if (cstMins < 900) return {
    mode: "INTRADAY MONITOR", modeDetail: "Post-trap session",
    waiting: "Intraday price action + momentum",
    nextAction: "EOD brief fires at 3:00pm CST"
  };
  return {
    mode: "EOD  ·  WIND-DOWN", modeDetail: "Day complete",
    waiting: "Day summary + signal accuracy review",
    nextAction: "Overnight watch begins · Next active session ~6:00am CST"
  };
}

// ─────────────────────────────────────────────────────────────
// ES ALIGNMENT STATUS
// ─────────────────────────────────────────────────────────────
function getESAlignmentStatus(esData) {
  if (!esData) return {
    label:  "UNKNOWN  ·  No ES Data",
    reason: "ES futures data unavailable. Cannot assess Bear Trap alignment.",
    action: "Check data connection. Proceed with caution — assume uncertain.",
    color:  DB.TXT_LABEL
  };

  var trend = esData.trend;
  var pct   = esData.changePct;

  if (trend === "FADING" && pct < -ES_ALIGN.VOID_DROP_PCT) return {
    label:  "VOID  ·  Strategy Off Today",
    reason: "ES down " + Math.abs(pct).toFixed(2) + "% and FADING hard. This looks like real distribution — not a manufactured flush. Bear Trap requires ES near highs.",
    action: "SKIP Bear Trap today. Do NOT buy calls into this move. Wait for a cleaner day.",
    color:  DB.TXT_RED
  };

  if (trend === "CLIMBING" && pct > ES_ALIGN.CAUTION_RISE_PCT) return {
    label:  "CAUTION  ·  Flush May Follow Through",
    reason: "ES up " + pct.toFixed(2) + "% and still CLIMBING. Morning flush into a rising ES can be real selling, not a trap.",
    action: "Reduce conviction. Require confidence >80% before entering. Smaller size if you trade.",
    color:  DB.TXT_ORANGE
  };

  if (trend === "FLAT" && pct < -ES_ALIGN.MONITOR_PCT) return {
    label:  "MONITOR  ·  Ambiguous Setup",
    reason: "ES flat but sitting " + Math.abs(pct).toFixed(2) + "% below overnight high. Key setup requirement (OH tag) not yet confirmed.",
    action: "Watch whether ES recovers toward overnight high before open. Recovery = setup strengthens.",
    color:  DB.TXT_GOLD
  };

  if (trend === "FADING") return {
    label:  "ALIGNED  ·  Classic Bear Trap Setup",
    reason: "ES FADING from overnight high (" + pct.toFixed(2) + "%). Textbook setup: futures peak → fade → SPY opens → flush retail stops → rip.",
    action: "Stay ready. Watch for: flush in first 15 min · stall on weak volume · flip signal. Enter calls ONLY on flip confirmation.",
    color:  DB.TXT_GREEN
  };

  return {
    label:  "ALIGNED  ·  ES Flat Near Highs",
    reason: "ES FLAT (" + pct.toFixed(2) + "%). Consolidating near overnight levels — valid Bear Trap precondition. Flush can still manufacture retail panic.",
    action: "Setup is live. Watch for morning flush. Require confidence >65% before entering calls.",
    color:  DB.TXT_GREEN
  };
}

// ─────────────────────────────────────────────────────────────
// SECTION HEADER BAR helper
// ─────────────────────────────────────────────────────────────
function writeSectionHeader(sheet, row, stripColor, bgColor, txtColor, label) {
  sheet.getRange(row, 1, 1, 5).merge()
    .setValue(label)
    .setBackground(bgColor)
    .setFontColor(txtColor)
    .setFontWeight("bold")
    .setFontSize(9)
    .setFontFamily("Trebuchet MS")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(row, 24);
  // Left 4px painted with accent color using a narrow left border trick via background
  // (Sheets can't do CSS borders, so we use column A background which is 8px wide)
}

// ─────────────────────────────────────────────────────────────
// SPACER ROW helper
// ─────────────────────────────────────────────────────────────
function writeSpacerRow(sheet, row) {
  sheet.getRange(row, 1, 1, 5).merge()
    .setValue("").setBackground(DB.BG_BASE);
  sheet.setRowHeight(row, 8);
}

// ─────────────────────────────────────────────────────────────
// SHEET SETUP — run once
// ─────────────────────────────────────────────────────────────
function setupDashboardSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_DASHBOARD);
  if (!sheet) sheet = ss.insertSheet(SHEET_DASHBOARD);

  sheet.setTabColor("#00e5ff");
  sheet.clearContents();
  sheet.clearFormats();

  // ── Column widths ─────────────────────────────────────────
  sheet.setColumnWidth(1,  8);    // A — accent strip
  sheet.setColumnWidth(2,  120);  // B — label
  sheet.setColumnWidth(3,  260);  // C — primary value
  sheet.setColumnWidth(4,  200);  // D — secondary value
  sheet.setColumnWidth(5,  160);  // E — tertiary

  // ── Base background for all rows ─────────────────────────
  sheet.getRange(1, 1, 50, 5).setBackground(DB.BG_BASE);

  // ── Row 1: Banner ────────────────────────────────────────
  sheet.getRange(1, 1, 1, 5).merge()
    .setValue("  ⚡  M I S S I O N   C O N T R O L  ·  S P Y   I N T E L L I G E N C E   D A S H B O A R D")
    .setBackground(DB.BG_VOID)
    .setFontColor(DB.BANNER_TXT)
    .setFontWeight("bold")
    .setFontSize(13)
    .setFontFamily("Georgia")
    .setHorizontalAlignment("left")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 46);

  // ── Row 2: Subtitle ───────────────────────────────────────
  sheet.getRange(2, 1, 1, 5).merge()
    .setValue("Initializing system...")
    .setBackground(DB.BG_VOID)
    .setFontColor(DB.TXT_LABEL)
    .setFontSize(8)
    .setHorizontalAlignment("center");
  sheet.setRowHeight(2, 20);

  // ── Spacer row 3 ─────────────────────────────────────────
  writeSpacerRow(sheet, DR.SPACER_1);

  // ── Section headers (static — written once at setup) ─────
  writeSectionHeader(sheet, DR.HDR_SPY,   DB.STRIP_SPY,   DB.HDR_BG_SPY,   DB.HDR_TXT_SPY,   "  ◈  SECTION 01  ·  SPY LAST CLOSE");
  writeSectionHeader(sheet, DR.HDR_MKT,   DB.STRIP_MKT,   DB.HDR_BG_MKT,   DB.HDR_TXT_MKT,   "  ◈  SECTION 02  ·  MARKET STATUS");
  writeSectionHeader(sheet, DR.HDR_AI,    DB.STRIP_AI,    DB.HDR_BG_AI,    DB.HDR_TXT_AI,    "  ◈  SECTION 03  ·  AI SYSTEM STATUS");
  writeSectionHeader(sheet, DR.HDR_ES,    DB.STRIP_ES,    DB.HDR_BG_ES,    DB.HDR_TXT_ES,    "  ◈  SECTION 04  ·  ES FUTURES  &  BEAR TRAP ALIGNMENT");
  writeSectionHeader(sheet, DR.HDR_BRIEF, DB.STRIP_BRIEF, DB.HDR_BG_BRIEF, DB.HDR_TXT_BRIEF, "  ◈  SECTION 05  ·  AI MISSION BRIEFING");

  // ── Spacer rows ───────────────────────────────────────────
  writeSpacerRow(sheet, DR.SPACER_2);
  writeSpacerRow(sheet, DR.SPACER_3);
  writeSpacerRow(sheet, DR.SPACER_4);
  writeSpacerRow(sheet, DR.SPACER_5);

  // ── Label column (B) alignment for all data rows ──────────
  var dataRows = [
    DR.SPY_PRICE,
    DR.MKT_STATUS, DR.MKT_NEXT,
    DR.AI_MODE, DR.AI_WAITING, DR.AI_NEXT,
    DR.ES_PRICE, DR.ES_ALIGN, DR.ES_SIGNAL, DR.ES_ACTION,
    DR.BRIEF_META
  ];
  for (var i = 0; i < dataRows.length; i++) {
    sheet.getRange(dataRows[i], 2)
      .setHorizontalAlignment("right")
      .setVerticalAlignment("middle")
      .setFontColor(DB.TXT_LABEL)
      .setFontSize(8);
    sheet.getRange(dataRows[i], 3)
      .setVerticalAlignment("middle");
  }

  // ── Freeze top 2 rows ─────────────────────────────────────
  sheet.setFrozenRows(2);

  // ── Hide gridlines via sheet options ─────────────────────
  // (Can only be done via UI, but we set row/col appearance to compensate)

  Logger.log("Dashboard sheet setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRY
// ─────────────────────────────────────────────────────────────
function setupDashboardSheetFromMenu() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  setupDashboardSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🖥️ MISSION CONTROL\n\n" +
    "✅ Dashboard created!\n\n" +
    "SECTIONS:\n" +
    "  01 · SPY last close + % change\n" +
    "  02 · Market status + countdown\n" +
    "  03 · AI mode + what it's watching\n" +
    "  04 · ES futures + Bear Trap alignment\n" +
    "  05 · AI briefing (emotional coaching)\n\n" +
    "BRIEFING SCHEDULE:\n" +
    "  Overnight / weekends  →  every 4 hours\n" +
    "  6:00am – 8:00am       →  every 30 min\n" +
    "  8:00am – 8:30am       →  every 15 min  ← coaching\n" +
    "  8:30am – 9:30am       →  every 15 min  ← critical\n" +
    "  9:30am – 3:00pm       →  every 30 min\n" +
    "  After 3:00pm          →  every 4 hours\n\n" +
    "Run 'Refresh Dashboard Now' to populate immediately."
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
    setFlag("DASHBOARD_LAST_BRIEF_MINS", "-9999"); // force new brief
    runDashboardTick(data, now);
    SpreadsheetApp.getUi().alert("✅ Dashboard refreshed!\nSPY: $" + data.price.toFixed(2));
  } catch (e) {
    Logger.log("runManualDashboardRefresh ERROR: " + e.message);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message);
  }
}
