// Compiles Backstop.cash to artifacts/Backstop.artifact.ts.
// The file is only rewritten when the compiled contract changes, so its `updatedAt`
// timestamp does not create a new diff on every test run.
import { compileFile } from 'cashc';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const source = new URL('../Backstop.cash', import.meta.url);
const target = new URL('../artifacts/Backstop.artifact.ts', import.meta.url);

const artifact = compileFile(source);
const { updatedAt, ...stable } = artifact;
const render = (a) => `export default ${JSON.stringify(a, null, 2)} as const;\n`;

if (existsSync(target)) {
  const previous = readFileSync(target, 'utf8');
  const match = previous.match(/"updatedAt": "([^"]+)"/);
  if (match && previous === render({ ...stable, updatedAt: match[1] })) {
    console.log(`Backstop.cash unchanged (${artifact.debug?.bytecode.length / 2} bytes)`);
    process.exit(0);
  }
}
writeFileSync(target, render({ ...stable, updatedAt }));
console.log(`Compiled Backstop.cash (${artifact.debug?.bytecode.length / 2} bytes)`);
