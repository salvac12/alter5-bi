// Test 9: Just check ALLOWED_ORIGIN value
export default function handler(req, res) {
  const raw = process.env.ALLOWED_ORIGIN;
  return res.status(200).json({
    hasAllowedOrigin: raw !== undefined,
    type: typeof raw,
    length: raw ? raw.length : 0,
    value: raw || '(not set)',
    charCodes: raw ? Array.from(raw).slice(0, 50).map(c => c.charCodeAt(0)) : [],
  });
}
