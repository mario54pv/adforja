// Correo transaccional mediante la API HTTP de Resend. Sin clave, no se envía nada:
// el correo queda registrado como "no enviado" y se muestra en consola (útil en desarrollo).
export function createMailer({ db, resendKey, from, fetchImpl = globalThis.fetch, log = console }) {
  const record = (to, subject, status, error = null) =>
    db.prepare('INSERT INTO email_log (to_email, subject, status, error, created_at) VALUES (?,?,?,?,?)')
      .run(to, subject, status, error, Date.now());

  return {
    configured: Boolean(resendKey),
    async send({ to, subject, text }) {
      if (!to) return false;
      if (!resendKey) {
        record(to, subject, 'no_enviado_sin_proveedor');
        log.info?.(`[correo NO enviado: falta RESEND_API_KEY] Para: ${to} | ${subject}\n${text}\n`);
        return false;
      }
      try {
        const r = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          record(to, subject, 'error', `${r.status} ${body.slice(0, 300)}`);
          return false;
        }
        record(to, subject, 'enviado');
        return true;
      } catch (e) {
        record(to, subject, 'error', e.message);
        return false;
      }
    },
  };
}
