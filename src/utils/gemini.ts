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
 * Call Gemini with Google Search grounding enabled.
 * Used when no CRM data is available — searches the web for company info.
 * Returns concatenated text from all response parts.
 */
export async function callGeminiWithGrounding(prompt: string, temperature = 0.3): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("VITE_GEMINI_API_KEY no configurada");

  const url = `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature },
      tools: [{ google_search: {} }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  // Concatenate all text parts (grounding may return multiple)
  const text = parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join("\n");
  if (!text) throw new Error("Gemini no devolvio respuesta");
  return text;
}

// ── Stage-specific prompts for Prospect Intelligence ─────────────────────

import { PROSPECT_STAGES } from './airtableProspects';

export const STAGE_PROMPTS: Record<string, string> = {
  "Lead": `FASE ACTUAL: Lead (cualificacion inicial)

ENFOQUE DE ANALISIS:
- Evalua si este lead es REAL o un FALSO POSITIVO (proveedor SaaS, intermediario sin proyecto, etc.)
- Identifica la contraparte real (si hay intermediario, quien es el beneficiario final)
- Evalua el potencial: tipo de proyecto, tamano estimado, encaje con Alter5
- Detecta gaps de informacion criticos que impiden cualificar
- Valora la urgencia y el timing del lead

RECOMENDACION DE FASE:
- Si hay suficiente informacion y el lead es real, recomienda avanzar a "Interesado"
- Si faltan datos basicos, recomienda mantener en "Lead" y pedir mas info
- Si es falso positivo, indicalo claramente`,

  "Interesado": `FASE ACTUAL: Interesado (engagement activo)

ENFOQUE DE ANALISIS:
- Evalua el nivel de engagement: frecuencia de contacto, quien toma la iniciativa, temas tratados
- Identifica senales de avance (piden mas info, comparten docs, presentan equipo)
- Identifica senales de riesgo (ghosting, respuestas vagas, piden solo info sin comprometerse)
- Mapea stakeholders: quien decide, quien influye, quien bloquea
- Evalua si hay un proyecto concreto o solo interes generico

RECOMENDACION DE FASE:
- Si hay proyecto concreto y quieren reunion, recomienda "Reunion"
- Si el engagement es bajo o hay riesgo, recomienda mantener en "Interesado"
- Si se ha perdido el contacto, recomienda volver a "Lead"`,

  "Reunion": `FASE ACTUAL: Reunion (preparacion o seguimiento de reunion)

ENFOQUE DE ANALISIS:
- Evalua la historia de la relacion y el contexto de la(s) reunion(es)
- Identifica los temas clave a tratar o ya tratados
- Sugiere proximos pasos concretos post-reunion
- Evalua la posicion negociadora de Alter5 (fortalezas, debilidades, alternativas del prospect)
- Identifica a los participantes clave y su rol en la decision

RECOMENDACION DE FASE:
- Si la reunion fue productiva y hay docs pendientes, recomienda "Documentacion Pendiente"
- Si necesitan mas reuniones, recomienda mantener en "Reunion"
- Si no hubo avance, recomienda volver a "Interesado"`,

  "Documentacion Pendiente": `FASE ACTUAL: Documentacion Pendiente (due diligence)

ENFOQUE DE ANALISIS:
- Evalua que documentos se han recibido vs cuales faltan (NDA, teaser, modelo financiero, etc.)
- Identifica blockers: que impide avanzar, quien debe actuar
- Evalua el timeline: cuanto tiempo llevan pendientes los docs, hay deadline
- Detecta riesgo de attrition: el prospect se esta enfriando, hay competencia
- Sugiere acciones para desbloquear (reclamar, ofrecer ayuda, escalar)

RECOMENDACION DE FASE:
- Si toda la documentacion esta completa, recomienda "Listo para Term-Sheet"
- Si faltan docs pero hay avance, mantener en "Documentacion Pendiente"
- Si hay bloqueo prolongado, considerar volver a "Reunion" para reactivar`,

  "Listo para Term-Sheet": `FASE ACTUAL: Listo para Term-Sheet (decision final)

ENFOQUE DE ANALISIS:
- Genera un BRIEFING EJECUTIVO completo:
  * Tipo de operacion (Project Finance, Corporate Debt, etc.)
  * Tamano estimado del deal y estructura propuesta
  * Activo subyacente (tecnologia, ubicacion, MW)
  * Geografia y regulacion aplicable
- Metricas clave: TIR estimada, ratio de cobertura, plazo
- Riesgos principales: regulatorio, construccion, contraparte, mercado
- Fortalezas del deal: sponsor, tecnologia, contratos, garantias
- Estructura financiera recomendada

RECOMENDACION DE FASE:
- En esta fase, no recomiendas mover a otra fase sino que te enfocas en el briefing para la decision de inversion`,
};

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
  prospectData?: { product?: string; stage?: string; contacts?: { name: string; email: string; role: string }[]; notes?: string; amount?: string; origin?: string; assignedTo?: string },
): Promise<{ summary: string; suggestedNextSteps: string[]; suggestedStage: string | null }> {
  const enrichment = company?.detail?.enrichment || {};
  const datedSubjects = (company?.detail?.datedSubjects || []).slice(0, 30);
  const context = company?.detail?.context || "";
  const employees = company?.detail?.employees || {};
  const currentStage = prospectData?.stage || "Lead";

  // Select stage-specific prompt
  const stagePrompt = STAGE_PROMPTS[currentStage] || STAGE_PROMPTS["Lead"];

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

  // Build prospect-specific data block (when no CRM company matched)
  const prospectBlock = prospectData ? `
=== DATOS DEL PROSPECT (Airtable) ===
Producto: ${prospectData.product || "No especificado"}
Fase: ${prospectData.stage || "Lead"}
Importe: ${prospectData.amount || "No especificado"}
Origen: ${prospectData.origin || "No especificado"}
Asignado a: ${prospectData.assignedTo || "No asignado"}
${prospectData.contacts?.length ? `Contactos:\n${prospectData.contacts.map(c => `  - ${c.name || "?"} <${c.email || "?"}> — ${c.role || "sin rol"}`).join("\n")}` : "Sin contactos"}
${prospectData.notes ? `Notas del equipo:\n${prospectData.notes}` : ""}` : "";

  const hasCRM = !!(company?.domain || company?.interactions);

  const prompt = `Eres un analista senior de deal origination en Alter5 (financiacion de energias renovables en Espana).

${stagePrompt}

${hasCRM ? "Analiza los datos CRM de la siguiente empresa y genera una ficha de inteligencia comercial adaptada a la fase actual." : "No hay datos CRM historicos. Basa tu analisis en la informacion del prospect disponible."}

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
${prospectBlock}
${hasCRM ? `=== HISTORIAL DE COMUNICACIONES (ultimas interacciones) ===
Total interacciones: ${company?.interactions || 0}
Ultima fecha: ${company?.lastDate || ""}

${subjectsBlock ? `Ultimos asuntos de email:\n${subjectsBlock}` : ""}

=== DESGLOSE POR EMPLEADO ===
${employeeLines || "Sin datos de empleados"}

=== CONTEXTO ADICIONAL ===
${context || "Sin contexto adicional"}` : ""}

${existingContext ? `=== NOTAS PREVIAS DEL EQUIPO ===\n${existingContext}` : ""}

=== INSTRUCCIONES ===
1. Analiza si este prospect es REAL o un FALSO POSITIVO (ej: proveedor de servicios, herramienta SaaS, intermediario sin proyecto real, etc.)
2. Si hay un intermediario (broker, asesor, fondo de fondos), identifica quien es el beneficiario final real
3. Genera un resumen ejecutivo estructurado adaptado a la fase "${currentStage}" con:
   - Naturaleza de la relacion y tipo de oportunidad
${hasCRM ? "   - Historico de comunicaciones y nivel de engagement" : "   - Informacion disponible y gaps de datos"}
   - Analisis especifico de la fase actual (segun las instrucciones de la fase)
   - Riesgos o alertas detectadas
4. Sugiere proximos pasos concretos y accionables
5. Recomienda la fase mas adecuada (puede ser la actual u otra)

Las fases validas son: "Lead", "Interesado", "Reunion", "Documentacion Pendiente", "Listo para Term-Sheet"

Responde UNICAMENTE con un JSON valido con esta estructura exacta:
{
  "is_prospect": true,
  "summary": "Texto del resumen ejecutivo estructurado con saltos de linea para legibilidad. Si es falso positivo, indicar FALSO POSITIVO al inicio.",
  "suggested_next_steps": ["Paso 1", "Paso 2", "Paso 3"],
  "suggested_stage": "Interesado"
}`;

  // Use grounding (web search) when no CRM data available
  let raw: string;
  if (!hasCRM) {
    try {
      raw = await callGeminiWithGrounding(prompt, 0.2);
    } catch {
      // Fallback to normal call if grounding fails
      raw = await callGemini(prompt, 0.2);
    }
  } else {
    raw = await callGemini(prompt, 0.2);
  }

  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    // Validate suggestedStage against known stages
    let suggestedStage: string | null = parsed.suggested_stage || null;
    if (suggestedStage && !PROSPECT_STAGES.includes(suggestedStage)) {
      suggestedStage = null;
    }
    return {
      summary: parsed.summary || "",
      suggestedNextSteps: Array.isArray(parsed.suggested_next_steps) ? parsed.suggested_next_steps : [],
      suggestedStage,
    };
  } catch {
    console.warn("Failed to parse Gemini prospect intelligence response:", cleaned);
    return { summary: cleaned, suggestedNextSteps: [], suggestedStage: null };
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
