/**
 * Cloudflare Pages Function that reads the launch visit count from D1.
 *
 * The total is seeded once in D1 and incremented by api/visit.js. No browser
 * identifier or IP address is stored.
 */

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: CACHE_HEADERS,
  });
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ count: 0, live: false });

  try {
    const row = await env.DB
      .prepare('SELECT value FROM site_stats WHERE key = ?1')
      .bind('visits')
      .first();
    const count = Number(row?.value);
    return Number.isFinite(count) ? json({ count, live: true }) : json({ count: 0, live: false });
  } catch {
    return json({ count: 0, live: false });
  }
}

export function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'GET' },
  });
}
