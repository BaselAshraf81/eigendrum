/**
 * Zero-dependency static dev server.
 *
 * Serves the project root so `index.html` and its ES modules load the same way
 * they would on any static host. Sets the headers modules and workers need.
 */

import http from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // robots.txt, sitemap.xml and llms.txt are only useful if a crawler is willing to
  // read them, and octet-stream is an invitation to download rather than parse.
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.map': 'application/json',
};

/* The Monetag tag is pasted into the pages exactly as their dashboard issues it, which
   means it is unconditional - their installation checker reads the served HTML and would
   not recognise a rewritten or wrapped version. Unconditional is wrong locally, though:
   impressions from a developer's machine or from the browser suites are traffic no real
   visitor generated, and networks close accounts over that. So the gate moved from the
   page to this server, which strips the tag out of any HTML it serves. Production is
   untouched; localhost never contacts the ad network. */
function stripAdTag(html) {
  return html.replace(/[ \t]*<script>\(function\(s\)\{s\.dataset\.zone[\s\S]*?<\/script>\n?/g, '');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Contain everything under ROOT.
  const target = join(ROOT, normalize(pathname).replace(/^([/\\])+/, ''));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let stats;
  try {
    stats = statSync(target);
    if (stats.isDirectory()) throw new Error('directory');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  const ext = extname(target).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';

  if (ext === '.html') {
    // Rewritten, so the length changes and the file cannot simply be streamed.
    const body = stripAdTag(readFileSync(target, 'utf8'));
    res.writeHead(200, {
      'content-type': type,
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-cache',
    });
    res.end(body);
    return;
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': stats.size,
    'cache-control': 'no-cache',
  });
  createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Eigendrum dev server: http://localhost:${PORT}`);
});
