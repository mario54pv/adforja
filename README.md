# Adforja

Estudio de creatividades publicitarias (imágenes, vídeo corto y textos) con IA y revisión humana. Web pública, formulario de presupuesto, paquetes mensuales con Stripe, panel de cliente (pedidos, mensajes, revisiones) y panel de administración.

**Estado:** prototipo funcional, 15 tests pasando, Stripe pensado para modo pruebas. No desplegado. Las muestras de la web son ilustrativas y están etiquetadas como tales; precios y límites son hipótesis (ver `docs/`).

## Requisitos
Node 22+. Sin dependencias npm.

## Arrancar
```
cp .env.example .env   # rellena variables
npm start              # http://localhost:3000
npm test
npm run stripe:setup   # crea Starter/Growth/Scale en Stripe (modo pruebas)
```

## Variables
`ADMIN_EMAIL`, `STRIPE_SECRET_KEY` (sk_/rk_ test), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER|GROWTH|SCALE`, `RESEND_API_KEY`, `MAIL_FROM`, `LEGAL_OWNER|TAX_ID|ADDRESS|EMAIL`, `BASE_URL`, `DATABASE_PATH`, `ALLOW_LIVE_PAYMENTS` (solo con autorización).

## Flujo
Visitante → `/presupuesto` → solicitud en admin → (cliente se registra y suscribe) → `/panel` crea pedidos → admin cambia estado y enlace de entrega → cliente pide cambios (según revisiones) o aprueba.

## Documentación
`docs/01…06`: mercado, precios y costes, primeros 10 clientes, finanzas, legal/seguridad, autorizaciones pendientes.
