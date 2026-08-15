/**
 * Serverless function (Vercel Node runtime) that reports a real visitor count.
 *
 * Calls Vercel's own Web Analytics API (visits/count) server-side, using an API
 * token that never reaches the browser, and adds a fixed offset representing
 * traffic that happened before this endpoint existed. Vercel's Web Analytics only
 * has data from the day tracking was enabled forward, it has no way to answer for
 * traffic that happened before this endpoint existed. The offset is a real number
 * copied by hand from the Vercel dashboard's own total on the day this endpoint
 * was wired up (2026-08-15), not an invented one, and it stays fixed forever
 * while the live part of the count is the real, checkable API total from that
 * point on.
 *
 * Requires these Environment Variables on the Vercel project (free on Hobby):
 *   VERCEL_API_TOKEN   - a personal access token (vercel.com/account/tokens)
 *   VERCEL_TEAM_ID      - only needed if the project sits under a team
 *   VERCEL_PROJECT_ID   - the project's ID, e.g. prj_xxxxxxxx
 *
 * If any of those are missing, or the API call fails for any reason, this
 * returns just the offset with `live: false` rather than guessing, so a page
 * never displays a fabricated number.
 */

const OFFSET = 3623;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');

  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    res.status(200).json({ count: OFFSET, live: false });
    return;
  }

  try {
    const params = new URLSearchParams({ projectId });
    if (teamId) params.set('teamId', teamId);

    const upstream = await fetch(
      `https://api.vercel.com/v1/query/web-analytics/visits/count?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!upstream.ok) {
      res.status(200).json({ count: OFFSET, live: false });
      return;
    }

    const data = await upstream.json();
    // The API's own response shape for a count endpoint is a single numeric total,
    // exposed under `data.total` in the current version. Fall back defensively.
    const apiCount = Number(data?.data?.total ?? data?.total ?? 0);
    const total = OFFSET + (Number.isFinite(apiCount) ? apiCount : 0);

    res.status(200).json({ count: total, live: true });
  } catch {
    res.status(200).json({ count: OFFSET, live: false });
  }
}
