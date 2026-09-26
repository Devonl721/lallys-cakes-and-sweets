#!/usr/bin/env node
/*
 * Lally's Cakes & Sweets: placeholder check.
 *
 * Prints a LOUD warning listing every unfinished placeholder on the public
 * pages: elements marked with the `todo-devon` class and any "coming soon"
 * text (photo tiles etc.), with file:line so they are easy to find.
 * Also run automatically at the end of tools/build-events.js.
 *
 * Usage:
 *   node tools/check-placeholders.js            # warn only (exit 0)
 *   node tools/check-placeholders.js --strict   # exit 1 if any placeholder remains
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES = ['index.html', 'menu.html', 'about.html', 'contact.html', 'events.html'];
const PATTERN = /todo-devon|coming soon/i;

function strip(line) {
  return line.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function find() {
  const hits = [];
  for (const file of PAGES) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (PATTERN.test(line)) {
        const kind = /todo-devon/i.test(line) ? 'todo-devon' : 'coming soon';
        hits.push({ file, line: i + 1, kind, text: strip(line) || line.trim() });
      }
    });
  }
  return hits;
}

function run(opts) {
  const hits = find();
  const bar = '!'.repeat(72);
  if (!hits.length) {
    console.log('check-placeholders: OK, no todo-devon or "coming soon" placeholders left.');
    return hits;
  }
  console.warn('\n' + bar);
  console.warn(`!!  WARNING: ${hits.length} UNFINISHED PLACEHOLDER${hits.length === 1 ? '' : 'S'} ON THE PUBLIC SITE`);
  console.warn('!!  Replace these with real content (photos / Devon\'s own words) before launch.');
  console.warn(bar);
  for (const h of hits) console.warn(`!!  ${h.file}:${h.line}  [${h.kind}]  ${h.text}`);
  console.warn(bar + '\n');
  if (opts && opts.strict) process.exitCode = 1;
  return hits;
}

module.exports = { run, find };

if (require.main === module) run({ strict: process.argv.includes('--strict') });
