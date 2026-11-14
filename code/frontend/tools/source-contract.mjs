/** Preservation checks compare parsed code/markup/CSS, not source formatting. */
import { createHash } from 'node:crypto';
import { parse as parseJavaScript } from 'acorn';
import { parse as parseHtml } from 'parse5';
import postcss from 'postcss';
import prettier from 'prettier';

export const hash = (value) => createHash('sha256').update(value).digest('hex');

/** Git may check text SVGs out with CRLF on Windows and LF on Linux.
 * Normalize only that transport difference; keep binary assets byte-exact.
 */
export function assetContract(name, content) {
  const bytes = Buffer.from(content);
  return hash(
    name.toLowerCase().endsWith('.svg') ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes,
  );
}

function normalizeAst(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item?.type !== 'EmptyStatement').map(normalizeAst);
  }
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'Property' && !value.computed) {
    value = {
      ...value,
      key: { type: 'PropertyName', value: value.key.name ?? value.key.value },
    };
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['start', 'end', 'loc', 'range', 'raw'].includes(key))
      .map(([key, item]) => [key, normalizeAst(item)]),
  );
}

export function scriptContract(source, name) {
  const ast = parseJavaScript(source, { ecmaVersion: 'latest' });
  ast.body = ast.body.filter((node) => node.type !== 'EmptyStatement');
  if (name === 'workspace.js') {
    for (const node of ast.body) {
      // Only these two dispatch points intentionally move to the new router.
      if (node.type === 'FunctionDeclaration' && node.id.name === 'render') {
        node.body = { type: 'CentralizedPageDispatch' };
      }
      if (
        node.type === 'ExpressionStatement' &&
        (source
          .slice(node.start, node.end)
          .startsWith("document.querySelectorAll('[data-page]')") ||
          source.slice(node.start, node.end).startsWith('StudyPilotRouter.bindNavigation('))
      ) {
        node.expression = { type: 'CentralizedNavigationBinding' };
      }
    }
  }
  if (name === 'plan_dialogue.js') {
    // These are all declarations, whose hoisting is unchanged by request/UI extraction.
    ast.body.sort((a, b) => a.id.name.localeCompare(b.id.name));
  }
  return hash(JSON.stringify(normalizeAst(ast)));
}

function htmlNode(node) {
  if (['style', 'script', 'link'].includes(node.tagName) || node.nodeName === '#comment') {
    return null;
  }
  if (node.nodeName === '#text') {
    const text = node.value.replace(/\s+/g, ' ');
    return text.trim() ? ['text', text.trim()] : null;
  }
  return [
    node.tagName || node.nodeName,
    (node.attrs || []).map(({ name, value }) => [name, value]).sort(),
    (node.childNodes || []).map(htmlNode).filter(Boolean),
  ];
}

export const markupContract = (source) => hash(JSON.stringify(htmlNode(parseHtml(source))));

export async function shellContract(source) {
  const normalized = source.replace("import '../progress.css';", "import '../styles/shell.css';");
  return hash(
    await prettier.format(normalized, {
      parser: 'babel',
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
      embeddedLanguageFormatting: 'off',
    }),
  );
}

const compact = (value) =>
  value
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),/:>])\s*/g, '$1')
    .trim();

export async function styleRules(sources) {
  const asts = sources.map((source) => postcss.parse(source));
  const variables = {};
  for (const ast of asts) {
    ast.walkRules(':root', (rule) => {
      rule.walkDecls((declaration) => {
        variables[declaration.prop] = declaration.value;
      });
    });
  }
  function resolve(value, depth = 0) {
    if (depth > 10) throw new Error('Circular theme variable');
    return value.replace(/var\((--[\w-]+)\)/g, (match, name) =>
      variables[name] === undefined ? match : resolve(variables[name], depth + 1),
    );
  }
  function visit(node) {
    if (node.type === 'comment' || (node.type === 'rule' && node.selector === ':root')) {
      return null;
    }
    if (node.type === 'decl') {
      return ['decl', node.prop, compact(resolve(node.value)), Boolean(node.important)];
    }
    return [
      node.type,
      node.selector ? compact(node.selector) : node.name || '',
      node.params ? compact(node.params) : '',
      (node.nodes || []).map(visit).filter(Boolean),
    ];
  }
  const canonical = await Promise.all(
    asts.map(async (ast) => {
      ast.walkDecls((declaration) => {
        declaration.value = resolve(declaration.value);
      });
      // Normalize harmless quote, decimal and whitespace changes made by formatting.
      const formatted = await prettier.format(ast.toString(), { parser: 'css', singleQuote: true });
      return postcss.parse(formatted);
    }),
  );
  return canonical.flatMap((ast) => ast.nodes.map(visit).filter(Boolean));
}

export const styleContract = async (sources) => hash(JSON.stringify(await styleRules(sources)));
