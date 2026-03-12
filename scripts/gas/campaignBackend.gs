/**
 * Campaign Backend — Google Apps Script Web App
 *
 * Manages campaigns, recipients, follow-ups using Google Sheets as DB.
 * Called via POST from /api/campaign-proxy (Vercel serverless).
 * Called via GET from BridgeCampaignView (dashboard + pipeline).
 *
 * Sheets (auto-created on first request):
 *   - Campaigns: campaign metadata
 *   - Recipients: per-campaign recipients with status tracking
 *   - FollowUps: scheduled 1-a-1 follow-ups
 *
 * Security: POST requests must include `token` matching Script Property API_TOKEN.
 *           GET requests (dashboard, pipeline) are public (read-only data).
 */

// ── Config ────────────────────────────────────────────────────────────

var SPREADSHEET_ID = null; // auto-detected: uses the spreadsheet bound to this script, or set manually
var SHEET_CAMPAIGNS = 'Campaigns';
var SHEET_RECIPIENTS = 'Recipients';
var SHEET_FOLLOWUPS = 'FollowUps';
var SHEET_PIPELINE = 'Pipeline';

var CAMPAIGN_HEADERS = [
  'id', 'name', 'type', 'status', 'senderEmail', 'senderName',
  'subjectA', 'bodyA', 'subjectB', 'bodyB',
  'abTestPercent', 'abWinnerCriteria', 'abWinner',
  'totalRecipients', 'totalSent', 'totalOpened', 'totalClicked', 'totalReplied',
  'createdTime', 'startedTime', 'completedTime', 'notes', 'knowledgeBase'
];

var RECIPIENT_HEADERS = [
  'id', 'campaignId', 'email', 'name', 'lastName', 'organization',
  'status', 'variant', 'openCount', 'clickCount', 'messageId',
  'sentTime', 'openedTime', 'clickedTime'
];

var FOLLOWUP_HEADERS = [
  'id', 'email', 'name', 'organization', 'status',
  'instructions', 'scheduledAt', 'senderEmail', 'senderName',
  'draftHtml', 'sentTime', 'createdTime', 'cancelledTime'
];

var PIPELINE_HEADERS = [
  'email', 'etapa', 'etapaAnterior', 'fechaCambio', 'fechaCreacion', 'notas', 'historial'
];

// ── Entry points ──────────────────────────────────────────────────────

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
      'updateCampaign': handleUpdateCampaign,
      'addRecipients': handleAddRecipients,
      'getCampaignRecipients': handleGetCampaignRecipients,
      'getCampaignDashboard': handleCampaignDashboard,
      'getFollowUps': handleGetFollowUps,
      'scheduleFollowUp': handleScheduleFollowUp,
      'cancelFollowUp': handleCancelFollowUp,
      'sendTestEmail': handleSendTestEmail,
      'createDrafts': handleCreateDrafts,
      'sendDrafts': handleSendDrafts,
      'moveStage': handleMoveStage,
      'addNote': handleAddNote,
      'sendDraft': handleSendDraft,
      'saveDraft': handleSaveDraft,
      'composeAndSaveDraft': handleComposeAndSaveDraft,
      'composeFromInstructions': handleComposeFromInstructions,
      'uploadMeetingNotes': handleUploadMeetingNotes,
      'generateFollowUp': handleGenerateFollowUp,
      'improveMessage': handleImproveMessage,
      'generateFollowUpBatch': handleGenerateFollowUpBatch,
      'sendFollowUpBatch': handleSendFollowUpBatch,
      'classifyReply': handleClassifyReply,
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

/**
 * doGet — Route GET requests by ?action= query parameter.
 * Supports: dashboard, pipeline. Default: status check.
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

    if (action === 'dashboard') {
      var result = handleDashboard();
      return jsonResponse(result);
    }

    if (action === 'pipeline') {
      var result = handlePipeline();
      return jsonResponse(result);
    }

    if (action === 'getConversation' || action === 'getConversacion') {
      var email = (e.parameter.email || '').trim();
      if (!email) return jsonResponse({ error: 'Missing email parameter' }, 400);
      var result = handleGetConversation({ email: email, campaignId: e.parameter.campaignId || '' });
      return jsonResponse(result);
    }

    if (action === 'getConversacionCompleta') {
      var email = (e.parameter.email || '').trim();
      if (!email) return jsonResponse({ error: 'Missing email parameter' }, 400);
      var result = handleGetConversacionCompleta({ email: email });
      return jsonResponse(result);
    }

    if (action === 'getFollowUpCandidates') {
      var result = handleGetFollowUpCandidates({ campaignId: e.parameter.campaignId || '' });
      return jsonResponse(result);
    }

    if (action === 'getConversaciones') {
      var result = handleGetConversaciones(e.parameter);
      return jsonResponse(result);
    }

    // Default: health check
    return jsonResponse({ status: 'ok', message: 'Campaign Backend is running. Use POST for actions or GET ?action=dashboard.' });

  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
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

/** Map recipient status to Spanish estado for BridgeCampaignView */
function mapStatus(status, openCount, clickCount) {
  if (status === 'error') return 'Error';
  if (status === 'replied') return 'Respondido';
  if (Number(clickCount) > 0) return 'Clic';
  if (Number(openCount) > 0) return 'Abierto';
  if (status === 'sent' || status === 'draft_ready') return 'Enviado';
  if (status === 'pending') return '';
  return status || '';
}

// ── Action handlers ──────────────────────────────────────────────────

/**
 * dashboard — Returns contacts + metrics for BridgeCampaignView.
 *
 * BridgeCampaignView expects:
 *   { contactos: [{ email, nombre, apellido, organizacion, grupo, variante,
 *                    estado, fechaEnvio, primeraApertura, numAperturas,
 *                    primerClic, numClics, respondido }],
 *     metricas: { total, errores,
 *                 A: { enviados, abiertos, clics, respondidos, tasaApertura, tasaClics, tasaRespuesta },
 *                 B: { ... },
 *                 Final: { total, enviados, pendientes, abiertos, clics, respondidos } },
 *     contactosRastreados: N,
 *     actualizado: ISO }
 *
 * Data sources:
 *   1) Recipients sheet (this backend's campaigns) — full tracking data
 *   2) Legacy Campaign Dashboard Tracking sheet (LEGACY_SHEET_ID) — basic contact info
 */
function handleDashboard() {
  var seen = {};
  var contactos = [];
  var legacyContactos = [];

  // 1) Read from legacy Campaign Dashboard Tracking sheet (if configured)
  // Legacy columns: A=Email, B=Nombre, C=Apellido, D=Organizacion,
  //                 E=Grupo, F=Variante, G=Estado, H=FechaEnvio,
  //                 I=PrimeraApertura, J=NumAperturas, K=PrimerClic,
  //                 L=NumClics, M=Respondido
  var props = PropertiesService.getScriptProperties();
  var legacyId = props.getProperty('LEGACY_SHEET_ID') || props.getProperty('CAMPAIGN_SHEET_ID');
  if (legacyId) {
    try {
      var legacySs = SpreadsheetApp.openById(legacyId);
      var trackingSheet = legacySs.getSheetByName('Tracking');
      if (trackingSheet) {
        var data = trackingSheet.getDataRange().getValues();
        // Read header row to find columns dynamically
        var hdr = data[0];
        var colMap = {};
        for (var h = 0; h < hdr.length; h++) {
          colMap[String(hdr[h]).toLowerCase().trim()] = h;
        }
        for (var i = 1; i < data.length; i++) {
          var email = String(data[i][0] || '').toLowerCase().trim();
          if (!email || seen[email]) continue;
          var estado = String(data[i][colMap['estado'] !== undefined ? colMap['estado'] : 6] || '');
          if (estado === 'Error') continue;
          seen[email] = true;

          var numAperturas = Number(data[i][colMap['numaperturas'] !== undefined ? colMap['numaperturas'] : 9]) || 0;
          var numClics = Number(data[i][colMap['numclics'] !== undefined ? colMap['numclics'] : 11]) || 0;

          legacyContactos.push({
            email: email,
            nombre: String(data[i][1] || ''),
            apellido: String(data[i][2] || ''),
            organizacion: String(data[i][3] || ''),
            grupo: String(data[i][colMap['grupo'] !== undefined ? colMap['grupo'] : 4] || ''),
            variante: String(data[i][colMap['variante'] !== undefined ? colMap['variante'] : 5] || ''),
            estado: estado,
            fechaEnvio: data[i][colMap['fechaenvio'] !== undefined ? colMap['fechaenvio'] : 7] ? String(data[i][colMap['fechaenvio'] !== undefined ? colMap['fechaenvio'] : 7]) : null,
            primeraApertura: data[i][colMap['primeraapertura'] !== undefined ? colMap['primeraapertura'] : 8] ? String(data[i][colMap['primeraapertura'] !== undefined ? colMap['primeraapertura'] : 8]) : null,
            numAperturas: numAperturas,
            primerClic: data[i][colMap['primerclic'] !== undefined ? colMap['primerclic'] : 10] ? String(data[i][colMap['primerclic'] !== undefined ? colMap['primerclic'] : 10]) : null,
            numClics: numClics,
            respondido: String(data[i][colMap['respondido'] !== undefined ? colMap['respondido'] : 12] || 'No'),
          });
        }
      }
    } catch (e) {
      Logger.log('Error reading legacy Tracking: ' + e.message);
    }
  }

  // 2) Read from new Recipients sheet (this backend's campaigns)
  var recipients = readAll(SHEET_RECIPIENTS, RECIPIENT_HEADERS);

  // Group recipients by campaignId to determine grupo
  var campaignNames = {};
  try {
    var campaigns = readAll(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
    for (var c = 0; c < campaigns.length; c++) {
      campaignNames[campaigns[c].id] = campaigns[c].name || '';
    }
  } catch (e) { /* ignore */ }

  // Count sent per variant for metrics
  var varA = { enviados: 0, abiertos: 0, clics: 0, respondidos: 0 };
  var varB = { enviados: 0, abiertos: 0, clics: 0, respondidos: 0 };
  var finalGroup = { total: 0, enviados: 0, pendientes: 0, abiertos: 0, clics: 0, respondidos: 0 };
  var totalErrors = 0;
  var rastreados = 0;

  for (var j = 0; j < recipients.length; j++) {
    var r = recipients[j];
    var rEmail = String(r.email).toLowerCase().trim();
    if (!rEmail) continue;

    var openCount = Number(r.openCount) || 0;
    var clickCount = Number(r.clickCount) || 0;
    var isReplied = (r.status === 'replied');
    var isSent = (r.status === 'sent' || r.status === 'replied');
    var isError = (r.status === 'error');
    var isPending = (r.status === 'pending');
    var variant = String(r.variant || '');
    var estado = mapStatus(r.status, openCount, clickCount);
    var respondido = isReplied ? 'Sí' : 'No';

    // Track metrics per variant
    if (variant === 'A' || variant === 'B') {
      var bucket = (variant === 'A') ? varA : varB;
      if (isSent || isError) bucket.enviados++;
      if (openCount > 0) bucket.abiertos++;
      if (clickCount > 0) bucket.clics++;
      if (isReplied) bucket.respondidos++;
    } else if (isPending) {
      finalGroup.total++;
      finalGroup.pendientes++;
    }

    if (isError) totalErrors++;
    if (isSent && (openCount > 0 || clickCount > 0 || isReplied)) rastreados++;

    // Skip if already seen from legacy
    if (seen[rEmail]) continue;
    seen[rEmail] = true;

    contactos.push({
      email: rEmail,
      nombre: String(r.name || ''),
      apellido: String(r.lastName || ''),
      organizacion: String(r.organization || ''),
      grupo: campaignNames[r.campaignId] || '',
      variante: variant || '-',
      estado: estado,
      fechaEnvio: r.sentTime ? String(r.sentTime) : null,
      primeraApertura: r.openedTime ? String(r.openedTime) : null,
      numAperturas: openCount,
      primerClic: r.clickedTime ? String(r.clickedTime) : null,
      numClics: clickCount,
      respondido: respondido,
    });
  }

  // Merge legacy + new contacts (legacy first, then new)
  var allContactos = legacyContactos.concat(contactos);

  // Also count legacy contacts in metrics
  for (var k = 0; k < legacyContactos.length; k++) {
    var lc = legacyContactos[k];
    var lv = String(lc.variante || '');
    if (lv === 'A' || lv === 'B') {
      var lBucket = (lv === 'A') ? varA : varB;
      if (lc.estado && lc.estado !== 'Error') lBucket.enviados++;
      if ((lc.numAperturas || 0) > 0) lBucket.abiertos++;
      if ((lc.numClics || 0) > 0) lBucket.clics++;
      if (lc.respondido === 'Sí' || lc.respondido === 'Si' || lc.estado === 'Respondido') lBucket.respondidos++;
    }
    if (lc.estado && lc.estado.indexOf('Error') === 0) totalErrors++;
    if ((lc.numAperturas || 0) > 0 || (lc.numClics || 0) > 0 ||
        lc.respondido === 'Sí' || lc.respondido === 'Si' || lc.estado === 'Respondido') {
      rastreados++;
    }
  }

  // Calculate rates
  function calcRates(bucket) {
    var total = bucket.enviados || 1;
    bucket.tasaApertura = Math.round((bucket.abiertos / total) * 10000) / 10000;
    bucket.tasaClics = Math.round((bucket.clics / total) * 10000) / 10000;
    bucket.tasaRespuesta = Math.round((bucket.respondidos / total) * 10000) / 10000;
    return bucket;
  }

  var metricas = {
    total: allContactos.length,
    errores: totalErrors,
    A: calcRates(varA),
    B: calcRates(varB),
    Final: finalGroup,
  };

  return {
    actualizado: now(),
    metricas: metricas,
    contactos: allContactos,
    contactosRastreados: rastreados,
  };
}

/**
 * pipeline — Read pipeline cards from Pipeline sheet.
 * Returns cards with parsed notas/historial.
 */
function handlePipeline() {
  var rows = readAll(SHEET_PIPELINE, PIPELINE_HEADERS);
  var pipeline = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var notas = [];
    var historial = [];
    try { notas = JSON.parse(r.notas || '[]'); } catch (e) { /* ignore */ }
    try { historial = JSON.parse(r.historial || '[]'); } catch (e) { /* ignore */ }

    // Enrich with recipient data if available
    var recipientInfo = findRecipientByEmail(r.email);

    pipeline.push({
      email: r.email,
      etapa: r.etapa || 'nuevo',
      etapaAnterior: r.etapaAnterior || '',
      fechaCambio: r.fechaCambio || '',
      fechaCreacion: r.fechaCreacion || '',
      notas: notas,
      historial: historial,
      nombre: recipientInfo ? recipientInfo.name : '',
      apellido: recipientInfo ? recipientInfo.lastName : '',
      organizacion: recipientInfo ? recipientInfo.organization : '',
    });
  }
  return { success: true, pipeline: pipeline };
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
      // Fallback: send without 'from' alias
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
      // Fallback: create draft without 'from' alias
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

// ── New helpers ──────────────────────────────────────────────────────

/** Find a recipient row by email (returns first match) */
function findRecipientByEmail(email) {
  if (!email) return null;
  var recipients = readAll(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  var emailLower = String(email).toLowerCase().trim();
  for (var i = 0; i < recipients.length; i++) {
    if (String(recipients[i].email).toLowerCase().trim() === emailLower) {
      return recipients[i];
    }
  }
  return null;
}

/** Get or create a Pipeline row for an email. Returns { sheet, rowIndex, row } */
function getOrCreatePipelineRow(email) {
  var sheet = getOrCreateSheet(SHEET_PIPELINE, PIPELINE_HEADERS);
  var emailCol = PIPELINE_HEADERS.indexOf('email');
  var rowIndex = findRowIndex(sheet, emailCol, email);

  if (rowIndex === -1) {
    var newRow = {
      email: email,
      etapa: 'nuevo',
      etapaAnterior: '',
      fechaCambio: now(),
      fechaCreacion: now(),
      notas: '[]',
      historial: '[]',
    };
    appendRow(sheet, PIPELINE_HEADERS, newRow);
    rowIndex = sheet.getLastRow();
    return { sheet: sheet, rowIndex: rowIndex, row: newRow };
  }

  // Read existing row
  var data = sheet.getRange(rowIndex, 1, 1, PIPELINE_HEADERS.length).getValues()[0];
  var row = {};
  for (var i = 0; i < PIPELINE_HEADERS.length; i++) {
    row[PIPELINE_HEADERS[i]] = data[i];
  }
  return { sheet: sheet, rowIndex: rowIndex, row: row };
}

/** Get sender config from Script Properties or campaign */
function getSenderConfig() {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('SENDER_EMAIL') || '';
  var name = props.getProperty('SENDER_NAME') || '';

  // Fallback: try first active campaign
  if (!email) {
    var campaigns = readAll(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
    for (var i = 0; i < campaigns.length; i++) {
      if (campaigns[i].senderEmail) {
        email = campaigns[i].senderEmail;
        name = name || campaigns[i].senderName;
        break;
      }
    }
  }

  return { email: email, name: name };
}

/** Call Gemini 2.0 Flash API */
function callGemini(prompt, maxTokens) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured in Script Properties');

  maxTokens = maxTokens || 1024;
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var json = JSON.parse(response.getContentText());
  if (json.error) throw new Error('Gemini error: ' + json.error.message);

  var candidates = json.candidates || [];
  if (candidates.length === 0) return '';
  var parts = candidates[0].content && candidates[0].content.parts || [];
  return parts.map(function(p) { return p.text || ''; }).join('');
}

/** Get conversation context from Gmail for an email address */
function getConversationContext(email, maxMessages) {
  maxMessages = maxMessages || 5;
  var threads = GmailApp.search('from:' + email + ' OR to:' + email, 0, 3);
  var messages = [];

  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var from = msg.getFrom();
      var esLeticia = (from.indexOf('alter-5.com') !== -1 || from.indexOf('alter5.com') !== -1);

      messages.push({
        fecha: msg.getDate().toISOString(),
        remitente: from,
        esLeticia: esLeticia,
        asunto: msg.getSubject(),
        cuerpo: msg.getPlainBody().substring(0, 2000),
      });
    }
  }

  // Sort by date desc, limit
  messages.sort(function(a, b) { return b.fecha.localeCompare(a.fecha); });
  return messages.slice(0, maxMessages);
}

/** Find an existing Gmail draft for a specific email address */
function findDraftForEmail(email) {
  var drafts = GmailApp.getDrafts();
  var emailLower = String(email).toLowerCase().trim();

  for (var i = 0; i < drafts.length; i++) {
    var msg = drafts[i].getMessage();
    var to = String(msg.getTo()).toLowerCase();
    if (to.indexOf(emailLower) !== -1) {
      return {
        draftId: drafts[i].getId(),
        cuerpo: msg.getBody(),
        asunto: msg.getSubject(),
        existe: true,
        estado: 'listo',
      };
    }
  }

  return { draftId: null, cuerpo: '', asunto: '', existe: false, estado: '' };
}

// ── Pipeline handlers ────────────────────────────────────────────────

/** moveStage — Move a contact to a new pipeline stage */
function handleMoveStage(payload) {
  var email = payload.email;
  var newStage = payload.newStage;
  if (!email || !newStage) return { error: 'Missing email or newStage' };

  var p = getOrCreatePipelineRow(email);
  var oldStage = p.row.etapa || 'nuevo';

  // Update etapa
  updateCell(p.sheet, p.rowIndex, PIPELINE_HEADERS, 'etapa', newStage);
  updateCell(p.sheet, p.rowIndex, PIPELINE_HEADERS, 'etapaAnterior', oldStage);
  updateCell(p.sheet, p.rowIndex, PIPELINE_HEADERS, 'fechaCambio', now());

  // Append to historial
  var historial = [];
  try { historial = JSON.parse(p.row.historial || '[]'); } catch (e) { /* ignore */ }
  historial.push({ etapa: newStage, fecha: now() });
  updateCell(p.sheet, p.rowIndex, PIPELINE_HEADERS, 'historial', JSON.stringify(historial));

  return { success: true, email: email, etapa: newStage, etapaAnterior: oldStage };
}

/** addNote — Add a note to a pipeline contact */
function handleAddNote(payload) {
  var email = payload.email;
  var note = payload.note;
  if (!email || !note) return { error: 'Missing email or note' };

  var p = getOrCreatePipelineRow(email);

  var notas = [];
  try { notas = JSON.parse(p.row.notas || '[]'); } catch (e) { /* ignore */ }
  notas.push({ fecha: now(), texto: note });
  updateCell(p.sheet, p.rowIndex, PIPELINE_HEADERS, 'notas', JSON.stringify(notas));

  return { success: true, email: email, totalNotas: notas.length };
}

// ── Gmail reading handlers ───────────────────────────────────────────

/** getConversation — Get conversation thread + draft for an email */
function handleGetConversation(payload) {
  var email = payload.email;
  if (!email) return { error: 'Missing email' };

  // Get conversation history
  var historial = [];
  var ultimaRespuesta = null;

  try {
    var threads = GmailApp.search('from:' + email + ' OR to:' + email, 0, 5);

    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        var msg = msgs[m];
        var from = msg.getFrom();
        var esLeticia = (from.indexOf('alter-5.com') !== -1 || from.indexOf('alter5.com') !== -1);

        var entry = {
          fecha: msg.getDate().toISOString(),
          remitente: from,
          esLeticia: esLeticia,
          cuerpo: msg.getPlainBody().substring(0, 2000),
          asunto: msg.getSubject(),
        };
        historial.push(entry);

        // Track last reply from the contact (not from us)
        if (!esLeticia) {
          if (!ultimaRespuesta || msg.getDate().toISOString() > ultimaRespuesta.fecha) {
            ultimaRespuesta = entry;
          }
        }
      }
    }
  } catch (e) {
    Logger.log('Error reading Gmail for ' + email + ': ' + e.message);
  }

  // Sort historial by date desc
  historial.sort(function(a, b) { return b.fecha.localeCompare(a.fecha); });

  // Find existing draft for this email
  var borrador = findDraftForEmail(email);

  return {
    success: true,
    respuesta: ultimaRespuesta ? {
      fecha: ultimaRespuesta.fecha,
      cuerpo: ultimaRespuesta.cuerpo,
      estado: 'recibido',
    } : null,
    borrador: borrador,
    historial: historial,
  };
}

/** getConversacionCompleta — Full conversation thread with AI summary */
function handleGetConversacionCompleta(payload) {
  var email = payload.email;
  if (!email) return { error: 'Missing email' };

  var mensajes = getConversationContext(email, 20);
  var resumen = '';

  // Generate AI summary if we have Gemini and messages
  if (mensajes.length > 0) {
    try {
      var context = mensajes.map(function(m) {
        return (m.esLeticia ? 'Alter5' : 'Contacto') + ' (' + m.fecha.substring(0, 10) + '): ' + m.cuerpo.substring(0, 500);
      }).join('\n---\n');

      resumen = callGemini(
        'Resume esta conversación de email en 2-3 frases en español. Indica los puntos clave y el estado actual:\n\n' + context,
        256
      );
    } catch (e) {
      resumen = 'No se pudo generar resumen: ' + e.message;
    }
  }

  return { success: true, mensajes: mensajes, resumen: resumen };
}

/** getConversaciones — Batch get conversation summaries (for dashboard) */
function handleGetConversaciones(params) {
  // Lightweight: just return recent threads count per contact
  return { success: true, conversaciones: [] };
}

/** getFollowUpCandidates — Contacts that opened/clicked but haven't been followed up */
function handleGetFollowUpCandidates(payload) {
  var campaignId = payload.campaignId || '';
  var recipients = readAll(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  var followUps = readAll(SHEET_FOLLOWUPS, FOLLOWUP_HEADERS);

  // Count follow-ups sent per email
  var followUpCount = {};
  for (var f = 0; f < followUps.length; f++) {
    var fEmail = String(followUps[f].email).toLowerCase().trim();
    if (followUps[f].status === 'sent' || followUps[f].status === 'scheduled' || followUps[f].status === 'draft_ready') {
      followUpCount[fEmail] = (followUpCount[fEmail] || 0) + 1;
    }
  }

  var candidatos = [];
  var seen = {};

  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    if (campaignId && r.campaignId !== campaignId) continue;

    var rEmail = String(r.email).toLowerCase().trim();
    if (!rEmail || seen[rEmail]) continue;
    seen[rEmail] = true;

    var openCount = Number(r.openCount) || 0;
    var clickCount = Number(r.clickCount) || 0;

    // Candidate if opened or clicked
    if (openCount > 0 || clickCount > 0) {
      candidatos.push({
        email: rEmail,
        nombre: r.name || '',
        apellido: r.lastName || '',
        organizacion: r.organization || '',
        numAperturas: openCount,
        numClics: clickCount,
        seguimientosEnviados: followUpCount[rEmail] || 0,
      });
    }
  }

  // Sort: clicked first, then most opens
  candidatos.sort(function(a, b) {
    if (b.numClics !== a.numClics) return b.numClics - a.numClics;
    return b.numAperturas - a.numAperturas;
  });

  return { success: true, candidatos: candidatos };
}

// ── Gmail writing handlers ───────────────────────────────────────────

/** sendDraft — Send a draft or reply to a thread */
function handleSendDraft(payload) {
  var email = payload.email;
  if (!email) return { error: 'Missing email' };

  var draftId = payload.draftId;
  var editedBody = payload.editedBody || payload.cuerpoEditado || '';
  var sender = getSenderConfig();

  // If draftId provided, send that draft (optionally with edited body)
  if (draftId) {
    try {
      var draft = GmailApp.getDraft(draftId);
      if (editedBody) {
        // Delete old draft, create new with edited body, and send
        var origMsg = draft.getMessage();
        var subject = origMsg.getSubject();
        var to = origMsg.getTo();
        draft.deleteDraft();
        var newDraft = GmailApp.createDraft(to, subject, '', emailOptions(editedBody, sender.email, sender.name));
        newDraft.send();
      } else {
        draft.send();
      }
      return { success: true, email: email };
    } catch (e) {
      return { error: 'Error sending draft: ' + e.message };
    }
  }

  // No draftId: find existing thread and reply, or send new email
  try {
    var body = editedBody || payload.body || '';
    var subject = payload.asunto || payload.subject || 'Seguimiento';

    // Try to find an existing thread to reply to
    var threads = GmailApp.search('from:' + email + ' OR to:' + email, 0, 1);
    if (threads.length > 0) {
      var lastMsg = threads[0].getMessages().pop();
      subject = 'Re: ' + lastMsg.getSubject();
      lastMsg.reply('', emailOptions(body, sender.email, sender.name));
    } else {
      sendWithFallback(email, subject, body, sender.email, sender.name);
    }

    return { success: true, email: email };
  } catch (e) {
    return { error: 'Error sending: ' + e.message };
  }
}

/** saveDraft — Save or update a Gmail draft for an email */
function handleSaveDraft(payload) {
  var email = payload.email;
  var body = payload.body || payload.borradorCuerpo || '';
  if (!email) return { error: 'Missing email' };

  var sender = getSenderConfig();
  var subject = payload.asunto || payload.subject || 'Seguimiento';

  try {
    // Check for existing draft to this email
    var existing = findDraftForEmail(email);
    if (existing.existe && existing.draftId) {
      // Delete old draft
      try {
        var oldDraft = GmailApp.getDraft(existing.draftId);
        subject = existing.asunto || subject; // Keep original subject
        oldDraft.deleteDraft();
      } catch (e) { /* draft may have been sent/deleted */ }
    }

    // Create new draft
    var draft = createDraftWithFallback(email, subject, body, sender.email, sender.name);
    return { success: true, draftId: draft.getId() };
  } catch (e) {
    return { error: 'Error saving draft: ' + e.message };
  }
}

/** composeAndSaveDraft — Create a new draft with given subject and body */
function handleComposeAndSaveDraft(payload) {
  var email = payload.email;
  var body = payload.mensaje || payload.body || '';
  var subject = payload.asunto || payload.subject || '';
  if (!email) return { error: 'Missing email' };

  var sender = getSenderConfig();

  try {
    var draft = createDraftWithFallback(email, subject, body, sender.email, sender.name);
    return { success: true, draftId: draft.getId() };
  } catch (e) {
    return { error: 'Error creating draft: ' + e.message };
  }
}

/** uploadMeetingNotes — Upload file to Drive and add note to Pipeline */
function handleUploadMeetingNotes(payload) {
  var email = payload.email;
  var noteText = payload.noteText || '';
  if (!email) return { error: 'Missing email' };

  var driveUrl = null;

  // Upload file to Drive if provided
  if (payload.fileBase64 && payload.fileName) {
    try {
      var blob = Utilities.newBlob(
        Utilities.base64Decode(payload.fileBase64),
        payload.fileType || 'application/octet-stream',
        payload.fileName
      );

      var folderId = PropertiesService.getScriptProperties().getProperty('NOTES_FOLDER_ID');
      var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      driveUrl = file.getUrl();

      noteText = noteText + (noteText ? '\n' : '') + 'Archivo: ' + driveUrl;
    } catch (e) {
      Logger.log('Error uploading file: ' + e.message);
    }
  }

  // Add note to pipeline
  if (noteText) {
    handleAddNote({ email: email, note: noteText });
  }

  return { success: true, driveUrl: driveUrl };
}

// ── AI handlers ──────────────────────────────────────────────────────

/** generateFollowUp — Generate a follow-up draft using Gemini */
function handleGenerateFollowUp(payload) {
  var email = payload.email;
  if (!email) return { error: 'Missing email' };

  // Get conversation context
  var mensajes = getConversationContext(email, 5);

  var conversationText = '';
  if (mensajes.length > 0) {
    conversationText = mensajes.map(function(m) {
      return (m.esLeticia ? 'Alter5' : 'Contacto') + ': ' + m.cuerpo.substring(0, 500);
    }).join('\n---\n');
  }

  // Get recipient info for personalization
  var recipientInfo = findRecipientByEmail(email);
  var nombre = recipientInfo ? (recipientInfo.name + ' ' + recipientInfo.lastName).trim() : '';
  var org = recipientInfo ? recipientInfo.organization : '';

  var prompt = 'Eres un asesor de inversión de Alter5 Capital (financiación energías renovables). ' +
    'Genera un email de seguimiento profesional en español.\n\n';

  if (nombre) prompt += 'Destinatario: ' + nombre + (org ? ' de ' + org : '') + '\n';
  if (payload.instructions) prompt += 'Instrucciones: ' + payload.instructions + '\n';

  if (conversationText) {
    prompt += '\nConversación previa:\n' + conversationText + '\n';
    prompt += '\nGenera un seguimiento natural basado en la conversación. ';
  } else {
    prompt += '\nNo hay conversación previa. Genera un email introductorio breve. ';
  }

  prompt += 'Responde SOLO con el cuerpo del email en HTML (sin subject, sin metadata). ' +
    'Usa un tono profesional pero cercano. Incluye un call-to-action claro.';

  try {
    var borrador = callGemini(prompt, 1024);
    return { success: true, borrador: borrador, body: borrador, draft: borrador };
  } catch (e) {
    return { error: 'Error generating follow-up: ' + e.message };
  }
}

/** improveMessage — Improve an email draft using Gemini */
function handleImproveMessage(payload) {
  var email = payload.email || '';
  var texto = payload.texto || payload.text || '';
  if (!texto) return { error: 'Missing texto' };

  var prompt = 'Eres un experto en comunicación comercial de Alter5 Capital (financiación energías renovables). ' +
    'Mejora el siguiente email manteniendo el mensaje original pero haciéndolo más profesional, ' +
    'claro y persuasivo. Mantén el mismo idioma. Responde SOLO con el texto mejorado en HTML:\n\n' + texto;

  try {
    var textoMejorado = callGemini(prompt, 1024);
    return { success: true, textoMejorado: textoMejorado };
  } catch (e) {
    return { error: 'Error improving message: ' + e.message };
  }
}

/** composeFromInstructions — Compose an email from instructions using Gemini */
function handleComposeFromInstructions(payload) {
  var email = payload.email;
  var instructions = payload.instructions || payload.instrucciones || '';
  if (!email || !instructions) return { error: 'Missing email or instructions' };

  // Get conversation context for personalization
  var mensajes = getConversationContext(email, 5);
  var conversationText = '';
  if (mensajes.length > 0) {
    conversationText = mensajes.map(function(m) {
      return (m.esLeticia ? 'Alter5' : 'Contacto') + ': ' + m.cuerpo.substring(0, 500);
    }).join('\n---\n');
  }

  var recipientInfo = findRecipientByEmail(email);
  var nombre = recipientInfo ? (recipientInfo.name + ' ' + recipientInfo.lastName).trim() : '';
  var org = recipientInfo ? recipientInfo.organization : '';

  var prompt = 'Eres un asesor de inversión de Alter5 Capital (financiación energías renovables). ' +
    'Compón un email profesional en español según las instrucciones.\n\n' +
    'Instrucciones: ' + instructions + '\n';

  if (nombre) prompt += 'Destinatario: ' + nombre + (org ? ' de ' + org : '') + '\n';

  if (conversationText) {
    prompt += '\nConversación previa para contexto:\n' + conversationText + '\n';
  }

  prompt += '\nResponde SOLO con el cuerpo del email en HTML (sin subject). ' +
    'Tono profesional pero cercano.';

  try {
    var borrador = callGemini(prompt, 1024);
    return { success: true, borrador: borrador, body: borrador, draft: borrador };
  } catch (e) {
    return { error: 'Error composing from instructions: ' + e.message };
  }
}

/** classifyReply — Classify a reply using Gemini */
function handleClassifyReply(payload) {
  var email = payload.email || '';
  var replyText = payload.replyText || '';
  if (!replyText) return { error: 'Missing replyText' };

  var prompt = 'Clasifica la siguiente respuesta de email en UNA de estas categorías:\n' +
    '- interesado: muestra interés en continuar la conversación\n' +
    '- reunion: propone o acepta una reunión\n' +
    '- no_interesado: rechaza o no está interesado\n' +
    '- informacion: pide más información\n' +
    '- fuera_oficina: auto-reply o fuera de oficina\n' +
    '- otro: no encaja en ninguna categoría\n\n' +
    'También indica el sentimiento: positivo, neutro, negativo.\n\n' +
    'Respuesta del email:\n' + replyText + '\n\n' +
    'Responde en formato JSON: {"classification": "...", "sentiment": "..."}';

  try {
    var result = callGemini(prompt, 128);
    // Parse JSON from Gemini response
    var jsonMatch = result.match(/\{[^}]+\}/);
    if (jsonMatch) {
      var parsed = JSON.parse(jsonMatch[0]);
      return { success: true, classification: parsed.classification, sentiment: parsed.sentiment };
    }
    return { success: true, classification: 'otro', sentiment: 'neutro' };
  } catch (e) {
    return { error: 'Error classifying reply: ' + e.message };
  }
}

// ── Batch handlers ───────────────────────────────────────────────────

/** generateFollowUpBatch — Generate follow-up drafts for multiple contacts */
function handleGenerateFollowUpBatch(payload) {
  var emails = payload.emails || payload.contacts || [];
  var instructions = payload.instrucciones || payload.instructions || '';
  if (!emails || emails.length === 0) return { error: 'Missing emails' };

  var maxBatch = 15;
  var borradores = [];
  var errors = [];

  for (var i = 0; i < Math.min(emails.length, maxBatch); i++) {
    var item = emails[i];
    var email = (typeof item === 'string') ? item : (item.email || '');
    if (!email) continue;

    try {
      var result = handleGenerateFollowUp({ email: email, instructions: instructions });
      if (result.success) {
        borradores.push({
          email: email,
          asunto: 'Seguimiento - Alter5 Capital',
          cuerpoHtml: result.borrador || result.body || '',
        });
      } else {
        errors.push({ email: email, error: result.error });
      }
    } catch (e) {
      errors.push({ email: email, error: e.message });
    }

    // Rate limit Gemini calls
    if (i < emails.length - 1) Utilities.sleep(500);
  }

  return { success: true, borradores: borradores, errors: errors };
}

/** sendFollowUpBatch — Send follow-up emails in batch */
function handleSendFollowUpBatch(payload) {
  var emails = payload.emails || [];
  if (!emails || emails.length === 0) return { error: 'Missing emails' };

  var sender = getSenderConfig();
  var totalEnviados = 0;
  var totalErrores = 0;
  var errors = [];

  for (var i = 0; i < emails.length; i++) {
    var item = emails[i];
    var email = item.email || '';
    var subject = item.asunto || 'Seguimiento - Alter5 Capital';
    var body = item.cuerpoHtml || '';

    if (!email || !body) {
      totalErrores++;
      errors.push({ email: email, error: 'Missing email or body' });
      continue;
    }

    try {
      sendWithFallback(email, subject, body, sender.email, sender.name);
      totalEnviados++;

      // Move to pipeline stage 'seguimiento' if not already there
      try {
        var p = getOrCreatePipelineRow(email);
        if (p.row.etapa === 'nuevo') {
          handleMoveStage({ email: email, newStage: 'seguimiento' });
        }
      } catch (e) { /* ignore pipeline errors */ }

      // Rate limit: 1 email per second
      Utilities.sleep(1000);
    } catch (e) {
      totalErrores++;
      errors.push({ email: email, error: e.message });
    }
  }

  return { success: true, totalEnviados: totalEnviados, totalErrores: totalErrores, errors: errors };
}

// ── Campaign management extras ───────────────────────────────────────

/** updateCampaign — Update specific fields of a campaign */
function handleUpdateCampaign(payload) {
  var campaignId = payload.campaignId;
  var fields = payload.fields || {};
  if (!campaignId) return { error: 'Missing campaignId' };

  var campSheet = getOrCreateSheet(SHEET_CAMPAIGNS, CAMPAIGN_HEADERS);
  var rowIndex = findRowIndex(campSheet, 0, campaignId);
  if (rowIndex === -1) return { error: 'Campaign not found' };

  // Update each provided field
  var updatable = ['name', 'senderEmail', 'senderName', 'subjectA', 'bodyA',
    'subjectB', 'bodyB', 'abTestPercent', 'abWinnerCriteria', 'notes', 'knowledgeBase'];

  for (var i = 0; i < updatable.length; i++) {
    var key = updatable[i];
    if (fields[key] !== undefined) {
      updateCell(campSheet, rowIndex, CAMPAIGN_HEADERS, key, fields[key]);
    }
  }

  return { success: true, id: campaignId };
}

/** getCampaignDashboard — Dashboard metrics for a specific campaign */
function handleCampaignDashboard(payload) {
  var campaignId = payload.campaignId;
  if (!campaignId) return { error: 'Missing campaignId' };

  var recipients = readAll(SHEET_RECIPIENTS, RECIPIENT_HEADERS);
  var campaignRecipients = recipients.filter(function(r) { return r.campaignId === campaignId; });

  var contactos = [];
  var metricas = { total: 0, enviados: 0, abiertos: 0, clics: 0, respondidos: 0, errores: 0 };

  for (var i = 0; i < campaignRecipients.length; i++) {
    var r = campaignRecipients[i];
    var openCount = Number(r.openCount) || 0;
    var clickCount = Number(r.clickCount) || 0;
    var isSent = (r.status === 'sent' || r.status === 'replied');
    var isReplied = (r.status === 'replied');
    var isError = (r.status === 'error');

    metricas.total++;
    if (isSent || isError) metricas.enviados++;
    if (openCount > 0) metricas.abiertos++;
    if (clickCount > 0) metricas.clics++;
    if (isReplied) metricas.respondidos++;
    if (isError) metricas.errores++;

    contactos.push({
      email: String(r.email).toLowerCase().trim(),
      nombre: r.name || '',
      apellido: r.lastName || '',
      organizacion: r.organization || '',
      variante: r.variant || '-',
      estado: mapStatus(r.status, openCount, clickCount),
      fechaEnvio: r.sentTime ? String(r.sentTime) : null,
      primeraApertura: r.openedTime ? String(r.openedTime) : null,
      numAperturas: openCount,
      primerClic: r.clickedTime ? String(r.clickedTime) : null,
      numClics: clickCount,
      respondido: isReplied ? 'Sí' : 'No',
    });
  }

  return {
    success: true,
    contactos: contactos,
    metricas: metricas,
    actualizado: now(),
  };
}
