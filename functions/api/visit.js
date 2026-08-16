/**
 * Cloudflare Pages Function that records one page-load visit.
 *
 * It stores only an aggregate number. There are no cookies, IP addresses, or
 * browser identifiers, so this is a page-load count rather than a unique-user
 * count.
 */

const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

export async function onRequestPost({ env }) {
  if (!env.DB) return json({ count: 0, live: false }, 503);

  try {
    await env.DB
      .prepare('UPDATE site_stats SET value = value + 1 WHERE key = ?1')
      .bind('visits')
      .run();

    const row = await env.DB
      .prepare('SELECT value FROM site_stats WHERE key = ?1')
      .bind('visits')
      .first();
    const count = Number(row?.value);
    return Number.isFinite(count) ? json({ count, live: true }) : json({ count: 0, live: false }, 500);
  } catch {
    return json({ count: 0, live: false }, 500);
  }
}

export function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  });
}
