/**
 * ensure-tickets.js
 *
 * src/data/tickets.json is not tracked in git — it lives only on the server,
 * where update-tickets.js regenerates it (see scripts/deploy.sh). The Astro
 * pages import it statically, so a fresh clone would fail to build/dev without
 * it. This creates an empty mapping if the file is missing.
 *
 * It also prunes any entry whose URL is listed in ticket-blocklist.json, so a
 * blocked link stops being published on the very next build — no need to wait
 * for the cron run of update-tickets.js.
 */

import fs from 'fs';
import path from 'path';

const TICKETS_JSON   = 'src/data/tickets.json';
const BLOCKLIST_JSON = 'src/data/ticket-blocklist.json';

if (!fs.existsSync(TICKETS_JSON)) {
  fs.mkdirSync(path.dirname(TICKETS_JSON), { recursive: true });
  fs.writeFileSync(TICKETS_JSON, '{}\n');
  console.log(`Created empty ${TICKETS_JSON}`);
}

if (fs.existsSync(BLOCKLIST_JSON)) {
  const blocked = (JSON.parse(fs.readFileSync(BLOCKLIST_JSON, 'utf-8')).blocked ?? [])
    .filter(e => e && e.url);
  const tickets = JSON.parse(fs.readFileSync(TICKETS_JSON, 'utf-8'));

  let removed = 0;
  for (const [slug, url] of Object.entries(tickets)) {
    const entry = blocked.find(e => url.includes(e.url));
    if (!entry) continue;
    delete tickets[slug];
    removed++;
    console.log(`Blocked ticket removed: ${slug} → ${url}`);
  }

  if (removed > 0) {
    fs.writeFileSync(TICKETS_JSON, JSON.stringify(tickets, null, 2) + '\n');
  }
}
