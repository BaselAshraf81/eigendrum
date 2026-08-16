/**
 * Cloudflare Pages Function for the visitor count.
 *
 * It temporarily keeps Vercel Web Analytics as the data source so the move to
 * Pages does not reset the displayed count. The token stays in the Pages
 * runtime environment and never reaches the browser.
 */

const SINCE = '2026-08-11T00:00:00.000Z';
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
  const token = env.VERCEL_API_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  const teamId = env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    return json({ count: 0, live: false });
  }

  try {
    const params = new URLSearchParams({
      projectId,
      since: SINCE,
      until: new Date().toISOString(),
      by: 'day',
    });
    if (teamId) params.set('teamId', teamId);

    const upstream = await fetch(
      `https://api.vercel.com/v1/query/web-analytics/visits/aggregate?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!upstream.ok) {
      return json({ count: 0, live: false });
    }

    const data = await upstream.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    const total = rows.reduce((sum, row) => sum + (Number(row?.visitors) || 0), 0);

    return json({ count: total, live: true });
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
