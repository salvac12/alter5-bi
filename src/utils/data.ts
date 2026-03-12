import rawData from '../data/companies.json';
import oppData from '../data/opportunities.json';
import { GROUP_WEIGHTS, ROLE_WEIGHTS, REF_DATE, PRODUCTS } from './constants';

const normalize = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// ── Airtable opportunities lookup ──
const oppByName = new Map();
for (const o of (oppData.opportunities || [])) {
  oppByName.set(o.nn, o);
}

/** Check if a company name matches an Airtable opportunity (fuzzy) */
function findOpportunity(companyName) {
  const nn = normalize(companyName);
  // Direct match
  if (oppByName.has(nn)) return oppByName.get(nn);
  // Partial match: company name contains opp name or vice versa
  for (const [oppName, opp] of oppByName) {
    if (nn.includes(oppName) || oppName.includes(nn)) return opp;
  }
  return null;
}

/** Get all pipeline stages from Airtable data */
export function getOpportunityStages() {
  return oppData.stages || [];
}

/** Get opportunity count per stage */
export function getOpportunityCounts(companies) {
  const counts = { _any: 0 };
  for (const c of companies) {
    if (c.opportunity) {
      counts._any++;
      const stage = c.opportunity.stage;
      counts[stage] = (counts[stage] || 0) + 1;
    }
  }
  return counts;
}

// ── Legacy → v2 taxonomy helpers ──
function mapLegacyGroup(grp) {
  return { "Capital Seeker": "Originación", "Investor": "Inversión", "Services": "Services", "Other": "No relevante" }[grp] || "No relevante";
}

function inferSegment(grp, tp) {
  if (grp !== "Capital Seeker") return "";
  if (["Developer", "IPP", "Utility", "Asset Owner"].includes(tp)) return "Project Finance";
  if (tp === "Corporate") return "Corporate Finance";
  return "";
}

/**
 * Record: [empresa, dominio, sector, nContactos, totalInteracciones,
 *          tipoRelacion, primeraInteraccion, ultimaInteraccion, employeeSources]
 * Detail: [[contacts], [timeline], contexto, [[empId, interactions], ...], subjects, enrichment]
 */
export function parseCompanies() {
  const maxInteractions = Math.max(...rawData.r.map(r => r[4]));

  return rawData.r.map((r, i) => {
    const lastDate = new Date(r[7]);
    const monthsAgo = Math.max(0, (REF_DATE - lastDate) / (1000 * 60 * 60 * 24 * 30));
    const status = monthsAgo <= 6 ? "active" : monthsAgo <= 18 ? "dormant" : "lost";

    const volScore = Math.min(35, Math.round(Math.log(r[4] + 1) / Math.log(maxInteractions) * 35));
    const recScore = Math.max(0, Math.round(30 - monthsAgo * 1.5));
    const netScore = Math.min(15, r[3] * 3);

    const employees = r[8] ? r[8].split(",").filter(Boolean) : [];

    const det = rawData.d[String(i)];
    const detail = det ? {
      contacts: det[0].map(c => ({ name: c[0], role: c[1], email: c[2] || "", nombre: c[3] || "", apellido: c[4] || "" })),
      timeline: det[1].map(t => ({ quarter: t[0], emails: t[1], summary: t[2] || "" })),
      context: det[2],
      sources: det[3] ? det[3].map(s => ({ employee: s[0], interactions: s[1] })) : [],
      subjects: det[4] || [],
      enrichment: det[5] || null,
      datedSubjects: det[6] ? det[6].map(ds => ({ date: ds[0], subject: ds[1], extract: ds[2] || "" })) : [],
    } : null;

    // Taxonomy fields from enrichment
    const enrichment = detail?.enrichment || {};
    const tv = enrichment._tv || 0;

    let role, segment, companyType, activities, technologies, geography, assetPhase, commercialPhase;

    if (tv >= 2) {
      // v2 taxonomy
      role = enrichment.role || "No relevante";
      segment = enrichment.seg || "";
      companyType = enrichment.tp2 || "";
      activities = enrichment.act || [];
      technologies = enrichment.tech || [];
      geography = enrichment.geo || [];
      assetPhase = enrichment.fase_activo || "";
      commercialPhase = enrichment.fase || "";
    } else {
      // Legacy fallback
      const legacyGrp = enrichment.grp || "Other";
      const legacyTp = enrichment.tp || "";
      role = mapLegacyGroup(legacyGrp);
      segment = inferSegment(legacyGrp, legacyTp);
      companyType = legacyTp;
      activities = [];
      technologies = [];
      geography = [];
      assetPhase = "";
      commercialPhase = enrichment.fc || "";
    }

    const marketRoles = enrichment.mr || [];
    const productosIA = enrichment.pp || [];
    const senales = enrichment.sc || [];

    // Role-based scoring (v2 roles + legacy groups both in GROUP_WEIGHTS)
    const groupScore = GROUP_WEIGHTS[role] ?? GROUP_WEIGHTS[enrichment.grp] ?? 2;
    const score = volScore + recScore + netScore + groupScore;

    // Airtable opportunity match
    const opportunity = findOpportunity(r[0]);

    // ── Data Quality Score (0-100) ──
    // Measures how complete and reliable the data is for this company
    let qualityScore = 0;

    // Has v2 enrichment with role classified (not "No relevante" default) → 25 pts
    if (tv >= 2 && role && role !== "No relevante") qualityScore += 25;
    else if (tv >= 2) qualityScore += 15; // has enrichment but "No relevante"

    // Has contacts with identified roles (not all "No identificado") → 20 pts
    const contacts = detail?.contacts || [];
    const identifiedContacts = contacts.filter(c => c.role && c.role !== "No identificado" && c.role !== "");
    if (identifiedContacts.length >= 2) qualityScore += 20;
    else if (identifiedContacts.length === 1) qualityScore += 10;

    // Has timeline with summaries → 15 pts
    const timeline = detail?.timeline || [];
    const summaryCount = timeline.filter(t => t.summary && t.summary.length > 5).length;
    if (summaryCount >= 3) qualityScore += 15;
    else if (summaryCount >= 1) qualityScore += 8;

    // Has meaningful context → 15 pts
    const contextLen = (detail?.context || "").length;
    if (contextLen >= 100) qualityScore += 15;
    else if (contextLen >= 30) qualityScore += 8;

    // Has enough subjects for context → 10 pts
    const subjectCount = (detail?.subjects || []).length;
    if (subjectCount >= 5) qualityScore += 10;
    else if (subjectCount >= 2) qualityScore += 5;

    // Has market roles assigned → 10 pts
    if (marketRoles.length > 0) qualityScore += 10;

    // Has multiple contacts → 5 pts
    if (contacts.length >= 3) qualityScore += 5;
    else if (contacts.length >= 2) qualityScore += 3;

    // Quality label
    const qualityLabel = qualityScore >= 75 ? "alta" : qualityScore >= 45 ? "media" : "baja";

    return {
      idx: i, name: r[0], domain: r[1],
      // Keep legacy fields for CSV export compatibility
      sectors: r[2], relType: r[5],
      nContacts: r[3], interactions: r[4],
      firstDate: r[6], lastDate: r[7],
      employees, status, score, volScore, recScore, netScore,
      groupScore,
      qualityScore, qualityLabel,
      monthsAgo: Math.round(monthsAgo), detail,
      // Taxonomy v2
      role,
      group: role, // alias for backward compat
      segment,
      companyType,
      activities,
      technologies,
      geography,
      assetPhase,
      commercialPhase,
      marketRoles,
      productosIA,
      senales,
      // Employee / revenue from enrichment
      employeeCount: enrichment.emp_count || null,
      estimatedRevenue: enrichment.revenue_eur || null,
      // Originación enrichment (enrich_originacion.py)
      businessLines: enrichment.business_lines || [],
      projectScale: enrichment.project_scale || null,
      knownPipelineMw: enrichment.known_pipeline_mw || null,
      websiteUrl: enrichment.website_url || null,
      websiteDescription: enrichment.website_description || null,
      // Investor preferences
      sentiment: enrichment.sentiment || null,
      investorPhase: enrichment.inv_phase || null,
      ticketSize: enrichment.ticket_size || null,
      assetTypes: enrichment.asset_types || [],
      investmentCriteria: enrichment.inv_criteria || null,
      nextAction: enrichment.next_action || null,
      dealsMentioned: enrichment.deals_mentioned || [],
      investorSubtype: enrichment.inv_subtipo || null,
      // Airtable pipeline
      opportunity,
    };
  });
}

/** Extract unique employees from the dataset */
export function getEmployees(companies) {
  const map = new Map();
  for (const c of companies) {
    for (const emp of c.employees) {
      if (!map.has(emp)) {
        map.set(emp, { id: emp, name: emp.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()), count: 0 });
      }
      map.get(emp).count++;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * Score every company against each product definition from PRODUCTS.
 * Returns a Map<companyIdx, productMatch[]> where each match has:
 *   { id, name, score (0-100), signals[] }
 */
export function calculateProductMatches(companies) {
  const results = new Map();

  for (const c of companies) {
    const ctx = (c.detail?.context || "").toLowerCase();
    const subjectsText = (c.detail?.subjects || []).join(" ").toLowerCase();
    const searchText = ctx + " " + subjectsText;
    const contactRoles = (c.detail?.contacts || []).map(ct => (ct.role || "").toLowerCase());

    // If company has IA-classified products, use those directly
    if (c.productosIA && c.productosIA.length > 0) {
      const confScores = { alta: 90, media: 60, baja: 30 };
      const IA_NAME_MAP = {
        "prestamo construccion": "Debt",
        "refinanciacion": "Debt",
        "colocacion inversores": "Equity",
        "advisory / m&a": "Equity",
        "debt": "Debt",
        "equity": "Equity",
      };
      const bestByProduct = new Map();
      for (const pia of c.productosIA) {
        const normalizedName = normalize(pia.p);
        const mappedName = IA_NAME_MAP[normalizedName];
        const product = mappedName
          ? PRODUCTS.find(p => p.name === mappedName)
          : PRODUCTS.find(p => normalize(p.name) === normalizedName);
        if (product) {
          const score = confScores[pia.c] || 60;
          const existing = bestByProduct.get(product.id);
          if (!existing || score > existing.score) {
            bestByProduct.set(product.id, {
              id: product.id,
              name: product.name,
              short: product.short,
              color: product.color,
              score,
              signals: [{ type: "ia_classification", value: `Gemini: ${pia.c}` }],
            });
          }
        }
      }
      const iaMatches = Array.from(bestByProduct.values());
      if (iaMatches.length > 0) {
        iaMatches.sort((a, b) => b.score - a.score);
        results.set(c.idx, iaMatches);
        continue;
      }
    }

    const matches = [];

    for (const product of PRODUCTS) {
      let score = 0;
      const signals = [];

      // --- Keyword scoring on context + subjects (max 40) ---
      let kwScore = 0;
      const seenKw = new Set();
      for (const kw of product.keywords.high) {
        if (searchText.includes(kw.toLowerCase()) && !seenKw.has(kw)) {
          kwScore += 10;
          seenKw.add(kw);
          signals.push({ type: "keyword_high", value: kw });
        }
      }
      for (const kw of product.keywords.medium) {
        if (searchText.includes(kw.toLowerCase()) && !seenKw.has(kw)) {
          kwScore += 4;
          seenKw.add(kw);
          signals.push({ type: "keyword_med", value: kw });
        }
      }
      for (const kw of product.keywords.low) {
        if (searchText.includes(kw.toLowerCase()) && !seenKw.has(kw)) {
          kwScore += 1;
          seenKw.add(kw);
          signals.push({ type: "keyword_low", value: kw });
        }
      }
      score += Math.min(40, kwScore);

      // --- Market Role match (max 25, replaces sector+relType) ---
      const roleMatch = product.dealRoles.some(dr => c.marketRoles.includes(dr));
      if (roleMatch) {
        score += 25;
        const matchedRoles = product.dealRoles.filter(dr => c.marketRoles.includes(dr));
        signals.push({ type: "marketRole", value: matchedRoles.join(", ") });
      }

      // --- Role/Group bonus (max 10) ---
      if ((product.roleBonus && c.role === product.roleBonus) ||
          (product.groupBonus && c.group === product.groupBonus)) {
        score += 10;
        signals.push({ type: "group", value: c.role || c.group });
      }

      // --- Contact role match (max 15) ---
      let roleScore = 0;
      for (const role of contactRoles) {
        for (const pRole of product.roles) {
          if (role.includes(pRole.toLowerCase())) {
            roleScore += 5;
            signals.push({ type: "role", value: role });
            break;
          }
        }
      }
      score += Math.min(15, roleScore);

      // --- Business line bonus (max 15) ---
      if (product.id === "debt" && c.businessLines?.length > 0) {
        const debtLines = ["Utility-scale developer", "IPP", "EPC / Construcción",
                            "Almacenamiento / BESS", "Agrovoltaica"];
        const matchedLines = c.businessLines.filter(bl => debtLines.includes(bl));
        if (matchedLines.length > 0) {
          score += Math.min(15, matchedLines.length * 5);
          signals.push({ type: "business_line", value: matchedLines.join(", ") });
        }
      }
      if (product.id === "equity" && c.businessLines?.length > 0) {
        const equityLines = ["Utility-scale developer", "IPP", "Trading / PPA"];
        const matchedLines = c.businessLines.filter(bl => equityLines.includes(bl));
        if (matchedLines.length > 0) {
          score += Math.min(15, matchedLines.length * 5);
          signals.push({ type: "business_line", value: matchedLines.join(", ") });
        }
      }

      // --- Pipeline MW bonus (max 10) ---
      if (c.knownPipelineMw && c.knownPipelineMw > 0) {
        const mwBonus = c.knownPipelineMw >= 500 ? 10 : c.knownPipelineMw >= 100 ? 7 : 3;
        score += mwBonus;
        signals.push({ type: "pipeline_mw", value: `${c.knownPipelineMw} MW` });
      }

      // --- Activity bonus: recent + high volume (max 10) ---
      if (c.monthsAgo <= 6 && c.interactions > 100) {
        score += 10;
        signals.push({ type: "activity", value: `${c.interactions} emails, ${c.monthsAgo}m ago` });
      } else if (c.monthsAgo <= 12 && c.interactions > 50) {
        score += 5;
      }

      if (score > 0) {
        matches.push({
          id: product.id,
          name: product.name,
          short: product.short,
          color: product.color,
          score: Math.min(100, score),
          signals,
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    results.set(c.idx, matches);
  }

  return results;
}

/** Get the best product match for a company (or null) */
export function getBestProductMatch(productMatches, companyIdx) {
  const matches = productMatches.get(companyIdx);
  if (!matches || matches.length === 0) return null;
  return matches[0];
}

/**
 * Assign a priority rank and label to a contact based on their role.
 * 1 = CEO/CFO  2 = Financiación Estructurada  3 = M&A
 * 4 = Other known role  5 = Unknown / No identificado
 */
function contactPriority(role) {
  const r = (role || "").toLowerCase().trim();
  if (/\bceo\b|\bcfo\b/.test(r)) return { rank: 1, label: "CEO/CFO" };
  if (r.includes("financiaci") && r.includes("estructurada")) return { rank: 2, label: "Financiación Estructurada" };
  if (/\bm&a\b|\bm\s*&\s*a\b/.test(r)) return { rank: 3, label: "M&A" };
  if (!r || r === "no identificado") return { rank: 5, label: "Cargo desconocido" };
  return { rank: 4, label: role };
}

/** Split a full name into { nombre, apellidos }. */
function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { nombre: "", apellidos: "" };
  const nombre = parts[0];
  const apellidos = parts.slice(1).join(" ");
  return { nombre, apellidos };
}

/** Export filtered companies to Airtable-compatible CSV. */
export function downloadCSV(companies, productMatches) {
  const headers = [
    "Empresa", "Dominio", "Role", "Segment", "Type",
    "Nº Contactos", "Total Interacciones",
    "Primera Interacción", "Última Interacción",
    "Estado", "Score", "Score Volumen", "Score Recencia", "Score Red", "Score Grupo",
    "Buzones", "Market Roles",
    "Pipeline Airtable", "Pipeline Stage",
    "Producto Match", "Producto Score",
    "Contactos - Nombre", "Contactos - Apellidos", "Contactos - Email",
    "Contactos - Cargo", "Contactos - Prioridad",
    "Contexto",
  ];

  const rows = companies.map(c => {
    const rawContacts = c.detail?.contacts || [];
    const sorted = [...rawContacts].sort((a, b) =>
      contactPriority(a.role).rank - contactPriority(b.role).rank
    );

    const nombres    = sorted.map(ct => splitName(ct.name).nombre).join("; ");
    const apellidos  = sorted.map(ct => splitName(ct.name).apellidos).join("; ");
    const emails     = sorted.map(ct => ct.email || "").join("; ");
    const cargos     = sorted.map(ct => ct.role || "Cargo desconocido").join("; ");
    const prioridades = sorted.map(ct => contactPriority(ct.role).label).join("; ");

    const bestProduct = productMatches ? getBestProductMatch(productMatches, c.idx) : null;

    return [
      c.name, c.domain, c.role, c.segment, c.companyType,
      c.nContacts, c.interactions,
      c.firstDate, c.lastDate,
      { active: "Activa", dormant: "Dormida", lost: "Perdida" }[c.status],
      c.score, c.volScore, c.recScore, c.netScore, c.groupScore,
      c.employees.join(", "), (c.marketRoles || []).join(", "),
      c.opportunity ? "Si" : "No", c.opportunity?.stage || "",
      bestProduct?.name || "", bestProduct?.score || 0,
      nombres, apellidos, emails, cargos, prioridades,
      c.detail?.context || "",
    ];
  });

  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = "alter5_empresas_scored.csv"; a.click();
  URL.revokeObjectURL(url);
}
