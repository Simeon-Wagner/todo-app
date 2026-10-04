// Kleiner Testserver fuer den Browser: liefert die App aus und reicht alle anderen Anfragen
// an einen CalDAV-Server weiter (umgeht die Browser-Sperre beim Testen am Rechner).
// Aufruf: node scripts/dev-server.mjs https://cloud.beispiel.de [port]
// Danach http://localhost:8080 oeffnen und als Adresse http://localhost:8080 eingeben.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = new URL(process.argv[2] || 'http://127.0.0.1:5232');
const port = Number(process.argv[3] || 8080);
const www = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json' };

http
  .createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(www, p === '/' ? 'index.html' : p);
    if (req.method === 'GET' && file.startsWith(www) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    const lib = target.protocol === 'https:' ? https : http;
    const headers = Object.assign({}, req.headers, { host: target.host });
    const out = lib.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), method: req.method, path: target.pathname.replace(/\/$/, '') + req.url, headers },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      }
    );
    out.on('error', (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    req.pipe(out);
  })
  .listen(port, () => console.log('App: http://localhost:' + port + '  ->  ' + target.href));
