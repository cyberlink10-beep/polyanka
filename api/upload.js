/**
 * Image upload via ImgBB API.
 * Free, no Vercel Blob limits.
 *
 * To rotate the API key without code change:
 *   set env var IMGBB_API_KEY in Vercel project settings.
 */

const ADMIN_PASSWORD = 'geroi2025';
const FALLBACK_IMGBB_KEY = 'e80e4c453cc59e425c38554f9917236d';

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '8mb',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers['x-admin-password'];
  if (auth !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.IMGBB_API_KEY || FALLBACK_IMGBB_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'IMGBB_API_KEY not configured' });
  }

  // Read raw body
  const chunks = [];
  try {
    for await (const c of req) chunks.push(c);
  } catch (e) {
    return res.status(400).json({ error: 'Failed to read body: ' + e.message });
  }
  const body = Buffer.concat(chunks);
  if (!body.length) return res.status(400).json({ error: 'Empty body' });

  // Suggested filename from header
  let suggested = req.headers['x-filename'];
  try { suggested = suggested ? decodeURIComponent(suggested) : ''; } catch { suggested = ''; }
  const safeName = String(suggested || 'upload')
    .replace(/[^A-Za-z0-9._\-]/g, '_')
    .slice(-80) || 'upload';

  // ImgBB expects base64 in URL-encoded form body
  const base64 = body.toString('base64');
  const form = new URLSearchParams();
  form.append('image', base64);
  form.append('name', safeName.replace(/\.[^.]+$/, '')); // strip extension

  try {
    const r = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const j = await r.json();
    if (!r.ok || !j?.success) {
      return res.status(502).json({
        error: 'ImgBB upload failed',
        status: r.status,
        details: j?.error?.message || j?.status_txt || 'unknown',
      });
    }
    // Use the original `url` (highest-resolution direct link)
    const url = j.data?.url || j.data?.display_url || j.data?.image?.url;
    if (!url) {
      return res.status(502).json({ error: 'ImgBB response missing url', response: j.data });
    }
    return res.status(200).json({
      ok: true,
      url,
      thumbnail: j.data?.thumb?.url,
      size: body.length,
      provider: 'imgbb',
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
