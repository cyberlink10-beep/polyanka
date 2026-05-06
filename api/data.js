import { createClient } from 'redis';

const KEY = 'site-data';
const ADMIN_PASSWORD = 'geroi2025';

let _client = null;
let _err = null;

async function getClient() {
  if (_client && _client.isOpen) return _client;
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) {
    _err = 'REDIS_URL not set. Available: ' + (Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|STORAGE/i.test(k)).join(', ') || '(none)');
    return null;
  }
  try {
    _client = createClient({
      url,
      socket: { connectTimeout: 7000, reconnectStrategy: false },
    });
    _client.on('error', e => { console.error('Redis error:', e?.message); });
    await _client.connect();
    _err = null;
    return _client;
  } catch (e) {
    _err = String(e?.message || e);
    _client = null;
    return null;
  }
}

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

async function readState() {
  const c = await getClient();
  if (!c) return {};
  try {
    const raw = await c.get(KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
async function writeState(obj) {
  const c = await getClient();
  if (!c) throw new Error(_err || 'Redis not configured');
  await c.set(KEY, JSON.stringify(obj));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      noStore(res);
      const url0 = new URL(req.url, 'http://x');
      if (url0.searchParams.get('debug') === '1') {
        const c = await getClient();
        const envKeys = Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|STORAGE/i.test(k));
        const data = c ? await readState() : {};
        return res.status(200).json({
          backend: 'node-redis',
          key: KEY,
          redisConfigured: !!c,
          redisError: _err,
          envKeys,
          keyCount: Object.keys(data).length,
          keys: Object.keys(data),
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
          // Korpuses: merge by id, deep-merge floorPolygons
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
          // Plain objects (e.g. geroi_settings, geroi_about, geroi_infra, geroi_footer): shallow merge
          merged[k] = { ...ex, ...inc };
        } else {
          // Arrays without id semantics, primitives, etc — replace
          merged[k] = inc;
        }
      }

      await writeState(merged);
      noStore(res);
      return res.status(200).json({
        ok: true,
        backend: 'node-redis',
        keys: Object.keys(merged),
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
