import rawData from '../data/companies.json';
import { TYPE_WEIGHTS, REF_DATE } from './constants';

/**
 * Record: [empresa, dominio, sector, nContactos, totalInteracciones,
 *          tipoRelacion, primeraInteraccion, ultimaInteraccion, employeeSources]
 * Detail: [[contacts], [timeline], contexto, [[empId, interactions], ...]]
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
    const types = r[5].split(", ");
    const typeScore = Math.max(...types.map(t => TYPE_WEIGHTS[t] || 2));
    const score = volScore + recScore + netScore + typeScore;

    const employees = r[8] ? r[8].split(",").filter(Boolean) : [];

    const det = rawData.d[String(i)];
    const detail = det ? {
      contacts: det[0].map(c => ({ name: c[0], role: c[1], email: c[2] || "" })),
      timeline: det[1].map(t => ({ quarter: t[0], emails: t[1] })),
      context: det[2],
      sources: det[3] ? det[3].map(s => ({ employee: s[0], interactions: s[1] })) : [],
    } : null;

    return {
      idx: i, name: r[0], domain: r[1], sectors: r[2], nContacts: r[3],
      interactions: r[4], relType: r[5], firstDate: r[6], lastDate: r[7],
      employees, status, score, volScore, recScore, netScore, typeScore,
      monthsAgo: Math.round(monthsAgo), detail,
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

/** Split a full name into { nombre, apellidos }.
 *  "Salvador Carrillo Ruiz" → { nombre: "Salvador", apellidos: "Carrillo Ruiz" }
 */
function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { nombre: "", apellidos: "" };
  const nombre = parts[0];
  const apellidos = parts.slice(1).join(" ");
  return { nombre, apellidos };
}

/** Export filtered companies to Airtable-compatible CSV.
 *  Contacts are sorted by priority (CEO/CFO > Fin.Estructurada > M&A > Otros > Desconocido)
 *  and exported as semicolon-separated columns: Nombre · Apellidos · Email · Cargo · Prioridad
 */
export function downloadCSV(companies) {
  const headers = [
    "Empresa", "Dominio", "Sector", "Nº Contactos", "Total Interacciones",
    "Tipo Relación", "Primera Interacción", "Última Interacción",
    "Estado", "Score", "Score Volumen", "Score Recencia", "Score Red", "Score Tipo",
    "Buzones",
    "Contactos - Nombre", "Contactos - Apellidos", "Contactos - Email",
    "Contactos - Cargo", "Contactos - Prioridad",
    "Contexto",
  ];

  const rows = companies.map(c => {
    const rawContacts = c.detail?.contacts || [];

    // Sort contacts by priority rank (ascending = highest first)
    const sorted = [...rawContacts].sort((a, b) =>
      contactPriority(a.role).rank - contactPriority(b.role).rank
    );

    const nombres    = sorted.map(ct => splitName(ct.name).nombre).join("; ");
    const apellidos  = sorted.map(ct => splitName(ct.name).apellidos).join("; ");
    const emails     = sorted.map(ct => ct.email || "").join("; ");
    const cargos     = sorted.map(ct => ct.role || "Cargo desconocido").join("; ");
    const prioridades = sorted.map(ct => contactPriority(ct.role).label).join("; ");

    return [
      c.name, c.domain, c.sectors, c.nContacts, c.interactions,
      c.relType, c.firstDate, c.lastDate,
      { active: "Activa", dormant: "Dormida", lost: "Perdida" }[c.status],
      c.score, c.volScore, c.recScore, c.netScore, c.typeScore,
      c.employees.join(", "),
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
