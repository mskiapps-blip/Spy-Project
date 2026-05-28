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
// Adjust these numbers to tune color intensity.
// All values are percentages (%) unless noted.
// ─────────────────────────────────────────────────────────────

var COLOR_THRESHOLDS = {

  // ── % Change vs previous close ────────────────────────────
  PCT_CHANGE_MAX: 2.0,    // ±2.0% = deepest green / red
  PCT_CHANGE_MIN: 0.05,   // below this = white (no color)

  // ── Tick % change (move since last 5-min tick) ────────────
  TICK_PCT_MAX:   0.30,   // ±0.30% per tick = deepest color
  TICK_PCT_MIN:   0.01,   // below this = white

  // ── Volume vs 30-day average ──────────────────────────────
  // Above average: green gradient (high volume = conviction)
  VOLUME_HIGH_MAX: 200,   // 200%+ of avg = deepest green
  VOLUME_HIGH_MIN: 100,   // exactly average = starts coloring

  // Below average: red gradient (low volume = caution)
  VOLUME_LOW_MIN:  40,    // below 40% = deepest red
  // 40–100% transitions from pale red → white

  // ── Neutral / no-data ─────────────────────────────────────
  NEUTRAL: "#ffffff"      // white — no data or value too small
};

// ─────────────────────────────────────────────────────────────
// PALETTE — RGB endpoints for each gradient.
// [R, G, B] arrays. Adjust to change the actual colors.
// ─────────────────────────────────────────────────────────────

var PALETTE = {
  // Price / % change — green (positive) and red (negative)
  GREEN_PALE: [230, 255, 230],   // very light mint
  GREEN_DEEP: [0,   120,  30],   // deep forest green

  RED_PALE:   [255, 230, 230],   // very light blush
  RED_DEEP:   [180,   0,   0],   // deep red

  // Text colors for readability on colored backgrounds
  TEXT_DARK:  "#0d0d0d",         // dark text — for light backgrounds
  TEXT_LIGHT: "#ffffff"          // white text — for dark backgrounds
};

// ─────────────────────────────────────────────────────────────
// CORE: % Change (vs prev close) → background color
// Used for both the PRICE and % CHANGE columns (% is the anchor).
// Positive → green gradient. Negative → red gradient.
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

  return pctValue >= 0
    ? interpolateRGB(PALETTE.GREEN_PALE, PALETTE.GREEN_DEEP, intensity)
    : interpolateRGB(PALETTE.RED_PALE,   PALETTE.RED_DEEP,   intensity);
}

// ─────────────────────────────────────────────────────────────
// CORE: Tick % change (per 5-min bar) → background color
// Same green/red logic but tighter thresholds since tick
// moves are much smaller than full-day moves.
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

  return tickPctValue >= 0
    ? interpolateRGB(PALETTE.GREEN_PALE, PALETTE.GREEN_DEEP, intensity)
    : interpolateRGB(PALETTE.RED_PALE,   PALETTE.RED_DEEP,   intensity);
}

// ─────────────────────────────────────────────────────────────
// CORE: Volume vs 30-day average → background color
//
// Uses the SAME green/red palette as price so everything
// reads consistently across the whole log:
//
//   Above average (volPct >= 100) → GREEN gradient
//     Interpretation: elevated participation, moves have
//     more conviction behind them.
//
//   Below average (volPct < 100)  → RED gradient
//     Interpretation: thin/quiet session, moves less reliable.
//
//   No avg data yet (avgVol30=0, rawVolume>0) → pale green hint
//     Shows activity is happening even before avg is available.
//
// volPct:    today's vol as % of 30d avg (e.g. 150 = 150%)
// rawVolume: raw share count (fallback when avgVol30=0)
// avgVol30:  30-day average daily volume
// ─────────────────────────────────────────────────────────────
function getVolumeColor(volPct, rawVolume, avgVol30) {
  // Normalize inputs safely
  volPct    = (typeof volPct    === "number" && !isNaN(volPct))    ? volPct    : 0;
  rawVolume = (typeof rawVolume === "number" && !isNaN(rawVolume)) ? rawVolume : 0;
  avgVol30  = (typeof avgVol30  === "number" && !isNaN(avgVol30))  ? avgVol30  : 0;

  // ── Have a real ratio: green (above avg) or red (below avg) ──
  if (volPct > 0) {
    if (volPct >= 100) {
      // Above average → green (high volume = conviction)
      var intensity = normalizeValue(
        volPct,
        COLOR_THRESHOLDS.VOLUME_HIGH_MIN,
        COLOR_THRESHOLDS.VOLUME_HIGH_MAX
      );
      return interpolateRGB(PALETTE.GREEN_PALE, PALETTE.GREEN_DEEP, intensity);
    } else {
      // Below average → red (low volume = thin/cautious)
      // Lower volume = more red, so we invert the scale
      var intensity = normalizeValue(
        100 - volPct,
        0,
        100 - COLOR_THRESHOLDS.VOLUME_LOW_MIN
      );
      return interpolateRGB(PALETTE.RED_PALE, PALETTE.RED_DEEP, intensity);
    }
  }

  // ── Volume exists but no 30d avg yet (early session) ─────
  // Show a very pale green hint — trading is happening, avg pending
  if (rawVolume > 0 && avgVol30 === 0) {
    return interpolateRGB(PALETTE.GREEN_PALE, PALETTE.GREEN_DEEP, 0.08);
  }

  // ── No data ───────────────────────────────────────────────
  return COLOR_THRESHOLDS.NEUTRAL;
}

// ─────────────────────────────────────────────────────────────
// MATH: Normalize value to 0–1 (clamped).
// value: raw input
// min:   maps to intensity 0 (pale)
// max:   maps to intensity 1 (deep)
// ─────────────────────────────────────────────────────────────
function normalizeValue(value, min, max) {
  if (max <= min) return 1;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ─────────────────────────────────────────────────────────────
// MATH: Linear RGB interpolation between two colors.
// colorA: [R, G, B] — pale endpoint
// colorB: [R, G, B] — deep endpoint
// t:      0–1 blend factor
// Returns: "#rrggbb" hex string
// ─────────────────────────────────────────────────────────────
function interpolateRGB(colorA, colorB, t) {
  var r = Math.round(colorA[0] + (colorB[0] - colorA[0]) * t);
  var g = Math.round(colorA[1] + (colorB[1] - colorA[1]) * t);
  var b = Math.round(colorA[2] + (colorB[2] - colorA[2]) * t);
  return rgbToHex(r, g, b);
}

// ─────────────────────────────────────────────────────────────
// MATH: R, G, B integers → "#rrggbb" hex string
// ─────────────────────────────────────────────────────────────
function rgbToHex(r, g, b) {
  return "#"
    + ("0" + r.toString(16)).slice(-2)
    + ("0" + g.toString(16)).slice(-2)
    + ("0" + b.toString(16)).slice(-2);
}

// ─────────────────────────────────────────────────────────────
// HELPER: Choose readable text color for a given background.
// Uses perceived luminance — dark bg → white text, vice versa.
// ─────────────────────────────────────────────────────────────
function getTextColor(hexBg) {
  if (!hexBg || hexBg === COLOR_THRESHOLDS.NEUTRAL || hexBg === "#ffffff") {
    return PALETTE.TEXT_DARK;
  }
  var r = parseInt(hexBg.slice(1, 3), 16);
  var g = parseInt(hexBg.slice(3, 5), 16);
  var b = parseInt(hexBg.slice(5, 7), 16);
  var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5 ? PALETTE.TEXT_LIGHT : PALETTE.TEXT_DARK;
}
