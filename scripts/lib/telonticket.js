// Shared by scripts/update-tickets.js and scripts/create-obra.js.

// Returns html from `start` up to the </div> that closes the div `start` is
// inside, counting nested divs on the way. Returns the rest of html if that
// closing tag never comes.
export function sliceToEnclosingDivEnd(html, start) {
  const tagRe = /<(\/?)div\b[^>]*>/gi;
  tagRe.lastIndex = start;

  let depth = 1;
  for (const m of html.matchAll(tagRe)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

// Returns the inner HTML of a telonticket obra page's description box
// (div.mpwem_details_content), leaving out the sidebar (addresses, organizer).
// Descriptions often contain nested <div>s (cast lists, credits), so a plain
// regex up to the first </div> would cut them short.
// Returns the whole page if the box isn't found.
export function extractContentDiv(html) {
  const open = html.match(/<div[^>]*class="[^"]*mpwem_details_content[^"]*"[^>]*>/);
  if (!open) return html;
  return sliceToEnclosingDivEnd(html, open.index + open[0].length);
}
