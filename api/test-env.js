export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    hasAirtablePat: !!process.env.AIRTABLE_PAT,
    hasProxySecret: !!process.env.CAMPAIGN_PROXY_SECRET,
    hasGasUrl: !!process.env.GAS_WEB_APP_URL,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    nodeVersion: process.version,
  });
}
