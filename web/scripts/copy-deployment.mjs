// Copies deployments/chipnet.json into the static site, so the app reads it at runtime and a new
// deployment needs no rebuild of the code. Without one, the app says so instead of failing.
import { copyFileSync, existsSync, rmSync } from 'node:fs';
const source = new URL('../../deployments/chipnet.json', import.meta.url);
const target = new URL('../public/deployment.json', import.meta.url);
if (existsSync(source)) {
  copyFileSync(source, target);
  console.log('Using deployments/chipnet.json');
} else {
  rmSync(target, { force: true });
  console.log('No deployments/chipnet.json yet: the app will ask for "npm run demo:deploy". Local preview still works.');
}
