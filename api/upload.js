/**
 * Image upload via Supabase Storage.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY  (service_role JWT)
 * Optional:
 *   SUPABASE_BUCKET       (default: 'images')
 */

const ADMIN_PASSWORD = 'geroi2025';
const DEFAULT_BUCKET = 'images';

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

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET || DEFAULT_BUCKET;
  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase env not set (SUPABASE_URL / SUPABASE_SERVICE_KEY)' });
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

  // Filename
  let suggested = req.headers['x-filename'];
  try { suggested = suggested ? decodeURIComponent(suggested) : ''; } catch { suggested = ''; }
  const safeName = String(suggested || 'upload')
    .replace(/[^A-Za-z0-9._\-]/g, '_')
    .slice(-80) || 'upload';
  const ext = safeName.includes('.') ? safeName.slice(safeName.lastIndexOf('.')) : '';
  const base = ext ? safeName.slice(0, safeName.lastIndexOf('.')) : safeName;
  const path = `uploads/${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const contentType = req.headers['content-type'] || 'application/octet-stream';

  try {
    // Upload to bucket
    const r = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': contentType,
        'Cache-Control': '3600',
      },
      body,
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: 'Supabase storage upload failed', status: r.status, details: text });
    }
    const publicUrl = `${url}/storage/v1/object/public/${bucket}/${path}`;
    return res.status(200).json({
      ok: true,
      url: publicUrl,
      path,
      bucket,
      size: body.length,
      provider: 'supabase',
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
