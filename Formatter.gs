// ============================================================
// FILE: Formatter.gs
// PURPOSE: Applies all visual formatting to each data row.
// ============================================================

// ─────────────────────────────────────────────────────────────
// FONT SIZES
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
  VWAP:          10,
  SR_ZONE:       9,
  TREND:         9,
  AI_MEMO:       8
};

// ─────────────────────────────────────────────────────────────
// ROW HEIGHT
// ─────────────────────────────────────────────────────────────
var ROW_HEIGHT_PX = 22;

// ─────────────────────────────────────────────────────────────
// COLUMN WIDTHS
// ─────────────────────────────────────────────────────────────
var COL_WIDTHS = {
  1:  95,   // DATE
  2:  75,   // TIME
  3:  80,   // PRICE
  4:  90,   // PCT CHANGE
  5:  85,   // TICK Δ
  6:  85,   // TICK %
  7:  130,  // TICK vs AVG
  8:  120,  // VOLUME
  9:  105,  // VOL vs 30D
  10: 95,   // VWAP
  11: 175,  // S1
  12: 175,  // S2
  13: 175,  // R1
  14: 175,  // R2
  15: 195,  // TREND
  16: 340   // AI MEMO
};

// ─────────────────────────────────────────────────────────────
// NUMBER FORMATS
// ─────────────────────────────────────────────────────────────
var NUM_FMT = {
  PRICE:       "$#,##0.00",
  PCT_CHANGE:  "0.00\"%\"",
  TICK_CHANGE: "0.00",
  TICK_PCT:    "0.000\"%\"",
  VOLUME:      "#,##0",
  VWAP:        "$#,##0.00"
};

// ─────────────────────────────────────────────────────────────
// S/R DISTANCE HEAT MAP THRESHOLDS (% distance from price)
// Controls how quickly the color deepens as price approaches a zone.
//
// SUPPORT (below price) → green gradient: nearer = deeper green
// RESISTANCE (above price) → red gradient: nearer = deeper red
//
// At or below MIN_PCT: deep color (maximum intensity)
// At or above MAX_PCT: white (no color — too far away to matter)
// ─────────────────────────────────────────────────────────────
var SR_HEAT = {
  MIN_PCT: 0.05,  // ≤0.05% away = deepest color (essentially at the zone)
  MAX_PCT: 1.50   // ≥1.50% away = white (too distant to influence price now)
};

// ─────────────────────────────────────────────────────────────
// MAIN: Apply formatting to one data row
// ─────────────────────────────────────────────────────────────
function applyRowFormatting(log, rowNum, price, pctChange, tickPct,
                             volume, volPct, avgVol30,
                             vwap, vwapDiffPct, srZones) {
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

    // PRICE
    var priceBg = getPctChangeColor(pctChange);
    styleCell(log, rowNum, COL.PRICE,
      priceBg, FONT_SIZES.PRICE, "center", getTextColor(priceBg), NUM_FMT.PRICE);

    // PCT CHANGE
    var pctBg = getPctChangeColor(pctChange);
    styleCell(log, rowNum, COL.PCT_CHANGE,
      pctBg, FONT_SIZES.PCT_CHANGE, "center", getTextColor(pctBg), NUM_FMT.PCT_CHANGE);

    // TICK CHANGE
    styleCell(log, rowNum, COL.TICK_CHANGE,
      null, FONT_SIZES.TICK_CHANGE, "center", null, NUM_FMT.TICK_CHANGE);

    // TICK PCT
    var tickPctNum = (typeof tickPct === "number" && !isNaN(tickPct)) ? tickPct : null;
    var tickBg     = tickPctNum !== null ? getTickPctColor(tickPctNum) : COLOR_THRESHOLDS.NEUTRAL;
    styleCell(log, rowNum, COL.TICK_PCT,
      tickBg, FONT_SIZES.TICK_PCT, "center", getTextColor(tickBg),
      tickPctNum !== null ? NUM_FMT.PCT_CHANGE : null);

    // TICK vs AVG
    styleCell(log, rowNum, COL.TICK_VS_AVG,
      null, FONT_SIZES.TICK_VS_AVG, "center", null, null);

    // VOLUME
    var volBg = getVolumeColor(volPct, volume, avgVol30);
    styleCell(log, rowNum, COL.VOLUME,
      volBg, FONT_SIZES.VOLUME, "center", getTextColor(volBg), NUM_FMT.VOLUME);

    // VOL vs 30D
    styleCell(log, rowNum, COL.VOLUME_VS_AVG,
      volBg, FONT_SIZES.VOLUME_VS_AVG, "center", getTextColor(volBg), null);

    // ── VWAP ──────────────────────────────────────────────────
    // Color: above VWAP = subtle green; below VWAP = subtle red.
    // We use a mild intensity (capped at 0.55) so VWAP doesn't
    // compete visually with the main % change columns.
    var vwapBg = COLOR_THRESHOLDS.NEUTRAL;
    if (vwapDiffPct !== null && vwap > 0) {
      var vwapIntensity = Math.min(0.55, normalizeValue(
        Math.abs(vwapDiffPct), 0.02, 0.60
      ));
      vwapBg = vwapDiffPct >= 0
        ? interpolateRGB(PALETTE.GREEN_PALE, PALETTE.GREEN_DEEP, vwapIntensity)
        : interpolateRGB(PALETTE.RED_PALE,   PALETTE.RED_DEEP,   vwapIntensity);
    }
    styleCell(log, rowNum, COL.VWAP,
      vwapBg, FONT_SIZES.VWAP, "center", getTextColor(vwapBg), NUM_FMT.VWAP);

    // ── S1 / S2 (support zones) ───────────────────────────────
    // Green gradient: intensity driven by proximity (closer = deeper).
    // Invert the distance: small distPct → high intensity.
    styleCell(log, rowNum, COL.S1,
      getSRZoneColor(srZones.supports[0], "support"),
      FONT_SIZES.SR_ZONE, "center",
      getTextColor(getSRZoneColor(srZones.supports[0], "support")), null);

    styleCell(log, rowNum, COL.S2,
      getSRZoneColor(srZones.supports[1], "support"),
      FONT_SIZES.SR_ZONE, "center",
      getTextColor(getSRZoneColor(srZones.supports[1], "support")), null);

    // ── R1 / R2 (resistance zones) ────────────────────────────
    styleCell(log, rowNum, COL.R1,
      getSRZoneColor(srZones.resistances[0], "resistance"),
      FONT_SIZES.SR_ZONE, "center",
      getTextColor(getSRZoneColor(srZones.resistances[0], "resistance")), null);

    styleCell(log, rowNum, COL.R2,
      getSRZoneColor(srZones.resistances[1], "resistance"),
      FONT_SIZES.SR_ZONE, "center",
      getTextColor(getSRZoneColor(srZones.resistances[1], "resistance")), null);

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
// S/R ZONE HEAT MAP COLOR
// zone:  { label, price, distPct } or null
// type:  "support" → green gradient | "resistance" → red gradient
//
// Distance color logic (inverted — CLOSER = DEEPER color):
//   distPct ≤ SR_HEAT.MIN_PCT → intensity = 1.0 (deepest)
//   distPct ≥ SR_HEAT.MAX_PCT → intensity = 0   (white)
//   in between → linear interpolation, inverted
// ─────────────────────────────────────────────────────────────
function getSRZoneColor(zone, type) {
  if (!zone) return COLOR_THRESHOLDS.NEUTRAL;

  // Invert: small distance → high intensity
  var intensity = 1 - normalizeValue(
    zone.distPct,
    SR_HEAT.MIN_PCT,
    SR_HEAT.MAX_PCT
  );
  // Clamp to a visible minimum so the farthest zones still show
  // a faint tint rather than going completely white
  intensity = Math.max(0.08, intensity);

  return type === "support"
    ? interpolateRGB(PALETTE.GREEN_PALE, PALETTE.GREEN_DEEP, intensity)
    : interpolateRGB(PALETTE.RED_PALE,   PALETTE.RED_DEEP,   intensity);
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
// ADD VOLUME + TREND + VWAP + S/R HEADER NOTES
// ─────────────────────────────────────────────────────────────
function addVolumeHeaderNotes(sheet) {
  var headerRow = findHeaderRow(sheet);
  if (!headerRow) {
    Logger.log("addVolumeHeaderNotes: could not find header row.");
    return;
  }

  // ── VOLUME TODAY ──────────────────────────────────────────
  sheet.getRange(headerRow, COL.VOLUME).setNote(
    "📦 VOLUME TODAY\n" +
    "─────────────────────\n" +
    "Total SPY shares traded so far today.\n\n" +
    "🟢 Green → above-average pace (conviction)\n" +
    "🔴 Red   → below-average pace (caution)"
  );

  // ── VOL vs 30D ────────────────────────────────────────────
  sheet.getRange(headerRow, COL.VOLUME_VS_AVG).setNote(
    "🔥 VOL vs 30D AVG (PACE-ADJUSTED)\n" +
    "─────────────────────\n" +
    "Today's volume vs. what an average day would show\n" +
    "AT THIS POINT in the session — not the full-day total.\n\n" +
    "100% = exactly on pace\n" +
    "150% = 50% more active than average\n" +
    " 60% = 40% quieter than average\n\n" +
    "🟢 Green = above pace  |  🔴 Red = below pace"
  );

  // ── VWAP ──────────────────────────────────────────────────
  sheet.getRange(headerRow, COL.VWAP).setNote(
    "〰️ VWAP — Volume-Weighted Average Price\n" +
    "─────────────────────\n" +
    "Calculated from all 5-min bars since the open using\n" +
    "the standard formula: Σ(typical_price × volume) / Σvolume\n" +
    "where typical_price = (High + Low + Close) / 3.\n\n" +
    "WHY IT MATTERS:\n" +
    "VWAP is the single most-watched intraday benchmark.\n" +
    "Institutions use it as a fair-value reference for\n" +
    "large order execution. Price above VWAP = buyers in\n" +
    "control; below VWAP = sellers in control.\n\n" +
    "COLOR (mild gradient):\n" +
    "🟢 Green = price is ABOVE VWAP (bullish intraday bias)\n" +
    "🔴 Red   = price is BELOW VWAP (bearish intraday bias)\n" +
    "Intensity scales with distance from VWAP (max ~0.60%)."
  );

  // ── S1 / S2 ───────────────────────────────────────────────
  sheet.getRange(headerRow, COL.S1).setNote(
    "🟢 S1 — Nearest Support Zone\n" +
    "─────────────────────\n" +
    "The closest price level BELOW the current price that\n" +
    "could act as a floor. Drawn from: Previous Close,\n" +
    "Day Open, Day Low, VWAP (if below), and the nearest\n" +
    "$5 round-number level.\n\n" +
    "FORMAT: Label  $Price  (distance%)\n\n" +
    "HEAT MAP (green gradient):\n" +
    "Deeper green = price is CLOSER to the support level.\n" +
    "  ≤0.05% away → deepest green (almost touching)\n" +
    "  ≥1.50% away → faint tint (far below, less urgent)\n\n" +
    "WHY PROXIMITY MATTERS:\n" +
    "Price approaching support = potential bounce zone.\n" +
    "Price breaking through support = bearish signal.\n" +
    "Watch volume confirmation when testing these levels."
  );

  sheet.getRange(headerRow, COL.S2).setNote(
    "🟢 S2 — Second Support Zone\n" +
    "─────────────────────\n" +
    "The next-closest support level below current price\n" +
    "(after S1). Same sources and color logic as S1.\n\n" +
    "If S1 breaks, S2 becomes the next potential floor.\n" +
    "Wide gap between S1 and S2 = bigger air pocket below."
  );

  // ── R1 / R2 ───────────────────────────────────────────────
  sheet.getRange(headerRow, COL.R1).setNote(
    "🔴 R1 — Nearest Resistance Zone\n" +
    "─────────────────────\n" +
    "The closest price level ABOVE the current price that\n" +
    "could act as a ceiling. Same sources as S1/S2:\n" +
    "Previous Close, Day Open, Day High, VWAP (if above),\n" +
    "and the nearest $5 round-number level.\n\n" +
    "FORMAT: Label  $Price  (distance%)\n\n" +
    "HEAT MAP (red gradient):\n" +
    "Deeper red = price is CLOSER to the resistance level.\n" +
    "  ≤0.05% away → deepest red (pressing against ceiling)\n" +
    "  ≥1.50% away → faint tint (room to run)\n\n" +
    "WHY PROXIMITY MATTERS:\n" +
    "Price pressing against resistance = likely stall/fade.\n" +
    "Price breaking through resistance on volume = breakout."
  );

  sheet.getRange(headerRow, COL.R2).setNote(
    "🔴 R2 — Second Resistance Zone\n" +
    "─────────────────────\n" +
    "The next-closest resistance level above current price\n" +
    "(after R1). Same sources and color logic as R1.\n\n" +
    "If R1 breaks, R2 becomes the next ceiling to watch.\n" +
    "Wide gap between R1 and R2 = more room to rally."
  );

  // ── TREND STATUS ──────────────────────────────────────────
  sheet.getRange(headerRow, COL.TREND).setNote(
    "🌐 TREND STATUS\n" +
    "─────────────────────\n" +
    "Three-part read separated by │ :\n\n" +
    "1) DIRECTION (9-bar vs 21-bar EMA)\n" +
    "   📈 UPTREND / 📉 DOWNTREND / ⚖️ CONSOLIDATING\n\n" +
    "2) NEAREST S/R ZONE (within ~0.20%)\n" +
    "   🟢 Near support  |  🔴 Near resistance\n\n" +
    "3) MOMENTUM (last 5 bars)\n" +
    "   ⚡ ACCELERATING  ↗️ GRINDING  ➡️ FLAT\n\n" +
    "⚠️ Early session shows GATHERING DATA until\n" +
    "   enough bars accumulate for the EMAs."
  );

  Logger.log("All header notes added at row " + headerRow + ".");
}

// ─────────────────────────────────────────────────────────────
// HELPER: Find header row by scanning for "DATE" in column A
// ─────────────────────────────────────────────────────────────
function findHeaderRow(sheet) {
  var lastRow = Math.min(sheet.getLastRow(), 5);
  if (lastRow < 1) return null;
  var colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (var i = 0; i < colA.length; i++) {
    var val = String(colA[i][0]);
    if (val.indexOf("DATE") !== -1) return i + 1;
  }
  return 2;
}
