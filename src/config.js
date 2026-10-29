import { stripeMode } from './stripe.js';

// Precios y límites: HIPÓTESIS DE TRABAJO pendientes de validar con clientes reales (ver docs/03-precios.md).
export const PLANS = {
  free: { key: 'free', name: 'Sin paquete', priceEur: 0, limit: 0, revisions: 1, period: 'mes', description: 'Pedidos sueltos con presupuesto' },
  starter: { key: 'starter', name: 'Starter', priceEur: 99, limit: 5, revisions: 1, period: 'mes', description: 'Hasta 5 entregables al mes: para empezar a probar anuncios' },
  growth: { key: 'growth', name: 'Growth', priceEur: 249, limit: 15, revisions: 2, period: 'mes', description: 'Hasta 15 entregables al mes, con vídeo corto y prioridad' },
  scale: { key: 'scale', name: 'Scale', priceEur: 499, limit: 35, revisions: 2, period: 'mes', description: 'Hasta 35 entregables al mes para quienes anuncian cada semana' },
};

export function loadConfig(env = process.env) {
  const secretKey = env.STRIPE_SECRET_KEY || '';
  const mode = stripeMode(secretKey);
  const allowLive = env.ALLOW_LIVE_PAYMENTS === 'true';

  // Salvaguarda: nunca cobrar de verdad sin autorización explícita del titular.
  if (mode === 'live' && !allowLive) {
    throw new Error('Se ha detectado una clave de Stripe en modo REAL (sk_live_) pero ALLOW_LIVE_PAYMENTS no es "true". '
      + 'La aplicación se niega a arrancar para no realizar cobros reales sin autorización. Usa una clave sk_test_ o activa ALLOW_LIVE_PAYMENTS=true conscientemente.');
  }

  // En Render, RENDER_EXTERNAL_URL contiene la dirección pública del servicio.
  const baseUrl = (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');
  return {
    port: Number(env.PORT || 3000),
    baseUrl,
    isProd: env.NODE_ENV === 'production',
    // Activar solo si la app está detrás de un proxy de confianza (Render, Railway, Nginx...).
    trustProxy: env.TRUST_PROXY === 'true',
    secureCookies: baseUrl.startsWith('https://'),
    dbPath: env.DATABASE_PATH || './data/adforja.db',
    adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    alertEmail: (env.ALERT_EMAIL || env.ADMIN_EMAIL || '').trim().toLowerCase(),
    stripe: {
      secretKey,
      mode,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      portalConfiguration: env.STRIPE_PORTAL_CONFIGURATION || '',
      prices: { starter: env.STRIPE_PRICE_STARTER || '', growth: env.STRIPE_PRICE_GROWTH || '', scale: env.STRIPE_PRICE_SCALE || '' },
    },
    mail: {
      resendKey: env.RESEND_API_KEY || '',
      from: env.MAIL_FROM || 'Adforja <no-reply@example.com>',
    },
    legal: {
      owner: env.LEGAL_OWNER || '[NOMBRE Y APELLIDOS O RAZÓN SOCIAL]',
      taxId: env.LEGAL_TAX_ID || '[NIF]',
      address: env.LEGAL_ADDRESS || '[DOMICILIO]',
      email: env.LEGAL_EMAIL || env.ADMIN_EMAIL || '[EMAIL DE CONTACTO]',
    },
  };
}
