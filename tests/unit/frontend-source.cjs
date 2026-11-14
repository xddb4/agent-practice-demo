/** Test actual source fragments; formatting is not a test contract. */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const acorn = require('../../code/frontend/node_modules/acorn');

const sourceRoot = path.resolve(__dirname, '../../code/frontend/src');
function readSource(relativePath) {
  return readFileSync(path.join(sourceRoot, relativePath), 'utf8');
}

function readBundle(name) {
  const ast = acorn.parse(readSource('app/assets.mjs'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  const declaration = ast.body.find(
    (node) => node.declaration?.declarations?.[0]?.id.name === 'bundles',
  ).declaration.declarations[0].init;
  const resource = declaration.properties.find((property) => property.key.value === name);
  if (!resource) throw new Error(`Bundle not registered: ${name}`);
  return resource.value.elements.map((node) => readSource(node.value)).join('\n;\n');
}

function namedFunction(source, name) {
  const marker = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = marker.exec(source);
  if (!match) throw new Error(`Function not found: ${name}`);
  const node = acorn.parseExpressionAt(source, match.index, { ecmaVersion: 'latest' });
  return source.slice(node.start, node.end);
}

function statementRange(source, firstName, nextName) {
  const nodes = acorn.parse(source, { ecmaVersion: 'latest' }).body;
  const nameOf = (node) =>
    node.type === 'VariableDeclaration'
      ? node.declarations[0].id.name
      : node.type === 'FunctionDeclaration'
        ? node.id.name
        : node.expression?.left?.name;
  const start = nodes.findIndex((node) => nameOf(node) === firstName);
  const end = nextName ? nodes.findIndex((node) => nameOf(node) === nextName) : nodes.length;
  if (start < 0 || end <= start) throw new Error(`Invalid statement range: ${firstName}`);
  return source.slice(nodes[start].start, nodes[end - 1].end);
}

module.exports = { readSource, readBundle, namedFunction, statementRange };
