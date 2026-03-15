/**
 * Verifies Google ID token and returns user info.
 * Env: GOOGLE_CLIENT_ID
 */
export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://alter5-bi.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' });

  try {
    // Verify with Google's tokeninfo endpoint (simpler than importing google-auth-library)
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    if (!verifyRes.ok) return res.status(401).json({ error: 'Invalid token' });

    const payload = await verifyRes.json();

    // Verify audience matches our client ID
    if (payload.aud !== clientId) {
      return res.status(401).json({ error: 'Token audience mismatch' });
    }

    // Restrict to @alter-5.com domain
    const email = payload.email || '';
    if (!email.endsWith('@alter-5.com')) {
      return res.status(403).json({ error: 'Solo se permiten cuentas @alter-5.com' });
    }

    return res.status(200).json({
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      hd: payload.hd, // hosted domain
    });
  } catch (err) {
    return res.status(500).json({ error: 'Token verification failed: ' + err.message });
  }
}
