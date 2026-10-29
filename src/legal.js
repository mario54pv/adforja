// BORRADORES de textos legales. Deben ser revisados por un profesional antes de publicar.
import { esc } from './views.js';

const note = '<div class="flash flash-info">Borrador pendiente de revisión legal antes de publicar.</div>';

export function legalPage(slug, legal, baseUrl) {
  const L = Object.fromEntries(Object.entries(legal).map(([k, v]) => [k, esc(v)]));
  const pages = {
    'aviso-legal': ['Aviso legal', `
<p>En cumplimiento de la Ley 34/2002, de Servicios de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE), se informa:</p>
<ul><li>Titular: ${L.owner}</li><li>NIF: ${L.taxId}</li><li>Domicilio: ${L.address}</li><li>Correo de contacto: ${L.email}</li><li>Sitio web: ${esc(baseUrl)}</li></ul>
<p>El titular no se hace responsable del uso que los clientes hagan de las creatividades una vez entregadas. Los clientes son responsables de que las campañas en las que las usen cumplan la normativa publicitaria y las políticas de cada plataforma.</p>`],
    privacidad: ['Política de privacidad', `
<h2>Responsable del tratamiento</h2><p>${L.owner} (NIF ${L.taxId}), ${L.address}. Contacto: ${L.email}.</p>
<h2>Qué datos tratamos</h2><ul><li>Datos de cuenta: nombre, correo electrónico y contraseña cifrada.</li><li>Datos de la solicitud de presupuesto: nombre, correo, empresa, sector, necesidad y mensaje.</li><li>Datos de tus pedidos: título, encargo, enlace a materiales y conversación con el equipo. Los materiales (logos, fotos) permanecen en el servicio donde los alojes; solo guardamos el enlace.</li><li>Datos de facturación, gestionados por Stripe. Nunca recibimos ni guardamos los datos completos de tu tarjeta.</li><li>Mensajes que nos envías por soporte.</li></ul>
<h2>Finalidades y bases legales</h2><ul><li>Prestar el servicio contratado (ejecución del contrato).</li><li>Cobrar las suscripciones y emitir facturas (ejecución del contrato y obligación legal).</li><li>Enviarte correos necesarios del servicio: recuperación de contraseña, avisos de pago (ejecución del contrato).</li><li>Atender tus solicitudes de soporte (interés legítimo).</li></ul>
<h2>Encargados del tratamiento</h2><ul><li>Stripe Payments Europe Ltd. (pagos).</li><li>Proveedores de IA generativa que se utilicen para producir borradores de creatividades [COMPLETAR cuando se contraten: nombre, país y garantías]. Antes de enviarles materiales de un cliente se evaluará que no contengan datos personales innecesarios.</li><li>Resend (envío de correos).</li><li>[PROVEEDOR DE ALOJAMIENTO].</li></ul><p>Algunos proveedores pueden tratar datos fuera del Espacio Económico Europeo con las garantías adecuadas (cláusulas contractuales tipo). [REVISAR Y COMPLETAR]</p>
<h2>Conservación</h2><p>Mientras mantengas tu cuenta. Al eliminarla borramos tus datos, salvo los que debamos conservar por obligaciones fiscales.</p>
<h2>Tus derechos</h2><p>Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${L.email}. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>`],
    terminos: ['Términos y condiciones', `
<h2>Servicio</h2><p>Adforja es un estudio que produce imágenes, vídeos cortos y textos para anuncios, con ayuda de herramientas de inteligencia artificial y revisión humana. El cliente es responsable de revisar las piezas y de las campañas en las que las publique. No se garantizan resultados de ventas.</p>
<h2>Entregas, revisiones y derechos de uso</h2><p>Cada pedido indica plazo y rondas de cambios incluidas; las adicionales se presupuestan aparte. Tras el pago, el cliente recibe licencia de uso comercial de las piezas entregadas para sus propias campañas. [REVISAR: titularidad y límites de derechos sobre contenido generado con IA, licencias de música e imágenes de terceros.]</p>
<h2>Paquetes y pagos</h2><p>Las suscripciones se cobran por adelantado cada mes a través de Stripe y se renuevan automáticamente hasta que se cancelen. Los precios se muestran sin IVA, que se añadirá cuando corresponda.</p>
<h2>Cancelación</h2><p>Puedes cancelar en cualquier momento desde tu panel. El cupo de entregables se mantiene hasta el final del periodo pagado y los entregables no usados no se acumulan al mes siguiente. No se realizan reembolsos prorrateados salvo obligación legal.</p>
<h2>Derecho de desistimiento</h2><p>[REVISAR: si se venden servicios a consumidores, el plazo de 14 días y su posible renuncia al empezar a usar el servicio deben redactarse conforme a la normativa de consumidores.]</p>
<h2>Uso aceptable</h2><p>No está permitido encargar contenido ilegal, engañoso, que suplante a terceros o que infrinja derechos de propiedad intelectual. Adforja puede rechazar encargos por ese motivo.</p>
<h2>Limitación de responsabilidad</h2><p>El servicio se presta "tal cual". [REVISAR]</p>
<h2>Ley aplicable</h2><p>Legislación española. [REVISAR]</p>`],
    cookies: ['Política de cookies', `
<p>Este sitio solo utiliza cookies técnicas necesarias para su funcionamiento, que no requieren consentimiento:</p>
<ul><li><code>sid</code>: mantiene tu sesión iniciada (30 días).</li><li><code>csrf</code>: protege los formularios frente a envíos fraudulentos (sesión).</li></ul>
<p>No usamos cookies de análisis ni de publicidad. La medición de visitas se hace con contadores anónimos en nuestro servidor, sin cookies ni identificadores personales.</p>
<p>Al pagar, Stripe puede usar sus propias cookies en su página de pago para prevenir el fraude.</p>`],
  };
  const p = pages[slug];
  if (!p) return null;
  return { title: p[0], body: `<section class="section narrow legal"><h1>${p[0]}</h1>${note}${p[1]}</section>` };
}
