import { readFileSync } from 'node:fs';

// Lee una clave secreta de Stripe de un archivo de texto. Tolera que algunos editores
// (p. ej. el Bloc de notas con formato Markdown) eliminen guiones bajos al guardar.
export function readKeyFile(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return ''; }
  const m = text.match(/\b(sk|rk)_?(test|live)_?([A-Za-z0-9]{20,})/);
  return m ? `${m[1]}_${m[2]}_${m[3]}` : '';
}
