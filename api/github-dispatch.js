/**
 * Vercel serverless proxy for GitHub Actions dispatch.
 * Calls GitHub API server-side using GITHUB_TOKEN (fine-grained PAT).
 *
 * Env vars (server-side only):
 *   GITHUB_TOKEN           — fine-grained PAT with Actions write permission
 *   CAMPAIGN_PROXY_SECRET  — shared secret between browser ↔ proxy
 */

const GITHUB_REPO = "salvac12/alter5-bi";

export default async function handler(req, res) {
  // CORS
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://alter5-bi.vercel.app";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-proxy-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Validate proxy secret
  const secret = req.headers["x-proxy-secret"];
  const expected = process.env.CAMPAIGN_PROXY_SECRET;
  if (!expected || secret !== expected) {
    return res.status(403).json({ error: "Invalid proxy secret" });
  }

  const { criteria, jobId } = req.body || {};
  if (!criteria || !jobId) {
    return res.status(400).json({ error: "Missing criteria or jobId" });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return res.status(500).json({ error: "GITHUB_TOKEN not configured on server" });
  }

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          event_type: "run-prospecting",
          client_payload: {
            criteria: typeof criteria === "string" ? criteria : JSON.stringify(criteria),
            jobId,
          },
        }),
      }
    );

    if (ghRes.status === 204) {
      return res.status(200).json({ success: true, jobId });
    }

    const errText = await ghRes.text();
    return res.status(ghRes.status).json({
      error: `GitHub dispatch failed (${ghRes.status})`,
      detail: errText,
    });
  } catch (err) {
    return res.status(502).json({ error: "GitHub request failed: " + err.message });
  }
}
