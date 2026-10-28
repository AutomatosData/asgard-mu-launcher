#!/usr/bin/env node
/**
 * Servidor de teste para "node tools/release.js ... --local" (ver PUBLICAR.md)
 *
 *   node tools/serve-local.js [porta] [KB/s]     (padrão 18787, sem limite de velocidade)
 *
 * Serve .release-local/<tag>/<arquivo> como os GitHub Releases, com suporte a Range
 * (o launcher continua downloads interrompidos). Abra o launcher com:
 *   set ASGARD_MANIFEST_URL=http://127.0.0.1:18787/current/update.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '.release-local');
const PORT = parseInt(process.argv[2], 10) || 18787;
// Limite de velocidade, para ver o progresso do launcher em testes
const RATE = (parseInt(process.argv[3], 10) || 0) * 1024;

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const filePath = path.resolve(ROOT, `.${urlPath}`);
  let stats = null;
  try {
    stats = filePath.startsWith(ROOT + path.sep) ? fs.statSync(filePath) : null;
  } catch {}

  if (!stats || !stats.isFile()) {
    res.writeHead(404);
    res.end('Not found');
    console.log(`404 ${urlPath}`);
    return;
  }

  const headers = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = stats.size - 1;
  let status = 200;
  if (range) {
    start = parseInt(range[1], 10);
    end = range[2] ? Math.min(parseInt(range[2], 10), end) : end;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
      res.end();
      return;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  console.log(`${status} ${urlPath}${range ? ` (${start}-${end})` : ''}`);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath, { start, end, highWaterMark: 16 * 1024 });
  if (!RATE) {
    stream.pipe(res);
    return;
  }
  stream.on('data', (chunk) => {
    stream.pause();
    res.write(chunk);
    setTimeout(() => stream.resume(), (chunk.length / RATE) * 1000);
  });
  stream.on('end', () => res.end());
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Servindo ${ROOT}`);
  console.log(`Manifesto: http://127.0.0.1:${PORT}/current/update.json`);
});
