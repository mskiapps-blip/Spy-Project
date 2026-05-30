// ============================================================
// FILE: Dashboard.gs  — PATCH INSTRUCTIONS
// ============================================================
//
//  TWO CHANGES NEEDED in your existing Dashboard.gs file.
//  Find each block by the comment marker and replace as shown.
//
// ─────────────────────────────────────────────────────────────
// CHANGE 1 of 2 — generateDashboardBrief()
//
// FIND this exact block (around line ~370 in Dashboard.gs):
//
//     var payload = JSON.stringify({
//       contents: [{ parts: [{ text: prompt }] }],
//       generationConfig: { maxOutputTokens: 400, temperature: 0.4 }
//     });
//
//     var resp = UrlFetchApp.fetch(url, {
//       method: "post", contentType: "application/json",
//       payload: payload, muteHttpExceptions: true
//     });
//
//     if (resp.getResponseCode() !== 200) {
//       Logger.log("Dashboard brief Gemini error: " + resp.getResponseCode());
//       return null;
//     }
//
// REPLACE WITH:
//
//     var payload = JSON.stringify({
//       contents: [{ parts: [{ text: prompt }] }],
//       generationConfig: { maxOutputTokens: 800, temperature: 0.4 }
//     });
//
//     var resp = UrlFetchApp.fetch(url, {
//       method: "post", contentType: "application/json",
//       payload: payload, muteHttpExceptions: true
//     });
//
//     if (resp.getResponseCode() !== 200) {
//       Logger.log("Dashboard brief Gemini error: " + resp.getResponseCode());
//       recordAICall(AI_FEATURE.DASHBOARD, false);
//       appendAIHealthLog("DASHBOARD", "FAIL", "HTTP " + resp.getResponseCode());
//       return null;
//     }
//
// ─────────────────────────────────────────────────────────────
// CHANGE 2 of 2 — generateDashboardBrief() success + fail paths
//
// FIND this exact block (a few lines below, still in
// generateDashboardBrief()):
//
//     // Reject truncated responses — must be at least 80 chars and end with
//     // sentence-ending punctuation. If not, return null so we don't save garbage.
//     if (!text || text.length < 80) {
//       Logger.log("Dashboard brief rejected — too short (" + (text ? text.length : 0) + " chars): " + text);
//       return null;
//     }
//     var lastChar = text[text.length - 1];
//     if (lastChar !== "." && lastChar !== "!" && lastChar !== "?") {
//       Logger.log("Dashboard brief rejected — appears truncated, last char: '" + lastChar + "'");
//       return null;
//     }
//
//     return text;
//   } catch (e) {
//     Logger.log("generateDashboardBrief ERROR: " + e.message);
//     return null;
//   }
// }
//
// REPLACE WITH:
//
//     // Reject truncated responses — must be at least 80 chars and end with
//     // sentence-ending punctuation. If not, return null so we don't save garbage.
//     if (!text || text.length < 80) {
//       Logger.log("Dashboard brief rejected — too short (" + (text ? text.length : 0) + " chars): " + text);
//       recordAICall(AI_FEATURE.DASHBOARD, false);
//       appendAIHealthLog("DASHBOARD", "FAIL", "too short (" + (text ? text.length : 0) + " chars)");
//       return null;
//     }
//     var lastChar = text[text.length - 1];
//     if (lastChar !== "." && lastChar !== "!" && lastChar !== "?") {
//       Logger.log("Dashboard brief rejected — appears truncated, last char: '" + lastChar + "'");
//       recordAICall(AI_FEATURE.DASHBOARD, false);
//       appendAIHealthLog("DASHBOARD", "FAIL", "truncated at char: '" + lastChar + "'");
//       return null;
//     }
//
//     recordAICall(AI_FEATURE.DASHBOARD, true);
//     appendAIHealthLog("DASHBOARD", "OK", "brief generated");
//     return text;
//   } catch (e) {
//     Logger.log("generateDashboardBrief ERROR: " + e.message);
//     recordAICall(AI_FEATURE.DASHBOARD, false);
//     appendAIHealthLog("DASHBOARD", "FAIL", "exception: " + e.message);
//     return null;
//   }
// }
//
// ─────────────────────────────────────────────────────────────
// SUMMARY OF CHANGES:
//   • maxOutputTokens: 400 → 800  (fixes brief truncation)
//   • recordAICall(AI_FEATURE.DASHBOARD, ...) added on all paths
//   • appendAIHealthLog() added on all paths (feeds the log sheet)
// ─────────────────────────────────────────────────────────────
