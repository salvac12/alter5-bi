/**
 * ProspectingResults -- Airtable REST API backend.
 *
 * Manages prospecting jobs and their company results.
 * Same base as Opportunities/Prospects (appVu3TvSZ1E4tj0J).
 * Table: "ProspectingResults"
 * All requests go through /api/airtable-proxy (Vercel serverless).
 */

import { airtableProxy, isProxyConfigured } from './proxyClient';

const TABLE_NAME = "ProspectingResults";
const CAMPAIGN_TARGETS_TABLE = "CampaignTargets";

function getProxySecret() {
  return import.meta.env.VITE_CAMPAIGN_PROXY_SECRET || "";
}

// -- In-memory cache for jobs list --
let jobsCache = null;
let jobsCacheTimestamp = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds (matches polling interval)

function invalidateJobsCache() {
  jobsCache = null;
  jobsCacheTimestamp = 0;
}

/**
 * Fetch all prospecting jobs with their status and company counts.
 * Groups records by JobId and aggregates stats.
 * Returns array of job objects sorted by CreatedAt desc.
 */
export async function fetchProspectingJobs() {
  const now = Date.now();
  if (jobsCache && (now - jobsCacheTimestamp) < CACHE_TTL) {
    return jobsCache;
  }

  if (!isProxyConfigured()) return [];

  const allRecords = [];
  let offset = "";

  try {
    do {
      const data = await airtableProxy({
        table: TABLE_NAME,
        method: 'GET',
        pageSize: 100,
        fieldsList: ["JobId", "JobName", "JobStatus", "SearchCriteria", "CreatedAt", "CreatedBy", "ReviewStatus", "Confidence", "CompanyName"],
        ...(offset ? { offset } : {}),
      });
      allRecords.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);
  } catch (err) {
    console.warn("ProspectingResults fetch failed:", err.message);
    return jobsCache || [];
  }

  // Group by JobId
  const jobMap = new Map();
  for (const r of allRecords) {
    const f = r.fields;
    const jobId = f.JobId || "";
    if (!jobId) continue;

    const isPlaceholder = f.CompanyName === "__JOB_PLACEHOLDER__";
    const isNoResults = f.CompanyName === "__NO_RESULTS__";

    if (!jobMap.has(jobId)) {
      let criteria = {};
      try { criteria = JSON.parse(f.SearchCriteria || "{}"); } catch {}

      jobMap.set(jobId, {
        jobId,
        jobName: f.JobName || jobId,
        status: f.JobStatus || "pending",
        createdAt: f.CreatedAt || "",
        createdBy: f.CreatedBy || "",
        criteria,
        totalCompanies: 0,
        approvedCount: 0,
        pendingCount: 0,
        highConfidenceCount: 0,
      });
    }

    // Placeholders and __NO_RESULTS__ create the job entry but don't count as companies
    if (isPlaceholder || isNoResults) continue;

    const job = jobMap.get(jobId);
    if (f.CompanyName) {
      job.totalCompanies++;
      if (f.ReviewStatus === "approved") job.approvedCount++;
      if (f.ReviewStatus === "pending") job.pendingCount++;
      if (f.Confidence === "high") job.highConfidenceCount++;
    }
  }

  const jobs = Array.from(jobMap.values()).sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );

  jobsCache = jobs;
  jobsCacheTimestamp = now;
  return jobs;
}

/**
 * Fetch all company results for a specific job.
 * Returns array of company records with pagination support.
 */
export async function fetchJobResults(jobId) {
  if (!isProxyConfigured() || !jobId) return [];

  const allRecords = [];
  let offset = "";
  const filterFormula = `AND({JobId}="${jobId}",{CompanyName}!="__JOB_PLACEHOLDER__",{CompanyName}!="__NO_RESULTS__")`;

  try {
    do {
      const data = await airtableProxy({
        table: TABLE_NAME,
        method: 'GET',
        pageSize: 100,
        formula: filterFormula,
        ...(offset ? { offset } : {}),
      });
      allRecords.push(...(data.records || []));
      offset = data.offset || "";
    } while (offset);
  } catch (err) {
    console.warn("fetchJobResults failed:", err.message);
    return [];
  }

  return allRecords.map(r => {
    const f = r.fields;
    let marketRoles = [];
    let technologies = [];
    let geography = [];
    let sourcesFound = [];
    let apolloData = null;
    let searchCriteria = {};

    try { marketRoles = JSON.parse(f.MarketRoles || "[]"); } catch {}
    try { technologies = JSON.parse(f.Technologies || "[]"); } catch {}
    try { geography = JSON.parse(f.Geography || "[]"); } catch {}
    try { sourcesFound = JSON.parse(f.SourcesFound || "[]"); } catch {}
    try { apolloData = JSON.parse(f.ApolloData || "null"); } catch {}
    try { searchCriteria = JSON.parse(f.SearchCriteria || "{}"); } catch {}

    return {
      id: r.id,
      jobId: f.JobId || "",
      jobName: f.JobName || "",
      jobStatus: f.JobStatus || "completed",
      searchCriteria,
      companyName: f.CompanyName || "",
      companyUrl: f.CompanyUrl || "",
      country: f.Country || "",
      taxId: f.TaxId || "PENDING",
      description: f.Description || "",
      financingSignals: f.FinancingSignals || "",
      assetType: f.AssetType || "",
      estimatedSize: f.EstimatedSize || "",
      role: f.Role || "",
      segment: f.Segment || "",
      companyType: f.CompanyType || "",
      marketRoles,
      technologies,
      geography,
      classificationNotes: f.ClassificationNotes || "",
      confidence: f.Confidence || "low",
      sourcesFound,
      reviewStatus: f.ReviewStatus || "pending",
      reviewedBy: f.ReviewedBy || "",
      reviewedAt: f.ReviewedAt || "",
      notes: f.Notes || "",
      contactName: f.ContactName || "",
      contactRole: f.ContactRole || "",
      contactLinkedIn: f.ContactLinkedIn || "",
      contactEmail: f.ContactEmail || "",
      findymailStatus: f.FindymailStatus || "pending",
      apolloData,
      campaignRef: f.CampaignRef || "",
      prospectId: f.ProspectId || "",
    };
  });
}

/**
 * Update the review status of a company record.
 */
export async function updateReviewStatus(recordId, status, reviewedBy = "") {
  if (!isProxyConfigured() || !recordId) return null;

  const fields = {
    ReviewStatus: status,
    ReviewedBy: reviewedBy,
    ReviewedAt: new Date().toISOString(),
  };

  try {
    const data = await airtableProxy({
      table: TABLE_NAME,
      method: 'PATCH',
      recordId,
      fields,
    });
    invalidateJobsCache();
    return data;
  } catch (err) {
    console.warn("updateReviewStatus failed:", err.message);
    return null;
  }
}

/**
 * Update contact data for a company record.
 */
export async function updateContactData(recordId, contactData) {
  if (!isProxyConfigured() || !recordId) return null;

  const fields: Record<string, any> = {};
  if (contactData.contactName !== undefined) fields.ContactName = contactData.contactName;
  if (contactData.contactRole !== undefined) fields.ContactRole = contactData.contactRole;
  if (contactData.contactEmail !== undefined) fields.ContactEmail = contactData.contactEmail;
  if (contactData.contactLinkedIn !== undefined) fields.ContactLinkedIn = contactData.contactLinkedIn;
  if (contactData.findymailStatus !== undefined) fields.FindymailStatus = contactData.findymailStatus;
  if (contactData.apolloData !== undefined) fields.ApolloData = JSON.stringify(contactData.apolloData);

  try {
    return await airtableProxy({
      table: TABLE_NAME,
      method: 'PATCH',
      recordId,
      fields,
    });
  } catch (err) {
    console.warn("updateContactData failed:", err.message);
    return null;
  }
}

/**
 * Create a new prospecting job record in Airtable.
 * Returns the created record.
 */
export async function createProspectingJob(criteria, jobName, createdBy = "") {
  if (!isProxyConfigured()) throw new Error("Proxy not configured");

  const jobId = `job_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 15)}_${(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))}`;

  const fields = {
    JobId: jobId,
    JobName: jobName,
    SearchCriteria: JSON.stringify({ ...criteria, job_id: jobId, job_name: jobName, created_by: createdBy }),
    JobStatus: "pending",
    CreatedAt: new Date().toISOString(),
    CreatedBy: createdBy,
    CompanyName: "__JOB_PLACEHOLDER__",
    ReviewStatus: "pending",
  };

  const data = await airtableProxy({
    table: TABLE_NAME,
    method: 'POST',
    records: [{ fields }],
  });

  invalidateJobsCache();

  return { jobId, record: data.records?.[0] };
}

/**
 * Trigger the GitHub Actions prospecting workflow via server-side proxy.
 * The proxy uses GITHUB_TOKEN (fine-grained PAT) server-side.
 */
export async function triggerGitHubAction(criteria, jobId) {
  const proxySecret = getProxySecret();
  if (!proxySecret) throw new Error("VITE_CAMPAIGN_PROXY_SECRET not configured");

  const criteriaWithJob = { ...criteria, job_id: jobId };

  const res = await fetch("/api/github-dispatch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-proxy-secret": proxySecret,
    },
    body: JSON.stringify({
      criteria: JSON.stringify(criteriaWithJob),
      jobId,
    }),
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    const detail = data.detail || data.error || `status ${res.status}`;
    throw new Error(`GitHub dispatch failed: ${detail}`);
  }

  return { success: true, jobId };
}

/**
 * Update job status for all records matching a JobId.
 */
export async function updateJobStatusByJobId(jobId, status, notes) {
  if (!isProxyConfigured() || !jobId) return;

  // Find all record IDs for this job
  try {
    const data = await airtableProxy({
      table: TABLE_NAME,
      method: 'GET',
      pageSize: 100,
      formula: `{JobId}="${jobId}"`,
      fieldsList: ["JobId"],
    });
    const recordIds = (data.records || []).map(r => r.id);
    if (recordIds.length === 0) return;

    const fields: Record<string, any> = { JobStatus: status };
    if (notes) fields.Notes = notes;

    // Update in batches of 10
    for (let i = 0; i < recordIds.length; i += 10) {
      const batch = recordIds.slice(i, i + 10);
      const payload = batch.map(id => ({ id, fields }));
      await airtableProxy({
        table: TABLE_NAME,
        method: 'PATCH',
        records: payload,
      });
    }
    invalidateJobsCache();
  } catch (err) {
    console.warn("updateJobStatusByJobId failed:", err.message);
  }
}

/**
 * Retry a failed/stuck prospecting job: reset status to "pending" and re-trigger dispatch.
 */
export async function retryProspectingJob(jobId, criteria) {
  await updateJobStatusByJobId(jobId, "pending", "Reintento manual");
  return triggerGitHubAction(criteria, jobId);
}

/**
 * Find contact by LinkedIn URL using Findymail API (called from frontend).
 * Note: This requires a server-side proxy to avoid exposing the API key.
 * For now, this returns a placeholder -- implement server-side if needed.
 */
export async function findContactByLinkedIn(linkedinUrl, recordId) {
  // This would need a server-side endpoint to avoid exposing Findymail API key
  // For now, update the record with the LinkedIn URL and mark for manual processing
  console.warn("[airtableProspecting] findContactByLinkedIn requires server-side implementation");
  return { status: "manual_required", linkedin_url: linkedinUrl };
}

/**
 * Export approved companies to CampaignTargets table.
 * Returns count of exported companies.
 */
export async function exportToCampaignTargets(companies, jobName) {
  if (!isProxyConfigured()) throw new Error("Proxy not configured");

  const toExport = companies.filter(
    c => c.reviewStatus === "approved" && c.contactEmail
  );

  if (toExport.length === 0) return 0;

  let exported = 0;

  for (let i = 0; i < toExport.length; i += 10) {
    const batch = toExport.slice(i, i + 10);
    const records = batch.map(company => {
      const domain = extractDomain(company.companyUrl);
      return {
        fields: {
          domain,
          companyName: company.companyName,
          status: "pending",
          campaignRef: jobName,
          segment: company.segment || "",
          companyType: company.companyType || "",
          selectedContacts: JSON.stringify([{
            name: company.contactName,
            email: company.contactEmail,
            role: company.contactRole,
          }]),
        },
      };
    });

    try {
      await airtableProxy({
        table: CAMPAIGN_TARGETS_TABLE,
        method: 'POST',
        records,
      });
      exported += batch.length;
    } catch (err) {
      console.warn("exportToCampaignTargets batch error:", err.message);
    }
  }

  return exported;
}

function extractDomain(url) {
  if (!url) return "";
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.replace("www.", "");
  } catch {
    return url.replace("www.", "").split("/")[0];
  }
}
