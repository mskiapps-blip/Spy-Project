// ============================================================
// FILE: ColorGradient.gs
// PURPOSE: All color-gradient math lives here.
//          RGB values are computed programmatically so every
//          shade is smooth and proportional — no fixed buckets.
//
//          DESIGN PATTERN:
//          1. Normalize the input value to a 0–1 intensity.
//          2. Interpolate between a "pale" and "deep" color.
//          3. Return a hex color string like "#rrggbb".
// ============================================================

// ─────────────────────────────────────────────────────────────
// ██  THRESHOLD SETTINGS  ██
// Adjust these to tune when colors become "deep" or "pale".
// All values are percentages (%) unless noted.
// ─────────────────────────────────────────────────────────────

var COLOR_THRESHOLDS = {

  // ── Percent Change (vs prev close) ──────────────────────
  // "DEEP" color kicks in at or above this absolute % value
  PCT_CHANGE_MAX: 2.0,       // ±2.0% = deepest color
  PCT_CHANGE_MIN: 0.05,      // below this = essentially white

  // ── Tick Percent Change (price change since last tick) ──
  TICK_PCT_MAX:   0.30,      // ±0.30% per tick = deep color
  TICK_PCT_MIN:   0.01,      // below this = essentially white

  // ── Volume vs 30-day average ────────────────────────────
  VOLUME_HIGH_MAX: 200,      // 200% of avg = deep orange/red
  VOLUME_HIGH_MIN: 80,       // below 80% = blue (thin volume)
  VOLUME_LOW_MIN:  40,       // below 40% = deep blue

  // ── AI MEMO background (large movement rows) ────────────
  AI_MEMO_BG:     "#1a0a3e", // dark purple for flagged rows

  // ── Neutral / no-data color ──────────────────────────────
  NEUTRAL:        "#ffffff"  // white — used when value is 0 or "—"
};

// ─────────────────────────────────────────────────────────────
// PALETTE — base RGB endpoints for each gradient
// [R, G, B] format. Adjust to taste.
// ─────────────────────────────────────────────────────────────

var PALETTE = {
  // Positive (green direction)
  GREEN_PALE: [230, 255, 230],   // very light mint
  GREEN_DEEP: [0,   120,  30],   // deep forest green

  // Negative (red direction)
  RED_PALE:   [255, 230, 230],   // very light blush
  RED_DEEP:   [180,   0,   0],   // deep red

  // Volume high (orange/amber — above avg)
  VOL_HIGH_PALE: [255, 245, 210],  // pale yellow
  VOL_HIGH_DEEP: [220,  80,   0],  // burnt orange

  // Volume low (blue — below avg)
  VOL_LOW_PALE:  [220, 235, 255],  // pale sky blue
  VOL_LOW_DEEP:  [20,   60, 200],  // deep blue

  // Text on deep backgrounds — always readable
  TEXT_DARK:  "#0d0d0d",
  TEXT_LIGHT: "#ffffff"
};

// ─────────────────────────────────────────────────────────────
// CORE: Get background color for a PERCENT CHANGE value.
// Also used for the PRICE cell (same color as pctChange).
// pctValue: number (e.g. 1.25 for +1.25%, -0.80 for -0.80%)
// ─────────────────────────────────────────────────────────────
function getPctChangeColor(pctValue) {
  if (typeof pctValue !== "number" || isNaN(pctValue)) {
    return COLOR_THRESHOLDS.NEUTRAL;
  }
  if (Math.abs(pctValue) < COLOR_THRESHOLDS.PCT_CHANGE_MIN) {
    return COLOR_THRESHOLDS.NEUTRAL;
  }

  var intensity = normalizeValue(
    Math.abs(pctValue),
    COLOR_THRESHOLDS.PCT_CHANGE_MIN,
    COLOR_THRESHOLDS.PCT_CHANGE_MAX
  );

  if (pctValue >= 0) {
    return interpolateRGB(PALETTE.GREEN_PALE, PALETTE.GREEN_DEEP, intensity);
  } else {
    return interpolateRGB(PALETTE.RED_PALE, PALETTE.RED_DEEP, intensity);
  }
}

// ─────────────────────────────────────────────────────────────
// CORE: Get background color for TICK PERCENT CHANGE.
// Uses tighter thresholds since tick moves are smaller.
// ─────────────────────────────────────────────────────────────
function getTickPctColor(tickPctValue) {
  if (typeof tickPctValue !== "number" || isNaN(tickPctValue)) {
    return COLOR_THRESHOLDS.NEUTRAL;
  }
  if (Math.abs(tickPctValue) < COLOR_THRESHOLDS.TICK_PCT_MIN) {
    return COLOR_THRESHOLDS.NEUTRAL;
  }

  var intensity = normalizeValue(
    Math.abs(tickPctValue),
    COLOR_THRESHOLDS.TICK_PCT_MIN,
    COLOR_THRESHOLDS.TICK_PCT_MAX
  );

  if (tickPctValue >= 0) {
    return interpolateRGB(PALETTE.GREEN_PALE, PALETTE.GREEN_DEEP, intensity);
  } else {
    return interpolateRGB(PALETTE.RED_PALE, PALETTE.RED_DEEP, intensity);
  }
}

// ─────────────────────────────────────────────────────────────
// CORE: Get background color for VOLUME vs 30-day average.
// volPct:      number — today's vol as % of 30d avg (e.g. 150 = 150%)
// rawVolume:   number — today's raw cumulative volume (used as fallback
//              when avgVol30 is unavailable so we still show some color)
// avgVol30:    number — the 30-day average daily volume
//
// COLOR LOGIC:
//   volPct >= 100  → orange gradient (above average)
//   volPct < 100   → blue gradient   (below average)
//   volPct == 0 but rawVolume > 0 → pale orange (data present, no avg yet)
//   everything else → white (no data)
// ─────────────────────────────────────────────────────────────
function getVolumeColor(volPct, rawVolume, avgVol30) {
  // Normalize inputs
  volPct    = (typeof volPct    === "number" && !isNaN(volPct))    ? volPct    : 0;
  rawVolume = (typeof rawVolume === "number" && !isNaN(rawVolume)) ? rawVolume : 0;
  avgVol30  = (typeof avgVol30  === "number" && !isNaN(avgVol30))  ? avgVol30  : 0;

  // ── Case 1: We have a valid comparison ratio ──────────────
  if (volPct > 0) {
    if (volPct >= 100) {
      // Above average — orange gradient
      var intensity = normalizeValue(
        volPct,
        COLOR_THRESHOLDS.VOLUME_HIGH_MIN,
        COLOR_THRESHOLDS.VOLUME_HIGH_MAX
      );
      return interpolateRGB(PALETTE.VOL_HIGH_PALE, PALETTE.VOL_HIGH_DEEP, intensity);
    } else {
      // Below average — blue gradient (lower = deeper blue)
      var intensity = normalizeValue(
        100 - volPct,
        0,
        100 - COLOR_THRESHOLDS.VOLUME_LOW_MIN
      );
      return interpolateRGB(PALETTE.VOL_LOW_PALE, PALETTE.VOL_LOW_DEEP, intensity);
    }
  }

  // ── Case 2: No 30d avg yet, but we DO have raw volume ─────
  // Show a very pale orange so the cell isn't just white —
  // it signals "trading is happening, comparison pending"
  if (rawVolume > 0 && avgVol30 === 0) {
    return interpolateRGB(PALETTE.VOL_HIGH_PALE, PALETTE.VOL_HIGH_DEEP, 0.08);
  }

  // ── Case 3: No data at all ────────────────────────────────
  return COLOR_THRESHOLDS.NEUTRAL;
}

// ─────────────────────────────────────────────────────────────
// MATH: Normalize a value to 0–1 clamped range.
// value: the raw input
// min:   value at which intensity = 0 (pale)
// max:   value at which intensity = 1 (deep)
// ─────────────────────────────────────────────────────────────
function normalizeValue(value, min, max) {
  if (max <= min) return 1;
  var normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized)); // clamp 0–1
}

// ─────────────────────────────────────────────────────────────
// MATH: Linear interpolation between two RGB colors.
// colorA: [R, G, B] starting color (pale)
// colorB: [R, G, B] ending color (deep)
// t:      0–1 blend factor
// Returns: hex string "#rrggbb"
// ─────────────────────────────────────────────────────────────
function interpolateRGB(colorA, colorB, t) {
  var r = Math.round(colorA[0] + (colorB[0] - colorA[0]) * t);
  var g = Math.round(colorA[1] + (colorB[1] - colorA[1]) * t);
  var b = Math.round(colorA[2] + (colorB[2] - colorA[2]) * t);
  return rgbToHex(r, g, b);
}

// ─────────────────────────────────────────────────────────────
// MATH: Convert R, G, B integers to hex string
// ─────────────────────────────────────────────────────────────
function rgbToHex(r, g, b) {
  return "#" +
    ("0" + r.toString(16)).slice(-2) +
    ("0" + g.toString(16)).slice(-2) +
    ("0" + b.toString(16)).slice(-2);
}

// ─────────────────────────────────────────────────────────────
// HELPER: Choose readable text color based on background.
// Dark backgrounds → white text; light → dark text.
// Uses luminance formula for accuracy.
// ─────────────────────────────────────────────────────────────
function getTextColor(hexBg) {
  // Default to dark text on white background
  if (!hexBg || hexBg === COLOR_THRESHOLDS.NEUTRAL) return PALETTE.TEXT_DARK;

  var r = parseInt(hexBg.slice(1, 3), 16);
  var g = parseInt(hexBg.slice(3, 5), 16);
  var b = parseInt(hexBg.slice(5, 7), 16);

  // Perceived luminance (standard formula)
  var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // If background is dark (luminance < 0.5), use white text
  return luminance < 0.5 ? PALETTE.TEXT_LIGHT : PALETTE.TEXT_DARK;
}
