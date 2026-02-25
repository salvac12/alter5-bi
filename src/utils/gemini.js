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

async function callGemini(prompt, temperature = 0.3) {
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
