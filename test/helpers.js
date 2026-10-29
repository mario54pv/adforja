import http from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { signPayload } from '../src/stripe.js';

export const WHSEC = 'whsec_test_secret_123';
export const PRICE_STARTER = 'price_starter_test';
export const PRICE_GROWTH = 'price_growth_test';
export const PRICE_SCALE = 'price_scale_test';

// Doble de pruebas de la API de Stripe que registra las llamadas y guarda suscripciones en memoria.
export function fakeStripe() {
  const calls = [];
  const subs = new Map();
  const sessions = new Map();
  let n = 0;
  const rec = (name, args) => calls.push({ name, args });
  return {
    mode: 'test', calls, subs, sessions,
    customers: { create: async (p) => { rec('customers.create', p); return { id: `cus_${++n}`, ...p }; } },
    checkout: { sessions: {
      create: async (p, o) => { rec('checkout.create', { p, o }); const s = { id: `cs_test_${++n}A`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}A`, ...p }; sessions.set(s.id, s); return s; },
      retrieve: async (id) => { rec('checkout.retrieve', id); const s = sessions.get(id); if (!s) throw Object.assign(new Error('No such session'), { status: 404 }); return s; },
    } },
    subscriptions: {
      retrieve: async (id) => { rec('subscriptions.retrieve', id); const s = subs.get(id); if (!s) throw Object.assign(new Error('No such subscription'), { status: 404 }); return structuredClone(s); },
      update: async (id, p) => { rec('subscriptions.update', { id, p }); const s = subs.get(id); s.cancel_at_period_end = p.cancel_at_period_end === 'true'; return structuredClone(s); },
    },
    billingPortal: { sessions: { create: async (p) => { rec('portal.create', p); return { url: 'https://billing.stripe.com/p/session/test_123' }; } } },
  };
}

export function makeSub({ id = 'sub_1', customer, userId, status = 'active', price = PRICE_STARTER, amount = 9900, start, end, cancelAtPeriodEnd = false }) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    id, object: 'subscription', customer, status, cancel_at_period_end: cancelAtPeriodEnd, metadata: userId ? { userId: String(userId) } : {},
    items: { data: [{ price: { id: price, unit_amount: amount, currency: 'eur' }, current_period_start: start ?? nowSec - 60, current_period_end: end ?? nowSec + 30 * 86400 }] },
  };
}

export async function startApp(envOverrides = {}, { withStripe = true } = {}) {
  const config = loadConfig({
    BASE_URL: 'http://localhost:3000', TRUST_PROXY: 'true', ADMIN_EMAIL: 'admin@example.com',
    STRIPE_SECRET_KEY: withStripe ? 'sk_test_fake' : '', STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_STARTER: PRICE_STARTER, STRIPE_PRICE_GROWTH: PRICE_GROWTH, STRIPE_PRICE_SCALE: PRICE_SCALE, ...envOverrides,
  });
  const db = openDb(':memory:');
  const stripe = withStripe ? fakeStripe() : null;
  const sent = [];
  const mailer = { configured: true, sent, async send(m) { sent.push(m); return true; } };
  const silent = { error() {}, info() {} };
  const { handler, billing } = createApp({ config, db, stripe, mailer, log: silent });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { config, db, stripe, mailer, sent, billing, server, base, close: () => new Promise((r) => server.close(r)) };
}

// Cliente con "tarro" de cookies que imita a un navegador.
let ipN = 0;
export function browser(base) {
  const jar = {};
  const ip = `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`;
  const store = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(); const v = decodeURIComponent(pair.slice(i + 1));
      if (attrs.some((a) => /max-age=0/i.test(a))) delete jar[k]; else jar[k] = v;
    }
  };
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  const b = {
    jar,
    async get(path) {
      const res = await fetch(base + path, { headers: { cookie: cookieHeader(), 'x-forwarded-for': ip }, redirect: 'manual' });
      store(res);
      return { status: res.status, location: res.headers.get('location'), text: await res.text(), headers: res.headers };
    },
    async post(path, data = {}, { csrf = true } = {}) {
      if (csrf && !jar.csrf) await b.get('/');
      const body = new URLSearchParams({ ...(csrf ? { _csrf: jar.csrf } : {}), ...data });
      const res = await fetch(base + path, { method: 'POST', body, headers: { cookie: cookieHeader(), 'x-forwarded-for': ip, 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
      store(res);
      return { status: res.status, location: res.headers.get('location'), text: await res.text() };
    },
    async register(email = 'ana@example.com', password = 'contraseña-segura', extra = {}) {
      return b.post('/registro', { name: 'Ana', email, password, accept: '1', ...extra });
    },
  };
  return b;
}

export async function sendWebhook(base, event, { secret = WHSEC, t } = {}) {
  const payload = JSON.stringify(event);
  const res = await fetch(`${base}/webhooks/stripe`, { method: 'POST', body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': signPayload(payload, secret, t) } });
  return { status: res.status, body: await res.json() };
}

let evn = 0;
export const event = (type, object) => ({ id: `evt_${Date.now()}_${++evn}`, object: 'event', type, data: { object } });
