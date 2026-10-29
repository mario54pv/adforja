// Catálogo de servicios y muestras. Todo importe es una REFERENCIA de trabajo, no un precio validado por el mercado.
export const SERVICES = {
  imagenes: {
    key: 'imagenes', name: 'Imágenes publicitarias', unit: 'pack de 5 variantes', fromEur: 49, delivery: '3 días laborables', revisions: 1,
    summary: 'Creatividades estáticas para Meta, Google y marketplaces, en los formatos que necesites (1:1, 4:5, 9:16).',
    includes: ['5 variantes de un mismo concepto', 'Formatos 1:1, 4:5 y 9:16', 'Una ronda de cambios', 'Archivos listos para subir a la plataforma'],
  },
  video: {
    key: 'video', name: 'Vídeo corto para anuncios', unit: '1 vídeo vertical de 15 s', fromEur: 79, delivery: '5 días laborables', revisions: 1,
    summary: 'Vídeo vertical con gancho en los primeros segundos, subtítulos y música libre de derechos.',
    includes: ['1 vídeo vertical de hasta 15 s', 'Subtítulos incluidos', 'Música con licencia de uso comercial', 'Una ronda de cambios'],
  },
  textos: {
    key: 'textos', name: 'Textos para anuncios', unit: 'pack de 10 variantes', fromEur: 29, delivery: '2 días laborables', revisions: 1,
    summary: 'Titulares y textos principales para probar ángulos distintos en Meta Ads y Google Ads.',
    includes: ['10 variantes de titular y texto', 'Ángulos diferenciados para test A/B', 'Adaptado a tu tono de marca', 'Una ronda de cambios'],
  },
  paquete: {
    key: 'paquete', name: 'Paquete mensual', unit: 'suscripción mensual', fromEur: 99, delivery: 'según calendario acordado', revisions: 2,
    summary: 'Un flujo constante de creatividades cada mes, con el mismo equipo y una cola de pedidos en tu panel.',
    includes: ['Cupo mensual de entregables', 'Panel con estado de cada pedido', 'Revisiones incluidas', 'Sin permanencia'],
  },
};

export const SECTORS = ['Restauración', 'Comercio y tienda online', 'Salud y estética', 'Inmobiliaria', 'Formación y academias', 'Servicios profesionales', 'Otro'];
export const BUDGETS = ['Menos de 100 €/mes', '100 – 300 €/mes', '300 – 600 €/mes', 'Más de 600 €/mes', 'Aún no lo sé'];
export const ORDER_STATUS = { recibido: 'Recibido', en_produccion: 'En producción', en_revision: 'Pendiente de tu revisión', entregado: 'Entregado', cancelado: 'Cancelado' };
export const QUOTE_STATUS = ['nuevo', 'contactado', 'presupuestado', 'ganado', 'descartado'];

// Muestras: demostraciones de estilo creadas por Adforja, NO trabajos de clientes. Cada una se etiqueta como tal en la web.
export const SAMPLES = [
  { id: 'a', kind: 'Imagen', title: 'Café de especialidad · lanzamiento', palette: ['#2b1d16', '#d9a066', '#f5ebe0'], headline: 'Tu primer café del día, tostado esta semana', cta: 'Pídelo online' },
  { id: 'b', kind: 'Imagen', title: 'Clínica dental · primera visita', palette: ['#0b3a53', '#6ec1e4', '#f1f8fb'], headline: 'Primera revisión sin sorpresas', cta: 'Reserva cita' },
  { id: 'c', kind: 'Imagen', title: 'Tienda de zapatillas · rebajas', palette: ['#1d1d3b', '#ff5a36', '#fff4ee'], headline: 'Hasta 40 % en la última colección', cta: 'Ver ofertas' },
  { id: 'd', kind: 'Texto', title: 'Academia de idiomas · matrícula', palette: ['#173b2a', '#7fd1a0', '#f2fbf5'], headline: 'Habla inglés en tu próximo viaje', cta: 'Prueba una clase' },
];
