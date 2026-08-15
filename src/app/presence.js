/**
 * Live "people here now" count.
 *
 * Talks to a standalone WebSocket server on a different machine entirely (see
 * presence-server/ at the repo root) - this site has no backend of its own, and
 * that server is the one exception, kept deliberately separate rather than folded
 * into a Vercel function, because a serverless function has no persistent
 * connection to count. If the server is unreachable, slow, or the connection
 * drops, the element simply stays hidden: no placeholder number, no "connecting"
 * text pretending to be data.
 */

const WS_URL = 'wss://presence.prolifictea.com';
const RECONNECT_MS = 4000;

/** Mounts a live presence connection into `el`, gated to the deployed host by the
 *  caller (same gate as ads/analytics/visits). Returns nothing; failures are
 *  silent by design, since a missing count is honest and a wrong one is not. */
export function mountPresence(el) {
  if (!el || typeof WebSocket === 'undefined') return;

  let socket;
  let closedByUs = false;

  function connect() {
    try {
      socket = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!Number.isFinite(data?.online) || data.online < 1) return;
      const n = Math.round(data.online);
      el.textContent = n === 1 ? '1 here now' : `${n} here now`;
      el.title = n === 1 ? '1 person has the page open right now' : `${n} people have the page open right now`;
      el.hidden = false;
    });

    socket.addEventListener('close', () => {
      el.hidden = true;
      if (!closedByUs) scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // 'close' always follows 'error' for a WebSocket, so no separate handling
      // is needed here beyond letting that fire.
    });
  }

  function scheduleReconnect() {
    setTimeout(connect, RECONNECT_MS);
  }

  connect();

  // Not currently used by any caller, but a mounted connection should be
  // stoppable rather than assumed to live forever.
  return () => {
    closedByUs = true;
    socket?.close();
  };
}
