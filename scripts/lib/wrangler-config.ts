export type Vars = { vars: { PUBLIC_DATASET_VERSION: string } };
export type WranglerConfig = Vars & { env: { staging: Vars } };

/** Parses wrangler.jsonc: strips // and block comments outside strings, then trailing commas. */
export function parseJsonc(text: string): WranglerConfig {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') {
        if (j >= text.length) throw new Error('Unterminated string in JSONC');
        j += text[j] === '\\' ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new Error('Unterminated block comment in JSONC');
      i = end + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
