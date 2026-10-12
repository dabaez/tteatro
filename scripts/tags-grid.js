/**
 * Local grid for editing every play's tags at once: plays are rows, tags are
 * columns, and each checkbox saves straight to the play's .mdx file.
 *
 *   pnpm tags:grid       then open the printed URL, Ctrl+C to stop
 *
 * Runs only on this machine; it is not part of the site build.
 */
import http from 'http';
import { tagRecommendations } from '../src/utils/tag-recommendations.ts';
import { knownTags, loadPlays, saveTags, toggleTag } from './lib/obra-tags.js';

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderPage() {
  const plays = loadPlays();
  // Tags used by plays but missing from tag-recommendations.ts get columns too, so they can be removed.
  const unknownTags = [...new Set(plays.flatMap(p => p.tags))].filter(t => !knownTags.includes(t));
  const columns = [...knownTags, ...unknownTags];
  const count = tag => plays.filter(p => p.tags.includes(tag)).length;

  const header = columns.map((tag, col) => {
    const unknown = !knownTags.includes(tag);
    const hint = unknown ? 'No está en tag-recommendations.ts' : (tagRecommendations[tag] || '(sin descripción)');
    return `<th class="tag${unknown ? ' unknown' : ''}" data-col="${col}" title="${escapeHtml(hint)}">
      <span>${escapeHtml(tag)}</span><small data-count="${col}">${count(tag)}</small></th>`;
  }).join('');

  const rows = plays.map(play => {
    const cells = columns.map((tag, col) => `<td data-col="${col}">
      <input type="checkbox" data-slug="${play.slug}" data-tag="${escapeHtml(tag)}" data-col="${col}"
        title="${escapeHtml(`${play.title} — ${tag}`)}"${play.tags.includes(tag) ? ' checked' : ''}></td>`).join('');
    return `<tr><th class="play">${escapeHtml(play.title)}</th>${cells}</tr>`;
  }).join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Tags</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f7ebe8; color: #1e1e24; }
  #status { position: fixed; top: 8px; right: 12px; padding: 4px 10px; border-radius: 4px; font-size: 14px; background: #fff; z-index: 3; }
  #status.error { background: #e54b4b; color: #fff; }
  .wrap { overflow: auto; height: 100vh; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #e3cfc8; }
  thead th { position: sticky; top: 0; background: #ffd9c9; z-index: 1; }
  th.tag { vertical-align: bottom; padding: 6px 4px; width: 28px; }
  th.tag span { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; display: block; margin: 0 auto; }
  th.tag small { display: block; text-align: center; color: #444140; margin-top: 4px; }
  th.tag.unknown { background: #e54b4b; color: #fff; }
  th.play { position: sticky; left: 0; background: #f7ebe8; text-align: left; padding: 4px 10px; white-space: nowrap; font-weight: 500; z-index: 1; }
  thead th.corner { left: 0; z-index: 2; }
  td { text-align: center; padding: 0; }
  td input { width: 18px; height: 18px; margin: 4px; cursor: pointer; }
  tbody tr:hover th.play, tbody tr:hover td, .col-hover { background: #ffe9df; }
</style>
</head>
<body>
<div id="status">Listo</div>
<div class="wrap">
<table>
  <thead><tr><th class="play corner"></th>${header}</tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>
<script>
  const status = document.getElementById('status');
  const setStatus = (text, error = false) => { status.textContent = text; status.className = error ? 'error' : ''; };

  document.querySelector('tbody').addEventListener('change', async (e) => {
    const box = e.target;
    box.disabled = true;
    try {
      const res = await fetch('/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: box.dataset.slug, tag: box.dataset.tag }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // The file is the source of truth; sync the whole row to it.
      document.querySelectorAll('input[data-slug="' + box.dataset.slug + '"]').forEach(b => {
        b.checked = data.tags.includes(b.dataset.tag);
      });
      const col = box.dataset.col;
      document.querySelector('[data-count="' + col + '"]').textContent =
        document.querySelectorAll('input[data-col="' + col + '"]:checked').length;
      setStatus('Guardado: ' + box.title);
    } catch (err) {
      box.checked = !box.checked;
      setStatus('Error: ' + err.message, true);
    } finally {
      box.disabled = false;
    }
  });

  // Highlight the column under the mouse, to keep track of which tag a box belongs to.
  let hovered = null;
  document.querySelector('table').addEventListener('mouseover', (e) => {
    const col = e.target.closest('[data-col]')?.dataset.col ?? null;
    if (col === hovered) return;
    document.querySelectorAll('.col-hover').forEach(el => el.classList.remove('col-hover'));
    if (col !== null) document.querySelectorAll('td[data-col="' + col + '"]').forEach(el => el.classList.add('col-hover'));
    hovered = col;
  });
</script>
</body>
</html>`;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage());
      return;
    }
    if (req.method === 'POST' && req.url === '/toggle') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { slug, tag } = JSON.parse(body);
      // Re-read from disk so edits made elsewhere in the meantime aren't overwritten.
      const play = loadPlays().find(p => p.slug === slug);
      if (!play) return sendJson(res, 404, { error: `No existe la obra ${slug}` });
      const tags = toggleTag(play.tags, tag);
      saveTags(play, tags);
      console.log(`${play.slug}: ${tags.join(', ') || '(no tags)'}`);
      return sendJson(res, 200, { tags });
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

const port = Number(process.env.PORT) || 4322;
server.listen(port, '127.0.0.1', () => {
  console.log(`Tag grid at http://localhost:${port}  (Ctrl+C to stop)`);
});
