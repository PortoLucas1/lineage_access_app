import { readFile } from 'node:fs/promises';

const appUrl = new URL('../config/external-bi.json', import.meta.url);
const terraformUrl = new URL('../../terraform/external-bi.json', import.meta.url);
const [appManifest, terraformManifest] = await Promise.all([
  readFile(appUrl, 'utf8'),
  readFile(terraformUrl, 'utf8'),
]);

if (appManifest !== terraformManifest) {
  throw new Error(
    'app/config/external-bi.json is stale; copy terraform/external-bi.json before building',
  );
}
