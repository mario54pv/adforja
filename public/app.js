// Mejoras progresivas: la aplicación funciona sin JavaScript.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const el = document.querySelector(btn.dataset.copy);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.value || el.textContent);
    const old = btn.textContent;
    btn.textContent = 'Copiado';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } catch {
    el.select();
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) { e.preventDefault(); return; }
  const btn = form.querySelector('button:not([type="button"])');
  if (btn) setTimeout(() => { btn.disabled = true; btn.dataset.locked = '1'; }, 0); // evita dobles envíos (p. ej. doble pago)
});

// Al volver atrás desde Stripe, el navegador puede restaurar la página con el botón bloqueado.
window.addEventListener('pageshow', () => {
  document.querySelectorAll('[data-locked]').forEach((b) => { b.disabled = false; delete b.dataset.locked; });
});

document.addEventListener('change', (e) => { if (e.target.matches('[data-autosubmit]')) e.target.form.requestSubmit(); });
