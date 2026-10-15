import { readFile } from 'node:fs/promises';

const appUrl = new URL('../config/declared-grants.json', import.meta.url);
const terraformUrl = new URL('../../terraform/declared-grants.json', import.meta.url);
const [appManifest, terraformManifest] = await Promise.all([
  readFile(appUrl, 'utf8'),
  readFile(terraformUrl, 'utf8'),
]);

if (appManifest !== terraformManifest) {
  throw new Error(
    'app/config/declared-grants.json is stale; copy terraform/declared-grants.json before building',
  );
}
