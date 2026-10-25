var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var TZ_MS = 7 * 3600 * 1e3;
var MAX_PHOTO_CHARS = 7e5;
var MAX_THUMB_CHARS = 12e4;
var MAX_BODY_CHARS = 9e5;
var dayKey = /* @__PURE__ */ __name((ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10), "dayKey");
var SCHEMA = [
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
var schemaReady = null;
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
__name(ensureSchema, "ensureSchema");
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}
__name(json, "json");
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(safeEqual, "safeEqual");
var cleanText = /* @__PURE__ */ __name((v, max) => typeof v === "string" ? v.trim().slice(0, max) : "", "cleanText");
var isPhoto = /* @__PURE__ */ __name((v) => typeof v === "string" && v.startsWith("data:image/jpeg;base64,") && v.length <= MAX_PHOTO_CHARS, "isPhoto");
var isThumb = /* @__PURE__ */ __name((v) => typeof v === "string" && v.startsWith("data:image/jpeg;base64,") && v.length <= MAX_THUMB_CHARS, "isThumb");
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
__name(publicRow, "publicRow");
async function readJson(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return { error: "body_too_large" };
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "bad_request" };
    return { data };
  } catch {
    return { error: "bad_request" };
  }
}
__name(readJson, "readJson");
function originAllowed(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
__name(originAllowed, "originAllowed");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (!env.TEAM_CODE) return json({ error: "server_not_configured" }, 500);
      const body = ["POST", "PUT", "PATCH"].includes(request.method) ? await readJson(request) : null;
      if (body && body.error) return json({ error: body.error }, body.error === "body_too_large" ? 413 : 400);
      if (url.pathname === "/api/session") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        if (!originAllowed(request)) return json({ error: "forbidden_origin" }, 403);
        const code2 = cleanText(body.data.code, 200);
        return safeEqual(code2, env.TEAM_CODE) ? json({ ok: true }) : json({ error: "unauthorized" }, 401);
      }
      const code = request.headers.get("x-team-code") || "";
      if (!safeEqual(code, env.TEAM_CODE)) return json({ error: "unauthorized" }, 401);
      await ensureSchema(env);
      if (url.pathname === "/api/attendance" && request.method === "GET") {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : dayKey(Date.now());
        const { results } = await env.DB.prepare("SELECT * FROM attendance WHERE work_date = ? ORDER BY check_in_at ASC").bind(date).all();
        return json({ date, records: results.map((r) => publicRow(r)) });
      }
      if (url.pathname === "/api/recent" && request.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
        const { results } = await env.DB.prepare("SELECT * FROM attendance ORDER BY check_in_at DESC LIMIT ?").bind(limit).all();
        return json({ records: results.map((r) => publicRow(r)) });
      }
      if (url.pathname === "/api/attendance" && request.method === "POST") {
        if (!originAllowed(request)) return json({ error: "forbidden_origin" }, 403);
        const name = cleanText(body.data.name, 80);
        const shift = cleanText(body.data.shift, 40);
        const status = cleanText(body.data.status, 40);
        const photo = body.data.photo;
        const thumb = body.data.thumb;
        if (!name || !shift || !status) return json({ error: "missing_fields" }, 400);
        if (!isPhoto(photo)) return json({ error: "bad_photo" }, 400);
        if (!isThumb(thumb)) return json({ error: "bad_thumb" }, 400);
        const now = Date.now();
        const workDate = dayKey(now);
        const open = await env.DB.prepare("SELECT id FROM attendance WHERE name = ? AND work_date = ? AND check_out_at IS NULL LIMIT 1").bind(name, workDate).first();
        if (open) return json({ error: "already_checked_in", id: open.id }, 409);
        const id = crypto.randomUUID();
        const checkInAt = new Date(now).toISOString();
        await env.DB.prepare(`INSERT INTO attendance (id, name, shift, status, work_date, check_in_at, photo_in, thumb_in)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, name, shift, status, workDate, checkInAt, photo, thumb).run();
        const row = await env.DB.prepare("SELECT * FROM attendance WHERE id = ?").bind(id).first();
        return json({ record: publicRow(row, true) }, 201);
      }
      const checkoutMatch = url.pathname.match(/^\/api\/attendance\/([^/]+)\/checkout$/);
      if (checkoutMatch && request.method === "POST") {
        if (!originAllowed(request)) return json({ error: "forbidden_origin" }, 403);
        const id = decodeURIComponent(checkoutMatch[1]);
        const photo = body.data.photo;
        const thumb = body.data.thumb;
        if (!isPhoto(photo)) return json({ error: "bad_photo" }, 400);
        if (!isThumb(thumb)) return json({ error: "bad_thumb" }, 400);
        const row = await env.DB.prepare("SELECT * FROM attendance WHERE id = ?").bind(id).first();
        if (!row) return json({ error: "not_found" }, 404);
        if (row.check_out_at) return json({ error: "already_checked_out", record: publicRow(row, true) }, 409);
        const now = Date.now();
        if (row.work_date !== dayKey(now)) return json({ error: "not_today" }, 409);
        await env.DB.prepare("UPDATE attendance SET check_out_at = ?, photo_out = ?, thumb_out = ? WHERE id = ? AND check_out_at IS NULL").bind(new Date(now).toISOString(), photo, thumb, id).run();
        const updated = await env.DB.prepare("SELECT * FROM attendance WHERE id = ?").bind(id).first();
        return json({ record: publicRow(updated, true) });
      }
      const detailMatch = url.pathname.match(/^\/api\/attendance\/([^/]+)$/);
      if (detailMatch && request.method === "GET") {
        const id = decodeURIComponent(detailMatch[1]);
        const row = await env.DB.prepare("SELECT * FROM attendance WHERE id = ?").bind(id).first();
        if (!row) return json({ error: "not_found" }, 404);
        return json({ record: publicRow(row, true) });
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error("api_error", err && err.message);
      return json({ error: "server_error" }, 500);
    }
  }
};

// ../../../AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-VdU1Gt/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-VdU1Gt/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
