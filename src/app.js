import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Router, readBody, parseBody, parseCookies, serializeCookie, securityHeaders, serveStatic, createRateLimiter, randomToken, sha256, safeEqual } from './http.js';
import { verifyWebhook } from './stripe.js';
import { createBilling } from './billing.js';
import { PLANS } from './config.js';
import { SERVICES, SECTORS, BUDGETS, ORDER_STATUS, QUOTE_STATUS } from './catalog.js';
import * as V from './views.js';
import { legalPage } from './legal.js';

const scrypt = promisify(crypto.scrypt);
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSION_DAYS = 30;
const PUBLIC_PATHS = new Set(['/', '/servicios', '/muestras', '/precios', '/presupuesto']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function checkPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export function createApp({ config, db, stripe, mailer, now = () => Date.now(), log = console }) {
  const router = new Router();
  const limit = createRateLimiter();
  const metric = (name) => db.prepare('INSERT INTO metrics (name, created_at) VALUES (?,?)').run(name, now());
  const billing = createBilling({ db, stripe, config, mailer, metric, now });
  const stripeReady = Boolean(stripe && config.stripe.prices.starter && config.stripe.prices.growth && config.stripe.prices.scale);

  if (config.adminEmail) db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(config.adminEmail);

  // ---------- avisos de errores al administrador (con límite para no saturar) ----------
  const lastAlert = new Map();
  async function logError(context, err) {
    const message = String(err?.message || err).slice(0, 1000);
    log.error?.(`[${context}]`, err);
    db.prepare('INSERT INTO error_log (context, message, created_at) VALUES (?,?,?)').run(context, message, now());
    const key = `${context}:${message.slice(0, 80)}`;
    if (config.alertEmail && (!lastAlert.has(key) || now() - lastAlert.get(key) > 15 * 60_000)) {
      lastAlert.set(key, now());
      await mailer.send({ to: config.alertEmail, subject: `[Adforja] Error: ${context}`, text: `${new Date(now()).toISOString()}\n${context}\n\n${message}` }).catch(() => {});
    }
  }

  // ---------- sesiones ----------
  function createSession(res, userId) {
    const token = randomToken();
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), userId, now() + SESSION_DAYS * 86400_000);
    res.appendHeader('Set-Cookie', serializeCookie('sid', token, { maxAge: SESSION_DAYS * 86400, secure: config.secureCookies }));
  }
  function loadUser(cookies) {
    if (!cookies.sid) return null;
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(cookies.sid), now());
    return row || null;
  }

  // ---------- rutas públicas ----------
  router.get('/', (c) => { metric('visita_inicio'); c.page('Creatividades para anuncios con IA: imágenes, vídeo y textos', V.landingPage(), 200, { description: 'Estudio de creatividades para anuncios con IA y revisión humana: imágenes, vídeos cortos y textos para Meta, Google y TikTok Ads. Desde 29 €. Pide presupuesto sin compromiso.' }); });
  router.get('/servicios', (c) => { metric('visita_servicios'); c.page('Servicios de creatividades para anuncios', V.servicesPage(), 200, { description: 'Imágenes publicitarias, vídeo corto y textos para anuncios hechos con IA y revisados por personas. Precios claros y entrega en plazo.' }); });
  router.get('/muestras', (c) => { metric('visita_muestras'); c.page('Muestras de estilo para anuncios', V.samplesPage(), 200, { description: 'Ejemplos ilustrativos de estilos visuales para tus anuncios con IA.' }); });
  router.get('/precios', (c) => {
    metric('visita_precios');
    c.page('Paquetes mensuales', V.pricingPage({ user: c.user, csrf: c.csrf, entitlement: c.user ? billing.entitlement(c.user.id) : null, canceled: c.query.get('cancelado'), stripeReady }));
  });
  router.get('/presupuesto', (c) => c.page('Pedir presupuesto', V.quotePage({ csrf: c.csrf, service: SERVICES[c.query.get('servicio')] ? c.query.get('servicio') : undefined, sent: c.query.get('enviado') })));
  router.post('/presupuesto', async (c) => {
    if (c.body.website) return c.redirect('/presupuesto?enviado=1'); // campo trampa para bots: se ignora en silencio
    if (!limit(`quote:${c.ip}`, 5, 3600_000)) throw new HttpError(429, 'Demasiadas solicitudes. Prueba más tarde.');
    const f = (k, n = 120) => String(c.body[k] || '').trim().slice(0, n);
    const values = { name: f('name', 80), email: f('email', 200).toLowerCase(), company: f('company'), sector: SECTORS.includes(f('sector')) ? f('sector') : '', service: f('service', 30), budget: BUDGETS.includes(f('budget')) ? f('budget') : '', message: f('message', 3000) };
    const fail = (error) => c.page('Pedir presupuesto', V.quotePage({ csrf: c.csrf, error, values }), 400);
    if (!values.name) return fail('Indica tu nombre.');
    if (!EMAIL_RE.test(values.email)) return fail('El correo electrónico no es válido.');
    if (!SERVICES[values.service]) return fail('Elige un servicio.');
    if (c.body.accept !== '1') return fail('Debes aceptar la política de privacidad para enviar la solicitud.');
    const info = db.prepare('INSERT INTO quote_requests (name, email, company, sector, service, budget, message, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(values.name, values.email, values.company, values.sector, values.service, values.budget, values.message, now());
    metric('presupuesto_solicitado');
    await mailer.send({ to: values.email, subject: 'Hemos recibido tu solicitud en Adforja', text: `Hola ${values.name},\n\nHemos recibido tu solicitud (${SERVICES[values.service].name}). Te responderemos en un día laborable con una propuesta y un precio cerrado.\n\nAdforja` }).catch(() => {});
    if (config.alertEmail) await mailer.send({ to: config.alertEmail, subject: `[Adforja] Nueva solicitud #${info.lastInsertRowid}: ${values.company || values.name}`, text: `${values.name} <${values.email}>\n${SERVICES[values.service].name} · ${values.budget || 'sin presupuesto indicado'}\n\n${values.message}` }).catch(() => {});
    c.redirect('/presupuesto?enviado=1');
  });
  router.get('/legal/:slug', (c) => {
    const p = legalPage(c.params.slug, config.legal, config.baseUrl);
    if (!p) throw new HttpError(404, 'Página no encontrada');
    c.page(p.title, p.body);
  });
  router.get('/salud', (c) => {
    let dbOk = true;
    try { db.prepare('SELECT 1').get(); } catch { dbOk = false; }
    c.json(dbOk ? 200 : 503, { ok: dbOk, stripe: config.stripe.mode, email: mailer.configured });
  });
  router.get('/robots.txt', (c) => c.text(`User-agent: *\nDisallow: /panel\nDisallow: /admin\nSitemap: ${config.baseUrl}/sitemap.xml\n`));
  router.get('/google35c4b52613777345.html', (c) => {
    c.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    c.res.end('google-site-verification: google35c4b52613777345.html');
  });
  router.get('/sitemap.xml', (c) => {
    const urls = [...PUBLIC_PATHS].map((p) => `<url><loc>${config.baseUrl}${p === '/' ? '/' : p}</loc></url>`).join('');
    c.res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    c.res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  // ---------- registro e inicio de sesión ----------
  router.get('/registro', (c) => c.user ? c.redirect('/panel') : c.page('Crear cuenta', V.authPage({ mode: 'registro', csrf: c.csrf, plan: PLANS[c.query.get('plan')] ? c.query.get('plan') : '' })));
  router.post('/registro', async (c) => {
    if (!limit(`reg:${c.ip}`, 10, 3600_000)) throw new HttpError(429, 'Demasiados intentos. Prueba más tarde.');
    const name = String(c.body.name || '').trim().slice(0, 80);
    const email = String(c.body.email || '').trim().toLowerCase();
    const password = String(c.body.password || '');
    const plan = PLANS[c.body.plan] && c.body.plan !== 'free' ? c.body.plan : '';
    const fail = (error) => c.page('Crear cuenta', V.authPage({ mode: 'registro', csrf: c.csrf, error, values: { name, email }, plan }), 400);
    if (!name) return fail('Indica tu nombre.');
    if (!EMAIL_RE.test(email) || email.length > 200) return fail('El correo electrónico no es válido.');
    if (password.length < 10 || password.length > 200) return fail('La contraseña debe tener al menos 10 caracteres.');
    if (c.body.accept !== '1') return fail('Debes aceptar los términos para continuar.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail('Ya existe una cuenta con ese correo. ¿Quieres entrar?');
    const info = db.prepare('INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?,?,?,?,?)')
      .run(email, name, await hashPassword(password), email === config.adminEmail ? 1 : 0, now());
    const userId = Number(info.lastInsertRowid);
    metric('registro');
    createSession(c.res, userId);
    mailer.send({ to: email, subject: 'Bienvenido a Adforja', text: `Hola ${name},\n\nTu cuenta está lista: ${config.baseUrl}/panel\nDesde ahí podrás crear y seguir tus pedidos. Si necesitas ayuda, escríbenos desde ${config.baseUrl}/soporte.\n\nAdforja` }).catch(() => {});
    if (plan && stripeReady) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      try { return c.redirect(await billing.createCheckout(user, plan)); } catch (e) { await logError('checkout_tras_registro', e); }
    }
    c.flash('success', 'Cuenta creada.');
    c.redirect('/panel');
  });

  router.get('/entrar', (c) => c.user ? c.redirect('/panel') : c.page('Entrar', V.authPage({ mode: 'entrar', csrf: c.csrf })));
  router.post('/entrar', async (c) => {
    const email = String(c.body.email || '').trim().toLowerCase();
    if (!limit(`login:${c.ip}`, 20, 15 * 60_000) || !limit(`login:${email}`, 8, 15 * 60_000)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = user ? await checkPassword(String(c.body.password || ''), user.password_hash) : (await hashPassword('x'), false);
    if (!ok) return c.page('Entrar', V.authPage({ mode: 'entrar', csrf: c.csrf, error: 'Correo o contraseña incorrectos.', values: { email } }), 401);
    createSession(c.res, user.id);
    c.redirect('/panel');
  });
  router.post('/salir', (c) => {
    if (c.cookies.sid) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(c.cookies.sid));
    c.res.appendHeader('Set-Cookie', serializeCookie('sid', '', { maxAge: 0, secure: config.secureCookies }));
    c.redirect('/');
  });

  router.get('/olvido', (c) => c.page('Recuperar contraseña', V.authPage({ mode: 'olvido', csrf: c.csrf })));
  router.post('/olvido', async (c) => {
    if (!limit(`forgot:${c.ip}`, 5, 3600_000)) throw new HttpError(429, 'Demasiados intentos. Prueba más tarde.');
    const email = String(c.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user) {
      const token = randomToken();
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), user.id, now() + 3600_000);
      await mailer.send({ to: email, subject: 'Restablece tu contraseña de Adforja',
        text: `Hola,\n\nPara crear una contraseña nueva abre este enlace (caduca en 1 hora):\n${config.baseUrl}/restablecer?token=${token}\n\nSi no lo has pedido tú, ignora este correo.` });
    }
    c.page('Recuperar contraseña', V.messagePage('Revisa tu correo', 'Si existe una cuenta con ese correo, te hemos enviado un enlace para restablecer la contraseña.', { href: '/entrar', label: 'Volver' }));
  });
  router.get('/restablecer', (c) => c.page('Nueva contraseña', V.authPage({ mode: 'restablecer', csrf: c.csrf, values: { token: c.query.get('token') || '' } })));
  router.post('/restablecer', async (c) => {
    const token = String(c.body.token || '');
    const password = String(c.body.password || '');
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?').get(sha256(token), now());
    if (!row) return c.page('Nueva contraseña', V.messagePage('Enlace no válido', 'El enlace ha caducado o ya se ha usado. Solicita uno nuevo.', { href: '/olvido', label: 'Solicitar enlace' }), 400);
    if (password.length < 10) return c.page('Nueva contraseña', V.authPage({ mode: 'restablecer', csrf: c.csrf, error: 'Mínimo 10 caracteres.', values: { token } }), 400);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), row.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    createSession(c.res, row.user_id);
    c.flash('success', 'Contraseña actualizada.');
    c.redirect('/panel');
  });

  // ---------- panel ----------
  const auth = (fn) => async (c) => { if (!c.user) return c.redirect('/entrar'); return fn(c); };
  const admin = (fn) => async (c) => { if (!c.user?.is_admin) throw new HttpError(404, 'Página no encontrada'); return fn(c); };

  const orderCtx = (c, extra = {}, status = 200) => {
    const ent = billing.entitlement(c.user.id);
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(c.user.id);
    return c.page('Mis pedidos', V.dashboardPage({ user: c.user, csrf: c.csrf, ent, orders, canOrder: ent.paid, ...extra }), status);
  };
  router.get('/panel', auth((c) => orderCtx(c)));
  const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
  router.post('/panel/pedidos', auth(async (c) => {
    const values = { service: String(c.body.service || ''), title: String(c.body.title || '').trim().slice(0, 120), brief: String(c.body.brief || '').trim().slice(0, 4000), assets_url: String(c.body.assets_url || '').trim().slice(0, 500) };
    const fail = (error, status = 400) => orderCtx(c, { error, values }, status);
    const ent = billing.entitlement(c.user.id);
    if (!ent.paid) return fail('Necesitas un paquete mensual activo para crear pedidos desde el panel.', 402);
    if (!SERVICES[values.service] || values.service === 'paquete') return fail('Elige un servicio válido.');
    if (!values.title || values.brief.length < 10) return fail('Indica un título y explica qué necesitas (mínimo 10 caracteres).');
    if (values.assets_url && !isHttps(values.assets_url)) return fail('El enlace a los materiales debe empezar por https://');
    if (!limit(`order:${c.user.id}`, 20, 3600_000)) throw new HttpError(429, 'Demasiados pedidos seguidos. Prueba más tarde.');
    const units = 1;
    if (ent.remaining < units) return fail('Has agotado los entregables de este periodo. Puedes cambiar de paquete en Facturación.', 402);
    const t = now();
    const info = db.prepare('INSERT INTO orders (user_id, service, title, brief, assets_url, units, revisions_max, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(c.user.id, values.service, values.title, values.brief, values.assets_url, units, ent.plan.revisions, t, t);
    metric('pedido_creado');
    if (config.alertEmail) await mailer.send({ to: config.alertEmail, subject: `[Adforja] Nuevo pedido #${info.lastInsertRowid} de ${c.user.email}`, text: `${values.title}\n\n${values.brief}` }).catch(() => {});
    c.flash('success', 'Pedido enviado. Te avisaremos cuando haya novedades.');
    c.redirect(`/panel/pedidos/${info.lastInsertRowid}`);
  }));
  const ownOrder = (c) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(Number(c.params.id), c.user.id);
    if (!o) throw new HttpError(404, 'Pedido no encontrado');
    return o;
  };
  const messagesOf = (id) => db.prepare('SELECT * FROM order_messages WHERE order_id = ? ORDER BY created_at, id').all(id);
  router.get('/panel/pedidos/:id', auth((c) => { const o = ownOrder(c); c.page(o.title, V.orderPage({ csrf: c.csrf, order: o, messages: messagesOf(o.id), isAdmin: false })); }));
  const addMessage = (orderId, author, body) => db.prepare('INSERT INTO order_messages (order_id, author, body, created_at) VALUES (?,?,?,?)').run(orderId, author, body, now());
  router.post('/panel/pedidos/:id/mensaje', auth(async (c) => {
    const o = ownOrder(c); const body = String(c.body.body || '').trim().slice(0, 2000);
    if (!body) throw new HttpError(400, 'El mensaje está vacío.');
    if (!limit(`msg:${c.user.id}`, 30, 3600_000)) throw new HttpError(429, 'Demasiados mensajes. Prueba más tarde.');
    addMessage(o.id, 'cliente', body);
    if (config.alertEmail) await mailer.send({ to: config.alertEmail, subject: `[Adforja] Mensaje en pedido #${o.id}`, text: body }).catch(() => {});
    c.redirect(`/panel/pedidos/${o.id}`);
  }));
  router.post('/panel/pedidos/:id/revision', auth(async (c) => {
    const o = ownOrder(c); const body = String(c.body.body || '').trim().slice(0, 2000);
    if (o.status !== 'entregado') throw new HttpError(400, 'Solo puedes pedir cambios sobre un pedido entregado.');
    if (o.revisions_used >= o.revisions_max) throw new HttpError(400, 'Has agotado las rondas de cambios incluidas. Escríbenos para presupuestar más.');
    if (!body) throw new HttpError(400, 'Indica qué quieres cambiar.');
    db.prepare(`UPDATE orders SET revisions_used = revisions_used + 1, status = 'en_produccion', updated_at = ? WHERE id = ?`).run(now(), o.id);
    addMessage(o.id, 'cliente', `Cambios solicitados:\n${body}`);
    if (config.alertEmail) await mailer.send({ to: config.alertEmail, subject: `[Adforja] Cambios solicitados en pedido #${o.id}`, text: body }).catch(() => {});
    c.flash('success', 'Cambios enviados al equipo.');
    c.redirect(`/panel/pedidos/${o.id}`);
  }));
  router.post('/panel/pedidos/:id/aprobar', auth((c) => {
    const o = ownOrder(c);
    addMessage(o.id, 'cliente', 'Pedido aprobado. Todo correcto.');
    c.flash('success', 'Gracias. Pedido cerrado.');
    c.redirect(`/panel/pedidos/${o.id}`);
  }));

  router.get('/panel/cuenta', auth((c) => c.page('Mi cuenta', V.accountPage({ user: c.user, csrf: c.csrf, hasActiveSub: billing.hasAccess(billing.getSubscription(c.user.id)) }))));
  router.post('/panel/cuenta', auth((c) => {
    const f = (k, n = 120) => String(c.body[k] || '').trim().slice(0, n);
    db.prepare('UPDATE users SET business_name = ?, name = ? WHERE id = ?')
      .run(f('business_name'), f('name', 80) || c.user.name, c.user.id);
    c.flash('success', 'Datos guardados.');
    c.redirect('/panel');
  }));
  router.post('/panel/eliminar', auth((c) => {
    if (billing.hasAccess(billing.getSubscription(c.user.id))) throw new HttpError(400, 'Cancela tu suscripción antes de eliminar la cuenta.');
    db.prepare('DELETE FROM users WHERE id = ?').run(c.user.id);
    c.res.appendHeader('Set-Cookie', serializeCookie('sid', '', { maxAge: 0, secure: config.secureCookies }));
    c.page('Cuenta eliminada', V.messagePage('Cuenta eliminada', 'Hemos borrado tu cuenta y tus datos.', { href: '/', label: 'Ir al inicio' }));
  }));

  // ---------- facturación ----------
  const requireStripe = () => { if (!stripe) throw new HttpError(503, 'Los pagos no están configurados todavía.'); };
  router.get('/panel/facturacion', auth((c) => {
    const ent = billing.entitlement(c.user.id);
    const payments = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 24').all(c.user.id);
    c.page('Facturación', V.billingPage({ csrf: c.csrf, ent, sub: ent.sub, payments, stripeReady: Boolean(stripe), hasCustomer: Boolean(c.user.stripe_customer_id) }));
  }));
  router.post('/facturacion/checkout', auth(async (c) => {
    requireStripe();
    const plan = c.body.plan;
    if (!PLANS[plan] || plan === 'free') throw new HttpError(400, 'Plan no válido.');
    if (billing.hasAccess(billing.getSubscription(c.user.id))) return c.redirect('/panel/facturacion'); // evita suscripciones duplicadas
    try { c.redirect(await billing.createCheckout(c.user, plan)); }
    catch (e) { await logError('checkout', e); throw new HttpError(e.status === 503 ? 503 : 502, 'No se ha podido iniciar el pago. Inténtalo de nuevo en unos minutos.'); }
  }));
  router.get('/facturacion/exito', auth(async (c) => {
    let active = billing.hasAccess(billing.getSubscription(c.user.id));
    const sessionId = c.query.get('session_id');
    if (!active && stripe && sessionId) {
      try { active = await billing.confirmCheckoutSession(c.user, sessionId); } catch (e) { await logError('confirmar_checkout', e); }
    }
    if (!active) c.res.setHeader('Refresh', '4');
    c.page(active ? 'Suscripción activada' : 'Verificando pago', V.checkoutReturnPage({ active }));
  }));
  router.post('/facturacion/portal', auth(async (c) => {
    requireStripe();
    try { c.redirect(await billing.createPortal(c.user)); }
    catch (e) { await logError('portal', e); throw new HttpError(502, 'No se ha podido abrir el portal de facturación.'); }
  }));
  router.post('/facturacion/cancelar', auth(async (c) => {
    requireStripe();
    await billing.setCancelAtPeriodEnd(c.user, true);
    c.flash('success', 'Suscripción cancelada. Mantienes el acceso hasta el final del periodo pagado.');
    c.redirect('/panel/facturacion');
  }));
  router.post('/facturacion/reanudar', auth(async (c) => {
    requireStripe();
    await billing.setCancelAtPeriodEnd(c.user, false);
    c.flash('success', 'Suscripción reanudada.');
    c.redirect('/panel/facturacion');
  }));

  // Webhook de Stripe: cuerpo sin procesar + firma verificada. Única fuente de verdad para activar planes.
  router.post('/webhooks/stripe', async (c) => {
    let event;
    try {
      event = verifyWebhook(c.rawBody, c.req.headers['stripe-signature'], config.stripe.webhookSecret, { nowSec: Math.floor(now() / 1000) });
    } catch (e) {
      await logError('webhook_firma', e);
      return c.json(400, { error: 'firma no válida' });
    }
    try {
      const result = await billing.handleEvent(event);
      c.json(200, { received: true, result });
    } catch (e) {
      await logError(`webhook_${event.type}`, e);
      c.json(500, { error: 'error procesando el evento' }); // Stripe lo reintentará
    }
  }, { raw: true, noCsrf: true });

  // ---------- soporte ----------
  router.get('/soporte', (c) => c.page('Soporte', V.supportPage({ csrf: c.csrf, user: c.user, sent: c.query.get('enviado') })));
  router.post('/soporte', async (c) => {
    if (!limit(`support:${c.ip}`, 5, 3600_000)) throw new HttpError(429, 'Demasiados mensajes. Prueba más tarde.');
    const email = c.user ? c.user.email : String(c.body.email || '').trim().toLowerCase();
    const subject = String(c.body.subject || '').trim().slice(0, 150);
    const message = String(c.body.message || '').trim().slice(0, 5000);
    if (!EMAIL_RE.test(email) || !subject || !message) return c.page('Soporte', V.supportPage({ csrf: c.csrf, user: c.user, error: 'Rellena todos los campos.' }), 400);
    const info = db.prepare('INSERT INTO support_tickets (user_id, email, subject, message, created_at) VALUES (?,?,?,?,?)').run(c.user?.id ?? null, email, subject, message, now());
    await mailer.send({ to: email, subject: `Hemos recibido tu consulta #${info.lastInsertRowid}`, text: `Hola,\n\nHemos recibido tu mensaje "${subject}" y te responderemos lo antes posible.\n\nAdforja` });
    if (config.alertEmail) await mailer.send({ to: config.alertEmail, subject: `[Soporte #${info.lastInsertRowid}] ${subject}`, text: `De: ${email}\n\n${message}` });
    c.redirect('/soporte?enviado=1');
  });

  // ---------- administración ----------
  router.get('/admin', admin((c) => {
    const d30 = now() - 30 * 86400_000;
    const nowSec = Math.floor(now() / 1000);
    const activeSubs = db.prepare(`SELECT * FROM subscriptions WHERE status IN ('active','trialing') AND current_period_end > ?`).all(nowSec);
    const lastEvent = db.prepare('SELECT received_at FROM stripe_events ORDER BY received_at DESC LIMIT 1').get();
    const stats = {
      quotes30: db.prepare('SELECT COUNT(*) c FROM quote_requests WHERE created_at > ?').get(d30).c,
      openOrders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE status IN ('recibido','en_produccion','en_revision')`).get().c,
      activeSubs: activeSubs.length,
      mrr: activeSubs.reduce((s, x) => s + (x.cancel_at_period_end ? 0 : (x.unit_amount || 0)), 0),
      revenue30: db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='paid' AND created_at > ?`).get(d30).s,
      expenses30: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date > ?').get(d30).s,
    };
    const health = [
      { label: 'Stripe', ok: Boolean(stripe), detail: stripe ? `conectado en modo ${config.stripe.mode === 'test' ? 'PRUEBAS' : 'REAL'}` : 'sin configurar (STRIPE_SECRET_KEY)' },
      { label: 'Precios de Stripe', ok: stripeReady, detail: stripeReady ? 'Starter, Growth y Scale configurados' : 'faltan STRIPE_PRICE_STARTER / GROWTH / SCALE (ejecuta npm run stripe:setup)' },
      { label: 'Webhook de Stripe', ok: Boolean(config.stripe.webhookSecret), detail: config.stripe.webhookSecret ? `secreto configurado · último evento: ${lastEvent ? new Date(lastEvent.received_at).toLocaleString('es-ES') : 'ninguno todavía'}` : 'falta STRIPE_WEBHOOK_SECRET' },
      { label: 'Correo', ok: mailer.configured, detail: mailer.configured ? `enviando como ${config.mail.from}` : 'falta RESEND_API_KEY: los correos no se envían' },
      { label: 'Alertas', ok: Boolean(config.alertEmail), detail: config.alertEmail || 'falta ALERT_EMAIL / ADMIN_EMAIL' },
    ];
    c.page('Administración', V.adminPage({
      csrf: c.csrf, stats, health,
      quotes: db.prepare('SELECT * FROM quote_requests ORDER BY created_at DESC LIMIT 100').all(),
      orders: db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 100').all(),
      users: db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 50').all(),
      subs: db.prepare('SELECT s.*, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.updated_at DESC LIMIT 50').all(),
      payments: db.prepare('SELECT p.*, u.email FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 50').all(),
      tickets: db.prepare(`SELECT * FROM support_tickets ORDER BY status = 'abierto' DESC, created_at DESC LIMIT 50`).all(),
      errors: db.prepare('SELECT * FROM error_log ORDER BY created_at DESC LIMIT 30').all(),
      emails: db.prepare('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 30').all(),
      events: db.prepare('SELECT * FROM stripe_events ORDER BY received_at DESC LIMIT 30').all(),
      expenses: db.prepare('SELECT * FROM expenses ORDER BY date DESC LIMIT 50').all(),
    }), 200, { wide: true });
  }));
  router.post('/admin/presupuestos/:id/estado', admin((c) => {
    const st = String(c.body.status || '');
    if (!QUOTE_STATUS.includes(st)) throw new HttpError(400, 'Estado no válido.');
    db.prepare('UPDATE quote_requests SET status = ? WHERE id = ?').run(st, Number(c.params.id));
    c.redirect('/admin');
  }));
  const anyOrder = (c) => { const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(c.params.id)); if (!o) throw new HttpError(404, 'Pedido no encontrado'); return o; };
  router.get('/admin/pedidos/:id', admin((c) => { const o = anyOrder(c); c.page(o.title, V.orderPage({ csrf: c.csrf, order: o, messages: messagesOf(o.id), isAdmin: true })); }));
  router.post('/admin/pedidos/:id/mensaje', admin(async (c) => {
    const o = anyOrder(c); const body = String(c.body.body || '').trim().slice(0, 2000);
    if (!body) throw new HttpError(400, 'El mensaje está vacío.');
    addMessage(o.id, 'equipo', body);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(o.user_id);
    await mailer.send({ to: u.email, subject: `Novedades en tu pedido #${o.id}`, text: `Hola ${u.name},\n\nHay un mensaje nuevo en tu pedido "${o.title}": ${config.baseUrl}/panel/pedidos/${o.id}\n\nAdforja` }).catch(() => {});
    c.redirect(`/admin/pedidos/${o.id}`);
  }));
  router.post('/admin/pedidos/:id/estado', admin(async (c) => {
    const o = anyOrder(c); const st = String(c.body.status || ''); const url = String(c.body.delivery_url || '').trim().slice(0, 500);
    if (!ORDER_STATUS[st]) throw new HttpError(400, 'Estado no válido.');
    if (url && !isHttps(url)) throw new HttpError(400, 'El enlace de entrega debe empezar por https://');
    if (st === 'entregado' && !url && !o.delivery_url) throw new HttpError(400, 'Añade el enlace de entrega antes de marcar como entregado.');
    db.prepare('UPDATE orders SET status = ?, delivery_url = ?, updated_at = ? WHERE id = ?').run(st, url || o.delivery_url, now(), o.id);
    if (st !== o.status && ['entregado', 'en_revision'].includes(st)) {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(o.user_id);
      await mailer.send({ to: u.email, subject: `Tu pedido #${o.id} está ${ORDER_STATUS[st].toLowerCase()}`, text: `Hola ${u.name},\n\nPuedes verlo aquí: ${config.baseUrl}/panel/pedidos/${o.id}\n\nAdforja` }).catch(() => {});
    }
    c.redirect(`/admin/pedidos/${o.id}`);
  }));
  router.post('/admin/gastos', admin((c) => {
    const amount = Math.round(Number(c.body.amount) * 100);
    const date = Date.parse(c.body.date);
    const concept = String(c.body.concept || '').trim().slice(0, 120);
    if (!concept || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(date)) throw new HttpError(400, 'Datos del gasto no válidos.');
    db.prepare('INSERT INTO expenses (concept, amount, date) VALUES (?,?,?)').run(concept, amount, date);
    c.redirect('/admin');
  }));
  router.post('/admin/tickets/:id/cerrar', admin((c) => {
    db.prepare(`UPDATE support_tickets SET status = 'cerrado' WHERE id = ?`).run(Number(c.params.id));
    c.redirect('/admin');
  }));

  // ---------- manejador principal ----------
  async function handler(req, res) {
    securityHeaders(res, { isProd: config.isProd });
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && /^\/(styles\.css|app\.js|favicon\.svg)$/.test(path)) {
      if (await serveStatic(res, PUBLIC_DIR, path)) return;
    }

    const cookies = parseCookies(req.headers.cookie);
    let csrf = cookies.csrf;
    if (!csrf || csrf.length < 20) {
      csrf = randomToken(24);
      res.appendHeader('Set-Cookie', serializeCookie('csrf', csrf, { secure: config.secureCookies }));
    }
    const forwarded = config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const ip = forwarded || req.socket.remoteAddress || 'unknown';
    let flash = null;
    if (cookies.flash) {
      try { flash = JSON.parse(cookies.flash); } catch { /* ignorar */ }
      res.appendHeader('Set-Cookie', serializeCookie('flash', '', { maxAge: 0 }));
    }

    const c = {
      req, res, cookies, csrf, ip, query: url.searchParams, params: {}, body: {}, rawBody: Buffer.alloc(0), user: null,
      page(title, body, status = 200, opts = {}) {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        const seo = {};
        if (status === 200 && PUBLIC_PATHS.has(path)) {
          seo.canonical = config.baseUrl + (path === '/' ? '/' : path);
          if (path === '/') seo.jsonld = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Adforja', url: config.baseUrl, description: 'Estudio de creatividades publicitarias con IA y revisión humana: imágenes, vídeo corto y textos para anuncios.' };
        } else seo.noindex = true;
        res.end(V.layout({ title, body, user: c.user, csrf, flash, stripeMode: config.stripe.mode, ...seo, ...opts }));
      },
      json(status, obj) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); },
      text(t) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(t); },
      redirect(to) { res.writeHead(303, { Location: to }); res.end(); },
      flash(type, text) { res.appendHeader('Set-Cookie', serializeCookie('flash', JSON.stringify({ type, text }), { maxAge: 60, secure: config.secureCookies })); },
    };

    try {
      c.user = loadUser(cookies);
      const m = router.match(req.method, path);
      if (!m) throw new HttpError(404, 'Página no encontrada');
      c.params = m.params;
      if (req.method === 'POST') {
        c.rawBody = await readBody(req);
        if (!m.route.opts.raw) c.body = parseBody(c.rawBody, req.headers['content-type']);
        if (!m.route.opts.noCsrf && !(c.body._csrf && cookies.csrf && safeEqual(c.body._csrf, cookies.csrf))) {
          throw new HttpError(403, 'La sesión del formulario ha caducado. Vuelve atrás, recarga la página e inténtalo de nuevo.');
        }
      }
      await m.route.handler(c);
    } catch (e) {
      const status = e.status && e.status < 600 ? e.status : 500;
      if (status >= 500) await logError(`${req.method} ${path}`, e);
      if (res.headersSent) return res.end();
      const msg = status >= 500 && !(e instanceof HttpError) ? 'Ha ocurrido un error inesperado. Ya hemos sido avisados.' : e.message;
      c.page(status === 404 ? 'No encontrado' : 'Error', V.messagePage(status === 404 ? 'Página no encontrada' : 'No se ha podido completar', msg, { href: '/', label: 'Volver al inicio' }), status);
    }
  }

  return { handler, billing };
}
