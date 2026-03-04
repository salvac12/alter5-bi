/**
 * ═══════════════════════════════════════════════════════════
 *  Alter5 BI — Gmail Scanner (Google Apps Script)
 * ═══════════════════════════════════════════════════════════
 *
 *  Escanea los buzones de Salvador y Leticia buscando emails
 *  recibidos desde la última ejecución. Escribe las filas en
 *  la Google Sheet "alter5-bi-pipeline" y dispara el workflow
 *  de GitHub Actions.
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

// ---- Main ----
function scanMailboxes() {
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

  EMPLOYEES.forEach(function(emp) {
    var lastScan = getConfigValue_(configSheet, emp.configKey);
    var afterDate = lastScan
      ? Utilities.formatDate(new Date(lastScan), 'Europe/Madrid', 'yyyy/MM/dd')
      : '2024/01/01';

    Logger.log('Scanning ' + emp.id + ' after ' + afterDate);

    var rows = scanDelegatedGmail_(emp, afterDate, existingThreadIds);

    if (rows.length > 0) {
      rawSheet.getRange(
        rawSheet.getLastRow() + 1, 1, rows.length, rows[0].length
      ).setValues(rows);
      totalNew += rows.length;
      Logger.log(emp.id + ': ' + rows.length + ' new emails');
    } else {
      Logger.log(emp.id + ': no new emails');
    }

    setConfigValue_(configSheet, emp.configKey, new Date().toISOString());
  });

  Logger.log('Total new emails: ' + totalNew);

  if (totalNew > 0) {
    triggerGitHubActions_();
  }
}

// ---- Gmail API con delegación de dominio ----
function scanDelegatedGmail_(emp, afterDate, existingThreadIds) {
  var accessToken = getServiceAccountToken_(emp.email);
  var queryDate = afterDate.replace(/\//g, '/');
  var query = 'after:' + queryDate + ' -from:me';
  var rows = [];

  // List messages matching the query
  var pageToken = '';
  var messageIds = [];

  do {
    var url = 'https://gmail.googleapis.com/gmail/v1/users/' + emp.email + '/messages?q=' + encodeURIComponent(query) + '&maxResults=100';
    if (pageToken) url += '&pageToken=' + pageToken;

    var response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken },
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('Gmail API error for ' + emp.email + ': ' + response.getContentText());
      return rows;
    }

    var data = JSON.parse(response.getContentText());
    var messages = data.messages || [];
    messages.forEach(function(m) { messageIds.push(m.id); });
    pageToken = data.nextPageToken || '';
  } while (pageToken && messageIds.length < 500);

  Logger.log(emp.id + ': ' + messageIds.length + ' message IDs to fetch');

  // Fetch messages in batches of 100 using Gmail batch API
  var BATCH_SIZE = 100;
  for (var batchStart = 0; batchStart < messageIds.length; batchStart += BATCH_SIZE) {
    var batchIds = messageIds.slice(batchStart, batchStart + BATCH_SIZE);
    var batchRows = fetchMessageBatch_(emp.email, accessToken, batchIds, emp.id, existingThreadIds);
    rows = rows.concat(batchRows);
  }

  return rows;
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
    batchBody += 'GET /gmail/v1/users/' + userEmail + '/messages/' + msgId + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date\r\n\r\n';
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
