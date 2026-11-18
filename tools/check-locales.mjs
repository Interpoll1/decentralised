import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';
import { parse as parseScript, parseExpression } from '@babel/parser';

const root = process.cwd();
const en = JSON.parse(readFileSync(join(root, 'src/i18n/locales/en.json'), 'utf8'));
const uk = JSON.parse(readFileSync(join(root, 'src/i18n/locales/uk.json'), 'utf8'));
const errors = [], used = new Set();
const placeholders = text => [...text.matchAll(/\{p\d+\}/g)].map(match => match[0]).sort().join(',');
for (const key of new Set([...Object.keys(en), ...Object.keys(uk)])) {
  if (en[key] !== key) errors.push(`English source mismatch: ${key}`);
  if (typeof uk[key] !== 'string' || !uk[key].trim()) errors.push(`Missing Ukrainian entry: ${key}`);
  else if (placeholders(key) !== placeholders(uk[key])) errors.push(`Placeholder mismatch: ${key}`);
}
function inspect(node, file) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && ['ui', '$ui', 'formatUi'].includes(node.callee?.name)
    && node.arguments[0]?.type === 'StringLiteral') {
    const key = node.arguments[0].value; used.add(key);
    if (!Object.hasOwn(en, key)) errors.push(`${file}: unregistered interface copy: ${key}`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc','extra','start','end'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(item => inspect(item, file));
    else if (value && typeof value === 'object') inspect(value, file);
  }
}
for (const directory of ['src/views', 'src/components']) {
  for (const name of readdirSync(join(root, directory), { recursive: true })) {
    if (!name.endsWith('.vue')) continue;
    const file = relative(root, join(root, directory, name));
    const descriptor = parseSfc(readFileSync(join(root, file), 'utf8')).descriptor;
    if (descriptor.scriptSetup) inspect(parseScript(descriptor.scriptSetup.content, { sourceType:'module', plugins:['typescript'] }), file);
    function expression(source) {
      try { inspect(parseExpression(source, { plugins:['typescript'] }), file); }
      catch { /* event statements and v-for declarations are not display expressions */ }
    }
    function template(node) {
      if (node.type === 5) expression(node.content.content);
      if (node.props) for (const prop of node.props) if (prop.type === 7 && prop.exp) expression(prop.exp.content);
      if (node.children) node.children.forEach(template);
    }
    if (descriptor.template) template(parseTemplate(descriptor.template.content));
  }
}
if (errors.length) {
  console.error(errors.join('\n')); process.exitCode = 1;
} else console.log(`Verified ${Object.keys(en).length} English/Ukrainian entries and ${used.size} literal interface keys; placeholders match.`);
