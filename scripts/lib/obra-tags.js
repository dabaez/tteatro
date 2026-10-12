// Shared by the tag editors (scripts/tags.js and scripts/tags-grid.js).
// Only the `tags:` line of a play's frontmatter is ever rewritten.
import fs from 'fs';
import path from 'path';
import { tagRecommendations } from '../../src/utils/tag-recommendations.ts';

const contentDir = 'src/content/obras';
export const knownTags = Object.keys(tagRecommendations);

function frontmatterOf(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : '';
}

function parseTags(line) {
  return [...line.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] ?? m[2]);
}

export function loadPlays() {
  return fs.readdirSync(contentDir)
    .filter(f => f.endsWith('.mdx'))
    .map(file => {
      const filePath = path.join(contentDir, file);
      const fm = frontmatterOf(fs.readFileSync(filePath, 'utf8'));
      const title = (fm.match(/^title:\s*(.*)$/m)?.[1] ?? file).trim().replace(/^['"]|['"]$/g, '');
      const tagsLine = fm.match(/^tags:.*$/m)?.[0] ?? 'tags: []';
      return { slug: file.replace(/\.mdx$/, ''), filePath, title, tags: parseTags(tagsLine) };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

// Throws if the play has no `tags:` line, so callers can report it.
export function saveTags(play, tags) {
  const text = fs.readFileSync(play.filePath, 'utf8');
  const fm = frontmatterOf(text);
  if (!/^tags:.*$/m.test(fm)) {
    throw new Error(`No "tags:" line found in ${play.filePath}`);
  }
  const newLine = `tags: [${tags.map(t => `'${t}'`).join(', ')}]`;
  const newFm = fm.replace(/^tags:.*$/m, newLine);
  fs.writeFileSync(play.filePath, text.replace(fm, newFm));
}

// Keep the existing order; a newly added tag goes at the end.
export function toggleTag(tags, tag) {
  return tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
}
