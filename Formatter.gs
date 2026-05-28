// ============================================================
// FILE: Formatter.gs
// PURPOSE: Applies all visual formatting to a data row.
//          Calls ColorGradient.gs for all color calculations.
//          Keeps all style decisions in one place for easy tweaks.
// ============================================================

// ─────────────────────────────────────────────────────────────
// ROW FONT SIZES — adjust here to scale the whole log
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
  AI_MEMO:       8     // Smaller — lots of text, needs to fit
};

// ─────────────────────────────────────────────────────────────
// ROW HEIGHT
// ─────────────────────────────────────────────────────────────
var ROW_HEIGHT_PX = 22;   // Pixels per data row

// ─────────────────────────────────────────────────────────────
// COLUMN WIDTHS — pixels
// ─────────────────────────────────────────────────────────────
var COL_WIDTHS = {
  1:  90,   // DATE
  2:  75,   // TIME
  3:  80,   // PRICE
  4:  90,   // PCT_CHANGE
  5:  90,   // TICK Δ
  6:  90,   // TICK %
  7:  140,  // TICK vs AVG
  8:  120,  // VOLUME
  9:  110,  // VOL vs 30D
  10: 200,  // TREND
  11: 350   // AI MEMO
};

// ─────────────────────────────────────────────────────────────
// NUMBER FORMATS per column
// ─────────────────────────────────────────────────────────────
var NUMBER_FORMATS = {
  PRICE:       "$#,##0.00",
  PCT_CHANGE:  "0.00\"%\"",
  TICK_CHANGE: "#,##0.00",
  TICK_PCT:    "0.000\"%\"",
  VOLUME:      "#,##0"
};

// ─────────────────────────────────────────────────────────────
// MAIN: Apply all formatting to a freshly written data row
// log:       Sheet object
// rowNum:    Row number (integer)
// price:     SPY price (number)
// pctChange: % vs prev close (number)
// tickPct:   % change since last tick (number or "—")
// volume:    Today's cumulative volume (number)
// volPct:    Volume vs 30d avg as % (number)
// avgVol30:  30-day avg volume (number)
// ─────────────────────────────────────────────────────────────
function applyRowFormatting(log, rowNum, price, pctChange, tickPct, volume, volPct, avgVol30) {

  // ── Row height ────────────────────────────────────────────
  log.setRowHeight(rowNum, ROW_HEIGHT_PX);

  // ── Base row style: white BG, dark text, standard font ───
  var fullRow = log.getRange(rowNum, 1, 1, HEADERS.length);
  fullRow
    .setBackground(COLOR_THRESHOLDS.NEUTRAL)
    .setFontColor("#1a1a2e")
    .setVerticalAlignment("middle");

  // ── COLUMN: Date ─────────────────────────────────────────
  styleCell(log, rowNum, COL.DATE, null, FONT_SIZES.DATE, "left", null, null);

  // ── COLUMN: Time ─────────────────────────────────────────
  styleCell(log, rowNum, COL.TIME, null, FONT_SIZES.TIME, "center", null, null);

  // ── COLUMN: Price — same BG as pctChange ─────────────────
  var priceBg   = getPctChangeColor(pctChange);
  var priceText = getTextColor(priceBg);
  styleCell(log, rowNum, COL.PRICE,
    priceBg, FONT_SIZES.PRICE, "center", priceText, NUMBER_FORMATS.PRICE);

  // ── COLUMN: Pct Change ───────────────────────────────────
  var pctBg   = getPctChangeColor(pctChange);
  var pctText = getTextColor(pctBg);
  styleCell(log, rowNum, COL.PCT_CHANGE,
    pctBg, FONT_SIZES.PCT_CHANGE, "center", pctText, NUMBER_FORMATS.PCT_CHANGE);

  // ── COLUMN: Tick Change (raw price diff) ─────────────────
  styleCell(log, rowNum, COL.TICK_CHANGE,
    null, FONT_SIZES.TICK_CHANGE, "center", null, NUMBER_FORMATS.TICK_CHANGE);

  // ── COLUMN: Tick Pct — own gradient ──────────────────────
  var tickPctNum = (typeof tickPct === "number") ? tickPct : null;
  var tickBg   = tickPctNum !== null ? getTickPctColor(tickPctNum) : COLOR_THRESHOLDS.NEUTRAL;
  var tickText = getTextColor(tickBg);
  styleCell(log, rowNum, COL.TICK_PCT,
    tickBg, FONT_SIZES.TICK_PCT, "center", tickText,
    tickPctNum !== null ? NUMBER_FORMATS.PCT_CHANGE : null);

  // ── COLUMN: Tick vs Avg ──────────────────────────────────
  styleCell(log, rowNum, COL.TICK_VS_AVG,
    null, FONT_SIZES.TICK_VS_AVG, "center", null, null);

  // ── COLUMN: Volume ────────────────────────────────────────
  var volBg   = getVolumeColor(volPct);
  var volText = getTextColor(volBg);
  styleCell(log, rowNum, COL.VOLUME,
    volBg, FONT_SIZES.VOLUME, "center", volText, NUMBER_FORMATS.VOLUME);

  // ── COLUMN: Volume vs 30d avg ────────────────────────────
  styleCell(log, rowNum, COL.VOLUME_VS_AVG,
    volBg, FONT_SIZES.VOLUME_VS_AVG, "center", volText, null);

  // ── COLUMN: Trend ────────────────────────────────────────
  styleCell(log, rowNum, COL.TREND,
    "#f0f4ff", FONT_SIZES.TREND, "left", "#1a1a2e", null);

  // ── COLUMN: AI Memo ──────────────────────────────────────
  styleCell(log, rowNum, COL.AI_MEMO,
    "#fafafa", FONT_SIZES.AI_MEMO, "left", "#333344", null);
  // Allow text to wrap in the memo cell
  log.getRange(rowNum, COL.AI_MEMO).setWrap(true);

  // ── Alternate row zebra (very subtle) ────────────────────
  // Odd rows: pure white; Even rows: barely-there gray
  // Only applies to cells that aren't already color-coded
  if (rowNum % 2 === 0) {
    var dateBg = log.getRange(rowNum, COL.DATE).getBackground();
    if (dateBg === "#ffffff" || dateBg === COLOR_THRESHOLDS.NEUTRAL) {
      log.getRange(rowNum, COL.DATE).setBackground("#f9f9fc");
      log.getRange(rowNum, COL.TIME).setBackground("#f9f9fc");
    }
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER: Style a single cell cleanly
// bg, textColor: pass null to skip that property
// format:        number format string or null
// ─────────────────────────────────────────────────────────────
function styleCell(sheet, row, col, bg, fontSize, align, textColor, format) {
  var cell = sheet.getRange(row, col);
  if (bg !== null)        cell.setBackground(bg);
  if (textColor !== null) cell.setFontColor(textColor);
  if (fontSize)           cell.setFontSize(fontSize);
  if (align)              cell.setHorizontalAlignment(align);
  if (format)             cell.setNumberFormat(format);
}

// ─────────────────────────────────────────────────────────────
// SETUP: Apply column widths (called once during sheet setup)
// ─────────────────────────────────────────────────────────────
function applyColumnWidths(sheet) {
  for (var col in COL_WIDTHS) {
    sheet.setColumnWidth(parseInt(col), COL_WIDTHS[col]);
  }
}
