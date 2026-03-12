/**
 * Gemini AI client — browser-side calls to Gemini API.
 * Used for summarizing meeting notes and extracting tasks from prospects.
 */

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export function isGeminiConfigured() {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  return !!(key && key.trim().length > 0);
}

function getApiKey() {
  return (import.meta.env.VITE_GEMINI_API_KEY || "").trim();
}

export async function callGemini(prompt, temperature = 0.3) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("VITE_GEMINI_API_KEY no configurada");

  const url = `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini no devolvio respuesta");
  return text;
}

/**
 * Generate an executive summary from meeting notes.
 */
export async function summarizeMeetingNotes(notes, prospectName) {
  const prompt = `Eres un analista de deal origination en una empresa de financiacion de energias renovables (Alter5).

Genera un RESUMEN EJECUTIVO breve (max 5 lineas) de las siguientes notas de reunion con el prospect "${prospectName}".

Enfocate en:
- Tipo de proyecto/oportunidad
- Tamano estimado del deal
- Intereses y necesidades del prospect
- Nivel de urgencia/interes
- Puntos clave de la conversacion

Notas de reunion:
${notes}

Responde SOLO con el resumen, sin encabezados ni formato markdown.`;

  return callGemini(prompt, 0.3);
}

/**
 * Extract actionable tasks from meeting notes.
 * Returns JSON array of tasks.
 */
export async function extractTasksFromNotes(notes, prospectName) {
  const prompt = `Eres un analista de deal origination en Alter5 (financiacion energias renovables).

De las siguientes notas de reunion con "${prospectName}", extrae los PROXIMOS PASOS como tareas accionables.

Para cada tarea indica:
- "text": descripcion breve de la tarea (imperativo, ej: "Enviar NDA a legal")
- "assignedTo": persona responsable si se menciona, o "" si no
- "dueDate": fecha limite si se menciona (formato YYYY-MM-DD), o "" si no

Responde UNICAMENTE con un JSON array valido, sin markdown, sin explicaciones.
Ejemplo: [{"text":"Enviar NDA","assignedTo":"Salvador","dueDate":"2026-03-05"}]

Si no hay proximos pasos claros, responde: []

Notas de reunion:
${notes}`;

  const raw = await callGemini(prompt, 0.2);

  // Parse JSON from response (strip markdown fences if present)
  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    const tasks = JSON.parse(cleaned);
    if (!Array.isArray(tasks)) return [];
    return tasks.map((t) => ({
      id: "task_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: t.text || "",
      status: "pendiente",
      assignedTo: t.assignedTo || "",
      dueDate: t.dueDate || "",
      createdAt: new Date().toISOString(),
    }));
  } catch {
    console.warn("Failed to parse Gemini tasks response:", cleaned);
    return [];
  }
}

// ── Cerebro AI ──────────────────────────────────────────────────────────────

import { fetchRelevantKnowledge, saveKnowledge } from "./airtableCerebro";

const STOP_WORDS = new Set([
  // Articles, prepositions, pronouns
  "a", "de", "el", "la", "los", "las", "un", "una", "que", "en", "con",
  "por", "para", "del", "al", "es", "no", "si", "se", "lo", "le", "me",
  "nos", "quien", "como", "donde", "cuando", "cuales", "cuantos", "hay",
  "tiene", "tienen", "hemos", "fue", "son", "esta", "este", "estan",
  "que", "quien", "como", "donde", "cuando", "cuales", "mas", "muy",
  // Conversational / question meta-words
  "dame", "dime", "muestrame", "lista", "listado", "todos", "todas",
  "empresas", "empresa", "cual", "cuantas", "sobre", "entre",
  "desde", "hasta", "pero", "sin", "ser", "estar", "han", "haber",
  "sido", "era", "eso", "esa", "ese", "estos", "estas", "esos", "esas",
  "otro", "otra", "otros", "otras", "todo", "toda", "cada", "mismo",
  "algo", "algun", "alguna", "algunos", "algunas", "bien", "mal",
  "asi", "aqui", "ahi", "alli", "ahora", "antes", "despues", "hoy",
  "solo", "aun", "menos", "tan", "tanto", "tanta",
  "nuestro", "nuestra", "nuestros", "nuestras",
  "hecho", "hacer", "hace", "hacen", "hizo",
  "puede", "pueden", "podemos", "podria", "deberia",
  "quiero", "quiere", "necesito", "necesita",
  "buscar", "busca", "encontrar", "mostrar", "muestra", "ver",
  "mail", "mails", "email", "emails", "correo", "correos",
  "analizar", "analizando", "analisis", "revisar", "revisando",
  "informacion", "info", "datos", "dato", "resultado", "resultados",
]);

/**
 * Cerebro AI: natural-language question over the full company dataset.
 * Phase 1: local keyword search to find top 30 matches.
 * Phase 2: send context to Gemini for a structured answer.
 *
 * @param {string} question
 * @param {Array} companies — full parsed companies array
 * @returns {{ answer: string, matchedCompanies: Array }}
 */
export async function queryCerebro(question, companies) {
  // Phase 1 — keyword extraction (normalize accents, filter stop words)
  const keywords = question
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/\W+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  if (keywords.length === 0) {
    return {
      answer: "No he podido extraer terminos de busqueda de tu pregunta. Intenta reformularla.",
      matchedCompanies: [],
    };
  }

  // Build keyword variants for simple stemming (plural handling)
  // "sheets" -> ["sheets", "sheet"], "inversiones" -> ["inversiones", "inversion"]
  const keywordVariants = keywords.map(kw => {
    const variants = [kw];
    if (kw.endsWith("s")) variants.push(kw.slice(0, -1));
    if (kw.endsWith("es") && kw.length > 4) variants.push(kw.slice(0, -2));
    return variants;
  });

  // Score each company against keywords (any variant match counts)
  const scored = companies.map(c => {
    const fields = [
      c.name || "",
      c.domain || "",
      c.group || "",
      c.companyType || "",
      c.sectors || "",
      c.detail?.context || "",
      ...(c.senales || []),
      ...(c.marketRoles || []),
      (c.productosIA || []).map(p => p.p || "").join(" "),
      c.detail?.enrichment?.fc || "",
      c.detail?.enrichment?.st || "",
      ...(c.detail?.subjects || []),
      ...(c.detail?.datedSubjects || []).map(ds => (ds.subject || "") + " " + (ds.extract || "")),
      ...(c.detail?.timeline || []).map(t => t.summary || ""),
    ];
    const text = fields.join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const score = keywordVariants.reduce((s, variants) =>
      s + (variants.some(v => text.includes(v)) ? 1 : 0), 0);
    return { company: c, score };
  }).filter(s => s.score > 0);

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      answer: "No he encontrado empresas que coincidan con tu busqueda. Prueba con otros terminos.",
      matchedCompanies: [],
    };
  }

  // Keep ALL matches for company cards, send top 50 to Gemini for analysis
  const allMatches = scored.map(m => m.company);
  const topForGemini = scored.slice(0, 50);

  // Phase 2 — fetch relevant past Q&A from knowledge base (non-blocking on error)
  let knowledgeContext = "";
  try {
    const pastKnowledge = await fetchRelevantKnowledge(keywords, 5);
    if (pastKnowledge.length > 0) {
      knowledgeContext = "\n\nCONTEXTO DE CONSULTAS ANTERIORES (base de conocimiento del equipo):\n" +
        pastKnowledge.map((k, i) =>
          `${i + 1}. Pregunta: "${k.question}" (${k.matchCount} empresas encontradas)\n   Respuesta: ${k.answer.slice(0, 400)}${k.answer.length > 400 ? "..." : ""}`
        ).join("\n");
    }
  } catch (err) {
    console.warn("Knowledge base fetch failed (continuing without):", err.message);
  }

  // Phase 3 — build context for Gemini (compact to fit more companies)
  const contextEmpresas = topForGemini.map(({ company: c }) => ({
    empresa: c.name,
    dominio: c.domain,
    grupo: c.group,
    tipo: c.companyType,
    market_roles: c.marketRoles,
    fase: c.detail?.enrichment?.fc || "",
    subtipo: c.detail?.enrichment?.st || "",
    productos: c.productosIA || [],
    senales: c.senales || [],
    contexto: (c.detail?.context || "").slice(0, 200),
    interacciones: c.interactions,
    ultima_fecha: c.lastDate,
    estado: c.status,
  }));

  const prompt = `Eres el asistente de inteligencia comercial de Alter5, una fintech espanola de financiacion de proyectos renovables.

El usuario pregunta: "${question}"

He encontrado ${allMatches.length} empresas relevantes en la base de datos (${companies.length} total). Te muestro las ${topForGemini.length} con mas coincidencias:

${JSON.stringify(contextEmpresas, null, 1)}
${knowledgeContext}

INSTRUCCIONES:
- Responde de forma clara, estructurada y directa a la pregunta
- Menciona que se han encontrado ${allMatches.length} empresas relevantes en total
- Si hay multiples resultados, lista las mas importantes con: nombre, dato clave, y contexto
- Agrupa por categorias si tiene sentido (por tipo, por fase, por estado, etc.)
- Usa los datos reales de las empresas (no inventes)
- Si tienes contexto de consultas anteriores, usalo para dar una respuesta mas completa y coherente con lo que el equipo ya ha preguntado
- Si no hay suficiente informacion para responder con certeza, dilo
- Responde en espanol
- NO uses formato markdown con #. Usa texto plano con saltos de linea`;

  const rawAnswer = await callGemini(prompt, 0.2);
  const answer = rawAnswer.trim();

  // Phase 4 — save Q&A to knowledge base (fire-and-forget, don't block the response)
  const matchedDomains = allMatches.map(c => c.domain);
  const savePromise = saveKnowledge({
    question,
    answer,
    keywords,
    matchedDomains,
    matchCount: allMatches.length,
  }).catch(() => null);

  // Return result immediately; recordId resolves shortly after
  return { answer, matchedCompanies: allMatches, savePromise };
}

/**
 * Generate AI prospect intelligence from CRM data.
 * Analyzes company email history, enrichment, and context to produce
 * a structured summary and suggested next steps.
 */
export async function generateProspectIntelligence(
  prospectName: string,
  company: any,
  existingContext: string = "",
): Promise<{ summary: string; suggestedNextSteps: string[] }> {
  const enrichment = company?.detail?.enrichment || {};
  const datedSubjects = (company?.detail?.datedSubjects || []).slice(0, 30);
  const context = company?.detail?.context || "";
  const employees = company?.detail?.employees || {};

  // Build per-employee breakdown
  const employeeLines = Object.entries(employees)
    .map(([empKey, empData]: [string, any]) => {
      const name = empKey.replace(/_/g, " ");
      const count = empData?.count || 0;
      const subjects = (empData?.subjects || []).slice(0, 5).join("; ");
      return `  - ${name}: ${count} emails${subjects ? ` | Asuntos: ${subjects}` : ""}`;
    })
    .join("\n");

  // Build dated subjects block
  const subjectsBlock = datedSubjects
    .map((ds: any) => {
      const date = ds.date || "";
      const subject = ds.subject || "";
      const extract = ds.extract ? ` — ${ds.extract.slice(0, 200)}` : "";
      return `  [${date}] ${subject}${extract}`;
    })
    .join("\n");

  const prompt = `Eres un analista senior de deal origination en Alter5 (financiacion de energias renovables en Espana).

Analiza los datos CRM de la siguiente empresa y genera una ficha de inteligencia comercial.

=== DATOS DEL PROSPECT ===
Nombre: ${prospectName}
Dominio: ${company?.domain || ""}
Grupo/Tipo: ${company?.group || ""} / ${company?.companyType || ""}
Segmento: ${enrichment?.st || ""}
Fase de inversion: ${enrichment?.fc || ""}
Descripcion empresa: ${enrichment?.description || ""}
Tecnologias: ${(enrichment?.technologies || []).join(", ")}
Geografia: ${enrichment?.geography || ""}
Roles de mercado: ${(company?.marketRoles || []).join(", ")}

=== HISTORIAL DE COMUNICACIONES (ultimas interacciones) ===
Total interacciones: ${company?.interactions || 0}
Ultima fecha: ${company?.lastDate || ""}

${subjectsBlock ? `Ultimos asuntos de email:\n${subjectsBlock}` : ""}

=== DESGLOSE POR EMPLEADO ===
${employeeLines || "Sin datos de empleados"}

=== CONTEXTO ADICIONAL ===
${context || "Sin contexto adicional"}

${existingContext ? `=== NOTAS PREVIAS DEL EQUIPO ===\n${existingContext}` : ""}

=== INSTRUCCIONES ===
1. Analiza si este prospect es REAL o un FALSO POSITIVO (ej: proveedor de servicios, herramienta SaaS, intermediario sin proyecto real, etc.)
2. Si hay un intermediario (broker, asesor, fondo de fondos), identifica quien es el beneficiario final real
3. Genera un resumen ejecutivo estructurado con:
   - Naturaleza de la relacion y tipo de oportunidad
   - Historico de comunicaciones y nivel de engagement
   - Posicion en el funnel de origination
   - Riesgos o alertas detectadas
4. Sugiere proximos pasos concretos y accionables

Responde UNICAMENTE con un JSON valido con esta estructura exacta:
{
  "is_prospect": true,
  "summary": "Texto del resumen ejecutivo estructurado con saltos de linea para legibilidad. Si es falso positivo, indicar FALSO POSITIVO al inicio.",
  "suggested_next_steps": ["Paso 1", "Paso 2", "Paso 3"]
}`;

  const raw = await callGemini(prompt, 0.2);
  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary || "",
      suggestedNextSteps: Array.isArray(parsed.suggested_next_steps) ? parsed.suggested_next_steps : [],
    };
  } catch {
    console.warn("Failed to parse Gemini prospect intelligence response:", cleaned);
    // Return raw text as summary if JSON parsing fails
    return { summary: cleaned, suggestedNextSteps: [] };
  }
}

/**
 * Attempt to fetch text content from a public Google Doc.
 * Only works with publicly shared docs (CORS limitations).
 */
export async function fetchGoogleDocText(url) {
  // Use the Vercel serverless proxy to bypass CORS
  const proxyUrl = `/api/fetch-gdoc?url=${encodeURIComponent(url)}`;

  const res = await fetch(proxyUrl);
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data.error || `Error al descargar documento (${res.status})`);
  }

  if (!data.text || !data.text.trim()) {
    throw new Error("El documento esta vacio o no se pudo leer.");
  }

  return data.text;
}
