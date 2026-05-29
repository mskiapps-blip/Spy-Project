// ============================================================
// FILE: IntegrationPatch.gs
// ============================================================
//
//  These are NOT new files — they show the small additions
//  needed in two existing files to wire up the richer AI context.
//  Each section is clearly labeled with where to paste it.
// ============================================================


// ════════════════════════════════════════════════════════════
//  PATCH 1 OF 2 — Logger.gs
//  Location: inside logTick(), AFTER the S/R zone block where
//             s1Str / r1Str are formatted (around line where
//             formatZone() is called). Paste these two lines
//             immediately after r2Str is set.
// ════════════════════════════════════════════════════════════

// ── Cache S/R for AI context ──────────────────────────────
// These flags are read by buildBearTrapPrompt() and buildPrompt()
// in AIAnalyst.gs so every AI call has the latest S/R levels.
if (srZones.supports[0])    setFlag("SESSION_LAST_S1", formatZone(srZones.supports[0]));
if (srZones.resistances[0]) setFlag("SESSION_LAST_R1", formatZone(srZones.resistances[0]));

// Also cache VWAP for AI context
if (vwap > 0) setFlag("DAY_VWAP", vwap.toString());


// ════════════════════════════════════════════════════════════
//  PATCH 2A OF 2 — Scorecard.gs → updateScorecardStats()
//  Location: At the very END of updateScorecardStats(), just
//             before the closing Logger.log() line.
// ════════════════════════════════════════════════════════════

// ── Cache rolling stats as flags for AI context ───────────
// Read by buildSessionContext() in AIAnalyst.gs so all three
// AI callers (AIAnalyst, BearTrapTracker, MorningBrief) have
// the latest historical win rate without reading the sheet.
cacheSessionContextFlags(winRate, windowWinRate, patternRate, dataRows);


// ════════════════════════════════════════════════════════════
//  PATCH 2B OF 2 — Scorecard.gs → logToScorecard()
//  Location: Inside logToScorecard(), just BEFORE the line:
//              updateScorecardStats(sheet);
//  This caches yesterday's result so the morning brief knows
//  how the prior session ended.
// ════════════════════════════════════════════════════════════

// ── Cache last session result for morning brief context ───
setFlag("SC_LAST_GRADE",          grade);
setFlag("SC_LAST_CLOSE_VS_OPEN",  (Math.round(closeVsOpen * 100) / 100).toString() + "%");


// ════════════════════════════════════════════════════════════
//  SUMMARY OF ALL FLAG KEYS USED BY THE AI CONTEXT SYSTEM
// ════════════════════════════════════════════════════════════
//
//  Set by Logger.gs (each tick):
//    SESSION_LAST_S1        — nearest support label + price + dist
//    SESSION_LAST_R1        — nearest resistance label + price + dist
//    DAY_VWAP               — current session VWAP price
//
//  Set by Scorecard.gs (via cacheSessionContextFlags, once/day):
//    SC_ROLLING_WIN_RATE    — 20-day rolling win rate (%)
//    SC_ROLLING_PATTERN_RATE — days pattern appeared / total (%)
//    SC_TOTAL_DAYS          — total trading days tracked
//
//  Set by Scorecard.gs (logToScorecard, once/day):
//    SC_LAST_GRADE          — yesterday's EOD grade string
//    SC_LAST_CLOSE_VS_OPEN  — yesterday's close vs open (e.g. "+0.82%")
//
//  Set by MorningBrief.gs (already set, just being read by AI):
//    MB_SETUP_TYPE          — today's setup (BEAR_TRAP / BULL / etc.)
//    MB_RATIONALE           — one-sentence rationale from brief
//    MB_FLUSH_TARGET        — predicted flush price level
//    MB_FLIP_ZONE           — predicted flip price level
//    MB_RIP_TARGET          — predicted rip price level
//    MB_EOD_TARGET          — predicted EOD close price
//    MB_HITS                — how many targets were hit (updated intraday)
//    MB_TOTAL_TARGETS       — total targets issued (usually 4)
//
//  All flags are reset at EOD (existing resetDailyBearTrapFlags /
//  resetDailyMorningBriefFlags calls) — except SC_* flags which
//  persist intentionally so tomorrow's morning brief can read them.
// ════════════════════════════════════════════════════════════
