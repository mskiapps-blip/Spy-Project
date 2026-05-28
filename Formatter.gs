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
// ADD VOLUME HEADER NOTES
// Attaches a hover-comment to the two volume column headers
// explaining exactly what each column means.
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
    "🟠 Orange → Volume is ABOVE the 30-day daily average.\n" +
    "   Deeper orange = more extreme above-average activity.\n\n" +
    "🔵 Blue → Volume is BELOW the 30-day daily average.\n" +
    "   Deeper blue = unusually quiet / thin trading day.\n\n" +
    "⚠️ Note: Early in the session (first 1-2 hours) volume\n" +
    "   will naturally appear low vs the full-day average —\n" +
    "   that's normal and doesn't mean today will be quiet."
  );

  // ── VOL vs 30D (column I) ──────────────────────────────────
  sheet.getRange(headerRow, COL.VOLUME_VS_AVG).setNote(
    "🔥 VOL vs 30D AVG\n" +
    "─────────────────────\n" +
    "Today's cumulative volume expressed as a PERCENTAGE\n" +
    "of the 30-day average daily volume.\n\n" +
    "HOW TO READ IT:\n" +
    "  100% = exactly on pace with the 30-day average\n" +
    "  150% = 50% MORE volume than average (active day)\n" +
    "   60% = 40% LESS volume than average (quiet day)\n\n" +
    "COLOR matches the VOLUME TODAY column — both cells\n" +
    "use the same gradient so you can read either one.\n\n" +
    "WHAT HIGH VOLUME MEANS:\n" +
    "  • Stronger conviction behind price moves\n" +
    "  • More likely to follow through on breakouts\n" +
    "  • Options and futures activity may be elevated\n\n" +
    "WHAT LOW VOLUME MEANS:\n" +
    "  • Moves may be less reliable / easier to reverse\n" +
    "  • Can be normal on holidays or slow summer days\n\n" +
    "SOURCE: 30-day avg is calculated fresh each tick\n" +
    "from Yahoo Finance daily bars (free, no API key)."
  );

  Logger.log("Volume header notes added at row " + headerRow + ".");
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
