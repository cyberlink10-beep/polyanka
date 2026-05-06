import { put, list, del } from '@vercel/blob';

const PREFIX = 'site-data-';
const ADMIN_PASSWORD = 'geroi2025';

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

async function readLatestBlob() {
  const { blobs } = await list({ prefix: PREFIX, limit: 100 });
  if (!blobs.length) return { data: {}, blobs: [] };
  const sorted = [...blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const latest = sorted[0];
  // Latest url is brand new each PUT (unique filename), so CDN cannot have stale copy.
  const r = await fetch(latest.url, { cache: 'no-store' });
  if (!r.ok) return { data: {}, blobs: sorted };
  let data = {};
  try { data = await r.json(); } catch {}
  return { data, blobs: sorted };
}

async function cleanupOldBlobs(blobs, keep = 3) {
  // Keep the most recent N, delete older
  if (blobs.length <= keep) return;
  const toDel = blobs.slice(keep);
  await Promise.all(toDel.map(b => del(b.url).catch(() => {})));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      noStore(res);
      const url0 = new URL(req.url, 'http://x');
      if (url0.searchParams.get('debug') === '1') {
        const { blobs } = await list({ prefix: PREFIX, limit: 100 });
        return res.status(200).json({
          PREFIX,
          blobCount: blobs.length,
          blobs: blobs.map(b => ({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt })),
        });
      }
      const { data } = await readLatestBlob();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const auth = req.headers['x-admin-password'];
      if (auth !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      const incoming = JSON.parse(body);
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return res.status(400).json({ error: 'Body must be an object' });
      }

      const url = new URL(req.url, 'http://x');
      const isReplace = url.searchParams.get('replace') === '1';
      const { data: existing, blobs: existingBlobs } = isReplace
        ? { data: {}, blobs: [] }
        : await readLatestBlob();

      // Deep-merge logic for korpuses
      const merged = { ...existing };
      for (const k of Object.keys(incoming)) {
        if (k === 'geroi_korpuses' && Array.isArray(existing[k]) && Array.isArray(incoming[k])) {
          const byId = new Map((existing[k] || []).map(x => [x.id, x]));
          for (const x of incoming[k]) {
            const ex = byId.get(x.id);
            if (ex) {
              byId.set(x.id, {
                ...ex,
                ...x,
                floorPolygons: { ...(ex.floorPolygons || {}), ...(x.floorPolygons || {}) },
              });
            } else {
              byId.set(x.id, x);
            }
          }
          merged[k] = Array.from(byId.values()).sort((a, b) => (a.id || 0) - (b.id || 0));
        } else {
          merged[k] = incoming[k];
        }
      }

      // Write to a NEW filename each time (timestamp-suffixed) — defeats CDN caching on read
      const filename = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
      const putResult = await put(filename, JSON.stringify(merged), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
      });

      // Async cleanup of older files (don't await, fire-and-forget)
      cleanupOldBlobs(existingBlobs, 3).catch(() => {});

      noStore(res);
      return res.status(200).json({
        ok: true,
        keys: Object.keys(merged),
        savedTo: putResult?.pathname,
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
