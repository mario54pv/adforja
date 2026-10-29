# 05 · Legal y seguridad (borradores, no es asesoramiento legal)

## Textos incluidos en la web (borradores a revisar por un profesional)
Aviso legal, privacidad, términos, cookies (`src/legal.js`). Puntos marcados [REVISAR]: desistimiento de consumidores, titularidad y licencias de contenido generado con IA, música/imágenes de terceros, encargados del tratamiento reales, transferencias internacionales.

## Puntos de atención
- **Publicidad**: sectores regulados (salud, finanzas, alcohol) tienen reglas propias; no prometer resultados.
- **IA y derechos**: confirmar licencias de uso comercial de cada herramienta y política de datos antes de subir materiales de clientes.
- **Autónomo/empresa**: confirmar alta y epígrafe del titular antes de facturar con Adforja (nombre comercial).
- **Marca**: comprobar OEPM/EUIPO y dominios antes de invertir en la marca "Adforja".
- **Prospección**: comunicaciones comerciales B2B con identificación, base legítima y baja fácil.

## Seguridad técnica implementada
scrypt para contraseñas, sesiones con token hasheado, CSRF en todos los formularios, límites de peticiones, cabeceras CSP, escape HTML, enlaces solo https, aislamiento de pedidos por usuario y acceso admin por correo configurado, webhooks de Stripe con firma e idempotencia. Sin secretos en el repositorio.

## No implementado todavía
Subida de archivos (el cliente comparte un enlace a sus materiales), copias de seguridad automáticas de la base de datos, verificación de correo, doble factor para admin.
