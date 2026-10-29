// Cliente mínimo de la API REST de Stripe (sin SDK) y verificación de firmas de webhooks.
// Algoritmo de firma documentado por Stripe: HMAC-SHA256 de "<timestamp>.<cuerpo>" con el secreto whsec_...
import crypto from 'node:crypto';

export function stripeMode(key = '') {
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  return 'off';
}

// Codifica objetos anidados al formato de formulario de Stripe: a[b][0][c]=valor
export function encodeForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encodeForm(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === 'object') {
      encodeForm(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

export class StripeError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

export function createStripeClient(secretKey, { fetchImpl = globalThis.fetch, apiBase = 'https://api.stripe.com/v1' } = {}) {
  if (stripeMode(secretKey) === 'off') return null;

  async function request(method, path, params, { idempotencyKey } = {}) {
    const form = params ? encodeForm(params).toString() : '';
    const url = apiBase + path + (method === 'GET' && form ? `?${form}` : '');
    const headers = { Authorization: `Bearer ${secretKey}` };
    if (method !== 'GET') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let r;
    try {
      r = await fetchImpl(url, { method, headers, body: method === 'GET' ? undefined : form, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new StripeError(`No se pudo contactar con Stripe: ${e.message}`, 502);
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new StripeError(data?.error?.message || `Error de Stripe (${r.status})`, r.status, data?.error);
    return data;
  }
  const id = (s) => encodeURIComponent(s);

  return {
    mode: stripeMode(secretKey),
    customers: {
      create: (p, o) => request('POST', '/customers', p, o),
      retrieve: (c) => request('GET', `/customers/${id(c)}`),
    },
    checkout: {
      sessions: {
        create: (p, o) => request('POST', '/checkout/sessions', p, o),
        retrieve: (s) => request('GET', `/checkout/sessions/${id(s)}`),
      },
    },
    subscriptions: {
      retrieve: (s) => request('GET', `/subscriptions/${id(s)}`),
      update: (s, p) => request('POST', `/subscriptions/${id(s)}`, p),
      cancel: (s) => request('DELETE', `/subscriptions/${id(s)}`),
    },
    billingPortal: {
      sessions: { create: (p) => request('POST', '/billing_portal/sessions', p) },
      configurations: { create: (p) => request('POST', '/billing_portal/configurations', p), list: (p) => request('GET', '/billing_portal/configurations', p) },
    },
    products: { create: (p, o) => request('POST', '/products', p, o), search: (p) => request('GET', '/products/search', p) },
    prices: { create: (p, o) => request('POST', '/prices', p, o), list: (p) => request('GET', '/prices', p), retrieve: (x) => request('GET', `/prices/${id(x)}`) },
    webhookEndpoints: { create: (p) => request('POST', '/webhook_endpoints', p), list: (p) => request('GET', '/webhook_endpoints', p) },
    balance: { retrieve: () => request('GET', '/balance') },
  };
}

export function verifyWebhook(rawBody, signatureHeader, secret, { toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) throw new StripeError('Falta STRIPE_WEBHOOK_SECRET', 500);
  if (!signatureHeader) throw new StripeError('Falta la cabecera Stripe-Signature', 400);
  let t = null; const sigs = [];
  for (const part of String(signatureHeader).split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') t = Number(v);
    if (k === 'v1' && v) sigs.push(v);
  }
  if (!t || !sigs.length) throw new StripeError('Cabecera de firma no válida', 400);
  if (Math.abs(nowSec - t) > toleranceSec) throw new StripeError('Firma caducada', 400);
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new StripeError('Firma no válida', 400);
  return JSON.parse(payload);
}

// Solo para pruebas: genera una cabecera igual que la que envía Stripe.
export function signPayload(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}
