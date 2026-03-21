// Verify Google ID token and return user info. Env: GOOGLE_CLIENT_ID

export default async function handler(req, res) {
  // CORS — allow all origins for auth verification
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured on server' });
    }

    // Verify token with Google's tokeninfo endpoint
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
    );

    if (!verifyRes.ok) {
      const errText = await verifyRes.text().catch(() => 'unknown');
      return res.status(401).json({ error: `Google rejected token: ${errText}` });
    }

    const payload = await verifyRes.json();

    // Audience must match our client ID
    if (payload.aud !== clientId) {
      return res.status(401).json({
        error: `Audience mismatch: token aud=${payload.aud}, expected=${clientId}`,
      });
    }

    // Restrict access to @alter-5.com domain only
    const email = payload.email || '';
    if (!email.endsWith('@alter-5.com')) {
      return res.status(403).json({ error: `Solo cuentas @alter-5.com (got ${email})` });
    }

    return res.status(200).json({
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      hd: payload.hd,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + (err.message || String(err)) });
  }
}
