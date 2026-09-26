/**
 * Cloudflare Worker: Anthropic Messages API proxy for veg-travel.
 * Secret: ANTHROPIC_API_KEY (never accept client-provided keys).
 * Abuse protection: allowed-origin required, per-IP + global rate limits
 * (Workers Rate Limiting bindings in wrangler.toml), fixed model,
 * capped max_tokens, request size cap.
 */

const ALLOWED_MODELS = new Set(['claude-sonnet-4-6']);
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 1500;
const MAX_MESSAGES = 4;
const MAX_BODY_BYTES = 6 * 1024 * 1024; // photos are sent as base64

const ALLOWED_ORIGINS = new Set([
  'https://mclintw.github.io',
  'https://mengchiaolin-ai.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
  } catch (_) {}
  return false;
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function rateLimited(origin) {
  return new Response(JSON.stringify({
    error: 'rate_limited',
    message: '使用次數太頻繁，請稍等一分鐘再試。',
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': '60',
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      if (origin && !isAllowedOrigin(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    }

    if (!isAllowedOrigin(origin)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, origin);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/v1/messages' && path !== '/api/claude') {
      return jsonResponse({ error: 'Not found' }, 404, origin);
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: 'Server misconfigured: missing ANTHROPIC_API_KEY' }, 500, origin);
    }

    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request too large' }, 413, origin);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.PER_IP_LIMITER) {
      const { success } = await env.PER_IP_LIMITER.limit({ key: ip });
      if (!success) return rateLimited(origin);
    }
    if (env.GLOBAL_LIMITER) {
      const { success } = await env.GLOBAL_LIMITER.limit({ key: 'global' });
      if (!success) return rateLimited(origin);
    }

    let raw;
    try {
      raw = await request.text();
    } catch (_) {
      return jsonResponse({ error: 'Invalid body' }, 400, origin);
    }
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request too large' }, 413, origin);
    }
    let input;
    try {
      input = JSON.parse(raw);
    } catch (_) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
    }
    if (!input || typeof input !== 'object' || !Array.isArray(input.messages)
        || input.messages.length === 0 || input.messages.length > MAX_MESSAGES) {
      return jsonResponse({ error: 'Invalid messages' }, 400, origin);
    }

    // Rebuild the upstream body from an allowlist: fixed model, capped tokens,
    // no tools, no client-supplied keys.
    const requestedTokens = Number(input.max_tokens) || 1000;
    const body = {
      model: ALLOWED_MODELS.has(input.model) ? input.model : DEFAULT_MODEL,
      max_tokens: Math.max(1, Math.min(requestedTokens, MAX_TOKENS_CAP)),
      messages: input.messages,
    };
    if (typeof input.system === 'string' && input.system.length <= 4000) {
      body.system = input.system;
    }

    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          ...corsHeaders(origin),
        },
      });
    } catch (err) {
      return jsonResponse({ error: 'Upstream request failed', detail: String(err && err.message || err) }, 502, origin);
    }
  },
};
