// NOC Check-in — attendance API + static assets
// Cloudflare Worker with a D1 binding (env.DB) and a team code (env.TEAM_CODE).

const TZ_MS = 7 * 3600 * 1000; // Asia/Bangkok (no DST)
const MAX_PHOTO_CHARS = 700_000; // ~300KB binary (base64)
const MAX_THUMB_CHARS = 120_000;
const MAX_BODY_CHARS = 900_000;

const dayKey = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS attendance (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     shift TEXT,
     status TEXT,
     work_date TEXT NOT NULL,
     check_in_at TEXT NOT NULL,
     check_out_at TEXT,
     photo_in TEXT,
     thumb_in TEXT,
     photo_out TEXT,
     thumb_out TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (work_date)`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_name_date ON attendance (name, work_date)`
];

let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const sql of SCHEMA) await env.DB.prepare(sql).run();
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const cleanText = (v, max) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const isPhoto = (v) =>
  typeof v === 'string' &&
  v.startsWith('data:image/jpeg;base64,') &&
  v.length <= MAX_PHOTO_CHARS;

const isThumb = (v) =>
  typeof v === 'string' &&
  v.startsWith('data:image/jpeg;base64,') &&
  v.length <= MAX_THUMB_CHARS;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL || '';

function publicRow(row, withPhotos = false) {
  const out = {
    id: row.id,
    name: row.name,
    shift: row.shift,
    status: row.status,
    workDate: row.work_date,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    thumbIn: row.thumb_in || null,
    thumbOut: row.thumb_out || null
  };
  if (withPhotos) {
    out.photoIn = row.photo_in || null;
    out.photoOut = row.photo_out || null;
  }
  return out;
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return { error: 'body_too_large' };
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'bad_request' };
    return { data };
  } catch {
    return { error: 'bad_request' };
  }
}

// Same-origin check for mutations (defence in depth on top of the team-code header).
function originAllowed(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin GETs from some clients omit it
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (!env.TEAM_CODE) return json({ error: 'server_not_configured' }, 500);

      const body = ['POST', 'PUT', 'PATCH'].includes(request.method) ? await readJson(request) : null;
      if (body && body.error) return json({ error: body.error }, body.error === 'body_too_large' ? 413 : 400);

      if (url.pathname === '/api/session') {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        if (!originAllowed(request)) return json({ error: 'forbidden_origin' }, 403);
        const code = cleanText(body.data.code, 200);
        return safeEqual(code, env.TEAM_CODE)
          ? json({ ok: true })
          : json({ error: 'unauthorized' }, 401);
      }

      const code = request.headers.get('x-team-code') || '';
      if (!safeEqual(code, env.TEAM_CODE)) return json({ error: 'unauthorized' }, 401);

      await ensureSchema(env);

      if (url.pathname === '/api/attendance' && request.method === 'GET') {
        const all = url.searchParams.get('all');
        if (all === '1') {
          const from = url.searchParams.get('from') || '';
          const to = url.searchParams.get('to') || '';
          let sql = 'SELECT * FROM attendance';
          const params = [];
          if (from || to) {
            sql += ' WHERE 1=1';
            if (from) { sql += ' AND work_date >= ?'; params.push(from); }
            if (to)   { sql += ' AND work_date <= ?'; params.push(to); }
          }
          sql += ' ORDER BY work_date DESC, check_in_at DESC';
          const { results } = await env.DB.prepare(sql).bind(...params).all();
          return json({ records: results.map((r) => publicRow(r)) });
        }
        const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '')
          ? url.searchParams.get('date')
          : dayKey(Date.now());
        const { results } = await env.DB
          .prepare('SELECT * FROM attendance WHERE work_date = ? ORDER BY check_in_at ASC')
          .bind(date)
          .all();
        return json({ date, records: results.map((r) => publicRow(r)) });
      }

      if (url.pathname === '/api/recent' && request.method === 'GET') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
        const { results } = await env.DB
          .prepare('SELECT * FROM attendance ORDER BY check_in_at DESC LIMIT ?')
          .bind(limit)
          .all();
        return json({ records: results.map((r) => publicRow(r)) });
      }

      if (url.pathname === '/api/attendance' && request.method === 'POST') {
        if (!originAllowed(request)) return json({ error: 'forbidden_origin' }, 403);
        const name = cleanText(body.data.name, 80);
        const shift = cleanText(body.data.shift, 40);
        const status = cleanText(body.data.status, 40);
        const photo = body.data.photo;
        const thumb = body.data.thumb;
        if (!name || !shift || !status) return json({ error: 'missing_fields' }, 400);
        if (!isPhoto(photo)) return json({ error: 'bad_photo' }, 400);
        if (!isThumb(thumb)) return json({ error: 'bad_thumb' }, 400);

        const now = Date.now();
        const workDate = dayKey(now);
        const open = await env.DB
          .prepare('SELECT id FROM attendance WHERE name = ? AND work_date = ? AND check_out_at IS NULL LIMIT 1')
          .bind(name, workDate)
          .first();
        if (open) return json({ error: 'already_checked_in', id: open.id }, 409);

        const id = crypto.randomUUID();
        const checkInAt = new Date(now).toISOString();
        await env.DB
          .prepare(`INSERT INTO attendance (id, name, shift, status, work_date, check_in_at, photo_in, thumb_in)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, name, shift, status, workDate, checkInAt, photo, thumb)
          .run();
        const row = await env.DB.prepare('SELECT * FROM attendance WHERE id = ?').bind(id).first();
        return json({ record: publicRow(row, true) }, 201);
      }

      const checkoutMatch = url.pathname.match(/^\/api\/attendance\/([^/]+)\/checkout$/);
      if (checkoutMatch && request.method === 'POST') {
        if (!originAllowed(request)) return json({ error: 'forbidden_origin' }, 403);
        const id = decodeURIComponent(checkoutMatch[1]);
        const photo = body.data.photo;
        const thumb = body.data.thumb;
        if (!isPhoto(photo)) return json({ error: 'bad_photo' }, 400);
        if (!isThumb(thumb)) return json({ error: 'bad_thumb' }, 400);

        const row = await env.DB.prepare('SELECT * FROM attendance WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'not_found' }, 404);
        if (row.check_out_at) return json({ error: 'already_checked_out', record: publicRow(row, true) }, 409);
        const now = Date.now();
        if (row.work_date !== dayKey(now)) return json({ error: 'not_today' }, 409);

        await env.DB
          .prepare('UPDATE attendance SET check_out_at = ?, photo_out = ?, thumb_out = ? WHERE id = ? AND check_out_at IS NULL')
          .bind(new Date(now).toISOString(), photo, thumb, id)
          .run();
        const updated = await env.DB.prepare('SELECT * FROM attendance WHERE id = ?').bind(id).first();
        return json({ record: publicRow(updated, true) });
      }

      const detailMatch = url.pathname.match(/^\/api\/attendance\/([^/]+)$/);
      if (detailMatch && request.method === 'GET') {
        const id = decodeURIComponent(detailMatch[1]);
        const row = await env.DB.prepare('SELECT * FROM attendance WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'not_found' }, 404);
        return json({ record: publicRow(row, true) });
      }

      // POST /api/notify/discord — server-side Discord webhook dispatch
      if (url.pathname === '/api/notify/discord' && request.method === 'POST') {
        const payload = body?.data;
        if (!payload || !payload.embed || !payload.image) {
          return json({ error: 'missing_fields' }, 400);
        }
        try {
          const formData = new FormData();
          const imgBytes = atob(payload.image.split(',')[1] || '');
          const u8 = new Uint8Array(imgBytes.length);
          for (let i = 0; i < imgBytes.length; i++) u8[i] = imgBytes.charCodeAt(i);
          formData.append('files[0]', new Blob([u8], { type: 'image/jpeg' }), 'checkin.jpg');
          formData.append('payload_json', JSON.stringify({ embeds: [payload.embed] }));
          const resp = await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', body: formData });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return json({ ok: true });
        } catch (err) {
          console.error('discord_notify_error', err?.message);
          return json({ error: 'discord_fail' }, 502);
        }
      }

      // POST /api/notify/teams — server-side Teams webhook dispatch
      if (url.pathname === '/api/notify/teams' && request.method === 'POST') {
        const payload = body?.data;
        if (!payload?.card) return json({ error: 'missing_fields' }, 400);
        try {
          const resp = await fetch(TEAMS_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: payload.card }] })
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return json({ ok: true });
        } catch (err) {
          console.error('teams_notify_error', err?.message);
          return json({ error: 'teams_fail' }, 502);
        }
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error('api_error', err && err.message);
      return json({ error: 'server_error' }, 500);
    }
  }
};
