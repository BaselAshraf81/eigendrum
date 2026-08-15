/**
 * Serverless function (Vercel Node runtime) that reports a real visitor count.
 *
 * Calls Vercel's own Web Analytics API (visits/count) server-side, using an API
 * token that never reaches the browser, for the count since launch.
 *
 * The Hobby plan's Web Analytics only exposes the latest 31 days of data, but
 * the site launched on 2026-08-11, well inside that window, so the API's own
 * total already covers every visit there has ever been. No hand-copied offset
 * is needed (an earlier version of this file used one; it was removed once this
 * was confirmed against the API directly).
 *
 * Requires these Environment Variables on the Vercel project (free on Hobby):
 *   VERCEL_API_TOKEN   - a personal access token (vercel.com/account/tokens)
 *   VERCEL_TEAM_ID      - only needed if the project sits under a team
 *   VERCEL_PROJECT_ID   - the project's ID, e.g. prj_xxxxxxxx
 *
 * If any of those are missing, or the API call fails for any reason, this
 * returns `live: false` with a count of 0 rather than guessing, so a page never
 * displays a fabricated number.
 */

// Launch day. The API requires both `since` and `until`; `until` is generated
// fresh on every request below.
const SINCE = '2026-08-11T00:00:00.000Z';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    res.status(200).json({ count: 0, live: false });
    return;
  }

  try {
    const params = new URLSearchParams({
      projectId,
      since: SINCE,
      until: new Date().toISOString(),
    });
    if (teamId) params.set('teamId', teamId);

    const upstream = await fetch(
      `https://api.vercel.com/v1/query/web-analytics/visits/count?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!upstream.ok) {
      res.status(200).json({ count: 0, live: false });
      return;
    }

    const data = await upstream.json();
    // The count endpoint's payload is `data.visitors` (unique visitors), not
    // `data.total`. `data.pageviews` is also available but visitors matches what
    // "visits" means everywhere else on the site.
    const apiCount = Number(data?.data?.visitors ?? 0);

    res.status(200).json({ count: Number.isFinite(apiCount) ? apiCount : 0, live: true });
  } catch {
    res.status(200).json({ count: 0, live: false });
  }
}
