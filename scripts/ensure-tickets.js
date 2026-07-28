/**
 * ensure-tickets.js
 *
 * src/data/tickets.json is not tracked in git — it lives only on the server,
 * where update-tickets.js regenerates it (see scripts/deploy.sh). The Astro
 * pages import it statically, so a fresh clone would fail to build/dev without
 * it. This creates an empty mapping if the file is missing.
 */

import fs from 'fs';
import path from 'path';

const TICKETS_JSON = 'src/data/tickets.json';

if (!fs.existsSync(TICKETS_JSON)) {
  fs.mkdirSync(path.dirname(TICKETS_JSON), { recursive: true });
  fs.writeFileSync(TICKETS_JSON, '{}\n');
  console.log(`Created empty ${TICKETS_JSON}`);
}
