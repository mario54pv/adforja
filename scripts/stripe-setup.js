// Crea en tu cuenta de Stripe los productos, precios, portal de cliente y (opcionalmente) el webhook.
// Es idempotente: si ya existen, los reutiliza. Por seguridad SOLO funciona con claves de PRUEBAS
// salvo que se pase --live y ALLOW_LIVE_PAYMENTS=true.
//
// Uso:  npm run stripe:setup            (modo pruebas)
//       npm run stripe:setup -- --webhook   (además crea el webhook en BASE_URL, que debe ser https)
import { readFileSync, existsSync } from 'node:fs';
import { readKeyFile } from '../src/keyfile.js';
import { createStripeClient, stripeMode } from '../src/stripe.js';
import { PLANS } from '../src/config.js';

export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
];

const keyFromFile = existsSync('clave-stripe.txt') ? readKeyFile('clave-stripe.txt') : '';
const envKey = /^(sk|rk)_(test|live)_/.test(process.env.STRIPE_SECRET_KEY || '') ? process.env.STRIPE_SECRET_KEY : '';
const key = envKey || keyFromFile || '';
const mode = stripeMode(key);
const args = process.argv.slice(2);

if (mode === 'off') { console.error('✖ Falta STRIPE_SECRET_KEY (sk_test_...) en el archivo .env'); process.exit(1); }
if (mode === 'live' && !(args.includes('--live') && process.env.ALLOW_LIVE_PAYMENTS === 'true')) {
  console.error('✖ Clave REAL detectada. Este script solo crea configuración real con --live y ALLOW_LIVE_PAYMENTS=true.');
  process.exit(1);
}

const stripe = createStripeClient(key);
console.log(`\nConfigurando Stripe en modo ${mode === 'test' ? 'PRUEBAS' : 'REAL'}...\n`);

const env = {};
const priceIds = [];
for (const plan of [PLANS.starter, PLANS.growth, PLANS.scale]) {
  const lookupKey = `adforja_${plan.key}_mensual`;
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: 'true', limit: 1 });
  let price = existing.data?.[0];
  if (price) {
    console.log(`✔ Precio existente para ${plan.name}: ${price.id}`);
  } else {
    const product = await stripe.products.create({ name: `Adforja ${plan.name}`, description: `Paquete mensual de ${plan.limit} entregables publicitarios (imágenes, vídeo corto y textos)`, metadata: { plan: plan.key } },
      { idempotencyKey: `adforja-product-${plan.key}-${mode}` });
    price = await stripe.prices.create({
      product: product.id, currency: 'eur', unit_amount: plan.priceEur * 100, recurring: { interval: 'month' },
      lookup_key: lookupKey, tax_behavior: 'exclusive', metadata: { plan: plan.key },
    }, { idempotencyKey: `adforja-price-${plan.key}-${mode}` });
    console.log(`✔ Creado ${plan.name}: producto ${product.id}, precio ${price.id} (${plan.priceEur} €/mes)`);
  }
  env[`STRIPE_PRICE_${plan.key.toUpperCase()}`] = price.id;
  priceIds.push({ product: typeof price.product === 'string' ? price.product : price.product.id, prices: [price.id] });
}

// Portal de cliente: cambiar tarjeta, ver facturas, cambiar de plan y cancelar al final del periodo.
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
try {
  const portal = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Gestiona tu suscripción a Adforja', privacy_policy_url: `${baseUrl}/legal/privacidad`, terms_of_service_url: `${baseUrl}/legal/terminos` },
    default_return_url: `${baseUrl}/panel/facturacion`,
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'unused', 'missing_features', 'other'] } },
      subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: priceIds },
    },
  });
  console.log(`✔ Portal de cliente configurado: ${portal.id}`);
  env.STRIPE_PORTAL_CONFIGURATION = portal.id;
} catch (e) {
  console.warn(`⚠ No se pudo crear la configuración del portal (${e.message}). Configúralo en el Dashboard: Configuración > Facturación > Portal de clientes.`);
}

if (args.includes('--webhook')) {
  if (!baseUrl.startsWith('https://')) {
    console.warn('⚠ Para crear el webhook, BASE_URL debe ser una dirección pública https. En local usa: stripe listen --forward-to localhost:3000/webhooks/stripe');
  } else {
    const url = `${baseUrl}/webhooks/stripe`;
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    if (list.data.some((w) => w.url === url)) {
      console.log(`✔ Ya existe un webhook para ${url}. Su secreto está en el Dashboard (Desarrolladores > Webhooks).`);
    } else {
      const wh = await stripe.webhookEndpoints.create({ url, enabled_events: WEBHOOK_EVENTS, description: 'Adforja' });
      console.log(`✔ Webhook creado: ${wh.id}`);
      env.STRIPE_WEBHOOK_SECRET = wh.secret;
    }
  }
}

console.log('\nAñade estas líneas a tu archivo .env:\n');
for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
console.log('');
