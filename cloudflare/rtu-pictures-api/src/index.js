/**
 * RTU Pictures API — auth + upload to R2 bucket `rtu-pictures`
 */

const TOKEN_TTL_HOURS = 8;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB
const ALLOWED_ORIGINS = new Set([
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Filename",
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

      const objectKey = `uploads/${new Date().toISOString().slice(0, 10)}/${randomHex(4)}-${key}`;
      await env.PICTURES.put(objectKey, read.body, {
        httpMetadata: { contentType },
        customMetadata: {
          originalName: key,
          uploadedAt: new Date().toISOString(),
        },
      });
      return json(request, { ok: true, key: objectKey });
    }

    // Unmatched method under /api/* → 405; unknown paths → 404
    if (path.startsWith("/api/")) {
      return json(request, { ok: false, error: "Method not allowed" }, 405);
    }

    return json(request, { ok: false, error: "Not found" }, 404);
  },
};
