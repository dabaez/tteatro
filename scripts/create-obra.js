/**
 * create-obra.js
 *
 * Generates a ready-to-edit MDX file under src/content/obras/ from a
 * telonticket.cl obra page, including the cover image download.
 *
 * Obra data comes from the telonticket JSON-LD + HTML content. The full
 * catalogue (current AND past shows) is discovered via the WP sitemap at
 * /wp-sitemap-posts-mep_events-1.xml, so you never need to know the URL
 * in advance.
 *
 * Everything that can be derived from the site is pre-filled. Tags and the
 * Spoiler review section are left as placeholders for you to fill in.
 *
 * Usage:
 *   node scripts/create-obra.js <title-or-partial-title>
 *   node scripts/create-obra.js <telonticket-obra-url>
 *   node scripts/create-obra.js --dry-run <title-or-partial-title>
 *
 * Examples:
 *   node scripts/create-obra.js "Extinción"
 *   node scripts/create-obra.js "mantis religiosa"
 *   node scripts/create-obra.js --dry-run https://telonticket.cl/obra/la-mantis-religiosa-2/
 */

import fs   from 'fs';
import path from 'path';

const CONTENT_DIR   = 'src/content/obras';
const ASSETS_DIR    = 'src/assets';
const TICKETS_JSON  = 'src/data/tickets.json';
const SITEMAP_URL   = 'https://telonticket.cl/wp-sitemap-posts-mep_events-1.xml';

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; tteatro-bot/1.0)' };

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------
function normalizeForSlug(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim();
}

function slugify(str) {
  return normalizeForSlug(str).replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------
function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Sitemap — discovers ALL obra URLs (current and past)
// ---------------------------------------------------------------------------
async function fetchSitemapUrls() {
  const res = await fetch(SITEMAP_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Sitemap fetch failed: HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/https:\/\/telonticket\.cl\/obra\/([^<\s]+)/g)].map(m => ({
    url:  m[0].trim(),
    slug: m[1].replace(/\/$/, ''),   // URL slug (with hyphens)
  }));
}

// Score how well a sitemap slug matches a user search string.
// Words in the slug are split on hyphens; we count word overlaps.
function scoreMatch(sitemapSlug, normalizedQuery) {
  const slugWords  = new Set(sitemapSlug.split('-').filter(w => w.length > 1));
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 1);
  if (queryWords.length === 0) return 0;
  const hits = queryWords.filter(w => slugWords.has(w)).length;
  return hits / queryWords.length;
}

async function findObraUrl(query) {
  console.log('Fetching sitemap to search catalogue...');
  const entries = await fetchSitemapUrls();
  console.log(`  ${entries.length} obras in catalogue.\n`);

  const normalizedQuery = normalizeForSlug(query);
  const scored = entries
    .map(e => ({ ...e, score: scoreMatch(e.slug, normalizedQuery) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored;
}

// ---------------------------------------------------------------------------
// Fetch and parse the obra page
// ---------------------------------------------------------------------------
async function fetchObra(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const m of matches) {
    try {
      const data = JSON.parse(m[1]);
      if (data['@type'] === 'Event') return data;
    } catch {}
  }
  return null;
}

// Extract only the main content div, avoiding sidebar noise (addresses, etc.)
function extractContentDiv(html) {
  const m = html.match(/<div[^>]*class="[^"]*mpwem_details_content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  return m ? m[1] : html;
}

// ---------------------------------------------------------------------------
// Ficha heading detection — returns index of the start of the ficha section.
// Handles:
//   A. <h1-6>…Ficha artística…</h1-6>
//   B. <strong>FICHA ARTÍSTICA</strong>  (bold heading, not in an h-tag)
// ---------------------------------------------------------------------------
// Returns { idx, isHTag } where idx is where ficha content starts (after the heading).
// isHTag=true means Format A (pipe-separated) should be tried first.
function findFichaSection(content) {
  // h-tag heading: <h3>Ficha artística</h3>
  const hTagM = content.match(/<h[1-6][^>]*>[\s\S]{0,40}?[Ff]icha\s+art[ií]stica[\s\S]*?<\/h[1-6]>/i);
  if (hTagM) return { idx: hTagM.index + hTagM[0].length, isHTag: true };

  // Bold heading: <strong>FICHA ARTÍSTICA</strong> → start AFTER the closing tag
  const boldM = content.match(/<(?:strong|b)[^>]*>[\s\S]{0,10}?FICHA\s+ART[IÍ]STICA[\s\S]*?<\/(?:strong|b)>/i);
  if (boldM) return { idx: boldM.index + boldM[0].length, isHTag: false };

  return null;
}

// ---------------------------------------------------------------------------
// Parse role:value pairs from a block of HTML.
// Works by splitting on <br> at the HTML level first (before stripping tags),
// so that stripTags doesn't collapse the line breaks.
// Each line is then colon-split into role + value.
// Handles formats B, C, D and inline-pipe (mr-bo style).
// Only rule applied: skip entries where value is longer than 200 chars
// (to avoid capturing entire paragraphs of prose).
// ---------------------------------------------------------------------------
function parseBrLines(chunk) {
  const lines = chunk
    .split(/<br\s*\/?>/gi)
    .flatMap(seg => seg.split(/\s*·\s*/));   // · used as separator in some pages

  const pairs = [];
  for (const line of lines) {
    const text = stripTags(line);
    for (const segment of text.split(/\s*\|\s*/)) {
      const colonIdx = segment.indexOf(':');
      if (colonIdx < 0) continue;
      const role  = segment.slice(0, colonIdx).trim();
      const value = segment.slice(colonIdx + 1).trim();
      if (!role || !value || value.length > 200) continue;
      pairs.push({ role, name: value });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Format A: <h3>Ficha artística</h3> + pipe-separated bold roles
// (no colon between role and value — bold markers carry the role boundary)
// ---------------------------------------------------------------------------
function parsePipeFormat(chunk) {
  const withMarkers = chunk.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, inner) => {
    const role = stripTags(inner).replace(/[|]/g, '').trim();
    return role ? `@@ROLE@@${role}@@:` : '';
  });
  const text     = stripTags(withMarkers);
  const segments = text.split('@@ROLE@@').slice(1);
  const pairs    = [];
  for (const seg of segments) {
    const sepIdx = seg.indexOf('@@:');
    if (sepIdx < 0) continue;
    const role  = seg.slice(0, sepIdx).trim();
    const value = seg.slice(sepIdx + 3).trim();
    if (!role || !value || value.length > 200) continue;
    pairs.push({ role, name: value });
  }
  return pairs;
}

// Returns the index of the first <p> that looks like an inline ficha paragraph
// (no explicit heading, but contains bold Role: entries).
function fichaParaIdx(content) {
  for (const m of content.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const inner = m[1];
    const hasStrongRole = /<(?:strong|b)[^>]*>[^<]+<\/(?:strong|b)>\s*:/i.test(inner);
    const hasMultiColon = (inner.match(/\w+\s*:/g) || []).length >= 2;
    if (hasStrongRole || hasMultiColon) return m.index;
  }
  return -1;
}

function extractFicha(html) {
  const content  = extractContentDiv(html);
  const section  = findFichaSection(content);

  if (section) {
    const { idx, isHTag } = section;
    const chunk = content.slice(idx, idx + 8000);

    // h-tag heading → try Format A (pipe-separated, no colon) first
    if (isHTag) {
      const pairs = parsePipeFormat(chunk);
      if (pairs.length) return pairs;
    }

    // Bold heading or pipe format found nothing → br-line parsing
    return parseBrLines(chunk);
  }

  // No explicit heading — scan every <p> for an inline ficha paragraph
  for (const paraM of content.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const inner = paraM[1];
    const hasStrongRole = /<(?:strong|b)[^>]*>[^<]+<\/(?:strong|b)>\s*:/i.test(inner);
    const hasMultiColon = (inner.match(/\w+\s*:/g) || []).length >= 2;
    if (!hasStrongRole && !hasMultiColon) continue;
    const pairs = parseBrLines(inner);
    if (pairs.length >= 2) return pairs;
  }

  return [];
}

function extractSinopsis(html) {
  const content = extractContentDiv(html);

  // Stop before any ficha section (headed or inline paragraph)
  const section  = findFichaSection(content);
  const fichaIdx = Math.min(
    ...[section?.idx, fichaParaIdx(content)].filter(i => i != null && i >= 0),
    content.length
  );
  const relevantHtml = content.slice(0, fichaIdx);

  const paras = [];
  for (const m of relevantHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = stripTags(m[1]);
    if (text.length < 60) continue;
    paras.push(text);
  }
  return paras;
}

function fichaToMarkdown(pairs) {
  return pairs.map(p => `- ${p.role}: ${p.name}`).join('\n');
}

// ---------------------------------------------------------------------------
// Ticket link extraction
// Look for a "Comprar entradas" / "Entradas" link inside the content div.
// These point to the actual vendor (ticketmaster, ticketplus, passline, etc.)
// and are the real URL to use in tickets.json.
// Returns null if no such link is found (play has no current ticket sales).
// ---------------------------------------------------------------------------
function extractTicketUrl(html) {
  const content = extractContentDiv(html);
  const linkRe  = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of content.matchAll(linkRe)) {
    const href = m[1].trim();
    const text = stripTags(m[2]);
    if (/entr(?:ada|adas|adas)|tickets?|comprar/i.test(text)) return href;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Download image
// ---------------------------------------------------------------------------
async function downloadImage(imageUrl, destDir, baseName) {
  const ext  = path.extname(new URL(imageUrl).pathname) || '.jpg';
  const dest = path.join(destDir, `${baseName}${ext}`);
  const res  = await fetch(imageUrl, { headers: HEADERS });
  if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return { dest, ext };
}

// ---------------------------------------------------------------------------
// Build MDX content
// ---------------------------------------------------------------------------
function buildMdx({ title, slug, imageExt, sinopsis, ficha, company }) {
  const today     = new Date().toISOString().slice(0, 10);
  const imagePath = `../../assets/${slug}/imagen${imageExt}`;

  const fichaSection = ficha.length
    ? `### FICHA ARTÍSTICA:\n${fichaToMarkdown(ficha)}`
    : '### FICHA ARTÍSTICA:\n- (completar)';

  const sinopsisText = sinopsis.length
    ? sinopsis.join('\n\n')
    : '(sinopsis no disponible)';

  return `---
title: ${title}
published: ${today}
image: '${imagePath}'
tags: []
company: '${company}'
---
import Spoiler from '../../components/Spoiler.astro';
import beforeImage from '../../assets/${slug}/inicio.png'
import afterImage from '../../assets/${slug}/fin.png'

# Sinopsis
${sinopsisText}

${fichaSection}

<Spoiler
    imageBefore={beforeImage}
    imageAfter={afterImage}
>
¡Review pendiente!

¡Review pendiente!

¡Review pendiente!
</Spoiler>
`;
}

// ---------------------------------------------------------------------------
// Core: scrape a URL and write the obra
// ---------------------------------------------------------------------------
async function processUrl(url, dryRun) {
  console.log(`Fetching ${url} ...`);
  const html   = await fetchObra(url);
  const jsonLd = extractJsonLd(html);

  if (!jsonLd) {
    console.error('Could not find JSON-LD Event data. The page structure may have changed.');
    process.exit(1);
  }

  const title     = jsonLd.name?.trim() ?? '(sin título)';
  const slug      = slugify(title);
  const imageUrl  = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
  const company   = jsonLd.performer?.name ?? jsonLd.organizer?.name ?? '';
  const sinopsis  = extractSinopsis(html);
  const ficha     = extractFicha(html);
  const ticketUrl = extractTicketUrl(html);

  console.log(`\nTitle    : ${title}`);
  console.log(`Slug     : ${slug}`);
  console.log(`Company  : ${company}`);
  console.log(`Image    : ${imageUrl}`);
  console.log(`Tickets  : ${ticketUrl ?? '(none — play has no active ticket link)'}`);
  console.log(`Sinopsis : ${sinopsis.length} paragraph(s) found`);
  console.log(`Ficha    : ${ficha.length} entries found`);

  if (sinopsis.length) {
    console.log('\nSinopsis preview:');
    sinopsis.forEach((p, i) => console.log(`  [${i+1}] ${p.slice(0, 120)}...`));
  }
  if (ficha.length) {
    console.log('\nFicha artística:');
    ficha.forEach(p => console.log(`  ${p.role}: ${p.name}`));
  }

  const mdxPath  = path.join(CONTENT_DIR, `${slug}.mdx`);
  const assetDir = path.join(ASSETS_DIR, slug);

  if (dryRun) {
    const mdxContent = buildMdx({ title, slug, imageExt: '.jpg', sinopsis, ficha, company });
    console.log('\n=== MDX Preview ===\n');
    console.log(mdxContent);
    console.log('===================');
    console.log('\n(dry run — no files modified)');
    return;
  }

  if (fs.existsSync(mdxPath)) {
    console.error(`\nFile already exists: ${mdxPath}\nAbort — delete it first if you want to regenerate.`);
    process.exit(1);
  }

  let imageExt = '.jpg';
  if (imageUrl) {
    console.log('\nDownloading image...');
    if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });
    const result = await downloadImage(imageUrl, assetDir, 'imagen');
    imageExt = result.ext;
    console.log(`Image saved → ${result.dest}`);
  } else {
    console.warn('No image URL found — add the image manually.');
    if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });
  }

  const mdxContent = buildMdx({ title, slug, imageExt, sinopsis, ficha, company });
  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.writeFileSync(mdxPath, mdxContent);
  console.log(`\nMDX created → ${mdxPath}`);

  if (ticketUrl) {
    const tickets = fs.existsSync(TICKETS_JSON)
      ? JSON.parse(fs.readFileSync(TICKETS_JSON, 'utf-8'))
      : {};
    if (!tickets[slug]) {
      tickets[slug] = ticketUrl;
      fs.writeFileSync(TICKETS_JSON, JSON.stringify(tickets, null, 2) + '\n');
      console.log(`tickets.json updated → added "${slug}" → ${ticketUrl}`);
    }
  } else {
    console.log(`tickets.json — skipped (no active ticket link on the page)`);
  }

  console.log(`\nDone! Open ${mdxPath} to add tags and your review.`);
}

// ---------------------------------------------------------------------------
// Interactive selection prompt
// ---------------------------------------------------------------------------
async function promptSelection(candidates) {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise(resolve => {
    rl.question(`Select [1-${candidates.length}] (default 1): `, answer => {
      rl.close();
      const n = parseInt(answer.trim(), 10);
      const idx = Number.isInteger(n) && n >= 1 && n <= candidates.length ? n - 1 : 0;
      resolve(candidates[idx]);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args   = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const input  = args.find(a => !a.startsWith('--'));

  if (!input) {
    console.error(
      'Usage:\n' +
      '  node scripts/create-obra.js [--dry-run] "<title or partial title>"\n' +
      '  node scripts/create-obra.js [--dry-run] <telonticket-obra-url>'
    );
    process.exit(1);
  }

  if (dryRun) console.log('Dry run — no files will be written.\n');

  // Direct URL — skip the catalogue search
  if (input.startsWith('http')) {
    await processUrl(input, dryRun);
    return;
  }

  // Title search — query the sitemap catalogue
  const matches = await findObraUrl(input);

  if (matches.length === 0) {
    console.error(`No obras found matching "${input}". Try a different search term.`);
    process.exit(1);
  }

  const best = matches[0];

  if (matches.length === 1) {
    // Unambiguous match
    console.log(`Found: ${best.url}`);
    await processUrl(best.url, dryRun);
    return;
  }

  // Multiple candidates — let the user pick interactively.
  const top = matches.slice(0, 5);
  console.log(`Multiple matches for "${input}":\n`);
  top.forEach((m, i) => {
    console.log(`  [${i + 1}] (${Math.round(m.score * 100)}%) ${m.url}`);
  });
  console.log();

  const chosen = await promptSelection(top);
  console.log();
  await processUrl(chosen.url, dryRun);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
