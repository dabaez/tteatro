/**
 * Interactive tag editor for plays.
 *
 *   pnpm tags            pick a play from the list
 *   pnpm tags <search>   jump straight to a play by slug or title
 *
 * Only the `tags:` line of the frontmatter is rewritten. Tags come from
 * src/utils/tag-recommendations.ts, so new tags must be added there first.
 */
import readline from 'readline/promises';
import { knownTags, loadPlays, saveTags, toggleTag } from './lib/obra-tags.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// Reading through the iterator buffers lines, so nothing typed (or piped) ahead is lost.
const lines = rl[Symbol.asyncIterator]();

async function ask(prompt) {
  process.stdout.write(prompt);
  const { value, done } = await lines.next();
  return done ? null : value.trim();
}

async function editPlay(play) {
  const original = [...play.tags];
  let tags = [...play.tags];
  // Tags on the play that aren't in the registry still show up, so they can be removed.
  const options = [...knownTags, ...original.filter(t => !knownTags.includes(t))];

  while (true) {
    console.log(`\n${play.title}  (${play.slug})\n`);
    options.forEach((tag, i) => {
      const mark = tags.includes(tag) ? '[x]' : '[ ]';
      const unknown = knownTags.includes(tag) ? '' : '  <- not in tag-recommendations.ts';
      console.log(`  ${String(i + 1).padStart(2)}. ${mark} ${tag}${unknown}`);
    });
    const answer = await ask('\nNumbers to toggle (e.g. "3 7"), Enter to save, "c" to cancel: ');

    if (answer === null || answer.toLowerCase() === 'c') {
      console.log('  Cancelled, nothing saved.');
      return;
    }
    if (answer === '') {
      const changed = tags.length !== original.length || tags.some((t, i) => t !== original[i]);
      if (changed) {
        try {
          saveTags(play, tags);
          play.tags = tags;
          console.log(`  Saved ${play.filePath}`);
        } catch (err) {
          console.error(`  ${err.message}, nothing saved.`);
        }
      } else {
        console.log('  No changes.');
      }
      return;
    }

    for (const part of answer.split(/[\s,]+/)) {
      const tag = options[Number(part) - 1];
      if (!tag) {
        console.log(`  Ignoring "${part}"`);
        continue;
      }
      tags = toggleTag(tags, tag);
    }
  }
}

function findPlays(plays, query) {
  const q = query.toLowerCase();
  return plays.filter(p => p.slug.toLowerCase().includes(q) || p.title.toLowerCase().includes(q));
}

async function main() {
  const plays = loadPlays();
  let query = process.argv.slice(2).join(' ');

  while (true) {
    let play;
    let shown = plays;
    if (query) {
      const matches = findPlays(plays, query);
      if (matches.length === 1) play = matches[0];
      else if (matches.length > 1) {
        console.log(`\n"${query}" matches several plays:`);
        shown = matches;
      } else console.log(`\nNo play matches "${query}".`);
      query = '';
    }

    if (!play) {
      console.log('');
      shown.forEach((p, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${p.title}  ·  ${p.tags.join(', ') || '(no tags)'}`);
      });
      const answer = await ask('\nPlay number or search text, Enter to quit: ');
      if (!answer) break;
      if (/^\d+$/.test(answer)) {
        play = shown[Number(answer) - 1];
        if (!play) console.log(`  No play number ${answer}.`);
      } else {
        query = answer;
      }
    }

    if (play) await editPlay(play);
  }
  rl.close();
}

main();
