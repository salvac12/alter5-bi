/**
 * Vercel serverless proxy to fetch public Google Docs as plain text.
 * Bypasses CORS restrictions that block browser-side fetches.
 *
 * Usage: GET /api/fetch-gdoc?url=https://docs.google.com/document/d/XXXX/edit
 */
module.exports = async function handler(req, res) {
  // CORS headers
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://alter5-bi.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Validate proxy secret to prevent open SSRF
  const secret = req.headers['x-proxy-secret'] || req.query.secret;
  const expected = process.env.CAMPAIGN_PROXY_SECRET;
  if (!expected || secret !== expected) {
    return res.status(403).json({ error: 'Invalid proxy secret' });
  }

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Falta parametro ?url=' });

  // Validate that the URL is specifically a Google Docs URL
  if (!url.startsWith('https://docs.google.com/')) {
    return res.status(400).json({ error: 'Solo se permiten URLs de Google Docs' });
  }

  // Extract doc ID
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return res.status(400).json({ error: 'URL de Google Doc no valida' });

  const docId = match[1];
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

  try {
    const response = await fetch(exportUrl, { redirect: 'follow' });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return res.status(403).json({
          error: 'El documento no es publico. Comparte el doc con "Cualquiera con el enlace" y vuelve a intentar.',
        });
      }
      return res.status(response.status).json({ error: `Google respondio con ${response.status}` });
    }

    const text = await response.text();

    // Sanity check — Google sometimes returns HTML login page instead of doc content
    if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
      return res.status(403).json({
        error: 'El documento no es publico. Google devolvio una pagina de login en vez del contenido.',
      });
    }

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: 'Error al descargar documento: ' + err.message });
  }
}
