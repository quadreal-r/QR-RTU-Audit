/**
 * RTU Pictures API — auth + upload to R2 bucket `rtu-pictures`,
 * plus shared audit progress in Supabase (`public.rtu_audit_state`).
 */

const TOKEN_TTL_HOURS = 8;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB

// Audit-state sync limits. A full portfolio is ~1100 RTUs, so a device that has been
// offline for a week still catches up in two pages.
const SYNC_PAGE_SIZE = 1000;
const SYNC_MAX_CHANGES = 500;
const SYNC_MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB
const NOTE_MAX = 4000;
const ALLOWED_ORIGINS = new Set([
  // Desktop browsers. Same first-party app as the shells, just served from elsewhere:
  // leave an origin out and sign-in dies at the preflight, before the password is even
  // checked, which reads to a technician as a rejected password.
  "https://rtu-qr-tracker.quadreal-rpiwin.workers.dev",
  // GitHub Pages copy (quadreal-r/QR-RTU-Audit). Note this origin is shared by every
  // Pages site on that account, so anything published there can reach this API.
  "https://quadreal-r.github.io",
  // Capacitor shells: iOS uses the default `capacitor` scheme, Android follows
  // `androidScheme: 'https'` from capacitor.config.ts.
  "capacitor://localhost",
  "https://localhost",
  // Legacy hand-written shells in legacy-shells/ (WebViewAssetLoader / custom scheme).
  "https://appassets.androidplatform.net",
  "rtuapp://app",
]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  Vary: "Origin",
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Filename, X-Building-Id, X-Rtu-Key, X-Photo-Slot, X-Audit-Year",
    "Access-Control-Max-Age": "86400",
    ...SECURITY_HEADERS,
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(request, data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  return Uint8Array.from(
    atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad),
    (c) => c.charCodeAt(0)
  );
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Constant-time string compare via per-request HMAC digests. */
async function constantTimeEqual(a, b) {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(String(a ?? ""))),
    crypto.subtle.sign("HMAC", key, enc.encode(String(b ?? ""))),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  if (va.length !== vb.length) return false;
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function requireAuthSecret(env) {
  return typeof env.AUTH_SECRET === "string" && env.AUTH_SECRET.length > 0;
}

function tokenEpoch(env) {
  return String(env.TOKEN_EPOCH ?? "1");
}

function randomHex(bytes = 4) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TOKEN_TTL_HOURS * 3600;
  const iat = now;
  const jti = randomHex(16);
  const epoch = tokenEpoch(env);
  const payload = `rtu|${exp}|${iat}|${jti}|${epoch}`;
  const key = await hmacKey(env.AUTH_SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${b64url(new TextEncoder().encode(payload))}.${b64url(sig)}`;
}

async function verifyToken(env, token) {
  if (!token || !requireAuthSecret(env)) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const payload = new TextDecoder().decode(fromB64url(parts[0]));
    const [kind, expStr, iatStr, jti, epoch] = payload.split("|");
    if (kind !== "rtu") return false;
    if (!jti || !iatStr) return false;
    if (epoch !== tokenEpoch(env)) return false;
    const exp = Number(expStr);
    const iat = Number(iatStr);
    if (!exp || !iat || exp * 1000 < Date.now()) return false;
    if (iat > Math.floor(Date.now() / 1000) + 60) return false;
    const key = await hmacKey(env.AUTH_SECRET);
    const sig = fromB64url(parts[1]);
    return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

function bearer(req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function safeKey(name) {
  return String(name || "photo.jpg")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^\w.\- ()]+/g, "_")
    .slice(0, 180);
}

/**
 * Client-supplied identifiers that let the downstream QR East Industrial database
 * join an object back to its RTU without parsing the filename. Untrusted: keep to a
 * conservative ASCII allowlist and a short cap so nothing hostile lands in R2 metadata.
 */
function safeMetaValue(value, max = 64) {
  return String(value || "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, max);
}

function uploadMetadata(request) {
  const meta = {};
  const fields = {
    buildingId: request.headers.get("X-Building-Id"),
    rtuKey: request.headers.get("X-Rtu-Key"),
    slot: request.headers.get("X-Photo-Slot"),
    auditYear: request.headers.get("X-Audit-Year"),
  };
  for (const [name, raw] of Object.entries(fields)) {
    const clean = safeMetaValue(raw);
    if (clean) meta[name] = clean;
  }
  return meta;
}

/**
 * Objects are stored flat at the bucket root to match the existing RTU inventory
 * (`2320-RTU-14 (3) (Audit-2026).jpg`), so re-uploading a photo replaces it in place
 * instead of accumulating duplicates. That means the client chooses the key, so the name
 * must match the audit-photo shape exactly — otherwise a caller could overwrite an
 * unrelated object in a bucket shared with QR East Industrial.
 */
const AUDIT_PHOTO_NAME = /^[A-Za-z0-9]+-[A-Za-z0-9_-]+ \(\d{1,2}\) \(Audit-\d{4}\)\.(jpg|jpeg|png)$/i;

function isAuditPhotoName(name) {
  return AUDIT_PHOTO_NAME.test(name);
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rateLimitOr429(request, limiter, key, periodSec) {
  if (!limiter || typeof limiter.limit !== "function") return null;
  const { success } = await limiter.limit({ key });
  if (success) return null;
  return json(
    request,
    { ok: false, error: "Too many requests" },
    429,
    { "Retry-After": String(periodSec) }
  );
}

/** Sniff JPEG / PNG magic bytes; return canonical MIME or null. */
function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

async function readUploadBody(request, maxBytes) {
  const lenHeader = request.headers.get("Content-Length");
  if (lenHeader == null || lenHeader === "") {
    return { error: json(request, { ok: false, error: "Content-Length required" }, 411) };
  }
  const declared = Number(lenHeader);
  if (!Number.isFinite(declared) || declared < 0) {
    return { error: json(request, { ok: false, error: "Invalid Content-Length" }, 400) };
  }
  if (declared === 0) {
    return { error: json(request, { ok: false, error: "Empty body" }, 400) };
  }
  if (declared > maxBytes) {
    return { error: json(request, { ok: false, error: "Upload too large" }, 413) };
  }

  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    return { error: json(request, { ok: false, error: "Upload too large" }, 413) };
  }
  if (buf.byteLength === 0) {
    return { error: json(request, { ok: false, error: "Empty body" }, 400) };
  }
  return { body: new Uint8Array(buf) };
}

function supabaseReady(env) {
  return (
    typeof env.SUPABASE_URL === "string" &&
    env.SUPABASE_URL.startsWith("https://") &&
    typeof env.SUPABASE_SERVICE_KEY === "string" &&
    env.SUPABASE_SERVICE_KEY.length > 0
  );
}

/**
 * The service key bypasses RLS, so it never leaves the Worker and never appears in a
 * response. Callers get our own error text rather than PostgREST's, which can echo SQL.
 */
async function supabaseCall(env, path, init = {}) {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const res = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) return { error: res.status };
  // Prefer: return=minimal yields an empty body on success — that is not a failure.
  const text = await res.text();
  if (!text) return { data: null };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: 502 };
  }
}

/**
 * Map badge counts come from Supabase `rtu_pictures`, not from a live R2 listing.
 * Until this runs, an Audit upload lands in the bucket but the Industrial map stays
 * stuck on whatever row was there before. Failure here must never fail the upload —
 * the object is already in R2, and a later reconcile can catch up.
 */
function parseAuditPhotoParts(fileName) {
  const m = String(fileName).match(
    /^(\d+)-([A-Za-z0-9_-]+) \((\d{1,2})\) \(Audit-\d{4}\)\.(?:jpg|jpeg|png)$/i
  );
  if (!m) return null;
  return {
    buildingNum: m[1],
    rtuToken: m[2].replace(/_/g, "-"),
    slot: Number(m[3]),
  };
}

function unitCoreFromToken(token) {
  const stripped = String(token || "")
    .replace(/^(?:RTU?S?|RTU#|RT|S)[-_\s#]?/i, "")
    .trim();
  const m = stripped.match(/^0*(\d+)/);
  return m ? String(Number(m[1])) : null;
}

function streetNumber(address) {
  return String(address || "").match(/^\d+/)?.[0] || "";
}

async function registerPictureInMap(env, fileName) {
  if (!supabaseReady(env)) return { ok: false, reason: "no-supabase" };
  const parts = parseAuditPhotoParts(fileName);
  if (!parts || !parts.slot) return { ok: false, reason: "parse" };

  const { data: buildings, error: bErr } = await supabaseCall(
    env,
    `buildings?select=id,address&address=like.${encodeURIComponent(parts.buildingNum + "*")}&limit=50`
  );
  if (bErr || !Array.isArray(buildings) || !buildings.length) {
    return { ok: false, reason: "building" };
  }
  const building = buildings.find((b) => streetNumber(b.address) === parts.buildingNum);
  if (!building) return { ok: false, reason: "building" };

  const { data: rtus, error: rErr } = await supabaseCall(
    env,
    `rtus?select=id,name,building_id&building_id=eq.${encodeURIComponent(building.id)}&limit=500`
  );
  if (rErr || !Array.isArray(rtus) || !rtus.length) {
    return { ok: false, reason: "rtu" };
  }

  const wantCore = unitCoreFromToken(parts.rtuToken);
  const wantToken = parts.rtuToken.toUpperCase();
  let rtu =
    rtus.find((r) => String(r.name || "").replace(/\s+/g, "").toUpperCase() === wantToken) ||
    null;
  if (!rtu && wantCore) {
    const matches = rtus.filter((r) => unitCoreFromToken(r.name) === wantCore);
    if (matches.length === 1) rtu = matches[0];
  }
  if (!rtu) return { ok: false, reason: "rtu" };

  const row = {
    rtu_id: rtu.id,
    building_address: building.address,
    rtu_name: rtu.name,
    file_name: fileName,
    position: Math.max(0, parts.slot - 1),
    hidden: false,
  };
  const { error } = await supabaseCall(
    env,
    "rtu_pictures?on_conflict=building_address,rtu_name,file_name",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([row]),
    }
  );
  if (error) return { ok: false, reason: "upsert", status: error };
  return { ok: true, building: building.address, rtu: rtu.name };
}

const BUILDING_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const RTU_KEY = /^[A-Za-z0-9][A-Za-z0-9 ._()/-]{0,63}$/;

/**
 * Rebuild each change from an allowlist rather than passing the client object through,
 * so unknown keys cannot reach Postgres and a bad row cannot abort the whole batch.
 */
/**
 * Photo slots carry R2 object keys another device will fetch, so each name is held to the
 * same audit-photo shape the upload route enforces. A name that fails is dropped to null
 * rather than stored, so nobody can use sync to point a device at an arbitrary object.
 */
function cleanPhotoFiles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 4).map((entry) => {
    const name = safeKey(entry);
    return entry && isAuditPhotoName(name) ? name : null;
  });
}

function cleanChange(raw, deviceId) {
  if (!raw || typeof raw !== "object") return null;
  const buildingSlug = String(raw.buildingSlug ?? "").trim();
  const rtuKey = String(raw.rtuKey ?? "").trim();
  if (!BUILDING_SLUG.test(buildingSlug) || !RTU_KEY.test(rtuKey)) return null;
  const updatedAt = new Date(raw.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return null;
  return {
    building_slug: buildingSlug,
    rtu_key: rtuKey,
    started: raw.started === true,
    complete: raw.complete === true,
    photos_done: raw.photosDone === true,
    note: String(raw.note ?? "").slice(0, NOTE_MAX),
    updated_at: updatedAt.toISOString(),
    updated_by: deviceId || null,
    photo_files: cleanPhotoFiles(raw.photoFiles),
  };
}

function toClientRow(row) {
  return {
    buildingSlug: row.building_slug,
    rtuKey: row.rtu_key,
    s: row.started === true,
    c: row.complete === true,
    ph: row.photos_done === true,
    n: row.note || "",
    u: row.updated_at,
    by: row.updated_by || "",
    f: Array.isArray(row.photo_files) ? row.photo_files : [],
  };
}

const AUDIT_COLUMNS =
  "building_slug,rtu_key,started,complete,photos_done,note,updated_at,updated_by,photo_files";

async function handleAuditPull(request, env, url) {
  const since = url.searchParams.get("since") || "";
  let filter = "";
  if (since) {
    const at = new Date(since);
    if (Number.isNaN(at.getTime())) {
      return json(request, { ok: false, error: "Invalid since timestamp" }, 400);
    }
    filter = `&updated_at=gt.${encodeURIComponent(at.toISOString())}`;
  }
  const { data, error } = await supabaseCall(
    env,
    `rtu_audit_state?select=${AUDIT_COLUMNS}&order=updated_at.asc&limit=${SYNC_PAGE_SIZE}${filter}`
  );
  if (error) return json(request, { ok: false, error: "Sync unavailable" }, 502);
  const rows = Array.isArray(data) ? data.map(toClientRow) : [];
  return json(request, {
    ok: true,
    rows,
    // The client re-requests from the last row when a page fills up.
    more: rows.length === SYNC_PAGE_SIZE,
    syncedAt: new Date().toISOString(),
  });
}

async function handleAuditPush(request, env) {
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (declared > SYNC_MAX_BODY_BYTES) {
    return json(request, { ok: false, error: "Payload too large" }, 413);
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json(request, { ok: false, error: "Invalid JSON" }, 400);
  }
  if (!Array.isArray(body.changes)) {
    return json(request, { ok: false, error: "changes must be an array" }, 400);
  }
  if (body.changes.length > SYNC_MAX_CHANGES) {
    return json(request, { ok: false, error: "Too many changes in one request" }, 413);
  }

  const deviceId = safeMetaValue(body.deviceId, 64) || null;
  const changes = body.changes.map((c) => cleanChange(c, deviceId)).filter(Boolean);
  if (!changes.length) {
    return json(request, { ok: true, rows: [], accepted: 0, syncedAt: new Date().toISOString() });
  }

  const { data, error } = await supabaseCall(env, "rpc/rtu_audit_state_sync", {
    method: "POST",
    body: JSON.stringify({ changes }),
  });
  if (error) return json(request, { ok: false, error: "Sync unavailable" }, 502);
  return json(request, {
    ok: true,
    rows: Array.isArray(data) ? data.map(toClientRow) : [],
    accepted: changes.length,
    syncedAt: new Date().toISOString(),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "GET" && (path === "/" || path === "/api/health")) {
      return json(request, { ok: true, service: "rtu-pictures-api", bucket: "rtu-pictures" });
    }

    if (path === "/api/login") {
      if (request.method !== "POST") {
        return json(request, { ok: false, error: "Method not allowed" }, 405, {
          Allow: "POST, OPTIONS",
        });
      }

      const limited = await rateLimitOr429(
        request,
        env.LOGIN_LIMITER,
        `login:${clientIp(request)}`,
        60
      );
      if (limited) return limited;

      if (!requireAuthSecret(env)) {
        return json(request, { ok: false, error: "Server misconfigured" }, 500);
      }
      if (!env.AUTH_PASSWORD) {
        return json(request, { ok: false, error: "Server misconfigured" }, 500);
      }

      let body = {};
      try {
        body = await request.json();
      } catch {}
      const password = String(body.password || "");
      const match = await constantTimeEqual(password, env.AUTH_PASSWORD);
      if (!match) {
        return json(request, { ok: false, error: "Invalid password" }, 401);
      }
      const token = await mintToken(env);
      return json(request, { ok: true, token, expiresInHours: TOKEN_TTL_HOURS });
    }

    if (path === "/api/me") {
      if (request.method !== "GET") {
        return json(request, { ok: false, error: "Method not allowed" }, 405, {
          Allow: "GET, OPTIONS",
        });
      }
      if (!requireAuthSecret(env)) {
        return json(request, { ok: false, error: "Server misconfigured" }, 500);
      }
      const ok = await verifyToken(env, bearer(request));
      return ok
        ? json(request, { ok: true, signedIn: true })
        : json(request, { ok: false, signedIn: false }, 401);
    }

    if (path.startsWith("/api/upload/")) {
      if (request.method !== "PUT") {
        return json(request, { ok: false, error: "Method not allowed" }, 405, {
          Allow: "PUT, OPTIONS",
        });
      }

      if (!requireAuthSecret(env)) {
        return json(request, { ok: false, error: "Server misconfigured" }, 500);
      }

      const token = bearer(request);
      const ok = await verifyToken(env, token);
      if (!ok) return json(request, { ok: false, error: "Sign in required" }, 401);

      const uploadKey = await sha256Hex(token);
      const limited = await rateLimitOr429(
        request,
        env.UPLOAD_LIMITER,
        `upload:${uploadKey}`,
        60
      );
      if (limited) return limited;

      let keyName;
      try {
        keyName = decodeURIComponent(path.slice("/api/upload/".length));
      } catch {
        return json(request, { ok: false, error: "Invalid filename encoding" }, 400);
      }

      const key = safeKey(keyName || request.headers.get("X-Filename") || "photo.jpg");
      if (!key) return json(request, { ok: false, error: "Missing filename" }, 400);
      if (!isAuditPhotoName(key)) {
        return json(
          request,
          {
            ok: false,
            error:
              "Filename must look like '2320-RTU-14 (3) (Audit-2026).jpg'",
          },
          400
        );
      }

      const read = await readUploadBody(request, MAX_UPLOAD_BYTES);
      if (read.error) return read.error;

      const contentType = sniffImageType(read.body);
      if (!contentType) {
        return json(
          request,
          { ok: false, error: "Only JPEG and PNG images are allowed" },
          415
        );
      }

      const objectKey = key;
      await env.PICTURES.put(objectKey, read.body, {
        httpMetadata: { contentType },
        customMetadata: {
          originalName: key,
          uploadedAt: new Date().toISOString(),
          ...uploadMetadata(request),
        },
      });
      // Best-effort: keep the Industrial map badge in step with the bucket. A miss
      // here still leaves the object in R2 for a later reconcile.
      let map = null;
      try {
        map = await registerPictureInMap(env, objectKey);
      } catch (_) {
        map = { ok: false, reason: "exception" };
      }
      return json(request, { ok: true, key: objectKey, mapRegistered: !!(map && map.ok) });
    }

    // Photos are taken on one device and viewed on another, so a signed-in device can
    // stream an object back out of R2. Same name allowlist as upload: the key comes from
    // the client, and the bucket is shared with QR East Industrial.
    if (path.startsWith("/api/photo/")) {
      if (request.method !== "GET") {
        return json(request, { ok: false, error: "Method not allowed" }, 405, {
          Allow: "GET, OPTIONS",
        });
      }
      if (!requireAuthSecret(env)) {
        return json(request, { ok: false, error: "Server misconfigured" }, 500);
      }
      const token = bearer(request);
      if (!(await verifyToken(env, token))) {
        return json(request, { ok: false, error: "Sign in required" }, 401);
      }

      const limited = await rateLimitOr429(
        request,
        env.DOWNLOAD_LIMITER,
        `download:${await sha256Hex(token)}`,
        60
      );
      if (limited) return limited;

      let name;
      try {
        name = decodeURIComponent(path.slice("/api/photo/".length));
      } catch {
        return json(request, { ok: false, error: "Invalid filename encoding" }, 400);
      }
      const key = safeKey(name);
      if (!isAuditPhotoName(key)) {
        return json(request, { ok: false, error: "Not an audit photo name" }, 400);
      }

      const object = await env.PICTURES.get(key);
      if (!object) return json(request, { ok: false, error: "Not found" }, 404);

      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
          "Content-Length": String(object.size),
          ...corsHeaders(request),
        },
      });
    }

    if (path === "/api/audit-state") {
      if (request.method !== "GET" && request.method !== "POST") {
        return json(request, { ok: false, error: "Method not allowed" }, 405, {
          Allow: "GET, POST, OPTIONS",
        });
      }
      if (!requireAuthSecret(env)) {
        return json(request, { ok: false, error: "Server misconfigured" }, 500);
      }
      const token = bearer(request);
      if (!(await verifyToken(env, token))) {
        return json(request, { ok: false, error: "Sign in required" }, 401);
      }
      // Fail closed: without Supabase credentials the app stays offline-only rather
      // than silently reporting a successful sync that went nowhere.
      if (!supabaseReady(env)) {
        return json(request, { ok: false, error: "Sync not configured" }, 503);
      }

      const limited = await rateLimitOr429(
        request,
        env.SYNC_LIMITER,
        `sync:${await sha256Hex(token)}`,
        60
      );
      if (limited) return limited;

      return request.method === "GET"
        ? handleAuditPull(request, env, url)
        : handleAuditPush(request, env);
    }

    // Unmatched method under /api/* → 405; unknown paths → 404
    if (path.startsWith("/api/")) {
      return json(request, { ok: false, error: "Method not allowed" }, 405);
    }

    return json(request, { ok: false, error: "Not found" }, 404);
  },
};
