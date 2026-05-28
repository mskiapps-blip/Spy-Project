// ============================================================
// FILE: Formatter.gs
// PURPOSE: Applies all visual formatting to each data row.
//          All sizes, widths, and formats are adjustable here.
// ============================================================

// ─────────────────────────────────────────────────────────────
// FONT SIZES — adjust here to scale the log
// ─────────────────────────────────────────────────────────────
var FONT_SIZES = {
  DATE:          10,
  TIME:          10,
  PRICE:         11,
  PCT_CHANGE:    11,
  TICK_CHANGE:   10,
  TICK_PCT:      10,
  TICK_VS_AVG:   9,
  VOLUME:        10,
  VOLUME_VS_AVG: 10,
  TREND:         9,
  AI_MEMO:       8
};

// ─────────────────────────────────────────────────────────────
// ROW HEIGHT (pixels)
// ─────────────────────────────────────────────────────────────
var ROW_HEIGHT_PX = 22;

// ─────────────────────────────────────────────────────────────
// COLUMN WIDTHS (pixels) — keyed by column number
// ─────────────────────────────────────────────────────────────
var COL_WIDTHS = {
  1: 95,    // DATE
  2: 75,    // TIME
  3: 80,    // PRICE
  4: 90,    // PCT CHANGE
  5: 85,    // TICK Δ
  6: 85,    // TICK %
  7: 130,   // TICK vs AVG
  8: 120,   // VOLUME
  9: 105,   // VOL vs 30D
  10: 195,  // TREND
  11: 340   // AI MEMO
};

// ─────────────────────────────────────────────────────────────
// NUMBER FORMATS
// ─────────────────────────────────────────────────────────────
var NUM_FMT = {
  PRICE:       "$#,##0.00",
  PCT_CHANGE:  "0.00\"%\"",
  TICK_CHANGE: "0.00",
  TICK_PCT:    "0.000\"%\"",
  VOLUME:      "#,##0"
};

// ─────────────────────────────────────────────────────────────
// MAIN: Apply formatting to one data row
// ─────────────────────────────────────────────────────────────
function applyRowFormatting(log, rowNum, price, pctChange, tickPct, volume, volPct, avgVol30) {
  try {
    log.setRowHeight(rowNum, ROW_HEIGHT_PX);

    // Base: white background, dark text, center aligned
    var fullRow = log.getRange(rowNum, 1, 1, HEADERS.length);
    fullRow
      .setBackground(COLOR_THRESHOLDS.NEUTRAL)
      .setFontColor("#1a1a2e")
      .setVerticalAlignment("middle")
      .setFontFamily("Arial");

    // DATE
    styleCell(log, rowNum, COL.DATE,
      null, FONT_SIZES.DATE, "center", null, null);

    // TIME
    styleCell(log, rowNum, COL.TIME,
      null, FONT_SIZES.TIME, "center", null, null);

    // PRICE — same color as pctChange (pctChange is the anchor)
    var priceBg = getPctChangeColor(pctChange);
    styleCell(log, rowNum, COL.PRICE,
      priceBg, FONT_SIZES.PRICE, "center", getTextColor(priceBg), NUM_FMT.PRICE);

    // PCT CHANGE
    var pctBg = getPctChangeColor(pctChange);
    styleCell(log, rowNum, COL.PCT_CHANGE,
      pctBg, FONT_SIZES.PCT_CHANGE, "center", getTextColor(pctBg), NUM_FMT.PCT_CHANGE);

    // TICK CHANGE (raw price)
    styleCell(log, rowNum, COL.TICK_CHANGE,
      null, FONT_SIZES.TICK_CHANGE, "center", null, NUM_FMT.TICK_CHANGE);

    // TICK PCT — own gradient
    var tickPctNum = (typeof tickPct === "number" && !isNaN(tickPct)) ? tickPct : null;
    var tickBg     = tickPctNum !== null ? getTickPctColor(tickPctNum) : COLOR_THRESHOLDS.NEUTRAL;
    styleCell(log, rowNum, COL.TICK_PCT,
      tickBg, FONT_SIZES.TICK_PCT, "center", getTextColor(tickBg),
      tickPctNum !== null ? NUM_FMT.PCT_CHANGE : null);

    // TICK vs AVG (text only)
    styleCell(log, rowNum, COL.TICK_VS_AVG,
      null, FONT_SIZES.TICK_VS_AVG, "center", null, null);

    // VOLUME — colored by volPct, with rawVolume + avgVol30 as fallback context
    // (getVolumeColor needs all three to handle the "no 30d avg yet" case)
    var volBg = getVolumeColor(volPct, volume, avgVol30);
    styleCell(log, rowNum, COL.VOLUME,
      volBg, FONT_SIZES.VOLUME, "center", getTextColor(volBg), NUM_FMT.VOLUME);

    // VOL vs 30D — same color as VOLUME so both cells visually match
    styleCell(log, rowNum, COL.VOLUME_VS_AVG,
      volBg, FONT_SIZES.VOLUME_VS_AVG, "center", getTextColor(volBg), null);

    // TREND
    styleCell(log, rowNum, COL.TREND,
      "#f0f4ff", FONT_SIZES.TREND, "left", "#1a1a2e", null);

    // AI MEMO
    var memoCell = log.getRange(rowNum, COL.AI_MEMO);
    memoCell
      .setBackground("#fafafa")
      .setFontSize(FONT_SIZES.AI_MEMO)
      .setHorizontalAlignment("left")
      .setFontColor("#333344")
      .setWrap(true);

    // Subtle zebra striping on non-colored cells
    if (rowNum % 2 === 0) {
      var dateBg = log.getRange(rowNum, COL.DATE).getBackground();
      if (dateBg === "#ffffff" || dateBg === COLOR_THRESHOLDS.NEUTRAL) {
        log.getRange(rowNum, COL.DATE).setBackground("#f7f7fc");
        log.getRange(rowNum, COL.TIME).setBackground("#f7f7fc");
      }
    }

  } catch (e) {
    Logger.log("applyRowFormatting ERROR at row " + rowNum + ": " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER: Style a single cell; null = skip that property
// ─────────────────────────────────────────────────────────────
function styleCell(sheet, row, col, bg, fontSize, align, textColor, format) {
  var cell = sheet.getRange(row, col);
  if (bg        !== null && bg        !== undefined) cell.setBackground(bg);
  if (textColor !== null && textColor !== undefined) cell.setFontColor(textColor);
  if (fontSize)  cell.setFontSize(fontSize);
  if (align)     cell.setHorizontalAlignment(align);
  if (format)    cell.setNumberFormat(format);
}

// ─────────────────────────────────────────────────────────────
// HELPER: Apply column widths to a sheet
// ─────────────────────────────────────────────────────────────
function applyColumnWidths(sheet) {
  for (var col in COL_WIDTHS) {
    sheet.setColumnWidth(parseInt(col), COL_WIDTHS[col]);
  }
}

// ─────────────────────────────────────────────────────────────
// ADD VOLUME + TREND HEADER NOTES
// Attaches hover-comments to the volume column headers and the
// trend column header explaining exactly what each column means.
// Call this once from setupSheets() — safe to re-run.
// ─────────────────────────────────────────────────────────────
function addVolumeHeaderNotes(sheet) {
  // Row 2 is the header row (row 1 is the banner)
  // If setupSheets was skipped and headers are on row 1, this still works
  // because we find the header row by checking content.
  var headerRow = findHeaderRow(sheet);
  if (!headerRow) {
    Logger.log("addVolumeHeaderNotes: could not find header row.");
    return;
  }

  // ── VOLUME TODAY (column H) ────────────────────────────────
  sheet.getRange(headerRow, COL.VOLUME).setNote(
    "📦 VOLUME TODAY\n" +
    "─────────────────────\n" +
    "The total number of SPY shares traded so far today,\n" +
    "accumulated from the open up to this 5-minute tick.\n\n" +
    "COLOR GUIDE:\n" +
    "Color compares today's volume against the PACE of an\n" +
    "average day — i.e. how much should have traded by this\n" +
    "time of session, not the full-day total. So 'on pace'\n" +
    "reads neutral-to-green all day, even in the morning.\n\n" +
    "🟢 Green → Volume is running ABOVE average pace.\n" +
    "   Deeper green = stronger-than-normal participation.\n" +
    "   High volume gives price moves more conviction.\n\n" +
    "🔴 Red → Volume is running BELOW average pace.\n" +
    "   Deeper red = unusually thin / quiet session.\n" +
    "   Low volume moves are easier to reverse."
  );

  // ── VOL vs 30D ─────────────────────────────────────────────
  sheet.getRange(headerRow, COL.VOLUME_VS_AVG).setNote(
    "🔥 VOL vs 30D AVG (PACE-ADJUSTED)\n" +
    "─────────────────────\n" +
    "Today's cumulative volume as a PERCENTAGE of how much\n" +
    "an average day would have traded by this point in the\n" +
    "session — not the full-day total. This keeps the\n" +
    "reading fair in the morning instead of always low.\n\n" +
    "HOW TO READ IT:\n" +
    "  100% = exactly on pace with an average day\n" +
    "  150% = 50% MORE than average pace → active session\n" +
    "   60% = 40% LESS than average pace → thin session\n\n" +
    "COLOR uses the same green/red scale as price moves:\n" +
    "  🟢 Green = above-average pace (conviction)\n" +
    "  🔴 Red   = below-average pace (caution)\n" +
    "  The VOLUME and VOL-vs-30D cells share one color so\n" +
    "  you can glance at either one.\n\n" +
    "WHY IT MATTERS:\n" +
    "  • Big move on GREEN volume = more trustworthy\n" +
    "  • Big move on RED volume = possible fake-out\n" +
    "  • Watch for volume spikes near S/R zones\n\n" +
    "SOURCE: 30-day avg from Yahoo Finance daily bars,\n" +
    "cached ~6h (free, no API key required)."
  );

  // ── TREND STATUS (column J) ────────────────────────────────
  sheet.getRange(headerRow, COL.TREND).setNote(
    "🌐 TREND STATUS\n" +
    "─────────────────────\n" +
    "A one-line read on where SPY is heading right now,\n" +
    "rebuilt each tick from intraday price history.\n\n" +
    "It combines up to THREE parts, separated by │ :\n\n" +
    "1) DIRECTION — from two moving averages of recent\n" +
    "   closes (a fast 9-bar vs a slower 21-bar EMA):\n" +
    "   📈 UPTREND      fast EMA clearly above slow\n" +
    "   📉 DOWNTREND    fast EMA clearly below slow\n" +
    "   ⚖️ CONSOLIDATING  the two EMAs are entangled\n" +
    "   📈/📉 ABOVE/BELOW OPEN  not enough bars for the\n" +
    "       slow EMA yet, so it compares to today's open\n" +
    "   ⏳ GATHERING DATA  too few bars early in the day\n\n" +
    "2) NEAREST S/R ZONE — shown only when price is within\n" +
    "   ~0.20% of a key level (prev close, day open, day\n" +
    "   high/low, or a $5 round number):\n" +
    "   🟢 Near support     price resting on a floor\n" +
    "   🔴 Near resistance  price pressing on a ceiling\n" +
    "   The % tells you how far away that level is.\n\n" +
    "3) MOMENTUM — pace over the last few bars:\n" +
    "   ⚡ ACCELERATING UP / 💨 ACCELERATING DOWN  (fast)\n" +
    "   ↗️ GRINDING UP / ↘️ GRINDING DOWN          (steady)\n" +
    "   ➡️ FLAT                                    (going nowhere)\n\n" +
    "HOW TO READ IT:\n" +
    "  • Direction + momentum AGREE → trend has legs\n" +
    "  • Direction + momentum DISAGREE → possible stall\n" +
    "  • A direction read pinned against resistance often\n" +
    "    precedes a pause or reversal — watch the next ticks.\n\n" +
    "⚠️ Early in the day the read says GATHERING DATA or\n" +
    "   ABOVE/BELOW OPEN until enough 5-min bars accumulate\n" +
    "   for the EMAs — that is expected, not an error."
  );

  Logger.log("Volume + trend header notes added at row " + headerRow + ".");
}

// ─────────────────────────────────────────────────────────────
// HELPER: Find which row contains the headers by scanning
// column A for the DATE header text. Returns row number or null.
// ─────────────────────────────────────────────────────────────
function findHeaderRow(sheet) {
  var lastRow = Math.min(sheet.getLastRow(), 5); // headers can't be below row 5
  if (lastRow < 1) return null;
  var colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (var i = 0; i < colA.length; i++) {
    var val = String(colA[i][0]);
    if (val.indexOf("DATE") !== -1) return i + 1;
  }
  // Fallback: assume row 2 (banner + headers layout)
  return 2;
}
