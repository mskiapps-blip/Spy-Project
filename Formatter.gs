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

    // VOLUME — colored by volPct
    var volBg = getVolumeColor(volPct);
    styleCell(log, rowNum, COL.VOLUME,
      volBg, FONT_SIZES.VOLUME, "center", getTextColor(volBg), NUM_FMT.VOLUME);

    // VOL vs 30D — same color as volume
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
