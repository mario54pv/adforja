import { PLANS } from './config.js';
import { SERVICES, SECTORS, BUDGETS, ORDER_STATUS, QUOTE_STATUS, SAMPLES } from './catalog.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (cents, currency = 'eur') => new Intl.NumberFormat('es-ES', { style: 'currency', currency: (currency || 'eur').toUpperCase() }).format((cents || 0) / 100);
const date = (ms) => (ms ? new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const csrfField = (t) => `<input type="hidden" name="_csrf" value="${esc(t)}">`;
const opts = (list, cur) => list.map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('');

const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill="currentColor"/><path d="M9 23L16 8l7 15M12 18.5h8" fill="none" stroke="var(--paper)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function layout({ title, body, user, csrf, flash, stripeMode, description, wide, canonical, noindex, jsonld }) {
  const nav = user
    ? `<a href="/panel">Mis pedidos</a><a href="/panel/facturacion">Facturación</a>${user.is_admin ? '<a href="/admin">Admin</a>' : ''}
       <form method="post" action="/salir" class="inline">${csrfField(csrf)}<button class="link">Salir</button></form>`
    : `<a href="/servicios">Servicios</a><a href="/muestras">Muestras</a><a href="/precios">Paquetes</a><a href="/entrar">Entrar</a><a class="btn btn-sm" href="/presupuesto">Pedir presupuesto</a>`;
  const testBanner = stripeMode === 'test'
    ? '<div class="testmode">Modo de pruebas de Stripe: no se realizan cobros reales. Tarjeta de prueba 4242 4242 4242 4242.</div>' : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Adforja</title>
<meta name="description" content="${esc(description || 'Imágenes, vídeos cortos y textos para tus anuncios, creados con IA y revisados por personas. Pide presupuesto sin compromiso.')}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Adforja"><meta property="og:locale" content="es_ES">
<meta property="og:title" content="${esc(title)} · Adforja"><meta property="og:url" content="${esc(canonical)}">
<meta property="og:description" content="${esc(description || 'Imágenes, vídeos cortos y textos para tus anuncios, creados con IA y revisados por personas. Pide presupuesto sin compromiso.')}">
<meta name="twitter:card" content="summary">` : ''}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
${testBanner}
<header class="site-header"><div class="wrap header-row">
  <a class="brand" href="/">${LOGO}<span>Adforja</span></a>
  <nav class="nav">${nav}</nav>
</div></header>
<main class="${wide ? 'wrap wide' : 'wrap'}">
${flash ? `<div class="flash flash-${esc(flash.type)}" role="status">${esc(flash.text)}</div>` : ''}
${body}
</main>
<footer class="site-footer"><div class="wrap footer-row">
  <span>© ${new Date().getFullYear()} Adforja</span>
  <nav><a href="/servicios">Servicios</a><a href="/muestras">Muestras</a><a href="/precios">Paquetes</a><a href="/legal/aviso-legal">Aviso legal</a><a href="/legal/privacidad">Privacidad</a><a href="/legal/terminos">Términos</a><a href="/legal/cookies">Cookies</a><a href="/soporte">Contacto</a></nav>
</div></footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}

function sampleSvg(s) {
  const [bg, hi, fg] = s.palette;
  const words = esc(s.headline).split(' ');
  const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 18) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  const text = lines.slice(0, 4).map((l, i) => `<tspan x="28" dy="${i ? 34 : 0}">${l}</tspan>`).join('');
  return `<svg viewBox="0 0 320 320" role="img" aria-label="Muestra ilustrativa: ${esc(s.title)}" class="sample-svg">
    <rect width="320" height="320" fill="${bg}"/><circle cx="270" cy="60" r="90" fill="${hi}" opacity=".28"/><circle cx="300" cy="300" r="70" fill="${hi}" opacity=".5"/>
    <text x="28" y="120" font-family="Georgia,serif" font-size="27" font-weight="700" fill="${fg}">${text}</text>
    <rect x="28" y="252" width="${40 + s.cta.length * 9}" height="40" rx="20" fill="${hi}"/><text x="${28 + (40 + s.cta.length * 9) / 2}" y="277" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="${bg}">${esc(s.cta)}</text>
  </svg>`;
}

export function landingPage() {
  const svc = Object.values(SERVICES).filter((s) => s.key !== 'paquete');
  return `
<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">Estudio de creatividades para anuncios</p>
    <h1>Anuncios que se ven profesionales, sin montar un equipo de diseño</h1>
    <p class="lead">Imágenes, vídeos cortos y textos para Meta, Google y marketplaces. Los producimos con herramientas de IA y los revisa una persona antes de entregártelos.</p>
    <div class="cta-row"><a class="btn" href="/presupuesto">Pedir presupuesto</a><a class="btn btn-ghost" href="/muestras">Ver muestras de estilo</a></div>
    <p class="fine">Respuesta en un día laborable. Sin compromiso ni permanencia.</p>
  </div>
  <figure class="demo-card" aria-label="Muestra de estilo">
    ${sampleSvg(SAMPLES[2])}
    <figcaption>Muestra ilustrativa creada por Adforja. No es el trabajo de un cliente.</figcaption>
  </figure>
</section>

<div class="trust"><span>Revisión humana en cada entrega</span><span>Precio cerrado antes de empezar</span><span>Revisiones incluidas</span><span>Sin permanencia en los paquetes</span></div>

<section class="section">
  <h2>Qué hacemos</h2>
  <div class="grid3">
    ${svc.map((s) => `<div class="card"><h3>${esc(s.name)}</h3><p>${esc(s.summary)}</p><p class="muted">Desde ${s.fromEur} € · ${esc(s.unit)}</p></div>`).join('')}
  </div>
  <p><a href="/servicios">Ver detalle de cada servicio →</a></p>
</section>

<section class="section">
  <h2>Cómo trabajamos</h2>
  <ol class="steps">
    <li><strong>Nos cuentas tu objetivo:</strong> producto, público y dónde vas a anunciarte.</li>
    <li><strong>Te enviamos un presupuesto cerrado</strong> con plazo y número de revisiones.</li>
    <li><strong>Producimos y revisamos:</strong> la IA acelera el borrador; una persona cuida marca, ortografía y mensajes.</li>
    <li><strong>Recibes los archivos listos</strong> en tu panel y pides los cambios incluidos.</li>
  </ol>
</section>

<section class="section">
  <h2>Preguntas frecuentes</h2>
  ${faq()}
</section>

<section class="section final-cta">
  <h2>Cuéntanos qué quieres anunciar</h2>
  <p>Te respondemos con una propuesta y un precio cerrado.</p>
  <a class="btn" href="/presupuesto">Pedir presupuesto</a>
</section>`;
}

function faq() {
  const items = [
    ['¿Usáis inteligencia artificial?', 'Sí. Usamos herramientas de IA para acelerar bocetos, variantes y vídeo, y una persona revisa cada entrega. Te lo contamos con transparencia porque afecta a derechos de uso: lo detallamos en los términos.'],
    ['¿Garantizáis resultados de ventas?', 'No. Entregamos creatividades profesionales y variantes para que pruebes qué funciona, pero los resultados dependen de tu oferta, tu presupuesto publicitario y tu segmentación.'],
    ['¿Cuántas revisiones incluye?', 'Cada servicio indica sus rondas de cambios incluidas (una en pedidos sueltos, dos en paquetes Growth y Scale). Las adicionales se presupuestan aparte.'],
    ['¿Puedo cancelar el paquete mensual?', 'Sí, cuando quieras desde tu panel. Mantienes el cupo hasta el final del periodo ya pagado.'],
    ['¿Las muestras son trabajos reales?', 'No. Las muestras de la web son ejemplos de estilo creados por nosotros y están etiquetadas como tales. Iremos añadiendo casos reales cuando los haya y el cliente lo autorice.'],
    ['¿Qué necesito aportar?', 'Tu logo, fotos de producto si las tienes y cualquier guía de marca. Si no tienes nada, empezamos con una propuesta sencilla.'],
  ];
  return `<div class="faq">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
}

export function servicesPage() {
  return `
<section class="section">
  <h1>Servicios</h1>
  <p class="lead">Importes orientativos "desde". El presupuesto cerrado depende de formatos, cantidad y complejidad.</p>
  <div class="grid2">
  ${Object.values(SERVICES).map((s) => `<article class="card">
    <h2>${esc(s.name)}</h2>
    <p>${esc(s.summary)}</p>
    <ul class="checks">${s.includes.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
    <p class="muted">Desde ${s.fromEur} € ${s.key === 'paquete' ? '/mes' : ''} · ${esc(s.unit)} · entrega: ${esc(s.delivery)}</p>
    <a class="btn btn-ghost" href="/presupuesto?servicio=${s.key}">Pedir presupuesto</a>
  </article>`).join('')}
  </div>
  <p class="fine">IVA no incluido. Los importes "desde" son referencias de lanzamiento y pueden ajustarse tras hablar con cada cliente.</p>
</section>`;
}

export function samplesPage() {
  return `
<section class="section">
  <h1>Muestras de estilo</h1>
  <div class="flash flash-info">Estas piezas son <strong>ejemplos ilustrativos creados por Adforja</strong> para mostrar estilo y formatos. No corresponden a clientes reales ni a resultados publicitarios.</div>
  <div class="grid3 samples">
    ${SAMPLES.map((s) => `<figure class="card sample">${sampleSvg(s)}<figcaption><strong>${esc(s.title)}</strong><br><span class="muted">${esc(s.kind)} · muestra ilustrativa</span></figcaption></figure>`).join('')}
  </div>
  <p>¿Quieres algo así para tu negocio? <a href="/presupuesto">Pide presupuesto</a>.</p>
</section>`;
}

export function pricingPage({ user, csrf, entitlement, canceled, stripeReady }) {
  const card = (p, featured) => {
    let action;
    if (!user) action = `<a class="btn ${featured ? '' : 'btn-ghost'}" href="/registro?plan=${p.key}">Empezar</a>`;
    else if (entitlement?.paid && entitlement.plan.key === p.key) action = '<span class="badge">Tu paquete actual</span>';
    else if (entitlement?.paid) action = `<a class="btn btn-ghost" href="/panel/facturacion">Cambiar de paquete</a>`;
    else if (!stripeReady) action = '<button class="btn" disabled>Pagos no disponibles todavía</button>';
    else action = `<form method="post" action="/facturacion/checkout">${csrfField(csrf)}<input type="hidden" name="plan" value="${p.key}"><button class="btn ${featured ? '' : 'btn-ghost'}">Suscribirme</button></form>`;
    return `<div class="price-card ${featured ? 'featured' : ''}">
      ${featured ? '<span class="ribbon">Más elegido para empezar</span>' : ''}
      <h3>${esc(p.name)}</h3>
      <p class="price"><span>${p.priceEur.toLocaleString('es-ES')} €</span>/mes</p>
      <p class="muted">IVA no incluido</p>
      <ul class="checks">
        <li>Hasta ${p.limit} entregables al mes</li>
        <li>${p.revisions} ${p.revisions === 1 ? 'ronda' : 'rondas'} de cambios por pedido</li>
        <li>Panel con estado de cada pedido</li>
        <li>Imágenes, textos y vídeo corto</li>
        <li>Sin permanencia</li>
      </ul>
      ${action}
    </div>`;
  };
  return `
<section class="section">
  <h1>Paquetes mensuales</h1>
  <p class="lead">Un entregable es una pieza (una imagen, un vídeo corto o un pack de textos). Los paquetes están pensados para negocios que anuncian cada mes.</p>
  ${canceled ? '<div class="flash flash-info">Has cancelado el pago. No se ha realizado ningún cargo.</div>' : ''}
  <div class="pricing three">${card(PLANS.starter, false)}${card(PLANS.growth, true)}${card(PLANS.scale, false)}</div>
  <p class="fine">Precios de lanzamiento de Adforja. ¿Prefieres algo puntual? <a href="/presupuesto">Pide un presupuesto por pedido</a>.</p>
</section>
<section class="section"><h2>Preguntas frecuentes</h2>${faq()}</section>`;
}

export function quotePage({ csrf, error, values = {}, service, sent }) {
  if (sent) return `<section class="section narrow center"><div class="card"><h1>Solicitud recibida</h1><p>Gracias. Te responderemos en un día laborable con una propuesta y un precio cerrado.</p><a class="btn" href="/">Volver al inicio</a></div></section>`;
  const v = { service: service || 'imagenes', ...values };
  return `
<section class="section narrow">
  <h1>Pide presupuesto</h1>
  <p class="lead">Cuéntanos qué necesitas. No hace falta tarjeta ni compromiso.</p>
  ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
  <form method="post" action="/presupuesto" class="card form">${csrfField(csrf)}
    <div class="hp" aria-hidden="true"><label>No rellenar<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label>Tu nombre<input name="name" required maxlength="80" autocomplete="name" value="${esc(v.name)}"></label>
    <label>Correo electrónico<input name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(v.email)}"></label>
    <label>Empresa o negocio<input name="company" maxlength="120" value="${esc(v.company)}"></label>
    <label>Sector<select name="sector"><option value="">Elige uno</option>${opts(SECTORS, v.sector)}</select></label>
    <label>Qué necesitas<select name="service">${Object.values(SERVICES).map((s) => `<option value="${s.key}" ${s.key === v.service ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label>Presupuesto aproximado<select name="budget"><option value="">Prefiero no decirlo</option>${opts(BUDGETS, v.budget)}</select></label>
    <label>Cuéntanos tu objetivo<textarea name="message" rows="5" maxlength="3000" placeholder="Qué vendes, a quién y dónde quieres anunciarte">${esc(v.message)}</textarea></label>
    <label class="check"><input type="checkbox" name="accept" value="1" required> He leído la <a href="/legal/privacidad" target="_blank">política de privacidad</a> y acepto que Adforja use estos datos para responder a mi solicitud.</label>
    <button class="btn">Enviar solicitud</button>
  </form>
</section>`;
}

export function authPage({ mode, csrf, error, values = {}, plan }) {
  const titles = { registro: 'Crea tu cuenta de cliente', entrar: 'Entra en tu cuenta', olvido: 'Recuperar contraseña', restablecer: 'Nueva contraseña' };
  let fields = '';
  if (mode === 'registro') fields = `
    <label>Nombre<input name="name" autocomplete="name" required maxlength="80" value="${esc(values.name)}"></label>
    <label>Correo electrónico<input name="email" type="email" autocomplete="email" required maxlength="200" value="${esc(values.email)}"></label>
    <label>Contraseña<input name="password" type="password" autocomplete="new-password" required minlength="10" maxlength="200"><small>Mínimo 10 caracteres.</small></label>
    <label class="check"><input type="checkbox" name="accept" value="1" required> Acepto los <a href="/legal/terminos" target="_blank">términos</a> y he leído la <a href="/legal/privacidad" target="_blank">política de privacidad</a>.</label>
    ${plan ? `<input type="hidden" name="plan" value="${esc(plan)}">` : ''}`;
  if (mode === 'entrar') fields = `
    <label>Correo electrónico<input name="email" type="email" autocomplete="email" required value="${esc(values.email)}"></label>
    <label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label>`;
  if (mode === 'olvido') fields = `
    <p class="muted">Te enviaremos un enlace para crear una contraseña nueva.</p>
    <label>Correo electrónico<input name="email" type="email" autocomplete="email" required></label>`;
  if (mode === 'restablecer') fields = `
    <input type="hidden" name="token" value="${esc(values.token)}">
    <label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" required minlength="10"></label>`;
  const submit = { registro: 'Crear cuenta', entrar: 'Entrar', olvido: 'Enviar enlace', restablecer: 'Guardar contraseña' }[mode];
  const footer = {
    registro: '¿Ya tienes cuenta? <a href="/entrar">Entra</a>',
    entrar: '<a href="/olvido">¿Has olvidado tu contraseña?</a> · <a href="/registro">Crear cuenta</a>',
    olvido: '<a href="/entrar">Volver</a>', restablecer: '',
  }[mode];
  return `<section class="auth card">
    <h1>${titles[mode]}</h1>
    ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
    <form method="post" class="form">${csrfField(csrf)}${fields}<button class="btn">${submit}</button></form>
    <p class="muted center">${footer}</p>
  </section>`;
}

const statusBadge = (s) => `<span class="badge st-${esc(s)}">${esc(ORDER_STATUS[s] || s)}</span>`;

export function dashboardPage({ user, csrf, ent, orders, error, values = {}, canOrder }) {
  const v = { service: 'imagenes', ...values };
  const pct = ent.limit ? Math.min(100, Math.round((ent.used / ent.limit) * 100)) : 0;
  return `
<div class="dash">
  <section class="card generator">
    <h1>Mis pedidos</h1>
    ${orders.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Pedido</th><th>Servicio</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>
      ${orders.map((o) => `<tr><td>${o.id}</td><td><a href="/panel/pedidos/${o.id}">${esc(o.title)}</a></td><td>${esc(SERVICES[o.service]?.name || o.service)}</td><td>${statusBadge(o.status)}</td><td>${date(o.created_at)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Todavía no tienes pedidos. Crea el primero con el formulario.</p>'}
  </section>
  <aside class="side">
    <div class="card">
      <h2>${ent.paid ? `Paquete ${esc(ent.plan.name)}` : 'Sin paquete mensual'}</h2>
      ${ent.paid ? `<progress class="meter" value="${Math.min(ent.used, ent.limit)}" max="${ent.limit}">${pct}%</progress>
        <p><strong>${ent.used}</strong> de ${ent.limit} entregables usados este periodo.</p>
        <p class="muted">Se renueva el ${date(ent.sub.current_period_end * 1000)}.</p>`
        : '<p class="muted">Para crear pedidos desde el panel necesitas un paquete mensual. Si prefieres un trabajo puntual, <a href="/presupuesto">pide un presupuesto</a>.</p><a class="btn btn-sm" href="/precios">Ver paquetes</a>'}
    </div>
  </aside>
</div>
<section class="card form-card">
  <h2>Nuevo pedido</h2>
  ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
  ${canOrder ? `<form method="post" action="/panel/pedidos" class="form">${csrfField(csrf)}
    <label>Servicio<select name="service">${Object.values(SERVICES).filter((s) => s.key !== 'paquete').map((s) => `<option value="${s.key}" ${s.key === v.service ? 'selected' : ''}>${esc(s.name)} (${esc(s.unit)})</option>`).join('')}</select></label>
    <label>Título del pedido<input name="title" required maxlength="120" value="${esc(v.title)}" placeholder="Campaña de otoño – zapatillas"></label>
    <label>Qué necesitas<textarea name="brief" rows="6" required maxlength="4000" placeholder="Producto, público, mensaje principal, formatos y dónde se publicará">${esc(v.brief)}</textarea></label>
    <label>Enlace a tus materiales (opcional)<input name="assets_url" type="url" maxlength="500" value="${esc(v.assets_url)}" placeholder="https://drive.google.com/…"><small>Logo, fotos y guía de marca. Comprueba que el enlace permita verlos.</small></label>
    <button class="btn">Enviar pedido</button>
  </form>` : '<p class="muted">Activa un paquete mensual para crear pedidos aquí.</p>'}
</section>`;
}

export function orderPage({ csrf, order, messages, isAdmin, maxRevisions }) {
  const canRevise = !isAdmin && order.status === 'entregado' && order.revisions_used < order.revisions_max;
  return `
<section class="section narrow">
  <p><a href="${isAdmin ? '/admin' : '/panel'}">← Volver</a></p>
  <h1>${esc(order.title)}</h1>
  <p>${statusBadge(order.status)} <span class="muted">· ${esc(SERVICES[order.service]?.name || order.service)} · pedido #${order.id} · ${date(order.created_at)}</span></p>
  <div class="card"><h2>Encargo</h2><p class="pre">${esc(order.brief)}</p>
    ${order.assets_url ? `<p>Materiales: <a href="${esc(order.assets_url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(order.assets_url)}</a></p>` : ''}
    <p class="muted">Rondas de cambios usadas: ${order.revisions_used} de ${order.revisions_max}.</p></div>
  ${order.delivery_url ? `<div class="card"><h2>Entrega</h2><p><a class="btn" href="${esc(order.delivery_url)}" rel="noopener noreferrer nofollow" target="_blank">Abrir archivos entregados</a></p></div>` : ''}
  ${canRevise ? `<div class="card"><h2>Pedir cambios</h2><form method="post" action="/panel/pedidos/${order.id}/revision" class="form">${csrfField(csrf)}
    <label>Qué quieres cambiar<textarea name="body" rows="4" required maxlength="2000"></textarea></label><button class="btn">Enviar cambios</button></form>
    <form method="post" action="/panel/pedidos/${order.id}/aprobar" class="form">${csrfField(csrf)}<button class="btn btn-ghost">Todo correcto, cerrar pedido</button></form></div>` : ''}
  <div class="card"><h2>Conversación</h2>
    ${messages.length ? messages.map((m) => `<div class="msg msg-${esc(m.author)}"><strong>${m.author === 'equipo' ? 'Equipo Adforja' : 'Tú'}</strong> <span class="muted">${dateTime(m.created_at)}</span><p class="pre">${esc(m.body)}</p></div>`).join('') : '<p class="muted">Sin mensajes todavía.</p>'}
    <form method="post" action="${isAdmin ? `/admin/pedidos/${order.id}/mensaje` : `/panel/pedidos/${order.id}/mensaje`}" class="form">${csrfField(csrf)}
      <label>Escribir mensaje<textarea name="body" rows="3" required maxlength="2000"></textarea></label><button class="btn btn-sm">Enviar</button></form>
  </div>
  ${isAdmin ? `<div class="card"><h2>Gestión (admin)</h2>
    <form method="post" action="/admin/pedidos/${order.id}/estado" class="form">${csrfField(csrf)}
      <label>Estado<select name="status">${Object.entries(ORDER_STATUS).map(([k, l]) => `<option value="${k}" ${k === order.status ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label>Enlace de entrega (https)<input name="delivery_url" type="url" maxlength="500" value="${esc(order.delivery_url)}"></label>
      <button class="btn btn-sm">Guardar</button></form></div>` : ''}
</section>`;
}

export function billingPage({ csrf, ent, sub, payments, stripeReady, hasCustomer }) {
  let status;
  if (ent.paid) {
    status = `<p>Paquete <strong>${esc(ent.plan.name)}</strong> · ${sub.unit_amount != null ? eur(sub.unit_amount, sub.currency) : ent.plan.priceEur + ' €'}/mes.</p>
      ${sub.cancel_at_period_end
        ? `<div class="flash flash-info">Tu suscripción está cancelada y finalizará el ${date(sub.current_period_end * 1000)}. No se te volverá a cobrar.</div>
           <form method="post" action="/facturacion/reanudar">${csrfField(csrf)}<button class="btn">Reanudar suscripción</button></form>`
        : `<p class="muted">Próxima renovación: ${date(sub.current_period_end * 1000)}.</p>
           <form method="post" action="/facturacion/cancelar" data-confirm="¿Seguro que quieres cancelar? Mantendrás el cupo hasta el final del periodo pagado.">${csrfField(csrf)}<button class="btn btn-danger">Cancelar suscripción</button></form>`}`;
  } else if (sub && sub.status === 'past_due') {
    status = '<div class="flash flash-error">El último cobro ha fallado. Actualiza tu método de pago para recuperar el paquete.</div>';
  } else if (sub && sub.status === 'incomplete') {
    status = '<div class="flash flash-info">Tu pago está pendiente de confirmación.</div>';
  } else {
    status = '<p>No tienes ningún paquete mensual activo.</p><a class="btn" href="/precios">Ver paquetes</a>';
  }
  return `
<section class="section narrow">
  <h1>Facturación</h1>
  <div class="card">${status}</div>
  ${hasCustomer && stripeReady ? `<div class="card"><h2>Método de pago, facturas y cambio de paquete</h2>
    <p class="muted">Se abre el portal seguro de Stripe, donde puedes cambiar de tarjeta, descargar facturas o cambiar de paquete.</p>
    <form method="post" action="/facturacion/portal">${csrfField(csrf)}<button class="btn btn-ghost">Abrir portal de facturación</button></form></div>` : ''}
  <div class="card"><h2>Pagos</h2>
    ${payments.length ? `<table class="table"><thead><tr><th>Fecha</th><th>Importe</th><th>Estado</th></tr></thead><tbody>
      ${payments.map((p) => `<tr><td>${date(p.created_at)}</td><td>${eur(p.amount, p.currency)}</td><td>${p.status === 'paid' ? 'Pagado' : 'Fallido'}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted">Todavía no hay pagos.</p>'}
  </div>
</section>`;
}

export function checkoutReturnPage({ active }) {
  return active
    ? `<section class="section narrow center"><div class="card"><h1>¡Paquete activado!</h1><p>Hemos verificado tu pago con Stripe. Ya puedes crear pedidos.</p><a class="btn" href="/panel">Ir a mis pedidos</a></div></section>`
    : `<section class="section narrow center"><div class="card"><h1>Verificando tu pago…</h1>
       <p>Estamos esperando la confirmación de Stripe. Esta página se actualizará sola en unos segundos.</p>
       <p class="muted">Si tarda más de un minuto, escríbenos desde <a href="/soporte">contacto</a>. No se activa ningún paquete hasta que Stripe confirma el pago.</p></div></section>`;
}

export function accountPage({ user, csrf, hasActiveSub }) {
  return `
<section class="section narrow">
  <h1>Mi cuenta</h1>
  <form method="post" action="/panel/cuenta" class="card form">${csrfField(csrf)}
    <h2>Tus datos</h2>
    <label>Tu nombre<input name="name" maxlength="80" value="${esc(user.name)}"></label>
    <label>Empresa o negocio<input name="business_name" maxlength="120" value="${esc(user.business_name)}"></label>
    <button class="btn">Guardar</button>
  </form>
  <div class="card">
    <h2>Eliminar cuenta</h2>
    ${hasActiveSub
      ? '<p class="muted">Para eliminar tu cuenta, primero cancela tu suscripción desde <a href="/panel/facturacion">Facturación</a> y espera a que finalice.</p>'
      : `<p class="muted">Se borrarán tus datos y pedidos de forma permanente. Las facturas emitidas se conservan en Stripe por obligación legal.</p>
         <form method="post" action="/panel/eliminar" data-confirm="Esta acción no se puede deshacer. ¿Eliminar tu cuenta?">${csrfField(csrf)}<button class="btn btn-danger">Eliminar mi cuenta</button></form>`}
  </div>
</section>`;
}

export function supportPage({ csrf, user, sent, error }) {
  return `
<section class="section narrow">
  <h1>Contacto</h1>
  ${sent ? '<div class="flash flash-success">Hemos recibido tu mensaje. Te responderemos por correo lo antes posible.</div>' : ''}
  ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
  <form method="post" action="/soporte" class="card form">${csrfField(csrf)}
    ${user ? '' : '<label>Tu correo<input name="email" type="email" required maxlength="200"></label>'}
    <label>Asunto<input name="subject" required maxlength="150"></label>
    <label>Mensaje<textarea name="message" rows="6" required maxlength="5000"></textarea></label>
    <button class="btn">Enviar</button>
  </form>
</section>`;
}

export function messagePage(title, text, link) {
  return `<section class="section narrow center"><div class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p>${link ? `<a class="btn" href="${esc(link.href)}">${esc(link.label)}</a>` : ''}</div></section>`;
}

export function adminPage({ csrf, stats, quotes, orders, users, subs, payments, tickets, errors, emails, events, expenses, health }) {
  const kpi = (label, value) => `<div class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const table = (heads, rows) => rows.length
    ? `<div class="table-wrap"><table class="table"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Sin datos.</p>';
  return `
<h1>Administración</h1>
<div class="card health"><h2>Estado de los servicios</h2><ul>${health.map((h) => `<li class="${h.ok ? 'ok' : 'bad'}">${esc(h.label)}: ${esc(h.detail)}</li>`).join('')}</ul></div>
<div class="kpis">
  ${kpi('Solicitudes de presupuesto (30 d)', stats.quotes30)}${kpi('Pedidos abiertos', stats.openOrders)}${kpi('Suscriptores activos', stats.activeSubs)}
  ${kpi('Ingresos recurrentes (MRR)', eur(stats.mrr))}${kpi('Cobrado últimos 30 días', eur(stats.revenue30))}${kpi('Gastos 30 días', eur(stats.expenses30))}
</div>
<div class="card"><h2>Solicitudes de presupuesto</h2>${table(['Fecha', 'Nombre', 'Correo', 'Empresa', 'Servicio', 'Presupuesto', 'Mensaje', 'Estado'], quotes.map((q) => [dateTime(q.created_at), esc(q.name), esc(q.email), esc(q.company), esc(SERVICES[q.service]?.name || q.service), esc(q.budget), `<span class="clip">${esc(q.message)}</span>`,
    `<form method="post" action="/admin/presupuestos/${q.id}/estado" class="inline">${csrfField(csrf)}<select name="status" data-autosubmit>${QUOTE_STATUS.map((s) => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn btn-sm btn-ghost">OK</button></form>`]))}</div>
<div class="card"><h2>Pedidos</h2>${table(['#', 'Cliente', 'Pedido', 'Estado', 'Fecha'], orders.map((o) => [o.id, esc(o.email), `<a href="/admin/pedidos/${o.id}">${esc(o.title)}</a>`, statusBadge(o.status), dateTime(o.created_at)]))}</div>
<div class="card"><h2>Tickets de contacto</h2>${table(['Fecha', 'Correo', 'Asunto', 'Mensaje', 'Estado', ''], tickets.map((t) => [dateTime(t.created_at), esc(t.email), esc(t.subject), `<span class="clip">${esc(t.message)}</span>`, esc(t.status),
    t.status === 'abierto' ? `<form method="post" action="/admin/tickets/${t.id}/cerrar">${csrfField(csrf)}<button class="btn btn-sm btn-ghost">Cerrar</button></form>` : '']))}</div>
<div class="card"><h2>Suscripciones</h2>${table(['Usuario', 'Paquete', 'Estado', 'Fin del periodo', 'Cancela al final'], subs.map((s) => [esc(s.email), esc(s.plan), esc(s.status), date(s.current_period_end * 1000), s.cancel_at_period_end ? 'Sí' : 'No']))}</div>
<div class="card"><h2>Pagos</h2>${table(['Fecha', 'Usuario', 'Importe', 'Estado', 'Factura'], payments.map((p) => [dateTime(p.created_at), esc(p.email || '—'), eur(p.amount, p.currency), esc(p.status), `<code>${esc(p.id)}</code>`]))}</div>
<div class="card"><h2>Gastos</h2>
  <form method="post" action="/admin/gastos" class="form inline-form">${csrfField(csrf)}
    <input name="concept" placeholder="Concepto (hosting, dominio, herramientas IA…)" required maxlength="120">
    <input name="amount" type="number" step="0.01" min="0" placeholder="Importe €" required>
    <input name="date" type="date" required>
    <button class="btn btn-sm">Añadir</button>
  </form>
  ${table(['Fecha', 'Concepto', 'Importe'], expenses.map((e) => [date(e.date), esc(e.concept), eur(e.amount)]))}</div>
<div class="card"><h2>Usuarios recientes</h2>${table(['Alta', 'Correo', 'Nombre', 'Empresa'], users.map((u) => [date(u.created_at), esc(u.email), esc(u.name), esc(u.business_name)]))}</div>
<div class="card"><h2>Eventos de Stripe recibidos</h2>${table(['Fecha', 'Tipo', 'Id'], events.map((e) => [dateTime(e.received_at), esc(e.type), `<code>${esc(e.id)}</code>`]))}</div>
<div class="card"><h2>Correos</h2>${table(['Fecha', 'Para', 'Asunto', 'Estado'], emails.map((e) => [dateTime(e.created_at), esc(e.to_email), esc(e.subject), esc(e.status + (e.error ? ` (${e.error})` : ''))]))}</div>
<div class="card"><h2>Errores recientes</h2>${table(['Fecha', 'Contexto', 'Mensaje'], errors.map((e) => [dateTime(e.created_at), esc(e.context), esc(e.message)]))}</div>`;
}

export { date, eur };
