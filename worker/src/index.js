// Cloud backup for the What to Watch app.
// Stores one JSON document per backup password (hashed) in the D1 database "tvseries".
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Backup-Code',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname !== '/api/data') {
      // Everything else is the app itself (index.html etc.), served from the repo's files.
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('What to Watch backup is running.', { headers: CORS });
    }

    const code = (request.headers.get('X-Backup-Code') || '').trim();
    if (code.length < 6 || code.length > 200) return json({ error: 'bad code' }, 400);
    const id = await sha256('tvseries:' + code);

    try {
      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)'
      ).run();

      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT data, updated FROM backups WHERE id = ?1').bind(id).first();
        if (!row) return json({ found: false });
        return json({ found: true, updated: row.updated, data: JSON.parse(row.data) });
      }

      if (request.method === 'PUT') {
        const body = await request.text();
        if (body.length > 1500000) return json({ error: 'too large' }, 413);
        try { JSON.parse(body); } catch (e) { return json({ error: 'bad json' }, 400); }
        const updated = Date.now();
        await env.DB.prepare(
          'INSERT INTO backups (id, data, updated) VALUES (?1, ?2, ?3) ' +
          'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated'
        ).bind(id, body, updated).run();
        return json({ ok: true, updated });
      }
      return json({ error: 'method not allowed' }, 405);
    } catch (e) {
      return json({ error: 'server error' }, 500);
    }
  },
};
