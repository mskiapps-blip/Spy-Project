function testGemini() {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  Logger.log("API Key found: " + (apiKey ? "YES (" + apiKey.length + " chars)" : "NO - KEY IS MISSING"));
  
  var models = [
    "gemini-2.0-flash",
    "gemini-2.5-flash-preview-05-20",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-pro"
  ];
  
  models.forEach(function(model) {
    try {
      var url = "https://generativelanguage.googleapis.com/v1beta/models/"
              + model + ":generateContent?key=" + apiKey;
      var payload = JSON.stringify({
        contents: [{ parts: [{ text: "Say OK" }] }],
        generationConfig: { maxOutputTokens: 5 }
      });
      var resp = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: payload,
        muteHttpExceptions: true
      });
      Logger.log(model + " → " + resp.getResponseCode());
    } catch(e) {
      Logger.log(model + " → ERROR: " + e.message);
    }
  });
}

function testGeminiSingle() {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  var url = "https://generativelanguage.googleapis.com/v1beta/models/"
          + "gemini-2.0-flash:generateContent?key=" + apiKey;
  var payload = JSON.stringify({
    contents: [{ parts: [{ text: "Say OK" }] }],
    generationConfig: { maxOutputTokens: 5 }
  });
  var resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: payload,
    muteHttpExceptions: true
  });
  Logger.log("Response code: " + resp.getResponseCode());
  Logger.log("Body: " + resp.getContentText().substring(0, 200));
}

function listAvailableModels() {
  var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  var url    = "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey;
  
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log("Response code: " + resp.getResponseCode());
  
  var json   = JSON.parse(resp.getContentText());
  var models = json.models || [];
  
  models.forEach(function(m) {
    // Only show models that support generateContent
    var methods = m.supportedGenerationMethods || [];
    if (methods.indexOf("generateContent") !== -1) {
      Logger.log("✅ " + m.name + " — " + (m.displayName || ""));
    }
  });
}
