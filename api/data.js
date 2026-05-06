/**
 * Site data API — Supabase Postgres backend.
 * Stores everything as a single row in `kv` table: { key: 'site-data', value: jsonb }.
 *
 * Required env vars (set in Vercel):
 *   SUPABASE_URL          https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role JWT
 */

const KEY = 'site-data';
const ADMIN_PASSWORD = 'geroi2025';

function getEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key };
}

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

async function readState() {
  const { url, key } = getEnv();
  if (!url || !key) return {};
  try {
    const r = await fetch(`${url}/rest/v1/kv?key=eq.${KEY}&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return {};
    const rows = await r.json();
    if (!rows.length) return {};
    return rows[0].value || {};
  } catch (e) {
    return {};
  }
}

async function writeState(obj) {
  const { url, key } = getEnv();
  if (!url || !key) throw new Error('Supabase env not set');
  // Upsert via Prefer: resolution=merge-duplicates
  const r = await fetch(`${url}/rest/v1/kv`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{ key: KEY, value: obj }]),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Supabase upsert failed: ${r.status} ${text}`);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      noStore(res);
      const url0 = new URL(req.url, 'http://x');
      if (url0.searchParams.get('debug') === '1') {
        const { url, key } = getEnv();
        const data = await readState();
        return res.status(200).json({
          backend: 'supabase',
          configured: !!(url && key),
          envKeys: Object.keys(process.env).filter(k => /SUPABASE|REDIS|KV|UPSTASH|STORAGE/i.test(k)),
          keys: Object.keys(data),
          keyCount: Object.keys(data).length,
        });
      }
      const data = await readState();
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
      const existing = isReplace ? {} : await readState();

      const merged = { ...existing };
      for (const k of Object.keys(incoming)) {
        const ex = existing[k];
        const inc = incoming[k];
        if (k === 'geroi_korpuses' && Array.isArray(ex) && Array.isArray(inc)) {
          // Korpuses: merge by id, deep-merge floorPolygons + floorSchemas
          const byId = new Map(ex.map(x => [x.id, x]));
          for (const x of inc) {
            const old = byId.get(x.id);
            if (old) {
              byId.set(x.id, {
                ...old,
                ...x,
                floorPolygons: { ...(old.floorPolygons || {}), ...(x.floorPolygons || {}) },
                floorSchemas:  { ...(old.floorSchemas  || {}), ...(x.floorSchemas  || {}) },
              });
            } else {
              byId.set(x.id, x);
            }
          }
          merged[k] = Array.from(byId.values()).sort((a, b) => (a.id || 0) - (b.id || 0));
        } else if (ex && typeof ex === 'object' && !Array.isArray(ex) && inc && typeof inc === 'object' && !Array.isArray(inc)) {
          // Plain objects: shallow merge
          merged[k] = { ...ex, ...inc };
        } else {
          merged[k] = inc;
        }
      }

      await writeState(merged);
      noStore(res);
      return res.status(200).json({
        ok: true,
        backend: 'supabase',
        keys: Object.keys(merged),
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
