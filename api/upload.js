import { put } from '@vercel/blob';

const ADMIN_PASSWORD = 'geroi2025';

export const config = {
  api: {
    bodyParser: false, // we want the raw binary body
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

  // Allow caller to suggest a filename via x-filename header (URL-encoded)
  let suggested = req.headers['x-filename'];
  try { suggested = suggested ? decodeURIComponent(suggested) : ''; } catch { suggested = ''; }
  const safeName = String(suggested || 'upload')
    .replace(/[^A-Za-z0-9._\-]/g, '_')
    .slice(-80) || 'upload';
  const ext = safeName.includes('.') ? safeName.slice(safeName.lastIndexOf('.')) : '.bin';
  const base = safeName.includes('.') ? safeName.slice(0, safeName.lastIndexOf('.')) : safeName;

  const contentType = req.headers['content-type'] || 'application/octet-stream';

  // Read raw body
  const chunks = [];
  try {
    for await (const c of req) chunks.push(c);
  } catch (e) {
    return res.status(400).json({ error: 'Failed to read body: ' + e.message });
  }
  const body = Buffer.concat(chunks);
  if (!body.length) return res.status(400).json({ error: 'Empty body' });

  // Use random suffix so multiple uploads of same name don't collide
  const filename = `uploads/${base}-${Date.now()}${ext}`;
  try {
    const result = await put(filename, body, {
      access: 'public',
      addRandomSuffix: false,
      contentType,
    });
    return res.status(200).json({
      ok: true,
      url: result.url,
      pathname: result.pathname,
      size: body.length,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
