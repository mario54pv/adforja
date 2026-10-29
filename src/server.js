import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { readKeyFile } from './keyfile.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createStripeClient } from './stripe.js';
import { createMailer } from './mailer.js';
import { createApp } from './app.js';

// Alternativa cómoda en Windows: la clave secreta de Stripe puede guardarse sola en clave-stripe.txt.
if (!/^(sk|rk)_(test|live)_/.test(process.env.STRIPE_SECRET_KEY || '') && existsSync('clave-stripe.txt')) {
  const k = readKeyFile('clave-stripe.txt');
  if (k) process.env.STRIPE_SECRET_KEY = k;
}

let config;
try { config = loadConfig(); } catch (e) { console.error(`\n✖ ${e.message}\n`); process.exit(1); }

const db = openDb(config.dbPath);
const stripe = createStripeClient(config.stripe.secretKey);
const mailer = createMailer({ db, resendKey: config.mail.resendKey, from: config.mail.from });
const { handler } = createApp({ config, db, stripe, mailer });

const server = http.createServer(handler);
server.listen(config.port, () => {
  const line = (ok, label, detail) => console.log(`  ${ok ? '✔' : '✖'} ${label}: ${detail}`);
  console.log(`\nAdforja escuchando en ${config.baseUrl} (puerto ${config.port})`);
  line(Boolean(stripe), 'Stripe', stripe ? `modo ${config.stripe.mode === 'test' ? 'PRUEBAS (sin cobros reales)' : 'REAL'}` : 'sin configurar');
  line(Boolean(config.stripe.prices.starter && config.stripe.prices.growth && config.stripe.prices.scale), 'Precios', config.stripe.prices.starter ? 'configurados' : 'faltan (npm run stripe:setup)');
  line(Boolean(config.stripe.webhookSecret), 'Webhook', config.stripe.webhookSecret ? 'secreto configurado' : 'falta STRIPE_WEBHOOK_SECRET');
  line(mailer.configured, 'Correo', mailer.configured ? 'Resend' : 'falta RESEND_API_KEY (los correos se muestran en consola)');
  console.log('');
});

// Limpieza periódica de sesiones y enlaces caducados.
setInterval(() => {
  const t = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(t);
}, 3600_000).unref();

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
