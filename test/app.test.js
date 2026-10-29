import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, browser, sendWebhook, event, makeSub, PRICE_GROWTH } from './helpers.js';
import { loadConfig, PLANS } from '../src/config.js';
import { encodeForm, verifyWebhook, signPayload } from '../src/stripe.js';

const userByEmail = (db, email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);

describe('Configuración y pagos', () => {
  test('se niega a arrancar con clave real sin autorización explícita', () => {
    assert.throws(() => loadConfig({ STRIPE_SECRET_KEY: 'sk_live_abc' }), /ALLOW_LIVE_PAYMENTS/);
    assert.equal(loadConfig({ STRIPE_SECRET_KEY: 'sk_test_abc' }).stripe.mode, 'test');
  });
  test('codifica parámetros anidados al formato de Stripe', () => {
    const f = encodeForm({ line_items: [{ price: 'p', quantity: 1 }], a: undefined });
    assert.equal(decodeURIComponent(f.toString()), 'line_items[0][price]=p&line_items[0][quantity]=1');
  });
  test('verifica firmas de webhook', () => {
    const payload = '{"id":"evt_1"}';
    assert.deepEqual(verifyWebhook(payload, signPayload(payload, 'whsec_x'), 'whsec_x'), { id: 'evt_1' });
    assert.throws(() => verifyWebhook(payload, signPayload(payload, 'whsec_otro'), 'whsec_x'), /Firma no válida/);
  });
  test('los paquetes son hipótesis coherentes y crecientes', () => {
    assert.ok(PLANS.starter.priceEur < PLANS.growth.priceEur && PLANS.growth.priceEur < PLANS.scale.priceEur);
    assert.ok(PLANS.starter.limit < PLANS.growth.limit && PLANS.growth.limit < PLANS.scale.limit);
  });
});

describe('Web pública', () => {
  let app; before(async () => { app = await startApp(); }); after(() => app.close());
  const b = () => browser(app.base);

  test('las páginas públicas responden y no inventan clientes ni resultados', async () => {
    for (const path of ['/', '/servicios', '/muestras', '/precios', '/presupuesto', '/legal/privacidad', '/legal/terminos', '/legal/aviso-legal', '/legal/cookies', '/soporte']) {
      const r = await b().get(path);
      assert.equal(r.status, 200, path);
    }
    const m = await b().get('/muestras');
    assert.match(m.text, /ejemplos ilustrativos creados por Adforja/);
    assert.doesNotMatch((await b().get('/')).text, /\d+ ?% de (aumento|mejora)|clientes satisfechos|testimonio/i);
    assert.match((await b().get('/precios')).text, /99 €/);
  });

  test('el formulario de presupuesto valida y guarda la solicitud', async () => {
    const x = b();
    const bad = await x.post('/presupuesto', { name: 'Eva', email: 'no-es-correo', service: 'imagenes', accept: '1' });
    assert.equal(bad.status, 400);
    const noAccept = await x.post('/presupuesto', { name: 'Eva', email: 'eva@example.com', service: 'imagenes' });
    assert.equal(noAccept.status, 400);
    const ok = await x.post('/presupuesto', { name: 'Eva', email: 'eva@example.com', company: 'Café Sol', service: 'imagenes', sector: 'Restauración', budget: '100 – 300 €/mes', message: 'Anuncios para el café', accept: '1' });
    assert.equal(ok.location, '/presupuesto?enviado=1');
    const q = app.db.prepare('SELECT * FROM quote_requests WHERE email = ?').get('eva@example.com');
    assert.equal(q.company, 'Café Sol'); assert.equal(q.status, 'nuevo');
    assert.ok(app.sent.some((m) => m.to === 'eva@example.com'));
  });

  test('el campo trampa descarta bots y el CSRF es obligatorio', async () => {
    const x = b();
    await x.post('/presupuesto', { name: 'Bot', email: 'bot@example.com', service: 'video', accept: '1', website: 'http://spam' });
    assert.equal(app.db.prepare('SELECT * FROM quote_requests WHERE email = ?').get('bot@example.com'), undefined);
    await x.get('/');
    const r = await x.post('/presupuesto', { name: 'X', email: 'x@example.com', service: 'video', accept: '1' }, { csrf: false });
    assert.equal(r.status, 403);
  });

  test('escapa HTML en datos del usuario', async () => {
    const x = b();
    await x.post('/presupuesto', { name: '<script>alert(1)</script>', email: 'xss@example.com', service: 'video', accept: '1' });
    const admin = b(); await admin.register('admin@example.com');
    const page = await admin.get('/admin');
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.text, /<script>alert\(1\)/);
  });
});

describe('Cuentas, paquetes y pedidos', () => {
  let app; before(async () => { app = await startApp(); }); after(() => app.close());

  async function subscribed(email) {
    const x = browser(app.base);
    await x.register(email);
    const u = userByEmail(app.db, email);
    const sub = makeSub({ id: `sub_${u.id}`, customer: `cus_${u.id}`, userId: u.id, price: PRICE_GROWTH, amount: 24900 });
    app.db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(`cus_${u.id}`, u.id);
    const r = await sendWebhook(app.base, event('customer.subscription.created', sub));
    assert.equal(r.status, 200);
    return { x, u };
  }

  test('sin paquete no se pueden crear pedidos', async () => {
    const x = browser(app.base); await x.register('sin@example.com');
    const r = await x.post('/panel/pedidos', { service: 'imagenes', title: 'Prueba', brief: 'Necesito anuncios de verano' });
    assert.equal(r.status, 402);
    assert.equal(app.db.prepare('SELECT COUNT(*) c FROM orders').get().c, 0);
  });

  test('un paquete activo permite pedir, consume cupo y respeta las revisiones', async () => {
    const { x, u } = await subscribed('pack@example.com');
    assert.equal(app.billing.entitlement(u.id).plan.key, 'growth');
    const r = await x.post('/panel/pedidos', { service: 'imagenes', title: 'Campaña otoño', brief: 'Cinco imágenes para Instagram', assets_url: 'https://drive.example.com/x' });
    assert.match(r.location, /^\/panel\/pedidos\/\d+$/);
    const o = app.db.prepare('SELECT * FROM orders WHERE user_id = ?').get(u.id);
    assert.equal(o.revisions_max, 2);
    assert.equal(app.billing.entitlement(u.id).used, 1);
    assert.equal((await x.post('/panel/pedidos', { service: 'imagenes', title: 'X', brief: 'Brief válido largo', assets_url: 'javascript:alert(1)' })).status, 400);
    // no puede pedir cambios hasta que esté entregado
    assert.equal((await x.post(`/panel/pedidos/${o.id}/revision`, { body: 'Cambia el color' })).status, 400);
    app.db.prepare(`UPDATE orders SET status = 'entregado', delivery_url = 'https://x.example/f' WHERE id = ?`).run(o.id);
    assert.equal((await x.post(`/panel/pedidos/${o.id}/revision`, { body: 'Cambia el color' })).status, 303);
    app.db.prepare(`UPDATE orders SET status = 'entregado' WHERE id = ?`).run(o.id);
    assert.equal((await x.post(`/panel/pedidos/${o.id}/revision`, { body: 'Otro cambio' })).status, 303);
    app.db.prepare(`UPDATE orders SET status = 'entregado' WHERE id = ?`).run(o.id);
    assert.equal((await x.post(`/panel/pedidos/${o.id}/revision`, { body: 'Tercero' })).status, 400); // agotadas
  });

  test('el cupo mensual se agota', async () => {
    const { x, u } = await subscribed('cupo@example.com');
    const t = Date.now();
    app.db.prepare(`INSERT INTO orders (user_id, service, title, units, created_at, updated_at) VALUES (?,?,?,?,?,?)`).run(u.id, 'imagenes', 'Bulk', PLANS.growth.limit, t, t);
    const r = await x.post('/panel/pedidos', { service: 'textos', title: 'Uno más', brief: 'Textos para anuncios' });
    assert.equal(r.status, 402);
  });

  test('un cliente no puede ver pedidos de otro ni entrar al admin', async () => {
    const a = await subscribed('a1@example.com');
    await a.x.post('/panel/pedidos', { service: 'video', title: 'Privado', brief: 'Vídeo de producto' });
    const o = app.db.prepare('SELECT * FROM orders WHERE user_id = ?').get(a.u.id);
    const other = browser(app.base); await other.register('b1@example.com');
    assert.equal((await other.get(`/panel/pedidos/${o.id}`)).status, 404);
    assert.equal((await other.get('/admin')).status, 404);
    assert.equal((await other.get(`/admin/pedidos/${o.id}`)).status, 404);
  });

  test('el admin gestiona un pedido y avisa al cliente', async () => {
    const adm = browser(app.base); await adm.register('admin@example.com');
    assert.equal(userByEmail(app.db, 'admin@example.com').is_admin, 1);
    const { x, u } = await subscribed('cli@example.com');
    await x.post('/panel/pedidos', { service: 'textos', title: 'Textos', brief: 'Diez titulares nuevos' });
    const o = app.db.prepare('SELECT * FROM orders WHERE user_id = ?').get(u.id);
    assert.equal((await adm.post(`/admin/pedidos/${o.id}/estado`, { status: 'entregado', delivery_url: '' })).status, 400);
    assert.equal((await adm.post(`/admin/pedidos/${o.id}/estado`, { status: 'entregado', delivery_url: 'http://inseguro' })).status, 400);
    assert.equal((await adm.post(`/admin/pedidos/${o.id}/estado`, { status: 'entregado', delivery_url: 'https://files.example.com/a' })).status, 303);
    assert.equal(app.db.prepare('SELECT status FROM orders WHERE id = ?').get(o.id).status, 'entregado');
    assert.ok(app.sent.some((m) => m.to === 'cli@example.com' && /entregado/.test(m.subject)));
    await adm.post(`/admin/pedidos/${o.id}/mensaje`, { body: 'Listo' });
    assert.match((await x.get(`/panel/pedidos/${o.id}`)).text, /Equipo Adforja/);
  });

  test('el checkout solo acepta paquetes válidos', async () => {
    const x = browser(app.base); await x.register('chk@example.com');
    assert.equal((await x.post('/facturacion/checkout', { plan: 'free' })).status, 400);
    assert.equal((await x.post('/facturacion/checkout', { plan: 'oro' })).status, 400);
    const r = await x.post('/facturacion/checkout', { plan: 'scale' });
    assert.equal(r.status, 303);
    assert.match(r.location, /checkout\.stripe\.com/);
  });

  test('webhooks sin firma válida se rechazan', async () => {
    const r = await sendWebhook(app.base, event('customer.subscription.created', makeSub({ customer: 'c', userId: 1 })), { secret: 'whsec_falso' });
    assert.equal(r.status, 400);
  });
});

describe('SEO básico', () => {
  test('páginas públicas con canonical, sitemap y robots; privadas con noindex', async () => {
    const ctx = await startApp();
    try {
      const home = await (await fetch(`${ctx.base}/`)).text();
      assert.match(home, /<link rel="canonical" href="http:\/\/localhost:3000\/">/);
      assert.match(home, /application\/ld\+json/);
      const priv = await (await fetch(`${ctx.base}/entrar`)).text();
      assert.match(priv, /noindex/);
      const sm = await (await fetch(`${ctx.base}/sitemap.xml`)).text();
      assert.match(sm, /<loc>http:\/\/localhost:3000\/servicios<\/loc>/);
      assert.match(await (await fetch(`${ctx.base}/robots.txt`)).text(), /Sitemap: http:\/\/localhost:3000\/sitemap\.xml/);
    } finally { await ctx.close(); }
  });
});
