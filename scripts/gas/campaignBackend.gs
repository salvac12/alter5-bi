/**
 * Campaign Backend — Google Apps Script Web App
 *
 * Manages campaigns, recipients, follow-ups using Google Sheets as DB.
 * Called via POST from /api/campaign-proxy (Vercel serverless).
 *
 * Sheets (auto-created on first request):
 *   - Campaigns: campaign metadata
 *   - Recipients: per-campaign recipients with status tracking
 *   - FollowUps: scheduled 1-a-1 follow-ups
 *
 * Security: every request must include `token` matching Script Property API_TOKEN.
 */

// ── Config ────────────────────────────────────────────────────────────

var SPREADSHEET_ID = null; // auto-detected: uses the spreadsheet bound to this script, or set manually
var SHEET_CAMPAIGNS = 'Campaigns';
var SHEET_RECIPIENTS = 'Recipients';
var SHEET_FOLLOWUPS = 'FollowUps';

var CAMPAIGN_HEADERS = [
  'id', 'name', 'type', 'status', 'senderEmail', 'senderName',
  'subjectA', 'bodyA', 'subjectB', 'bodyB',
  'abTestPercent', 'abWinnerCriteria', 'abWinner',
  'totalRecipients', 'totalSent', 'totalOpened', 'totalClicked', 'totalReplied',
  'createdTime', 'startedTime', 'completedTime', 'notes'
];

var RECIPIENT_HEADERS = [
  'id', 'campaignId', 'email', 'name', 'lastName', 'organization',
  'status', 'variant', 'openCount', 'clickCount', 'messageId',
  'sentTime', 'openedTime'
];

var FOLLOWUP_HEADERS = [
  'id', 'email', 'name', 'organization', 'status',
  'instructions', 'scheduledAt', 'senderEmail', 'senderName',
  'draftHtml', 'sentTime', 'createdTime', 'cancelledTime'
];

// ── Entry point ───────────────────────────────────────────────────────

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var token = payload.token;

    // Auth
    var expectedToken = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!expectedToken || token !== expectedToken) {
      return jsonResponse({ error: 'Unauthorized' }, 403);
    }

    // Route
    var handlers = {
      'dashboard': handleDashboard,
      'getCampaigns': handleGetCampaigns,
      'getCampaign': handleGetCampaign,
      'createCampaign': handleCreateCampaign,
      'startCampaign': handleStartCampaign,
      'updateCampaignStatus': handleUpdateCampaignStatus,
      'addRecipients': handleAddRecipients,
      'getCampaignRecipients': handleGetCampaignRecipients,
      'getFollowUps': handleGetFollowUps,
      'scheduleFollowUp': handleScheduleFollowUp,
      'cancelFollowUp': handleCancelFollowUp,
      'sendTestEmail': handleSendTestEmail,
      'createDrafts': handleCreateDrafts,
      'sendDrafts': handleSendDrafts,
    };

    if (!handlers[action]) {
      return jsonResponse({ error: 'Unknown action: ' + action }, 400);
    }

    var result = handlers[action](payload);
    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
}

function doGet() {
  return jsonResponse({ status: 'ok', message: 'Campaign Backend is running. Use POST.' });
}

// ── Helpers ───────────────────────────────────────────────────────────

function jsonResponse(data, code) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  // Check Script Properties for a previously created spreadsheet
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SPREADSHEET_ID');
  if (ssId) {
    return SpreadsheetApp.openById(ssId);
  }

  // If bound to a spreadsheet, use that
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) { /* not bound, continue */ }

  // Auto-create a new spreadsheet and save its ID
  var newSs = SpreadsheetApp.create('Alter5 Campaign Backend - Data');
  props.setProperty('SPREADSHEET_ID', newSs.getId());
  Logger.log('Created spreadsheet: ' + newSs.getUrl());
  return newSs;
}

function getOrCreateSheet(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function generateId() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function now() {
  return new Date().toISOString();
}

/** Read all rows from a sheet as array of objects */
function readAll(sheetName, headers) {
  var sheet = getOrCreateSheet(sheetName, headers);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var hdr = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < hdr.length; j++) {
      obj[hdr[j]] = data[i][j];
    }
    rows.push(obj);
  }
  return rows;
}

/** Find row index (1-based, including header) by column value */
function findRowIndex(sheet, colIndex, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(value)) {
      return i + 1; // 1-based row number
    }
  }
  return -1;
}

/** Update a single cell by row and column header name */
function updateCell(sheet, rowIndex, headers, colName, value) {
  var colIndex = headers.indexOf(colName);
  if (colIndex === -1) return;
  sheet.getRange(rowIndex, colIndex + 1).setValue(value);
}

/** Append a row from an object using header order */
function appendRow(sheet, headers, obj) {
  var row = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
}

// ── Action handlers ──────────────────────────────────────────────────

/**
 * dashboard — Returns unique contacts from Recipients sheet + legacy Tracking sheet.
 * Used by fetchSentDomains() to know which domains have been contacted.
 *
 * Legacy: reads "Tracking" tab from the original Campaign Dashboard spreadsheet
 * (ID stored in Script Property LEGACY_SHEET_ID). Columns: A=Email, B=Nombre,
 * C=Apellido, D=Organizacion, G=Estado.
 */
function handleDashboard() {
  var seen = {};
  var contactos = [];

  // 1) Read from legacy Campaign Dashboard Tracking sheet (if configured)
  var legacyId = PropertiesService.getScriptProperties().getProperty('LEGACY_SHEET_ID');
  if (legacyId) {
    try {
      var legacySs = SpreadsheetApp.openById(legacyId);
      var trackingSheet = legacySs.getSheetByName('Tracking');
      if (trackingSheet) {
        var data = trackingSheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          var email = String(data[i][0] || '').toLowerCase().trim(); // Col A = Email
          var estado = String(data[i][6] || '');                     // Col G = Estado
          if (!email || seen[email]) continue;
          if (estado === 'Error') continue; // skip errors
          seen[email] = true;
          contactos.push({
            email: email,
            name: String(data[i][1] || ''),          // Col B = Nombre
            organization: String(data[i][3] || ''),   // Col D = Organizacion
          });
        }
      }
    } catch (e) {
      Logger.log('Error reading legacy Tracking: ' + e.message);
    }
  }

  // 2) Read from new Recipients sheet (this backend's campaigns)
  var recipients = readAll(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  for (var j = 0; j < recipients.length; j++) {
    var r = recipients[j];
    if (r.status === 'pending') continue;
    var rEmail = String(r.email).toLowerCase();
    if (!rEmail || seen[rEmail]) continue;
    seen[rEmail] = true;
    contactos.push({
      email: rEmail,
      name: r.name || '',
      organization: r.organization || '',
    });
  }

  return { contactos: contactos };
}

/**
 * getCampaigns — List all campaigns with optional status filter.
 */
function handleGetCampaigns(payload) {
  var campaigns = readAll(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var statusFilter = payload.status;
  if (statusFilter) {
    campaigns = campaigns.filter(function(c) { return c.status === statusFilter; });
  }
  // Sort by createdTime desc
  campaigns.sort(function(a, b) {
    return String(b.createdTime).localeCompare(String(a.createdTime));
  });
  return { campaigns: campaigns };
}

/**
 * getCampaign — Get a single campaign by id.
 */
function handleGetCampaign(payload) {
  var id = payload.id;
  if (!id) return { error: 'Missing id' };

  var campaigns = readAll(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campaign = null;
  for (var i = 0; i < campaigns.length; i++) {
    if (campaigns[i].id === id) { campaign = campaigns[i]; break; }
  }
  if (!campaign) return { error: 'Campaign not found' };
  return campaign;
}

/**
 * createCampaign — Create campaign + insert recipients in bulk.
 */
function handleCreateCampaign(payload) {
  var campaignId = generateId();
  var recipients = payload.recipients || [];

  // Create campaign row
  var campaign = {
    id: campaignId,
    name: payload.name || 'Sin nombre',
    type: payload.type || 'mass',
    status: 'draft',
    senderEmail: payload.senderEmail || '',
    senderName: payload.senderName || '',
    subjectA: payload.subjectA || '',
    bodyA: payload.bodyA || '',
    subjectB: payload.subjectB || '',
    bodyB: payload.bodyB || '',
    abTestPercent: payload.abTestPercent || 0,
    abWinnerCriteria: payload.abWinnerCriteria || '',
    abWinner: '',
    totalRecipients: recipients.length,
    totalSent: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalReplied: 0,
    createdTime: now(),
    startedTime: '',
    completedTime: '',
    notes: payload.notes || '',
  };

  var campSheet = getOrCreateSheet(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  appendRow(campSheet, CAMPAIGN_HEADERS, campaign);

  // Insert recipients
  var recSheet = getOrCreateSheet(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    var rec = {
      id: generateId(),
      campaignId: campaignId,
      email: r.email || '',
      name: r.name || '',
      lastName: r.lastName || '',
      organization: r.organization || '',
      status: 'pending',
      variant: '',
      openCount: 0,
      clickCount: 0,
      messageId: '',
      sentTime: '',
      openedTime: '',
    };
    appendRow(recSheet, RECIPIENT_HEADERS, rec);
  }

  return { id: campaignId, status: 'draft', totalRecipients: recipients.length };
}

/**
 * startCampaign — Send emails via GmailApp and update status.
 */
function handleStartCampaign(payload) {
  var campaignId = payload.campaignId;
  if (!campaignId) return { error: 'Missing campaignId' };

  var campSheet = getOrCreateSheet(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campRow = findRowIndex(campSheet, 0, campaignId);
  if (campRow === -1) return { error: 'Campaign not found' };

  // Read campaign data
  var campaigns = readAll(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campaign = null;
  for (var i = 0; i < campaigns.length; i++) {
    if (campaigns[i].id === campaignId) { campaign = campaigns[i]; break; }
  }
  if (!campaign) return { error: 'Campaign not found' };
  if (campaign.status !== 'draft' && campaign.status !== 'paused') {
    return { error: 'Campaign must be draft or paused to start. Current: ' + campaign.status };
  }

  // Read recipients
  var recSheet = getOrCreateSheet(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  var allData = recSheet.getDataRange().getValues();
  var hdr = allData[0];
  var campaignIdCol = hdr.indexOf('campaignId');
  var statusCol = hdr.indexOf('status');
  var emailCol = hdr.indexOf('email');
  var nameCol = hdr.indexOf('name');
  var orgCol = hdr.indexOf('organization');
  var variantCol = hdr.indexOf('variant');
  var messageIdCol = hdr.indexOf('messageId');
  var sentTimeCol = hdr.indexOf('sentTime');

  var useAB = campaign.subjectB && campaign.bodyB;
  var abPercent = Number(campaign.abTestPercent) || 50;
  var sentCount = 0;
  var errors = [];

  for (var r = 1; r < allData.length; r++) {
    if (String(allData[r][campaignIdCol]) !== campaignId) continue;
    if (allData[r][statusCol] !== 'pending') continue;

    var email = String(allData[r][emailCol]);
    var recipientName = String(allData[r][nameCol]);
    var org = String(allData[r][orgCol]);

    // Assign A/B variant
    var variant = 'A';
    if (useAB) {
      variant = (Math.random() * 100 < abPercent) ? 'A' : 'B';
    }

    var subject = (variant === 'B') ? campaign.subjectB : campaign.subjectA;
    var body = (variant === 'B') ? campaign.bodyB : campaign.bodyA;

    // Replace placeholders
    subject = replacePlaceholders(subject, recipientName, org);
    body = replacePlaceholders(body, recipientName, org);

    try {
      sendWithFallback(email, subject, body, campaign.senderEmail, campaign.senderName);

      // Update recipient row
      recSheet.getRange(r + 1, statusCol + 1).setValue('sent');
      recSheet.getRange(r + 1, variantCol + 1).setValue(variant);
      recSheet.getRange(r + 1, sentTimeCol + 1).setValue(now());
      sentCount++;

      // Rate limit: ~1 email per second
      if (sentCount % 1 === 0) Utilities.sleep(1000);

    } catch (err) {
      recSheet.getRange(r + 1, statusCol + 1).setValue('error');
      errors.push({ email: email, error: err.message });
    }
  }

  // Update campaign counters and status
  updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'status', 'active');
  updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'startedTime', now());
  updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'totalSent',
    Number(campaign.totalSent || 0) + sentCount);

  // If all sent, mark as completed
  var pendingLeft = 0;
  var updatedData = recSheet.getDataRange().getValues();
  for (var r2 = 1; r2 < updatedData.length; r2++) {
    if (String(updatedData[r2][campaignIdCol]) === campaignId &&
        updatedData[r2][statusCol] === 'pending') {
      pendingLeft++;
    }
  }
  if (pendingLeft === 0) {
    updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'status', 'completed');
    updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'completedTime', now());
  }

  return { sent: sentCount, errors: errors, pendingLeft: pendingLeft };
}

function replacePlaceholders(text, name, org) {
  if (!text) return text;
  var firstName = String(name).split(' ')[0] || name;
  return text
    .replace(/\{\{nombre\}\}/gi, firstName)
    .replace(/\{\{name\}\}/gi, firstName)
    .replace(/\{\{empresa\}\}/gi, org)
    .replace(/\{\{organization\}\}/gi, org)
    .replace(/\{\{company\}\}/gi, org);
}

/** Build email options, trying 'from' alias — falls back to script owner */
function emailOptions(body, senderEmail, senderName) {
  var opts = { htmlBody: body, name: senderName || '' };
  if (senderEmail) opts.from = senderEmail;
  return opts;
}

function sendWithFallback(email, subject, body, senderEmail, senderName) {
  try {
    GmailApp.sendEmail(email, subject, '', emailOptions(body, senderEmail, senderName));
  } catch (err) {
    if (String(err.message).indexOf('Invalid argument') !== -1 && senderEmail) {
      GmailApp.sendEmail(email, subject, '', emailOptions(body, '', senderName));
    } else {
      throw err;
    }
  }
}

function createDraftWithFallback(email, subject, body, senderEmail, senderName) {
  try {
    return GmailApp.createDraft(email, subject, '', emailOptions(body, senderEmail, senderName));
  } catch (err) {
    if (String(err.message).indexOf('Invalid argument') !== -1 && senderEmail) {
      return GmailApp.createDraft(email, subject, '', emailOptions(body, '', senderName));
    } else {
      throw err;
    }
  }
}

/**
 * updateCampaignStatus — Change campaign status (pause/complete/cancel).
 */
function handleUpdateCampaignStatus(payload) {
  var campaignId = payload.campaignId;
  var newStatus = payload.status;
  if (!campaignId || !newStatus) return { error: 'Missing campaignId or status' };

  var validStatuses = ['draft', 'active', 'paused', 'completed', 'cancelled'];
  if (validStatuses.indexOf(newStatus) === -1) {
    return { error: 'Invalid status: ' + newStatus };
  }

  var campSheet = getOrCreateSheet(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var rowIndex = findRowIndex(campSheet, 0, campaignId);
  if (rowIndex === -1) return { error: 'Campaign not found' };

  updateCell(campSheet, rowIndex, CAMPAIGN_HEADERS, 'status', newStatus);
  if (newStatus === 'completed') {
    updateCell(campSheet, rowIndex, CAMPAIGN_HEADERS, 'completedTime', now());
  }

  return { id: campaignId, status: newStatus };
}

/**
 * addRecipients — Add recipients to an existing campaign.
 */
function handleAddRecipients(payload) {
  var campaignId = payload.campaignId;
  var recipients = payload.recipients || [];
  if (!campaignId) return { error: 'Missing campaignId' };

  // Verify campaign exists
  var campSheet = getOrCreateSheet(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campRow = findRowIndex(campSheet, 0, campaignId);
  if (campRow === -1) return { error: 'Campaign not found' };

  var recSheet = getOrCreateSheet(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  var added = 0;

  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    var rec = {
      id: generateId(),
      campaignId: campaignId,
      email: r.email || '',
      name: r.name || '',
      lastName: r.lastName || '',
      organization: r.organization || '',
      status: 'pending',
      variant: '',
      openCount: 0,
      clickCount: 0,
      messageId: '',
      sentTime: '',
      openedTime: '',
    };
    appendRow(recSheet, RECIPIENT_HEADERS, rec);
    added++;
  }

  // Update totalRecipients counter
  var currentTotal = Number(campSheet.getRange(campRow, CAMPAIGN_HEADERS.indexOf('totalRecipients') + 1).getValue()) || 0;
  updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'totalRecipients', currentTotal + added);

  return { campaignId: campaignId, added: added };
}

/**
 * getCampaignRecipients — List recipients for a campaign.
 */
function handleGetCampaignRecipients(payload) {
  var campaignId = payload.campaignId;
  if (!campaignId) return { error: 'Missing campaignId' };

  var all = readAll(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  var recipients = all.filter(function(r) {
    return r.campaignId === campaignId;
  });

  return { recipients: recipients };
}

/**
 * getFollowUps — List follow-ups with optional status filter.
 */
function handleGetFollowUps(payload) {
  var followUps = readAll(SHEET_FOLLOWUPS, FOLLOWUP_HEADERS);
  var statusFilter = payload.status;
  if (statusFilter) {
    followUps = followUps.filter(function(f) { return f.status === statusFilter; });
  }
  // Sort by scheduledAt asc
  followUps.sort(function(a, b) {
    return String(a.scheduledAt).localeCompare(String(b.scheduledAt));
  });
  return { followUps: followUps };
}

/**
 * scheduleFollowUp — Create a scheduled follow-up.
 */
function handleScheduleFollowUp(payload) {
  var id = generateId();

  var followUp = {
    id: id,
    email: payload.email || '',
    name: payload.name || '',
    organization: payload.organization || '',
    status: 'scheduled',
    instructions: payload.instructions || '',
    scheduledAt: payload.scheduledAt || '',
    senderEmail: payload.senderEmail || '',
    senderName: payload.senderName || '',
    draftHtml: '',
    sentTime: '',
    createdTime: now(),
    cancelledTime: '',
  };

  var sheet = getOrCreateSheet(SHEET_FOLLOWUPS, FOLLOWUP_HEADERS);
  appendRow(sheet, FOLLOWUP_HEADERS, followUp);

  return { id: id, status: 'scheduled' };
}

/**
 * cancelFollowUp — Cancel a scheduled/draft_ready follow-up.
 */
function handleCancelFollowUp(payload) {
  var followUpId = payload.followUpId;
  if (!followUpId) return { error: 'Missing followUpId' };

  var sheet = getOrCreateSheet(SHEET_FOLLOWUPS, FOLLOWUP_HEADERS);
  var rowIndex = findRowIndex(sheet, 0, followUpId);
  if (rowIndex === -1) return { error: 'FollowUp not found' };

  // Only cancel if scheduled or draft_ready
  var currentStatus = sheet.getRange(rowIndex, FOLLOWUP_HEADERS.indexOf('status') + 1).getValue();
  if (currentStatus !== 'scheduled' && currentStatus !== 'draft_ready') {
    return { error: 'Cannot cancel follow-up with status: ' + currentStatus };
  }

  updateCell(sheet, rowIndex, FOLLOWUP_HEADERS, 'status', 'cancelled');
  updateCell(sheet, rowIndex, FOLLOWUP_HEADERS, 'cancelledTime', now());

  return { id: followUpId, status: 'cancelled' };
}

/**
 * sendTestEmail — Send a test copy of the campaign email to a specific address.
 * Does NOT affect recipients list. Just sends a preview.
 */
function handleSendTestEmail(payload) {
  var campaignId = payload.campaignId;
  var testEmail = payload.testEmail;
  if (!campaignId || !testEmail) return { error: 'Missing campaignId or testEmail' };

  var campaigns = readAll(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campaign = null;
  for (var i = 0; i < campaigns.length; i++) {
    if (campaigns[i].id === campaignId) { campaign = campaigns[i]; break; }
  }
  if (!campaign) return { error: 'Campaign not found' };

  var subject = campaign.subjectA || '(Sin asunto)';
  var body = campaign.bodyA || '';

  // Replace placeholders with test values
  subject = replacePlaceholders(subject, 'Test', 'TestCompany');
  body = replacePlaceholders(body, 'Test', 'TestCompany');
  // Prepend [TEST] to subject
  subject = '[TEST] ' + subject;

  try {
    sendWithFallback(testEmail, subject, body, campaign.senderEmail || '', campaign.senderName || '');
    return { success: true, sentTo: testEmail };
  } catch (err) {
    return { error: 'Failed to send test: ' + err.message };
  }
}

/**
 * createDrafts — Create Gmail drafts for all pending recipients (instead of sending directly).
 * Returns { drafts: N, campaignId }
 */
function handleCreateDrafts(payload) {
  var campaignId = payload.campaignId;
  if (!campaignId) return { error: 'Missing campaignId' };

  var campSheet = getOrCreateSheet(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campRow = findRowIndex(campSheet, 0, campaignId);
  if (campRow === -1) return { error: 'Campaign not found' };

  // Read campaign data
  var campaigns = readAll(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campaign = null;
  for (var i = 0; i < campaigns.length; i++) {
    if (campaigns[i].id === campaignId) { campaign = campaigns[i]; break; }
  }
  if (!campaign) return { error: 'Campaign not found' };

  // Read recipients
  var recSheet = getOrCreateSheet(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  var allData = recSheet.getDataRange().getValues();
  var hdr = allData[0];
  var campaignIdCol = hdr.indexOf('campaignId');
  var statusCol = hdr.indexOf('status');
  var emailCol = hdr.indexOf('email');
  var nameCol = hdr.indexOf('name');
  var orgCol = hdr.indexOf('organization');
  var variantCol = hdr.indexOf('variant');
  var messageIdCol = hdr.indexOf('messageId');

  var useAB = campaign.subjectB && campaign.bodyB;
  var abPercent = Number(campaign.abTestPercent) || 50;
  var draftCount = 0;
  var errors = [];

  for (var r = 1; r < allData.length; r++) {
    if (String(allData[r][campaignIdCol]) !== campaignId) continue;
    if (allData[r][statusCol] !== 'pending') continue;

    var email = String(allData[r][emailCol]);
    var recipientName = String(allData[r][nameCol]);
    var org = String(allData[r][orgCol]);

    // Assign A/B variant
    var variant = 'A';
    if (useAB) {
      variant = (Math.random() * 100 < abPercent) ? 'A' : 'B';
    }

    var subject = (variant === 'B') ? campaign.subjectB : campaign.subjectA;
    var body = (variant === 'B') ? campaign.bodyB : campaign.bodyA;

    // Replace placeholders
    subject = replacePlaceholders(subject, recipientName, org);
    body = replacePlaceholders(body, recipientName, org);

    try {
      var draft = createDraftWithFallback(email, subject, body, campaign.senderEmail, campaign.senderName);

      // Save draft ID in messageId field, update status to draft_ready
      recSheet.getRange(r + 1, messageIdCol + 1).setValue(draft.getId());
      recSheet.getRange(r + 1, statusCol + 1).setValue('draft_ready');
      recSheet.getRange(r + 1, variantCol + 1).setValue(variant);
      draftCount++;

    } catch (err) {
      recSheet.getRange(r + 1, statusCol + 1).setValue('error');
      errors.push({ email: email, error: err.message });
    }
  }

  // Update campaign status
  updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'status', 'drafts_created');

  return { drafts: draftCount, errors: errors, campaignId: campaignId };
}

/**
 * sendDrafts — Send all draft_ready Gmail drafts for a campaign.
 * Returns { sent: N, errors: [] }
 */
function handleSendDrafts(payload) {
  var campaignId = payload.campaignId;
  if (!campaignId) return { error: 'Missing campaignId' };

  var campSheet = getOrCreateSheet(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campRow = findRowIndex(campSheet, 0, campaignId);
  if (campRow === -1) return { error: 'Campaign not found' };

  // Read campaign for counters
  var campaigns = readAll(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var campaign = null;
  for (var i = 0; i < campaigns.length; i++) {
    if (campaigns[i].id === campaignId) { campaign = campaigns[i]; break; }
  }
  if (!campaign) return { error: 'Campaign not found' };

  // Read recipients
  var recSheet = getOrCreateSheet(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  var allData = recSheet.getDataRange().getValues();
  var hdr = allData[0];
  var campaignIdCol = hdr.indexOf('campaignId');
  var statusCol = hdr.indexOf('status');
  var emailCol = hdr.indexOf('email');
  var messageIdCol = hdr.indexOf('messageId');
  var sentTimeCol = hdr.indexOf('sentTime');

  var sentCount = 0;
  var errors = [];

  for (var r = 1; r < allData.length; r++) {
    if (String(allData[r][campaignIdCol]) !== campaignId) continue;
    if (allData[r][statusCol] !== 'draft_ready') continue;

    var email = String(allData[r][emailCol]);
    var draftId = String(allData[r][messageIdCol]);

    try {
      var draft = GmailApp.getDraft(draftId);
      draft.send();

      recSheet.getRange(r + 1, statusCol + 1).setValue('sent');
      recSheet.getRange(r + 1, sentTimeCol + 1).setValue(now());
      sentCount++;

      // Rate limit: ~1 email per second
      Utilities.sleep(1000);

    } catch (err) {
      recSheet.getRange(r + 1, statusCol + 1).setValue('error');
      errors.push({ email: email, error: err.message });
    }
  }

  // Update campaign counters and status
  updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'startedTime', now());
  updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'totalSent',
    Number(campaign.totalSent || 0) + sentCount);

  // Check if any draft_ready remain
  var updatedData = recSheet.getDataRange().getValues();
  var draftLeft = 0;
  for (var r2 = 1; r2 < updatedData.length; r2++) {
    if (String(updatedData[r2][campaignIdCol]) === campaignId &&
        updatedData[r2][statusCol] === 'draft_ready') {
      draftLeft++;
    }
  }

  if (draftLeft === 0) {
    updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'status', 'completed');
    updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'completedTime', now());
  } else {
    updateCell(campSheet, campRow, CAMPAIGN_HEADERS, 'status', 'active');
  }

  return { sent: sentCount, errors: errors, draftLeft: draftLeft };
}
