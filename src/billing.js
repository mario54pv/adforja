// Lógica de suscripciones. Regla de oro: el acceso de pago SOLO se concede a partir de datos
// obtenidos directamente de Stripe (webhook con firma verificada o consulta servidor→Stripe),
// nunca por haber llegado a la página de éxito ni por parámetros que envíe el navegador.
import { PLANS } from './config.js';

export const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export function createBilling({ db, stripe, config, mailer, metric, now = () => Date.now() }) {
  const priceToPlan = (priceId) => Object.entries(config.stripe.prices).find(([, p]) => p && p === priceId)?.[0] || null;

  function getSubscription(userId) {
    return db.prepare(`SELECT * FROM subscriptions WHERE user_id = ?
      ORDER BY CASE WHEN status IN ('active','trialing') THEN 0 WHEN status = 'past_due' THEN 1 ELSE 2 END, updated_at DESC LIMIT 1`).get(userId) || null;
  }

  function hasAccess(sub) {
    return Boolean(sub && ACTIVE_STATUSES.has(sub.status) && sub.current_period_end && sub.current_period_end * 1000 > now());
  }

  // Plan efectivo y uso del periodo para un usuario.
  function entitlement(userId) {
    const sub = getSubscription(userId);
    if (hasAccess(sub) && PLANS[sub.plan]) {
      const plan = PLANS[sub.plan];
      const since = (sub.current_period_start || 0) * 1000;
      const used = db.prepare('SELECT COALESCE(SUM(units),0) c FROM orders WHERE user_id = ? AND status != ? AND created_at >= ?').get(userId, 'cancelado', since).c;
      return { plan, sub, used, limit: plan.limit, remaining: Math.max(0, plan.limit - used), paid: true };
    }
    const plan = PLANS.free;
    const used = db.prepare('SELECT COALESCE(SUM(units),0) c FROM orders WHERE user_id = ? AND status != ?').get(userId, 'cancelado').c;
    return { plan, sub, used, limit: plan.limit, remaining: Math.max(0, plan.limit - used), paid: false };
  }

  function findUserForStripe({ metadataUserId, customerId }) {
    if (metadataUserId) {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(metadataUserId));
      if (u) return u;
    }
    if (customerId) return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId) || null;
    return null;
  }

  // Guarda en la base de datos el estado de una suscripción tal y como lo devuelve Stripe.
  function syncSubscription(sub, hintUserId = null) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const user = findUserForStripe({ metadataUserId: sub.metadata?.userId || hintUserId, customerId });
    if (!user) throw new Error(`Suscripción ${sub.id} sin usuario asociado (cliente ${customerId})`);
    if (customerId && !user.stripe_customer_id) db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);

    const item = sub.items?.data?.[0] || {};
    const priceId = item.price?.id || null;
    const plan = priceToPlan(priceId);
    if (!plan) throw new Error(`Precio desconocido ${priceId} en la suscripción ${sub.id}: revisa STRIPE_PRICE_STARTER / STRIPE_PRICE_GROWTH`);
    // En versiones recientes de la API el periodo está en cada elemento; en las antiguas, en la suscripción.
    const periodStart = item.current_period_start ?? sub.current_period_start ?? null;
    const periodEnd = item.current_period_end ?? sub.current_period_end ?? null;
    const before = getSubscription(user.id);

    db.prepare(`INSERT INTO subscriptions (id, user_id, status, plan, price_id, unit_amount, currency, current_period_start, current_period_end, cancel_at_period_end, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, plan=excluded.plan, price_id=excluded.price_id, unit_amount=excluded.unit_amount,
        currency=excluded.currency, current_period_start=excluded.current_period_start, current_period_end=excluded.current_period_end,
        cancel_at_period_end=excluded.cancel_at_period_end, updated_at=excluded.updated_at`)
      .run(sub.id, user.id, sub.status, plan, priceId, item.price?.unit_amount ?? null, item.price?.currency ?? null,
        periodStart, periodEnd, sub.cancel_at_period_end ? 1 : 0, now());

    if (ACTIVE_STATUSES.has(sub.status) && !(before && before.id === sub.id && ACTIVE_STATUSES.has(before.status))) {
      metric('suscripcion_activa');
    }
    return { user, plan, status: sub.status };
  }

  async function ensureCustomer(user) {
    if (user.stripe_customer_id) return user.stripe_customer_id;
    const c = await stripe.customers.create({ email: user.email, name: user.name || undefined, metadata: { userId: String(user.id) } },
      { idempotencyKey: `customer-${user.id}-${user.created_at}` });
    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(c.id, user.id);
    return c.id;
  }

  async function createCheckout(user, planKey) {
    const priceId = config.stripe.prices[planKey];
    if (!priceId) throw Object.assign(new Error('Este plan aún no está configurado en Stripe'), { status: 503 });
    const customer = await ensureCustomer(user);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: String(user.id),
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${config.baseUrl}/facturacion/exito?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.baseUrl}/precios?cancelado=1`,
      subscription_data: { metadata: { userId: String(user.id), plan: planKey } },
      metadata: { userId: String(user.id), plan: planKey },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { name: 'auto', address: 'auto' },
      locale: 'es',
    }, { idempotencyKey: `checkout-${user.id}-${user.created_at}-${planKey}-${Math.floor(now() / 60_000)}` });
    metric('checkout_iniciado');
    return session.url;
  }

  async function createPortal(user) {
    if (!user.stripe_customer_id) throw Object.assign(new Error('Todavía no tienes datos de facturación'), { status: 400 });
    const s = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${config.baseUrl}/panel/facturacion`, locale: 'es',
      configuration: config.stripe.portalConfiguration || undefined });
    return s.url;
  }

  // Verificación servidor→Stripe tras volver del pago (respaldo por si el webhook se retrasa).
  async function confirmCheckoutSession(user, sessionId) {
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId || '')) return false;
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (String(s.client_reference_id) !== String(user.id)) return false;
    if (s.status !== 'complete' || !['paid', 'no_payment_required'].includes(s.payment_status) || !s.subscription) return false;
    const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId);
    syncSubscription(sub, user.id);
    return hasAccess(getSubscription(user.id));
  }

  async function setCancelAtPeriodEnd(user, cancel) {
    const sub = getSubscription(user.id);
    if (!sub || !hasAccess(sub)) throw Object.assign(new Error('No tienes una suscripción activa'), { status: 400 });
    const updated = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: cancel ? 'true' : 'false' });
    syncSubscription(updated, user.id);
  }

  function recordPayment(invoice, status) {
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    const user = findUserForStripe({ customerId });
    const amount = status === 'paid' ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0);
    db.prepare(`INSERT INTO payments (id, user_id, amount, currency, status, created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, amount = excluded.amount`)
      .run(invoice.id, user?.id ?? null, amount, invoice.currency || 'eur', status, (invoice.created || Math.floor(now() / 1000)) * 1000);
    return user;
  }

  const invoiceSubscriptionId = (inv) => {
    const s = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? inv.lines?.data?.[0]?.subscription ?? null;
    return typeof s === 'string' ? s : s?.id ?? null;
  };

  async function handleEvent(event) {
    const seen = db.prepare('INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?,?,?)').run(event.id, event.type, now());
    if (seen.changes === 0) return 'duplicado';
    try {
      const obj = event.data?.object || {};
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
          if (obj.mode !== 'subscription' || !obj.subscription) break;
          if (!['paid', 'no_payment_required'].includes(obj.payment_status)) break; // p. ej. pagos diferidos aún pendientes
          const subId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          syncSubscription(sub, obj.client_reference_id);
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed': {
          const { user } = syncSubscription(obj);
          if (event.type === 'customer.subscription.deleted') {
            await mailer.send({ to: user.email, subject: 'Tu suscripción a Adforja ha finalizado',
              text: `Hola,\n\nTu suscripción ha finalizado y tu cuenta ya no tiene un paquete mensual activo (los pedidos en curso se entregarán). Puedes volver a suscribirte cuando quieras desde ${config.baseUrl}/precios\n\nGracias por haber confiado en Adforja.` });
          }
          break;
        }
        case 'invoice.paid': {
          const user = recordPayment(obj, 'paid');
          const subId = invoiceSubscriptionId(obj);
          if (subId) syncSubscription(await stripe.subscriptions.retrieve(subId), user?.id);
          break;
        }
        case 'invoice.payment_failed': {
          const user = recordPayment(obj, 'failed');
          const subId = invoiceSubscriptionId(obj);
          if (subId) syncSubscription(await stripe.subscriptions.retrieve(subId), user?.id);
          if (user) {
            await mailer.send({ to: user.email, subject: 'No hemos podido cobrar tu suscripción a Adforja',
              text: `Hola,\n\nEl último cobro de tu suscripción no se ha podido completar. Stripe lo reintentará automáticamente, pero para no perder el acceso puedes actualizar tu método de pago aquí: ${config.baseUrl}/panel/facturacion\n\nUn saludo,\nAdforja` });
          }
          break;
        }
        default:
          return 'ignorado';
      }
      return 'procesado';
    } catch (e) {
      // Se borra el registro para que el reintento automático de Stripe vuelva a procesarlo.
      db.prepare('DELETE FROM stripe_events WHERE id = ?').run(event.id);
      throw e;
    }
  }

  return { getSubscription, hasAccess, entitlement, createCheckout, createPortal, confirmCheckoutSession, setCancelAtPeriodEnd, handleEvent, syncSubscription };
}
