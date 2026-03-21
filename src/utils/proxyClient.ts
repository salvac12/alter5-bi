/**
 * Shared proxy client for server-side API calls.
 * All sensitive API calls go through Vercel serverless proxies.
 *
 * - Airtable calls -> /api/airtable-proxy (AIRTABLE_PAT stays server-side)
 * - Gemini calls   -> /api/gemini-proxy   (GEMINI_API_KEY stays server-side)
 *
 * The only client-side env var is VITE_CAMPAIGN_PROXY_SECRET, which is a
 * shared key between browser and proxy (not a sensitive secret).
 */

function getProxySecret(): string {
  return import.meta.env.VITE_CAMPAIGN_PROXY_SECRET || '';
}

/** Check if the proxy secret is configured (proxy calls will work) */
export function isProxyConfigured(): boolean {
  return !!getProxySecret();
}

const defaultHeaders = () => ({
  'Content-Type': 'application/json',
  'x-proxy-secret': getProxySecret(),
});

// -- Airtable Proxy ----------------------------------------------------------

export async function airtableProxy(params: {
  table: string;
  method?: string;
  recordId?: string;
  fields?: Record<string, any>;
  records?: Array<{ id?: string; fields: Record<string, any> }>;
  formula?: string;
  pageSize?: number;
  offset?: string;
  sort?: string;
  fieldsList?: string[];
}): Promise<any> {
  const res = await fetch('/api/airtable-proxy', {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => `(unreadable, status ${res.status})`);
    throw new Error(`Airtable proxy ${res.status}: ${body.slice(0, 300)}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`Airtable proxy returned non-JSON (${res.status})`);
  }
}

// -- Gemini Proxy -------------------------------------------------------------

export async function geminiProxy(prompt: string, temperature = 0.3, model = 'gemini-2.5-flash', tools?: any[]): Promise<any> {
  const body: any = { prompt, temperature, model };
  if (tools) body.tools = tools;

  const res = await fetch('/api/gemini-proxy', {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini proxy ${res.status}: ${body}`);
  }
  return res.json();
}
