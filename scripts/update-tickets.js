/**
 * update-tickets.js
 *
 * Scrapes telonticket.cl's main listing page and writes src/data/tickets.json
 * — a mapping of obra slug → ticket URL for shows currently active on the
 * platform.
 *
 * "Active" = the show card appears on the telonticket.cl homepage right now.
 * Each card is server-side rendered with a data-title attribute and a
 * data-href pointing to the show's /obra/ page.
 *
 * For each matched show the script fetches its /obra/ page to extract the
 * real vendor ticket URL (ticketmaster, ticketplus, passline, etc.) embedded
 * in the page content. If no vendor link is found it falls back to the
 * telonticket obra URL.
 *
 * URLs listed in src/data/ticket-blocklist.json are skipped — useful when
 * telonticket lists a different company's staging of a play we reviewed.
 *
 * Usage:
 *   node scripts/update-tickets.js              # update tickets.json
 *   node scripts/update-tickets.js --dry-run    # preview only
 */

import fs from 'fs';
import path from 'path';

const CONTENT_DIR     = 'src/content/obras';
const TICKETS_JSON    = 'src/data/tickets.json';
const BLOCKLIST_JSON  = 'src/data/ticket-blocklist.json';
const TELONTICKET_URL = 'https://telonticket.cl/';
const HEADERS         = { 'User-Agent': 'Mozilla/5.0 (compatible; tteatro-bot/1.0)' };

// ---------------------------------------------------------------------------
// Blocklist — ticket URLs we refuse to publish (see ticket-blocklist.json)
// ---------------------------------------------------------------------------
function loadBlocklist() {
  if (!fs.existsSync(BLOCKLIST_JSON)) return [];
  const data = JSON.parse(fs.readFileSync(BLOCKLIST_JSON, 'utf-8'));
  return (data.blocked ?? []).filter(e => e && e.url);
}

// Returns the matching blocklist entry, or null.
function blockedEntry(url, blocklist) {
  if (!url) return null;
  return blocklist.find(e => url.includes(e.url)) ?? null;
}

// ---------------------------------------------------------------------------
// HTML helpers (shared with create-obra.js logic)
// ---------------------------------------------------------------------------
function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

function extractContentDiv(html) {
  const m = html.match(/<div[^>]*class="[^"]*mpwem_details_content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  return m ? m[1] : html;
}

// Returns the real vendor ticket URL embedded in the obra page content
// ("Comprar entradas" / "Entradas" links pointing to ticketmaster, ticketplus, etc.)
// Falls back to the telonticket obra URL if no vendor link is found.
async function fetchVendorTicketUrl(obraUrl) {
  try {
    const res = await fetch(obraUrl, { headers: HEADERS });
    if (!res.ok) return obraUrl;
    const html    = await res.text();
    const content = extractContentDiv(html);
    const linkRe  = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of content.matchAll(linkRe)) {
      const href = m[1].trim();
      const text = stripTags(m[2]);
      if (/entr(?:ada|adas)|tickets?|comprar/i.test(text)) return href;
    }
  } catch {}
  return obraUrl;   // fallback: the telonticket page itself
}

// ---------------------------------------------------------------------------
// Title normalisation
// ---------------------------------------------------------------------------
function normalizeTitle(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesMatch(rawA, rawB) {
  const a = normalizeTitle(rawA);
  const b = normalizeTitle(rawB);
  if (a === b) return true;
  const setA = new Set(a.split(' ').filter(w => w.length > 2));
  const setB = new Set(b.split(' ').filter(w => w.length > 2));
  if (setA.size === 0 || setB.size === 0) return false;
  const intersection = [...setA].filter(w => setB.has(w)).length;
  return (intersection / setA.size >= 0.7) && (intersection / setB.size >= 0.7);
}

// ---------------------------------------------------------------------------
// Fetch ACTIVE shows from telonticket.cl main page
// Each card is a .filter_item div with data-title="..." and contains a child
// div with data-href="https://telonticket.cl/obra/..."
// Returns Map<title, obraUrl>
// ---------------------------------------------------------------------------
async function fetchShows() {
  const response = await fetch(TELONTICKET_URL, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const html = await response.text();

  const shows = new Map();
  // Split on card boundaries so each chunk has exactly one data-title
  const chunks = html.split(/class='filter_item[^']*'/);
  for (const chunk of chunks) {
    const titleMatch = chunk.match(/data-title="([^"]+)"/);
    const hrefMatch  = chunk.match(/data-href="(https:\/\/telonticket\.cl\/obra\/[^"]+)"/);
    const cityMatch  = chunk.match(/data-city-name="([^"]+)"/);
    if (!titleMatch || !hrefMatch) continue;
    if (!cityMatch || cityMatch[1].trim() !== 'Santiago') continue;
    const title = titleMatch[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).trim();
    const url   = hrefMatch[1].trim();
    if (!shows.has(title)) shows.set(title, url);
  }
  return shows;
}

// ---------------------------------------------------------------------------
// Read frontmatter title from an MDX/MD file
// ---------------------------------------------------------------------------
function getFrontmatterTitle(content) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^title:\s*['"]?(.*?)['"]?\s*$/m);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) console.log('Dry run — tickets.json will NOT be written.\n');

  console.log(`Fetching currently active shows from ${TELONTICKET_URL}...`);

  const shows     = await fetchShows();
  const blocklist = loadBlocklist();

  if (shows.size === 0) {
    console.error('\nNo shows found. Check your network connection or the page structure may have changed.');
    process.exit(1);
  }
  console.log(`Found ${shows.size} active shows on the main page.\n`);

  // Load existing tickets.json to compute diff
  const existing = fs.existsSync(TICKETS_JSON)
    ? JSON.parse(fs.readFileSync(TICKETS_JSON, 'utf-8'))
    : {};

  const newTickets = {};
  const stats = { added: 0, cleared: 0, unchanged: 0, unmatched: 0, blocked: 0 };

  const files = fs.readdirSync(CONTENT_DIR)
    .filter(f => f.endsWith('.mdx') || f.endsWith('.md'))
    .sort();

  for (const file of files) {
    const slug    = file.replace(/\.(mdx|md)$/, '');
    const content = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8');
    const obraTitle = getFrontmatterTitle(content);

    if (!obraTitle) {
      console.warn(`  WARN: could not read title from ${file}`);
      continue;
    }

    let matchedUrl   = null;
    let matchedTitle = null;
    for (const [showTitle, url] of shows) {
      if (titlesMatch(obraTitle, showTitle)) {
        matchedUrl   = url;
        matchedTitle = showTitle;
        break;
      }
    }

    const prevUrl = existing[slug];

    let blocked = blockedEntry(matchedUrl, blocklist);
    let ticketUrl = null;
    if (matchedUrl && !blocked) {
      ticketUrl = await fetchVendorTicketUrl(matchedUrl);
      blocked   = blockedEntry(ticketUrl, blocklist);
    }

    if (blocked) {
      console.log(`  BLOCK  "${obraTitle}" — ${blocked.reason ?? 'blocklisted'}`);
      console.log(`         matched: ${blocked.url}`);
      stats.blocked++;
      continue;
    }

    if (matchedUrl) {
      newTickets[slug] = ticketUrl;
      if (ticketUrl !== prevUrl) {
        const tag = prevUrl ? 'UPDATE' : 'ADD   ';
        console.log(`  ${tag} "${obraTitle}"`);
        console.log(`         telonticket: "${matchedTitle}"`);
        console.log(`         → ${ticketUrl}`);
        stats.added++;
      } else {
        stats.unchanged++;
      }
    } else {
      if (prevUrl) {
        console.log(`  CLEAR  "${obraTitle}" (was: ${prevUrl})`);
        stats.cleared++;
      } else {
        console.log(`  ·      "${obraTitle}" — not in active shows`);
        stats.unmatched++;
      }
    }
  }

  console.log(
    `\nResult: ${stats.added} added/updated, ${stats.cleared} cleared, ` +
    `${stats.unchanged} already up-to-date, ${stats.unmatched} not listed, ` +
    `${stats.blocked} blocked.`
  );

  if (!dryRun) {
    const dir = path.dirname(TICKETS_JSON);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TICKETS_JSON, JSON.stringify(newTickets, null, 2) + '\n');
    console.log(`\nWritten → ${TICKETS_JSON}`);
  } else {
    console.log('\n(dry run — no files modified)');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
