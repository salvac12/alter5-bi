// Test 1: async function (minimal)
export default async function handler(req, res) {
  return res.status(200).json({ ok: true, node: process.version, async: true });
}
