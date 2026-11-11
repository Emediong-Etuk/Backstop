// Writes xo/backstop.template.json (the file to load into the XO debug tool), after checking it
// with @xo-cash/utils' own template parser.
import { writeFileSync } from 'node:fs';
import { parseTemplate, serializeTemplate } from '@xo-cash/utils';
import { backstopTemplate } from '../src/template.js';

const json = serializeTemplate(backstopTemplate);
parseTemplate(json); // throws if the template does not match the XO schema
const target = new URL('../backstop.template.json', import.meta.url);
writeFileSync(target, typeof json === 'string' ? json : JSON.stringify(json, null, 2));
console.log(`Wrote ${target.pathname}`);
