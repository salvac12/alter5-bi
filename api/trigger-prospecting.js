/**
 * Vercel serverless proxy for triggering GitHub Actions prospecting workflow.
 * Keeps GITHUB_TOKEN server-side only (NOT prefixed with VITE_).
 *
 * Env vars (server-side only):
 *   GITHUB_TOKEN            — GitHub PAT with repo dispatch scope
 *   CAMPAIGN_PROXY_SECRET   — shared secret between browser ↔ proxy
 */

const GITHUB_REPO = "salvac12/alter5-bi";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify shared secret
  const secret = req.headers["x-proxy-secret"] || "";
  const expectedSecret = process.env.CAMPAIGN_PROXY_SECRET || "";
  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return res.status(500).json({ error: "GITHUB_TOKEN not configured on server" });
  }

  const { criteria, jobId } = req.body || {};
  if (!criteria || !jobId) {
    return res.status(400).json({ error: "Missing criteria or jobId" });
  }

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        event_type: "run-prospecting",
        client_payload: {
          criteria: JSON.stringify(criteria),
          jobId,
        },
      }),
    });

    if (!ghRes.ok && ghRes.status !== 204) {
      const errText = await ghRes.text();
      return res.status(ghRes.status).json({ error: `GitHub API error: ${errText}` });
    }

    return res.status(200).json({ success: true, jobId });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
