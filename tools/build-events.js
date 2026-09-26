#!/usr/bin/env node
/*
 * Lally's Cakes & Sweets: events builder.
 *
 * Reads events.json (the single source of truth), drops events whose end
 * time has passed, and writes plain HTML (no JS needed in the browser) plus
 * schema.org Event JSON-LD between marker comments in index.html and
 * events.html. Safe to run any number of times (idempotent).
 *
 * Usage:
 *   node tools/build-events.js                     # uses the current time
 *   node tools/build-events.js --now=2026-10-26T00:00:00-04:00   # testing
 *
 * Markers (the builder only replaces what is between them):
 *   index.html : <!-- EVENTS:HOME:START --> ... <!-- EVENTS:HOME:END -->
 *                <!-- EVENTS:JSONLD:START --> ... <!-- EVENTS:JSONLD:END -->
 *   events.html: <!-- EVENTS:LIST:START --> ... <!-- EVENTS:LIST:END -->
 *                <!-- EVENTS:JSONLD:START --> ... <!-- EVENTS:JSONLD:END -->
 *
 * Run this locally before committing. GitHub Pages just serves the output.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://lallyscakesandsweets.com/';
const TZ = 'America/New_York';
const FACEBOOK_URL = 'https://www.facebook.com/LallysCakesandSweets/';
const INSTAGRAM_URL = 'https://www.instagram.com/lallyscakesandsweets/';
// Same Google place-ID directions link used elsewhere on the site.
const MARKET_ADDRESS = '10 S Summit Ave, Shillington, PA 19607';
const MARKET_DIRECTIONS_URL = 'https://www.google.com/maps/dir/?api=1&destination=Lallys%20Cakes%20And%20Sweets%2C%2010%20S%20Summit%20Ave%2C%20Shillington%2C%20PA%2019607&destination_place_id=ChIJhWyQyOpxxokRwW1ss5cYshM';

// ---------- helpers ----------
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseNow(argv) {
  const arg = argv.find((a) => a.startsWith('--now='));
  if (!arg) return new Date();
  const d = new Date(arg.slice('--now='.length));
  if (Number.isNaN(d.getTime())) {
    console.error('Invalid --now value: ' + arg);
    process.exit(1);
  }
  return d;
}

function parts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out; // weekday, month, day, year, hour, minute, dayPeriod
}

function clock(p, withPeriod) {
  const t = p.minute === '00' ? p.hour : p.hour + ':' + p.minute;
  return withPeriod ? t + '\u00a0' + p.dayPeriod : t;
}

// "Sunday, October 25" (+ ", 2026" when withYear)
function dateLabel(ev, withYear) {
  const p = parts(new Date(ev.start));
  return p.weekday + ', ' + p.month + ' ' + p.day + (withYear ? ', ' + p.year : '');
}

// "4–6 PM", "10:30 AM – 1 PM"
function timeLabel(ev) {
  const s = parts(new Date(ev.start));
  const e = parts(new Date(ev.end));
  if (s.dayPeriod === e.dayPeriod) return clock(s, false) + '\u2013' + clock(e, true);
  return clock(s, true) + ' \u2013 ' + clock(e, true);
}

function webpFor(img) {
  const webp = img.replace(/\.(jpe?g|png)$/i, '.webp');
  return webp !== img && fs.existsSync(path.join(ROOT, webp)) ? webp : null;
}

// Read width/height from a JPEG or PNG so <img> gets real dimensions (no layout shift).
function imageSize(rel) {
  try {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  } catch (e) { /* fall through */ }
  return null;
}

function picture(ev, cls, opts) {
  const size = imageSize(ev.image);
  const webp = webpFor(ev.image);
  const dims = size ? ` width="${size.w}" height="${size.h}"` : '';
  const lazy = opts && opts.lazy ? ' loading="lazy"' : '';
  return `<picture>${webp ? `<source srcset="${esc(webp)}" type="image/webp" />` : ''}` +
    `<img class="${cls}" src="${esc(ev.image)}"${dims}${lazy} decoding="async" alt="${esc(ev.image_alt || '')}" /></picture>`;
}

function directionsUrl(ev) {
  if (ev.directions_url) return ev.directions_url;
  if (ev.address === MARKET_ADDRESS) return MARKET_DIRECTIONS_URL;
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(ev.address);
}

// ---------- markup ----------
function homeBox(ev) {
  if (!ev) return '';
  return `
          <aside class="season-card" aria-labelledby="season-title">
            <div class="season-thumb">${picture(ev, 'season-img', { lazy: false })}</div>
            <div class="season-body">
              <p class="season-eyebrow">This season</p>
              <h2 class="season-title" id="season-title">${esc(ev.title)}</h2>
              <p class="season-when">Special event · ${esc(dateLabel(ev, false))} · ${esc(timeLabel(ev))}</p>
              <p class="season-where">At ${esc(ev.location_name)}</p>
              <div class="season-actions">
                <a class="btn btn-secondary" href="events.html#${esc(ev.id)}">Details</a>
                <a class="btn btn-facebook" href="${esc(ev.cta_url)}" target="_blank" rel="noopener noreferrer">${esc(ev.cta_label)}</a>
              </div>
            </div>
          </aside>
          `;
}

function eventCard(ev) {
  const notes = ev.notes ? `\n              <p class="event-notes">${esc(ev.notes)}</p>` : '';
  return `
          <article class="event-card" id="${esc(ev.id)}">
            <div class="event-media">${picture(ev, 'event-img', { lazy: false })}</div>
            <div class="event-body">
              <span class="eyebrow">Special event</span>
              <h2 class="event-title">${esc(ev.title)}</h2>
              <ul class="event-meta">
                <li><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm12 8H5v9h14zM5 6v2h14V6z"/></svg><span><time datetime="${esc(ev.start)}">${esc(dateLabel(ev, true))}</time> · ${esc(timeLabel(ev))}</span></li>
                <li><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg><span>${esc(ev.location_name)}<br />${esc(ev.address)}</span></li>
              </ul>
              <p class="event-summary">${esc(ev.summary)}</p>${notes}
              <div class="event-actions">
                <a class="btn btn-facebook" href="${esc(ev.cta_url)}" target="_blank" rel="noopener noreferrer">${esc(ev.cta_label)}</a>
                <a class="btn btn-secondary" href="${esc(directionsUrl(ev))}" target="_blank" rel="noopener">Directions</a>
              </div>
            </div>
          </article>
          `;
}

function eventList(events) {
  if (!events.length) {
    return `
          <p class="events-empty">No events on the calendar right now. Follow us on <a href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">Facebook</a> or <a href="${INSTAGRAM_URL}" target="_blank" rel="noopener">Instagram</a> for the latest.</p>
          `;
  }
  return events.map(eventCard).join('');
}

function jsonLd(events) {
  return events.map((ev) => {
    const [street, locality, regionZip] = ev.address.split(',').map((s) => s.trim());
    const [region, postalCode] = (regionZip || '').split(/\s+/);
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: ev.title,
      startDate: ev.start,
      endDate: ev.end,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        name: ev.location_name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: street,
          addressLocality: locality,
          addressRegion: region,
          postalCode: postalCode,
          addressCountry: 'US',
        },
      },
      image: new URL(ev.image, SITE_URL).href,
      description: ev.summary,
      organizer: { '@type': 'Organization', name: "Lally's Cakes & Sweets", url: SITE_URL },
    };
    const json = JSON.stringify(data).replace(/</g, '\\u003c');
    return `\n  <script type="application/ld+json">\n  ${json}\n  </script>\n  `;
  }).join('');
}

// ---------- write ----------
function replaceBetween(html, name, content, file) {
  const re = new RegExp(`(<!-- EVENTS:${name}:START -->)[\\s\\S]*?(<!-- EVENTS:${name}:END -->)`);
  if (!re.test(html)) throw new Error(`Missing EVENTS:${name} markers in ${file}`);
  return html.replace(re, (m, a, b) => a + (content || '') + b);
}

function main() {
  const now = parseNow(process.argv.slice(2));
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'events.json'), 'utf8'));
  const all = Array.isArray(data) ? data : data.events || [];
  const upcoming = all
    .filter((ev) => new Date(ev.end).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const targets = {
    'index.html': { HOME: homeBox(upcoming[0]), JSONLD: jsonLd(upcoming) },
    'events.html': { LIST: eventList(upcoming), JSONLD: jsonLd(upcoming) },
  };

  for (const [file, blocks] of Object.entries(targets)) {
    const p = path.join(ROOT, file);
    const before = fs.readFileSync(p, 'utf8');
    let html = before;
    for (const [name, content] of Object.entries(blocks)) html = replaceBetween(html, name, content, file);
    if (html !== before) fs.writeFileSync(p, html);
    console.log(`${file}: ${html !== before ? 'updated' : 'unchanged'}`);
  }
  console.log(`now=${now.toISOString()} upcoming=${upcoming.length}/${all.length}` +
    (upcoming[0] ? ` next=${upcoming[0].id}` : ''));
}

main();
