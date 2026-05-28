// ============================================================
// FILE: Dashboard.gs
// PURPOSE: 🖥️ MISSION CONTROL — System-wide status dashboard.
//
//  SECTIONS:
//    1. SPY Last Close Price + % Change
//    2. Current Market Status
//    3. AI Status (what it's waiting to do next)
//    4. ES Futures Movement + Bear Trap Alignment Check
//    5. AI Briefing (emotional coaching + tactical notes)
//
//  BRIEFING SCHEDULE (CST):
//    Overnight / weekends:  every 4 hours
//    6:00am – 7:59am:       every 30 min (pre-market watch)
//    8:00am – 8:29am:       every 15 min (emotional coaching ramp-up)
//    8:30am – 9:30am:       every 15 min (market open critical window)
//    9:31am – 2:59pm:       every 30 min (intraday updates)
//    After 3:00pm:          every 4 hours (wind-down)
//
//  ES ALIGNMENT:
//    ✅ ALIGNED  — ES FADING from overnight high (classic trap setup)
//    ⚠️ MONITOR  — ES flat well below overnight high (ambiguous)
//    ❌ VOID     — ES falling hard >1% (real distribution, skip trap)
//    🚫 CAUTION  — ES climbing >0.5% (flush may follow through)
//
//  All times in CST 12-hour format.
//  Budget: tight — gated by DASHBOARD_LAST_BRIEF_TIME flag.
// ============================================================

var SHEET_DASHBOARD = "🖥️ DASHBOARD";

// ─────────────────────────────────────────────────────────────
// DASHBOARD COLORS  (matches existing sci-fi dark theme)
// ─────────────────────────────────────────────────────────────
var DB = {
  // Backgrounds
  BG_BANNER:   "#030318",
  BG_SECTION:  "#0d0d2b",
  BG_LABEL:    "#12122e",
  BG_VALUE:    "#0a0a1e",
  BG_SPACER:   "#07071a",

  // Section accent strips
  STRIP_SPY:   "#001a33",
  STRIP_MKT:   "#0a1a00",
  STRIP_AI:    "#1a0a2e",
  STRIP_ES:    "#1a1000",
  STRIP_BRIEF: "#0f0800",

  // Text
  TEXT_BANNER:  "#00e5ff",
  TEXT_LABEL:   "#6060aa",
  TEXT_VALUE:   "#d0d0e8",
  TEXT_DIM:     "#404060",
  TEXT_GOLD:    "#ffd600",
  TEXT_GREEN:   "#00e676",
  TEXT_RED:     "#ff5252",
  TEXT_CYAN:    "#00e5ff",
  TEXT_ORANGE:  "#ff9800",
  TEXT_PURPLE:  "#ce93d8",

  // Section header text colors
  HDR_SPY:     "#4fc3f7",
  HDR_MKT:     "#69f0ae",
  HDR_AI:      "#ce93d8",
  HDR_ES:      "#ffca28",
  HDR_BRIEF:   "#ff9800"
};

// ─────────────────────────────────────────────────────────────
// BRIEFING INTERVAL THRESHOLDS (minutes)
// ─────────────────────────────────────────────────────────────
var BRIEF_INTERVALS = {
  OVERNIGHT:       240,  // every 4 hours (overnight + weekends)
  PRE_MARKET_EARLY: 30,  // 6:00am–7:59am
  PRE_MARKET_HOT:   15,  // 8:00am–8:29am  (emotional coaching)
  MARKET_OPEN:      15,  // 8:30am–9:30am  (critical window)
  INTRADAY:         30,  // 9:31am–2:59pm
  WIND_DOWN:       240   // after 3:00pm
};

// ─────────────────────────────────────────────────────────────
// ES ALIGNMENT THRESHOLDS
// ─────────────────────────────────────────────────────────────
var ES_ALIGN = {
  VOID_DROP_PCT:    1.0,  // >1.0% below overnight high = VOID
  CAUTION_RISE_PCT: 0.5,  // >0.5% above overnight high = CAUTION
  MONITOR_PCT:      0.5   // >0.5% below oh but <1.0% = MONITOR
};

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY — called from runEvery5Minutes() in Code.gs
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
    var dow     = cst.getDay(); // 0=Sun, 6=Sat

    // ── Fetch supporting data ─────────────────────────────────
    var esData  = fetchESFutures();
    var vixData = fetchVIX();

    // ── Determine if we should fire a new AI briefing ─────────
    var shouldBrief = shouldFireDashboardBrief(cst, cstMins, dow);

    // ── Write all static sections ─────────────────────────────
    writeSPYSection(sheet, data, cst);
    writeMarketStatusSection(sheet, data, cst, cstMins, dow);
    writeAIStatusSection(sheet, cst, cstMins, dow);
    writeESSection(sheet, esData, data);

    // ── Write AI briefing (may or may not fire Gemini) ────────
    writeBriefingSection(sheet, data, esData, vixData, cst, cstMins, dow, shouldBrief);

    // ── Update "last refreshed" timestamp ─────────────────────
    var timeStr = Utilities.formatDate(cst, "America/Chicago", "h:mm a");
    sheet.getRange(2, 2).setValue("Last refreshed: " + timeStr + " CST");

    Logger.log("Dashboard updated at " + timeStr + " CST");

  } catch (e) {
    Logger.log("runDashboardTick ERROR: " + e.message + "\n" + e.stack);
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 1 — SPY PRICE
// Rows 4–6
// ─────────────────────────────────────────────────────────────
function writeSPYSection(sheet, data, cst) {
  try {
    var price     = data.price     || 0;
    var prevClose = data.prevClose || price;
    var change    = price - prevClose;
    var changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    var isUp      = change >= 0;

    var priceStr  = "$" + price.toFixed(2);
    var changeStr = (isUp ? "+" : "") + change.toFixed(2)
                  + "  (" + (isUp ? "+" : "") + changePct.toFixed(2) + "%)";
    var prevStr   = "Prev Close: $" + prevClose.toFixed(2);
    var arrow     = isUp ? "▲" : "▼";

    sheet.getRange(4, 1).setValue("💰 SPY");
    sheet.getRange(4, 2).setValue(priceStr);
    sheet.getRange(5, 1).setValue("Change");
    sheet.getRange(5, 2).setValue(arrow + " " + changeStr);
    sheet.getRange(6, 1).setValue("Reference");
    sheet.getRange(6, 2).setValue(prevStr);

    // Styling
    var priceFg = isUp ? DB.TEXT_GREEN : DB.TEXT_RED;
    sheet.getRange(4, 2).setFontColor(DB.TEXT_CYAN).setFontSize(16).setFontWeight("bold");
    sheet.getRange(5, 2).setFontColor(priceFg).setFontSize(13).setFontWeight("bold");
    sheet.getRange(6, 2).setFontColor(DB.TEXT_LABEL).setFontSize(10);

    // Section header row
    sheet.getRange(3, 1, 1, 4).merge()
      .setValue("━━━  SECTION 1 · SPY LAST CLOSE  ━━━")
      .setBackground(DB.STRIP_SPY)
      .setFontColor(DB.HDR_SPY)
      .setFontWeight("bold")
      .setFontSize(10)
      .setHorizontalAlignment("left");

  } catch (e) {
    Logger.log("writeSPYSection ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 2 — MARKET STATUS
// Rows 8–10
// ─────────────────────────────────────────────────────────────
function writeMarketStatusSection(sheet, data, cst, cstMins, dow) {
  try {
    var status = getMarketStatus(cstMins, dow);

    sheet.getRange(8, 1).setValue("🏛️ Market");
    sheet.getRange(8, 2).setValue(status.label);
    sheet.getRange(9, 1).setValue("Session");
    sheet.getRange(9, 2).setValue(status.session);
    sheet.getRange(10, 1).setValue("Next event");
    sheet.getRange(10, 2).setValue(status.next);

    sheet.getRange(8, 2).setFontColor(status.color).setFontSize(13).setFontWeight("bold");
    sheet.getRange(9, 2).setFontColor(DB.TEXT_VALUE).setFontSize(10);
    sheet.getRange(10, 2).setFontColor(DB.TEXT_GOLD).setFontSize(10);

    sheet.getRange(7, 1, 1, 4).merge()
      .setValue("━━━  SECTION 2 · MARKET STATUS  ━━━")
      .setBackground(DB.STRIP_MKT)
      .setFontColor(DB.HDR_MKT)
      .setFontWeight("bold")
      .setFontSize(10)
      .setHorizontalAlignment("left");

  } catch (e) {
    Logger.log("writeMarketStatusSection ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 3 — AI STATUS
// Rows 12–14
// ─────────────────────────────────────────────────────────────
function writeAIStatusSection(sheet, cst, cstMins, dow) {
  try {
    var aiStatus = getAIStatus(cstMins, dow);

    sheet.getRange(12, 1).setValue("🤖 AI Mode");
    sheet.getRange(12, 2).setValue(aiStatus.mode);
    sheet.getRange(13, 1).setValue("Waiting for");
    sheet.getRange(13, 2).setValue(aiStatus.waiting);
    sheet.getRange(14, 1).setValue("Next action");
    sheet.getRange(14, 2).setValue(aiStatus.nextAction);

    sheet.getRange(12, 2).setFontColor(DB.TEXT_PURPLE).setFontSize(12).setFontWeight("bold");
    sheet.getRange(13, 2).setFontColor(DB.TEXT_VALUE).setFontSize(10);
    sheet.getRange(14, 2).setFontColor(DB.TEXT_GOLD).setFontSize(10);

    sheet.getRange(11, 1, 1, 4).merge()
      .setValue("━━━  SECTION 3 · AI STATUS  ━━━")
      .setBackground(DB.STRIP_AI)
      .setFontColor(DB.HDR_AI)
      .setFontWeight("bold")
      .setFontSize(10)
      .setHorizontalAlignment("left");

  } catch (e) {
    Logger.log("writeAIStatusSection ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 4 — ES FUTURES + BEAR TRAP ALIGNMENT
// Rows 16–20
// ─────────────────────────────────────────────────────────────
function writeESSection(sheet, esData, spyData) {
  try {
    var esPrice   = esData  ? "$" + esData.price.toFixed(2)     : "—";
    var esChange  = esData  ? (esData.changePct >= 0 ? "+" : "") + esData.changePct.toFixed(2) + "%" : "—";
    var esTrend   = esData  ? esData.trend : "UNKNOWN";
    var alignment = getESAlignmentStatus(esData);

    sheet.getRange(16, 1).setValue("📡 ES Futures");
    sheet.getRange(16, 2).setValue(esPrice + "  (" + esChange + ")");
    sheet.getRange(17, 1).setValue("ES Trend");
    sheet.getRange(17, 2).setValue(esTrend);
    sheet.getRange(18, 1).setValue("Bear Trap Align");
    sheet.getRange(18, 2).setValue(alignment.label);
    sheet.getRange(19, 1).setValue("Why");
    sheet.getRange(19, 2, 1, 3).merge().setValue(alignment.reason);
    sheet.getRange(20, 1).setValue("Strategy");
    sheet.getRange(20, 2, 1, 3).merge().setValue(alignment.action);

    var esChangePct = esData ? esData.changePct : 0;
    var esFg = esChangePct >= 0 ? DB.TEXT_GREEN : DB.TEXT_RED;
    sheet.getRange(16, 2).setFontColor(esFg).setFontSize(12).setFontWeight("bold");
    sheet.getRange(17, 2).setFontColor(
      esTrend === "FADING"   ? DB.TEXT_GREEN :
      esTrend === "CLIMBING" ? DB.TEXT_RED   : DB.TEXT_GOLD
    ).setFontSize(10);
    sheet.getRange(18, 2).setFontColor(alignment.color).setFontSize(13).setFontWeight("bold");
    sheet.getRange(19, 2).setFontColor(DB.TEXT_VALUE).setFontSize(10).setWrap(true);
    sheet.getRange(20, 2).setFontColor(DB.TEXT_GOLD).setFontSize(10).setFontWeight("bold").setWrap(true);

    sheet.getRange(15, 1, 1, 4).merge()
      .setValue("━━━  SECTION 4 · ES FUTURES & BEAR TRAP ALIGNMENT  ━━━")
      .setBackground(DB.STRIP_ES)
      .setFontColor(DB.HDR_ES)
      .setFontWeight("bold")
      .setFontSize(10)
      .setHorizontalAlignment("left");

  } catch (e) {
    Logger.log("writeESSection ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SECTION 5 — AI BRIEFING
// Rows 22–35
// ─────────────────────────────────────────────────────────────
function writeBriefingSection(sheet, data, esData, vixData, cst, cstMins, dow, shouldBrief) {
  try {
    sheet.getRange(21, 1, 1, 4).merge()
      .setValue("━━━  SECTION 5 · AI MISSION BRIEFING  ━━━")
      .setBackground(DB.STRIP_BRIEF)
      .setFontColor(DB.HDR_BRIEF)
      .setFontWeight("bold")
      .setFontSize(10)
      .setHorizontalAlignment("left");

    var briefText = getFlag("DASHBOARD_BRIEF_TEXT");
    var briefTime = getFlag("DASHBOARD_BRIEF_TIME");
    var nextBriefStr = getNextBriefTimeStr(cstMins, dow, cst);

    if (shouldBrief) {
      // ── Fire Gemini for a new briefing ───────────────────────
      var newBrief = callGeminiForDashboardBrief(data, esData, vixData, cst, cstMins, dow);
      if (newBrief) {
        briefText = newBrief;
        briefTime = Utilities.formatDate(cst, "America/Chicago", "h:mm a");
        setFlag("DASHBOARD_BRIEF_TEXT", briefText);
        setFlag("DASHBOARD_BRIEF_TIME", briefTime);
        setFlag("DASHBOARD_LAST_BRIEF_MINS", cstMins.toString());
      }
    }

    // ── Fallback text if nothing stored yet ───────────────────
    if (!briefText || briefText === "") {
      briefText = "System initializing... Next briefing will appear shortly. Stay patient — the setup will reveal itself.";
      briefTime = "—";
    }

    var timeLabel = briefTime ? "Posted: " + briefTime + " CST" : "Posted: —";

    sheet.getRange(22, 1).setValue("🤖 Briefing");
    sheet.getRange(22, 2).setValue(timeLabel);
    sheet.getRange(23, 1, 1, 4).merge()
      .setValue(briefText)
      .setWrap(true)
      .setBackground("#0c0800")
      .setFontColor("#ffd699")
      .setFontSize(11)
      .setFontStyle("normal")
      .setHorizontalAlignment("left")
      .setVerticalAlignment("top");
    sheet.setRowHeight(23, 120);

    sheet.getRange(34, 1).setValue("⏱️ Next briefing");
    sheet.getRange(34, 2, 1, 3).merge()
      .setValue(nextBriefStr)
      .setFontColor(DB.TEXT_CYAN)
      .setFontSize(10);

    sheet.getRange(22, 2).setFontColor(DB.TEXT_LABEL).setFontSize(9);

  } catch (e) {
    Logger.log("writeBriefingSection ERROR: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// GEMINI CALL — Dashboard Emotional Briefing
// Tight token budget: ~100 tokens in, 200 tokens out max
// ─────────────────────────────────────────────────────────────
function callGeminiForDashboardBrief(data, esData, vixData, cst, cstMins, dow) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      Logger.log("Dashboard brief: no GEMINI_API_KEY");
      return null;
    }

    var prompt = buildDashboardBriefPrompt(data, esData, vixData, cst, cstMins, dow);
    Logger.log("Dashboard brief prompt: " + prompt.substring(0, 100) + "...");

    var url     = GEMINI_ENDPOINT + "?key=" + apiKey;
    var payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 200,
        temperature: 0.6
      }
    });

    var resp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: payload,
      muteHttpExceptions: true
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

    Logger.log("Dashboard brief received: " + (text ? text.substring(0, 80) : "null"));
    return text;

  } catch (e) {
    Logger.log("callGeminiForDashboardBrief ERROR: " + e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUILD BRIEFING PROMPT
// ─────────────────────────────────────────────────────────────
function buildDashboardBriefPrompt(data, esData, vixData, cst, cstMins, dow) {
  var price      = data  ? "$" + data.price.toFixed(2)  : "unknown";
  var pctChange  = data  ? (data.changePct >= 0 ? "+" : "") + data.changePct.toFixed(2) + "%" : "unknown";
  var esTrend    = esData ? esData.trend : "UNKNOWN";
  var esChangePct = esData ? esData.changePct.toFixed(2) + "%" : "unknown";
  var vixVal     = vixData ? vixData.price.toFixed(1) + " (" + vixData.regime + ")" : "unknown";
  var timeStr    = Utilities.formatDate(cst, "America/Chicago", "h:mm a");
  var isWeekend  = (dow === 0 || dow === 6);

  var mode = getDashboardBriefMode(cstMins, dow);

  var baseContext =
    "You are a calm, experienced trading coach. The user trades SPY options using the Bear Trap Open strategy — " +
    "they wait for a morning flush/fake selloff after open, then enter calls when the trap springs. " +
    "They struggle with emotional, impulsive trading before market open.\n\n" +
    "Current time: " + timeStr + " CST\n" +
    "SPY: " + price + " (" + pctChange + " vs prev close)\n" +
    "ES Futures trend: " + esTrend + " (" + esChangePct + ")\n" +
    "VIX: " + vixVal + "\n" +
    "Bear Trap alignment: " + getESAlignmentStatus(esData).label + "\n";

  var modeInstruction = "";

  if (mode === "OVERNIGHT" || isWeekend) {
    modeInstruction =
      "Write a brief 2-3 sentence overnight/off-hours market update. " +
      "Calm, steady tone. Note what the system is monitoring. End with what to watch for.";

  } else if (mode === "PRE_MARKET_EARLY") {
    modeInstruction =
      "It is pre-market (6-8am CST). Write 2-3 sentences: note the overnight context, " +
      "remind the user NOT to make any trades yet, and tell them to get focused. " +
      "Calm but firm tone.";

  } else if (mode === "PRE_MARKET_HOT") {
    modeInstruction =
      "CRITICAL: It is 8:00–8:30am CST — market opens very soon. " +
      "The user tends to panic-trade before open and lose money. " +
      "Write 3-4 sentences of firm but supportive emotional coaching. " +
      "Key messages: (1) Do NOT jump in at open just because something moved overnight. " +
      "(2) We are WATCHING for a Bear Trap — a fake morning flush before a rip. " +
      "(3) Let the pattern develop. Patience = profit. " +
      "Tone: like a great coach talking to a nervous athlete right before game time. " +
      "You can say things like 'We got this. Stay locked in.' Be personal and direct, not generic.";

  } else if (mode === "MARKET_OPEN") {
    modeInstruction =
      "Market just opened or is in its first hour. Write 3 sentences: " +
      "(1) Quick read on what ES/SPY is doing right now. " +
      "(2) Whether Bear Trap conditions look present based on the data. " +
      "(3) What the user should be watching for, with specific patience coaching. " +
      "No generic disclaimers. Talk like you're in the room with them.";

  } else {
    modeInstruction =
      "Intraday update. Write 2-3 sentences: brief market read, " +
      "current pattern status based on ES trend and VIX, " +
      "and one tactical note for the user. Direct and concise.";
  }

  return baseContext + "\nINSTRUCTION: " + modeInstruction + "\nDo NOT add disclaimers. Respond only with the briefing text, no labels or headers.";
}

// ─────────────────────────────────────────────────────────────
// SHOULD WE FIRE A NEW BRIEF?
// Gates by time elapsed since last brief + mode interval
// ─────────────────────────────────────────────────────────────
function shouldFireDashboardBrief(cst, cstMins, dow) {
  try {
    var lastMinsStr = getFlag("DASHBOARD_LAST_BRIEF_MINS");
    var lastMins    = lastMinsStr ? parseInt(lastMinsStr) : -9999;
    var mode        = getDashboardBriefMode(cstMins, dow);

    var interval = BRIEF_INTERVALS.OVERNIGHT;
    if      (mode === "PRE_MARKET_EARLY") interval = BRIEF_INTERVALS.PRE_MARKET_EARLY;
    else if (mode === "PRE_MARKET_HOT")   interval = BRIEF_INTERVALS.PRE_MARKET_HOT;
    else if (mode === "MARKET_OPEN")      interval = BRIEF_INTERVALS.MARKET_OPEN;
    else if (mode === "INTRADAY")         interval = BRIEF_INTERVALS.INTRADAY;
    else if (mode === "WIND_DOWN")        interval = BRIEF_INTERVALS.WIND_DOWN;

    // Handle midnight rollover — if lastMins > cstMins, it was yesterday
    var elapsed;
    if (lastMins < 0 || lastMins === -9999) {
      elapsed = 99999; // never fired
    } else if (lastMins <= cstMins) {
      elapsed = cstMins - lastMins;
    } else {
      // crossed midnight
      elapsed = (1440 - lastMins) + cstMins;
    }

    Logger.log("Dashboard brief: mode=" + mode + " interval=" + interval + " elapsed=" + elapsed);
    return elapsed >= interval;

  } catch (e) {
    Logger.log("shouldFireDashboardBrief ERROR: " + e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// GET BRIEFING MODE based on CST time + day of week
// ─────────────────────────────────────────────────────────────
function getDashboardBriefMode(cstMins, dow) {
  var isWeekend = (dow === 0 || dow === 6);
  if (isWeekend) return "OVERNIGHT";

  // 0–359 = midnight–5:59am = OVERNIGHT
  if (cstMins < 360) return "OVERNIGHT";
  // 360–479 = 6:00am–7:59am = PRE_MARKET_EARLY
  if (cstMins < 480) return "PRE_MARKET_EARLY";
  // 480–509 = 8:00am–8:29am = PRE_MARKET_HOT (emotional coaching)
  if (cstMins < 510) return "PRE_MARKET_HOT";
  // 510–570 = 8:30am–9:30am = MARKET_OPEN critical window
  if (cstMins < 570) return "MARKET_OPEN";
  // 570–899 = 9:31am–2:59pm = INTRADAY
  if (cstMins < 900) return "INTRADAY";
  // 900+ = 3:00pm+ = WIND_DOWN
  return "WIND_DOWN";
}

// ─────────────────────────────────────────────────────────────
// GET NEXT BRIEF TIME STRING
// ─────────────────────────────────────────────────────────────
function getNextBriefTimeStr(cstMins, dow, cst) {
  try {
    var lastMinsStr = getFlag("DASHBOARD_LAST_BRIEF_MINS");
    var lastMins    = lastMinsStr ? parseInt(lastMinsStr) : cstMins;
    var mode        = getDashboardBriefMode(cstMins, dow);

    var interval = BRIEF_INTERVALS.OVERNIGHT;
    if      (mode === "PRE_MARKET_EARLY") interval = BRIEF_INTERVALS.PRE_MARKET_EARLY;
    else if (mode === "PRE_MARKET_HOT")   interval = BRIEF_INTERVALS.PRE_MARKET_HOT;
    else if (mode === "MARKET_OPEN")      interval = BRIEF_INTERVALS.MARKET_OPEN;
    else if (mode === "INTRADAY")         interval = BRIEF_INTERVALS.INTRADAY;
    else if (mode === "WIND_DOWN")        interval = BRIEF_INTERVALS.WIND_DOWN;

    var nextMins = lastMins + interval;
    if (nextMins >= 1440) nextMins -= 1440; // rollover

    var h = Math.floor(nextMins / 60);
    var m = nextMins % 60;
    var ampm = h >= 12 ? "PM" : "AM";
    var h12  = h % 12 || 12;
    var mStr = m < 10 ? "0" + m : "" + m;

    var remaining = nextMins - cstMins;
    if (remaining < 0) remaining += 1440;
    var remStr = remaining <= 60
      ? "~" + remaining + " min"
      : "~" + Math.round(remaining / 60) + " hr";

    return h12 + ":" + mStr + " " + ampm + " CST  (" + remStr + " from now)";
  } catch (e) {
    return "—";
  }
}

// ─────────────────────────────────────────────────────────────
// MARKET STATUS HELPER
// ─────────────────────────────────────────────────────────────
function getMarketStatus(cstMins, dow) {
  var isWeekend = (dow === 0 || dow === 6);
  var dayName   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow];

  if (isWeekend) {
    return {
      label:   "⛔ CLOSED — Weekend",
      session: "Weekend — markets closed",
      next:    "Opens Monday 8:30am CST",
      color:   DB.TEXT_LABEL
    };
  }

  // Pre-market: 3:00am–8:29am CST (180–509 mins)
  if (cstMins >= 180 && cstMins < 510) {
    var minsToOpen = 510 - cstMins;
    return {
      label:   "🌅 PRE-MARKET",
      session: "Pre-market session active",
      next:    "Market opens in ~" + minsToOpen + " min  (8:30am CST)",
      color:   DB.TEXT_ORANGE
    };
  }

  // Market open: 8:30am–2:59pm CST (510–899 mins)
  if (cstMins >= 510 && cstMins < 900) {
    var minsToClose = 900 - cstMins;
    return {
      label:   "✅ MARKET OPEN",
      session: "Regular trading session",
      next:    "Closes in ~" + minsToClose + " min  (3:00pm CST)",
      color:   DB.TEXT_GREEN
    };
  }

  // After-hours: 3:00pm–8:59pm CST
  if (cstMins >= 900 && cstMins < 1260) {
    return {
      label:   "🌙 AFTER HOURS",
      session: "After-hours session",
      next:    "Pre-market opens tomorrow ~3:00am CST",
      color:   DB.TEXT_PURPLE
    };
  }

  // Overnight
  return {
    label:   "🔒 OVERNIGHT",
    session: "Overnight — all sessions closed",
    next:    "Pre-market opens ~3:00am CST",
    color:   DB.TEXT_LABEL
  };
}

// ─────────────────────────────────────────────────────────────
// AI STATUS HELPER
// ─────────────────────────────────────────────────────────────
function getAIStatus(cstMins, dow) {
  var isWeekend = (dow === 0 || dow === 6);

  if (isWeekend) {
    return {
      mode:       "💤 STANDBY — Weekend",
      waiting:    "Weekend standby. Briefings every 4 hours.",
      nextAction: "Resumes full activity Monday 6:00am CST"
    };
  }

  if (cstMins < 360) { // before 6am
    return {
      mode:       "🌙 OVERNIGHT WATCH",
      waiting:    "Monitoring ES futures & overnight price action",
      nextAction: "Pre-market coaching begins at 6:00am CST"
    };
  }
  if (cstMins < 480) { // 6am–7:59am
    return {
      mode:       "👁️ PRE-MARKET WATCH",
      waiting:    "Watching overnight context — not yet actionable",
      nextAction: "Emotional coaching intensifies at 8:00am CST"
    };
  }
  if (cstMins < 510) { // 8am–8:29am
    return {
      mode:       "🔥 PRE-OPEN COACHING",
      waiting:    "Monitoring ES trend & Bear Trap setup alignment",
      nextAction: "Market opens 8:30am CST — STAY PATIENT, WATCH FOR TRAP"
    };
  }
  if (cstMins < 545) { // 8:30am–9:05am (first 35 min)
    return {
      mode:       "🪤 BEAR TRAP WATCH — ACTIVE",
      waiting:    "Watching for morning flush → stall → flip sequence",
      nextAction: "Bear Trap active window runs until 9:15am CST"
    };
  }
  if (cstMins < 570) { // 9:05am–9:30am
    return {
      mode:       "⚡ BEAR TRAP WINDOW — LATE",
      waiting:    "Monitoring for late flip or missed signal",
      nextAction: "Critical window closes 9:15am CST"
    };
  }
  if (cstMins < 900) { // 9:30am–3:00pm
    return {
      mode:       "📈 INTRADAY MONITOR",
      waiting:    "Tracking intraday price action & momentum",
      nextAction: "EOD brief fires at 3:00pm CST"
    };
  }
  // 3pm+
  return {
    mode:       "📊 EOD / WIND-DOWN",
    waiting:    "Day summary complete. Reviewing signals & accuracy.",
    nextAction: "Overnight watch begins. Next active day ~6:00am CST"
  };
}

// ─────────────────────────────────────────────────────────────
// ES ALIGNMENT STATUS
// ─────────────────────────────────────────────────────────────
function getESAlignmentStatus(esData) {
  if (!esData) {
    return {
      label:  "❓ UNKNOWN — No ES Data",
      reason: "ES futures data unavailable. Cannot assess Bear Trap alignment.",
      action: "Check data connection. Proceed with caution — assume uncertain.",
      color:  DB.TEXT_LABEL
    };
  }

  var trend     = esData.trend;      // "FADING" | "FLAT" | "CLIMBING"
  var changePct = esData.changePct;  // % vs prev close

  // VOID: ES falling hard — real distribution, trap unlikely
  if (trend === "FADING" && changePct < -ES_ALIGN.VOID_DROP_PCT) {
    return {
      label:  "❌ VOID — Bear Trap Strategy Off",
      reason: "ES futures down " + Math.abs(changePct).toFixed(2) + "% and FADING hard from overnight high. This looks like real distribution, not a manufactured flush. The Bear Trap setup requires ES to be near highs — this is not that.",
      action: "SKIP Bear Trap strategy today. Do NOT buy calls into this. Wait for a different day or a clear reversal signal.",
      color:  DB.TEXT_RED
    };
  }

  // CAUTION: ES climbing — morning flush may follow through
  if (trend === "CLIMBING" && changePct > ES_ALIGN.CAUTION_RISE_PCT) {
    return {
      label:  "🚫 CAUTION — Flush May Follow Through",
      reason: "ES futures rising " + changePct.toFixed(2) + "% and still CLIMBING. Bear Trap setups need ES to fade after tagging the overnight high — if ES is still pushing up, a morning flush could be the start of real selling rather than a trap.",
      action: "Reduce conviction on Bear Trap calls today. If a flush occurs, require HIGHER confidence score (>80%) before entering. Smaller size.",
      color:  DB.TEXT_ORANGE
    };
  }

  // MONITOR: ES flat but well below overnight high
  if (trend === "FLAT" && changePct < -ES_ALIGN.MONITOR_PCT) {
    return {
      label:  "⚠️ MONITOR — Ambiguous Setup",
      reason: "ES futures are flat but sitting " + Math.abs(changePct).toFixed(2) + "% below the overnight high. Neutral trend — could go either way. The overnight high was NOT cleanly tagged, which is one of our key setup requirements.",
      action: "Proceed cautiously. Watch whether ES recovers toward overnight high before open. A recovery = setup strengthens. No recovery = wait for clearer day.",
      color:  DB.TEXT_GOLD
    };
  }

  // ALIGNED: ES fading from near highs — classic setup
  if (trend === "FADING") {
    return {
      label:  "✅ ALIGNED — Classic Bear Trap Setup",
      reason: "ES futures FADING from overnight high (" + changePct.toFixed(2) + "%). This is the textbook Bear Trap setup: ES tags the high overnight, fades pre-market, SPY opens and flushes retail stops, then rips. Conditions look favorable.",
      action: "Stay ready. Watch for: (1) Morning flush starting within first 15 min of open. (2) Flush stalls on weak volume. (3) Flip signal — enter calls. DO NOT jump in early.",
      color:  DB.TEXT_GREEN
    };
  }

  // FLAT near highs
  return {
    label:  "✅ ALIGNED — ES Flat Near Highs",
    reason: "ES futures FLAT (" + changePct.toFixed(2) + "%). Consolidating near overnight levels. A flat ES pre-market with overnight high close by is still a valid Bear Trap setup — the flush can still manufacture retail panic from this position.",
    action: "Setup is live. Watch for morning flush. Slightly lower conviction than a full FADING setup — require confidence score >65% before entering calls.",
    color:  DB.TEXT_GREEN
  };
}

// ─────────────────────────────────────────────────────────────
// SHEET SETUP — run once to create + style the dashboard
// ─────────────────────────────────────────────────────────────
function setupDashboardSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_DASHBOARD);
  if (!sheet) sheet = ss.insertSheet(SHEET_DASHBOARD);

  sheet.setTabColor(THEME.ACCENT_CYAN);
  sheet.clearContents();
  sheet.clearFormats();

  // ── Column widths ─────────────────────────────────────────
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 340);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 120);

  // ── Row 1: Main banner ────────────────────────────────────
  sheet.getRange(1, 1, 1, 4).merge()
    .setValue("⚡  M I S S I O N   C O N T R O L   ·   S P Y   I N T E L L I G E N C E   D A S H B O A R D  ⚡")
    .setBackground(DB.BG_BANNER)
    .setFontColor(DB.TEXT_BANNER)
    .setFontWeight("bold")
    .setFontSize(14)
    .setFontFamily("Georgia")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 44);

  // ── Row 2: Timestamp ──────────────────────────────────────
  sheet.getRange(2, 1, 1, 4).merge()
    .setValue("Initializing...")
    .setBackground(DB.BG_SECTION)
    .setFontColor(DB.TEXT_DIM)
    .setFontSize(9)
    .setHorizontalAlignment("right");
  sheet.setRowHeight(2, 18);

  // ── Apply background to all data rows ─────────────────────
  for (var r = 3; r <= 40; r++) {
    sheet.getRange(r, 1, 1, 4).setBackground(DB.BG_SECTION);
    sheet.setRowHeight(r, 22);
    sheet.getRange(r, 1).setFontColor(DB.TEXT_LABEL).setFontSize(9)
      .setHorizontalAlignment("right").setVerticalAlignment("middle");
    sheet.getRange(r, 2, 1, 3).setFontColor(DB.TEXT_VALUE).setFontSize(10)
      .setVerticalAlignment("middle");
  }

  // ── Taller rows for wrapped content ───────────────────────
  sheet.setRowHeight(19, 50);
  sheet.setRowHeight(20, 50);
  sheet.setRowHeight(23, 120);

  // ── Freeze top 2 rows ─────────────────────────────────────
  sheet.setFrozenRows(2);

  Logger.log("Dashboard sheet setup complete.");
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// MENU ENTRY
// ─────────────────────────────────────────────────────────────
function setupDashboardSheetFromMenu() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = setupDashboardSheet(ss);
  SpreadsheetApp.getUi().alert(
    "🖥️ MISSION CONTROL\n\n" +
    "✅ Dashboard sheet created!\n\n" +
    "WHAT'S ON THE DASHBOARD:\n" +
    "  1. 💰 SPY last close + % change\n" +
    "  2. 🏛️ Current market status\n" +
    "  3. 🤖 AI mode + what it's waiting to do\n" +
    "  4. 📡 ES Futures + Bear Trap alignment check\n" +
    "  5. 🤖 AI Mission Briefing (emotional coaching)\n\n" +
    "BRIEFING SCHEDULE:\n" +
    "  • Overnight / weekends: every 4 hours\n" +
    "  • 6:00am–7:59am: every 30 min (pre-market watch)\n" +
    "  • 8:00am–8:29am: every 15 min (emotional coaching)\n" +
    "  • 8:30am–9:30am: every 15 min (market open critical)\n" +
    "  • 9:31am–3:00pm: every 30 min (intraday)\n" +
    "  • After 3:00pm: every 4 hours\n\n" +
    "Updates automatically on every 5-minute trigger tick.\n" +
    "Run a Manual Tick to populate it now."
  );
}

// ─────────────────────────────────────────────────────────────
// MANUAL DASHBOARD REFRESH — for testing
// ─────────────────────────────────────────────────────────────
function runManualDashboardRefresh() {
  try {
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    var now  = getCurrentEasternTime();
    var data = fetchSPYData();

    if (!data) {
      SpreadsheetApp.getUi().alert("❌ Could not fetch SPY data.");
      return;
    }

    // Force a new brief on manual run
    setFlag("DASHBOARD_LAST_BRIEF_MINS", "-9999");
    runDashboardTick(data, now);

    SpreadsheetApp.getUi().alert(
      "✅ Dashboard refreshed!\n\n" +
      "SPY: $" + data.price.toFixed(2) + "\n" +
      "Check the 🖥️ DASHBOARD sheet."
    );
  } catch (e) {
    Logger.log("runManualDashboardRefresh ERROR: " + e.message);
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message);
  }
}
