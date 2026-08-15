/**
 * Eigendrum presence server.
 *
 * The one thing eigendrum.com cannot do honestly from a static site: report how
 * many people have the page open right now. That needs a server that knows who is
 * currently connected, which is exactly the thing the main site's charter rules
 * out (zero backend, file:// support). So it lives here, standalone, on its own
 * VPS, and the site only ever gets a number from it, never a fake one.
 *
 * Protocol, deliberately tiny:
 *   client connects via WebSocket -> server adds it to the open set, broadcasts
 *   the new count to everyone -> client disconnects (tab closed, network drop,
 *   or the periodic ping fails) -> server removes it, broadcasts again.
 *   Every message the server ever sends is: {"online": <integer>}
 *   The server does not read or care about anything a client sends.
 *
 * Origin-checked so only the real site's page can open a connection here, not an
 * arbitrary script on some other page inflating or reading the count.
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ALLOWED_ORIGINS = new Set([
  'https://eigendrum.com',
  'https://www.eigendrum.com',
]);

// A plain HTTP server underneath, for two reasons: a reverse proxy (Coolify's
// Traefik) needs something to forward to and to health-check, and a WebSocket
// server on its own has no HTTP response to give a plain GET.
const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server: http,
  verifyClient: ({ origin }) => ALLOWED_ORIGINS.has(origin),
});

function broadcastCount() {
  const payload = JSON.stringify({ online: wss.clients.size });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socket.on('close', broadcastCount);
  broadcastCount();
});

// Dead connections (laptop closed, network dropped) do not always fire a clean
// close event, so the count would drift upward forever without this. Every 30s,
// ping everyone; anyone who did not pong since the last sweep is terminated.
const HEARTBEAT_MS = 30_000;
const sweep = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_MS);

http.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`eigendrum presence server listening on :${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(sweep);
    wss.close(() => http.close(() => process.exit(0)));
  });
}
