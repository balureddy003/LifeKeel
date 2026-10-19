// Serves the static export like the landing-uk Firebase target: its real headers (minus
// upgrade-insecure-requests, which cannot work on http://localhost) and an index.html fallback.
// Use it to see CSP violations before a deploy:
//   pnpm --filter @lifekeel/web run build:export && node scripts/externalize-inline-scripts.mjs apps/web/out
//   node scripts/serve-static-csp.mjs apps/web/out apps/web/firebase.json   # open http://localhost:8770
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(process.argv[2])
const cfg = JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8'))
const site = cfg.hosting.find((h) => h.target === 'landing-uk')
const headers = Object.fromEntries(site.headers[0].headers.map((h) => [h.key, h.value]))
// http://localhost cannot be upgraded to https; everything else in the CSP is kept as deployed.
headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(
  '; upgrade-insecure-requests',
  '',
)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain',
}
http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    let f = path.join(root, p)
    if (f !== root && !f.startsWith(root + path.sep)) {
      res.writeHead(403)
      return res.end()
    }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html')
    if (!fs.existsSync(f)) f = path.join(root, 'index.html')
    res.writeHead(200, {
      ...headers,
      'Content-Type': types[path.extname(f)] ?? 'application/octet-stream',
    })
    fs.createReadStream(f).pipe(res)
  })
  .listen(8770, '127.0.0.1', () => console.log('serving', root, 'on 8770'))
