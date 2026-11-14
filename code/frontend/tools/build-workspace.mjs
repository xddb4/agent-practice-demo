import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundles, extensions, styles } from '../src/app/assets.mjs';

export const frontendRoot = fileURLToPath(new URL('../', import.meta.url));

/** Generate stable public URLs without rewriting business code or UI text. */
export async function generateWorkspace({ outDir = path.join(frontendRoot, 'public') } = {}) {
  const generated = new Map();
  for (const [name, sources] of Object.entries(bundles)) {
    const fragments = await Promise.all(
      sources.map(async (source) => {
        const text = await readFile(path.join(frontendRoot, 'src', source), 'utf8');
        return `// Source: src/${source}\n${text}`;
      }),
    );
    // One classic script retains declaration hoisting and the shared lexical scope.
    generated.set(name, fragments.join('\n;\n'));
  }
  for (const [name, source] of styles) {
    if (generated.has(name)) throw new Error(`Duplicate public resource: ${name}`);
    generated.set(name, await readFile(path.join(frontendRoot, 'src', source), 'utf8'));
  }

  function resourceUrl(name) {
    const content = generated.get(name);
    if (content === undefined) throw new Error(`Unregistered resource: ${name}`);
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
    return `/${name}?v=${hash}`;
  }

  const scriptTag = (name) => `<script src="${resourceUrl(name)}"></script>`;
  let html = await readFile(path.join(frontendRoot, 'src/app/workspace.html'), 'utf8');
  html = html.replace(
    '<!-- @styles -->',
    styles.map(([name]) => `<link rel="stylesheet" href="${resourceUrl(name)}">`).join('\n'),
  );
  html = html.replace(/<!-- @script:([\w-]+\.js) -->/g, (_, name) => scriptTag(name));
  html = html.replace('<!-- @extensions -->', extensions.map(scriptTag).join('\n'));
  if (/<!-- @(?:styles|script|extensions)/.test(html)) {
    throw new Error('A workspace resource marker was not resolved.');
  }
  generated.set('prototype.html', html);
  await mkdir(outDir, { recursive: true });
  for (const [name, content] of generated) {
    await writeFile(path.join(outDir, name), content);
  }
  return { outDir, files: [...generated.keys()] };
}
