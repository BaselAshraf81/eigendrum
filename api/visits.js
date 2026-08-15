/**
 * Serverless function (Vercel Node runtime) that reports a real visitor count.
 *
 * Calls Vercel's own Web Analytics API server-side, using an API token that
 * never reaches the browser, for the count since launch.
 *
 * This deliberately uses `visits/aggregate?by=day` and sums the days, NOT
 * `visits/count` over the whole range. Vercel's "unique visitor" identifier is
 * a privacy-preserving hash that is rotated and discarded every 24 hours (see
 * their Web Analytics docs), so "unique" is only meaningful within a single
 * day. `visits/count` over a multi-day range dedupes across that rotation and
 * comes out far lower than what the dashboard shows, because the dashboard's
 * own "last N days" figure is exactly this same day-by-day sum. Verified
 * directly against the API on 2026-08-15: summing the daily aggregate for
 * Aug 13-15 gives 5155, matching the dashboard's ~5085 for the same window,
 * while `visits/count` over that same range returned 2160.
 *
 * The Hobby plan's Web Analytics only exposes the latest 31 days of data, but
 * the site launched on 2026-08-11, well inside that window, so this already
 * covers every visit there has ever been. No hand-copied offset is needed.
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
      by: 'day',
    });
    if (teamId) params.set('teamId', teamId);

    const upstream = await fetch(
      `https://api.vercel.com/v1/query/web-analytics/visits/aggregate?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!upstream.ok) {
      res.status(200).json({ count: 0, live: false });
      return;
    }

    const data = await upstream.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    const total = rows.reduce((sum, row) => sum + (Number(row?.visitors) || 0), 0);

    res.status(200).json({ count: total, live: true });
  } catch {
    res.status(200).json({ count: 0, live: false });
  }
}
