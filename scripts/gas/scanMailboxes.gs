/**
 * ═══════════════════════════════════════════════════════════
 *  Alter5 BI — Gmail Scanner (Google Apps Script)
 * ═══════════════════════════════════════════════════════════
 *
 *  Escanea los buzones del equipo buscando emails recibidos
 *  desde la última ejecución. Extrae metadatos + cuerpo completo
 *  (text/plain o HTML stripped, max 2000 chars). Escribe las filas
 *  en la Google Sheet "alter5-bi-pipeline" y dispara el workflow
 *  de GitHub Actions.
 *
 *  Columns: status | employee_id | date | from_email | from_name |
 *           from_domain | subject | body_snippet | thread_id | body_text
 *
 *  SETUP:
 *  1. Copiar este código al editor de Apps Script
 *  2. Configurar Script Properties:
 *     - GITHUB_PAT: Personal Access Token con scope "workflow"
 *     - GITHUB_REPO: owner/repo (ej: salvac12/alter5-bi)
 *     - SHEET_ID: ID de la Google Sheet
 *     - SA_EMAIL: Email de la service account
 *     - SA_PRIVATE_KEY: Private key del JSON (el campo "private_key", con \n)
 *  3. Crear trigger diario (scanMailboxes, time-based, 03:00-04:00)
 *
 *  Ambos buzones usan Gmail API + service account con delegación de dominio
 * ═══════════════════════════════════════════════════════════
 */

// ---- Config ----
var PERSONAL_DOMAINS = [
  'gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com',
  'live.com', 'icloud.com', 'yahoo.es', 'hotmail.es',
  'googlemail.com', 'protonmail.com', 'me.com', 'msn.com'
];

// Fallback employees (used if 'employees' tab doesn't exist or is empty)
var EMPLOYEES_FALLBACK = [
  { id: 'salvador_carrillo', configKey: 'lastScanDate_salvador', mode: 'delegated', email: 'salvador.carrillo@alter-5.com' },
  { id: 'leticia_menéndez',  configKey: 'lastScanDate_leticia',  mode: 'delegated', email: 'leticia.menendez@alter-5.com' },
];

/**
 * Read active employees from the 'employees' tab in the Sheet.
 * Columns: employee_id | email | configKey | active
 * Falls back to EMPLOYEES_FALLBACK if the tab doesn't exist or is empty.
 */
function getEmployeesFromSheet_(ss) {
  var empSheet = ss.getSheetByName('employees');
  if (!empSheet) {
    Logger.log('Tab "employees" not found — using fallback');
    return EMPLOYEES_FALLBACK;
  }

  var data = empSheet.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log('Tab "employees" is empty — using fallback');
    return EMPLOYEES_FALLBACK;
  }

  var employees = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var empId = String(row[0] || '').trim();
    var email = String(row[1] || '').trim();
    var configKey = String(row[2] || '').trim();
    var active = row[3];

    // Skip inactive or empty rows
    if (!empId || !email || active === false || active === 'FALSE' || active === 'false') continue;

    employees.push({
      id: empId,
      configKey: configKey || ('lastScanDate_' + empId.split('_')[0]),
      mode: 'delegated',
      email: email,
    });
  }

  if (employees.length === 0) {
    Logger.log('No active employees in Sheet — using fallback');
    return EMPLOYEES_FALLBACK;
  }

  Logger.log('Loaded ' + employees.length + ' employees from Sheet');
  return employees;
}

// ---- Config ----
var MAX_RUNTIME_MS = 25 * 60 * 1000;  // 25 min safety margin (GAS limit: 30 min manual)
var SCAN_START_TIME_ = null;           // set in scanMailboxes()

// ---- Main ----
function scanMailboxes() {
  SCAN_START_TIME_ = new Date().getTime();
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID no configurado en Script Properties');

  var ss = SpreadsheetApp.openById(sheetId);
  var rawSheet = ss.getSheetByName('raw_emails');
  var configSheet = ss.getSheetByName('config');

  if (!rawSheet || !configSheet) {
    throw new Error('Faltan tabs raw_emails o config en la Sheet');
  }

  var EMPLOYEES = getEmployeesFromSheet_(ss);
  var existingThreadIds = getExistingThreadIds_(rawSheet);
  var totalNew = 0;
  var timedOut = false;

  for (var ei = 0; ei < EMPLOYEES.length; ei++) {
    var emp = EMPLOYEES[ei];

    // Check if we're approaching the time limit
    if (isTimeLimitReached_()) {
      Logger.log('TIME LIMIT before starting ' + emp.id + '. Scheduling continuation...');
      timedOut = true;
      break;
    }

    var lastScan = getConfigValue_(configSheet, emp.configKey);
    var afterDate = lastScan
      ? Utilities.formatDate(new Date(lastScan), 'Europe/Madrid', 'yyyy/MM/dd')
      : '2020/01/01';

    // Skip employees already scanned recently (within last hour)
    if (lastScan) {
      var lastScanDate = new Date(lastScan);
      var hoursSince = (new Date().getTime() - lastScanDate.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 1) {
        Logger.log(emp.id + ': already scanned ' + Math.round(hoursSince * 60) + ' min ago, skipping');
        continue;
      }
    }

    Logger.log('Scanning ' + emp.id + ' after ' + afterDate);

    var result = scanDelegatedGmailStreaming_(emp, afterDate, existingThreadIds, rawSheet);
    totalNew += result.count;

    if (result.timedOut) {
      Logger.log('TIME LIMIT during ' + emp.id + '. Wrote ' + result.count + ' emails so far. Scheduling continuation...');
      // Do NOT update lastScanDate — next run retries this employee
      // Thread deduplication prevents duplicates
      timedOut = true;
      break;
    }

    Logger.log(emp.id + ': ' + result.count + ' new emails written (complete)');
    setConfigValue_(configSheet, emp.configKey, new Date().toISOString());
  }

  Logger.log('Total new emails this run: ' + totalNew);

  if (timedOut) {
    scheduleContinuation_();
  } else {
    cleanContinuationTriggers_();
    Logger.log('ALL EMPLOYEES COMPLETE');
    if (totalNew > 0) {
      triggerGitHubActions_();
    }
  }
}

function isTimeLimitReached_() {
  return (new Date().getTime() - SCAN_START_TIME_) > MAX_RUNTIME_MS;
}

/**
 * Schedule a continuation run in 2 minutes via time-based trigger.
 */
function scheduleContinuation_() {
  cleanContinuationTriggers_();
  ScriptApp.newTrigger('scanMailboxes')
    .timeBased()
    .after(2 * 60 * 1000)
    .create();
  Logger.log('Continuation scheduled in 2 minutes');
}

/**
 * Remove any existing continuation triggers to avoid duplicates.
 */
function cleanContinuationTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scanMailboxes' &&
        triggers[i].getTriggerSource() === ScriptApp.TriggerSource.CLOCK) {
      try {
        ScriptApp.deleteTrigger(triggers[i]);
      } catch(e) {
        Logger.log('Could not delete trigger: ' + e);
      }
    }
  }
}

// ---- Gmail API con delegación de dominio (streaming) ----

/**
 * Scan an employee's Gmail, writing rows to the sheet in real-time.
 * No message count limit — paginates through ALL messages.
 * Checks time limit after each batch write.
 * Returns { count: N, timedOut: bool }
 */
function scanDelegatedGmailStreaming_(emp, afterDate, existingThreadIds, rawSheet) {
  var accessToken = getServiceAccountToken_(emp.email);
  var query = 'after:' + afterDate + ' -from:me';
  var totalWritten = 0;

  // Paginate through ALL message IDs (no cap)
  var pageToken = '';
  var messageIds = [];

  do {
    var url = 'https://gmail.googleapis.com/gmail/v1/users/' + emp.email + '/messages?q=' + encodeURIComponent(query) + '&maxResults=500';
    if (pageToken) url += '&pageToken=' + pageToken;

    var response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('Gmail API error for ' + emp.email + ': ' + response.getContentText());
      return { count: totalWritten, timedOut: false };
    }

    var data = JSON.parse(response.getContentText());
    var messages = data.messages || [];
    messages.forEach(function(m) { messageIds.push(m.id); });
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  Logger.log(emp.id + ': ' + messageIds.length + ' total message IDs');

  // Fetch and write in batches of 50
  var BATCH_SIZE = 50;
  for (var batchStart = 0; batchStart < messageIds.length; batchStart += BATCH_SIZE) {
    // Time check before each batch
    if (isTimeLimitReached_()) {
      Logger.log(emp.id + ': time limit at batch ' + (batchStart / BATCH_SIZE + 1) + ', wrote ' + totalWritten + ' so far');
      return { count: totalWritten, timedOut: true };
    }

    var batchIds = messageIds.slice(batchStart, batchStart + BATCH_SIZE);
    var batchRows = fetchMessageBatch_(emp.email, accessToken, batchIds, emp.id, existingThreadIds);

    // Write immediately to sheet (streaming)
    if (batchRows.length > 0) {
      rawSheet.getRange(
        rawSheet.getLastRow() + 1, 1, batchRows.length, batchRows[0].length
      ).setValues(batchRows);
      totalWritten += batchRows.length;
    }

    // Progress log every 10 batches
    var batchNum = batchStart / BATCH_SIZE + 1;
    var totalBatches = Math.ceil(messageIds.length / BATCH_SIZE);
    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      Logger.log(emp.id + ': batch ' + batchNum + '/' + totalBatches + ' — ' + totalWritten + ' emails written');
    }
  }

  return { count: totalWritten, timedOut: false };
}

/**
 * Fetch up to 100 messages in a single HTTP call using Gmail batch API.
 * Reduces ~100 UrlFetchApp calls to 1, solving the daily quota issue.
 */
function fetchMessageBatch_(userEmail, accessToken, msgIds, empId, existingThreadIds) {
  var boundary = 'batch_alter5_' + Date.now();
  var batchBody = '';

  msgIds.forEach(function(msgId, i) {
    batchBody += '--' + boundary + '\r\n';
    batchBody += 'Content-Type: application/http\r\n';
    batchBody += 'Content-ID: <msg' + i + '>\r\n\r\n';
    batchBody += 'GET /gmail/v1/users/' + userEmail + '/messages/' + msgId + '?format=full\r\n\r\n';
  });
  batchBody += '--' + boundary + '--';

  var response = UrlFetchApp.fetch('https://gmail.googleapis.com/batch/gmail/v1', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + accessToken },
    contentType: 'multipart/mixed; boundary=' + boundary,
    payload: batchBody,
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Batch API error: ' + response.getResponseCode());
    return [];
  }

  var rows = [];
  var respText = response.getContentText();
  var respBoundary = respText.match(/^--([^\r\n]+)/);
  if (!respBoundary) return [];

  var parts = respText.split('--' + respBoundary[1]);
  parts.forEach(function(part) {
    // Each part has HTTP headers, blank line, then the JSON body
    var jsonMatch = part.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    try {
      var msg = JSON.parse(jsonMatch[0]);
    } catch(e) { return; }

    if (!msg.id || !msg.threadId) return;
    if (existingThreadIds[msg.threadId]) return;

    var headers = {};
    (msg.payload && msg.payload.headers || []).forEach(function(h) {
      headers[h.name.toLowerCase()] = h.value;
    });

    var parsed = parseFromField_(headers['from'] || '');
    if (!parsed.domain || isPersonalDomain_(parsed.domain)) return;

    var dateStr = '';
    try {
      dateStr = Utilities.formatDate(new Date(headers['date']), 'Europe/Madrid', 'yyyy-MM-dd');
    } catch(e) {
      dateStr = Utilities.formatDate(new Date(parseInt(msg.internalDate)), 'Europe/Madrid', 'yyyy-MM-dd');
    }

    // Extract and clean the full email body text (max 2000 chars)
    var bodyText = '';
    try {
      bodyText = extractPlainText_(msg.payload);
      bodyText = cleanEmailBody_(bodyText).substring(0, 2000);
    } catch(e) {
      bodyText = (msg.snippet || '').substring(0, 300);  // fallback to snippet
    }

    rows.push([
      'pending',
      empId,
      dateStr,
      parsed.email,
      parsed.name,
      parsed.domain,
      (headers['subject'] || '').substring(0, 200),
      (msg.snippet || '').substring(0, 300),
      msg.threadId,
      bodyText,           // NEW: column 10 — full email body text
    ]);

    existingThreadIds[msg.threadId] = true;
  });

  return rows;
}

// ---- Service Account OAuth2 (uses apps-script-oauth2 library) ----
function getServiceAccountToken_(impersonateEmail) {
  var props = PropertiesService.getScriptProperties();
  var saEmail = props.getProperty('SA_EMAIL');
  var privateKey = props.getProperty('SA_PRIVATE_KEY').replace(/\\n/g, '\n');

  if (!saEmail || !privateKey) {
    throw new Error('SA_EMAIL o SA_PRIVATE_KEY no configurados en Script Properties');
  }

  var serviceName = 'gmail_' + impersonateEmail.replace(/[@.]/g, '_');

  var service = OAuth2.createService(serviceName)
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setPrivateKey(privateKey)
    .setIssuer(saEmail)
    .setSubject(impersonateEmail)
    .setScope('https://www.googleapis.com/auth/gmail.readonly')
    .setPropertyStore(PropertiesService.getScriptProperties());

  if (!service.hasAccess()) {
    throw new Error('OAuth2 access denied: ' + service.getLastError());
  }

  return service.getAccessToken();
}

// ---- Email body extraction ----

/**
 * Extract plain text body from Gmail message payload (recursive for multipart).
 * Tries text/plain first, falls back to text/html with tag stripping.
 */
function extractPlainText_(payload) {
  if (!payload) return '';

  // Simple message with body directly on payload
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return decodeBase64Url_(payload.body.data);
  }

  // Multipart — search parts recursively
  if (payload.parts && payload.parts.length > 0) {
    // First pass: look for text/plain
    for (var i = 0; i < payload.parts.length; i++) {
      var part = payload.parts[i];
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        return decodeBase64Url_(part.body.data);
      }
      if (part.parts) {
        var nested = extractPlainText_(part);
        if (nested) return nested;
      }
    }
    // Second pass: fallback to text/html stripped
    for (var i = 0; i < payload.parts.length; i++) {
      var part = payload.parts[i];
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        return stripHtml_(decodeBase64Url_(part.body.data));
      }
      if (part.parts) {
        for (var j = 0; j < part.parts.length; j++) {
          if (part.parts[j].mimeType === 'text/html' && part.parts[j].body && part.parts[j].body.data) {
            return stripHtml_(decodeBase64Url_(part.parts[j].body.data));
          }
        }
      }
    }
  }

  // Last resort: snippet is always available
  return '';
}

function decodeBase64Url_(data) {
  var base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Utilities.newBlob(Utilities.base64Decode(base64)).getDataAsString('UTF-8');
  } catch(e) {
    return '';
  }
}

function stripHtml_(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clean email body: remove common signatures, disclaimers, forwarded headers.
 * Keep the meaningful content for AI classification.
 */
function cleanEmailBody_(text) {
  if (!text) return '';

  // Cut at common signature/disclaimer markers
  var cutMarkers = [
    /\n--\s*\n/,                            // standard sig delimiter
    /\nSent from my /i,
    /\nEnviado desde mi /i,
    /\n_{3,}/,                              // ___ underscores
    /\nDISCLAIMER/i,
    /\nAVISO LEGAL/i,
    /\nCONFIDENTIALITY/i,
    /\nEste mensaje .* confidencial/i,
    /\nThis (?:e-?mail|message) .* confidential/i,
  ];

  for (var i = 0; i < cutMarkers.length; i++) {
    var match = text.match(cutMarkers[i]);
    if (match && match.index > 50) {  // keep at least 50 chars
      text = text.substring(0, match.index);
    }
  }

  return text.trim();
}

// ---- Helpers ----

function parseFromField_(from) {
  var match = from.match(/<([^>]+)>/);
  var email = match ? match[1] : from.trim();
  var name = match ? from.replace(/<[^>]+>/, '').trim() : '';
  name = name.replace(/^["']|["']$/g, '');
  var domain = email.indexOf('@') > -1 ? email.split('@')[1].toLowerCase() : '';
  return { email: email.toLowerCase(), name: name, domain: domain };
}

function isPersonalDomain_(domain) {
  return PERSONAL_DOMAINS.indexOf(domain.toLowerCase()) > -1;
}

function getExistingThreadIds_(sheet) {
  var map = {};
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][8]) map[data[i][8]] = true;
  }
  return map;
}

function getConfigValue_(configSheet, key) {
  var data = configSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setConfigValue_(configSheet, key, value) {
  var data = configSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      configSheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  configSheet.appendRow([key, value]);
}

function triggerGitHubActions_() {
  var props = PropertiesService.getScriptProperties();
  var pat = props.getProperty('GITHUB_PAT');
  var repo = props.getProperty('GITHUB_REPO');

  if (!pat || !repo) {
    Logger.log('GITHUB_PAT or GITHUB_REPO not set — skipping trigger');
    return;
  }

  var url = 'https://api.github.com/repos/' + repo + '/actions/workflows/process-emails.yml/dispatches';
  var options = {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + pat,
      'Accept': 'application/vnd.github.v3+json',
    },
    contentType: 'application/json',
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  Logger.log('GitHub Actions trigger: ' + response.getResponseCode());
}
