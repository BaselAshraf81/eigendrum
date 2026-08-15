# Eigendrum presence server

Standalone WebSocket server counting concurrently open eigendrum.com tabs and
broadcasting the count. Kept outside Vercel since a serverless function can't
hold a persistent connection. No database, no state beyond who's connected now.

## Running it

Live at `wss://presence.prolifictea.com`, deployed on the same VPS as
prolifictea.com via a plain container (Coolify's Dockerfile resource needs a git
repo, so this is built and run by hand, with Traefik labels attached so the
existing proxy routes to it):

```bash
cd /opt/eigendrum-presence
docker build -t eigendrum-presence .
docker run -d --name eigendrum-presence --restart unless-stopped \
  --network coolify \
  -l "traefik.enable=true" \
  -l "traefik.http.routers.eigendrum-presence.rule=Host(\`presence.prolifictea.com\`)" \
  -l "traefik.http.routers.eigendrum-presence.entrypoints=http,https" \
  -l "traefik.http.routers.eigendrum-presence.tls=true" \
  -l "traefik.http.services.eigendrum-presence.loadbalancer.server.port=8787" \
  eigendrum-presence
```

`http,https` + `tls=true` with no cert resolver: Traefik redirects :80 to :443
internally regardless of Cloudflare's own Flexible SSL mode, so the router needs
both entrypoints or requests 503 with no matching route on :443.

To redeploy after a code change: stop + remove the container, rebuild, rerun the
same command.

`src/app/presence.js` holds the client URL.

## Notes

- Origin-locked to `eigendrum.com` / `www.eigendrum.com`.
- No logs, no IPs stored, just the current connection count in memory.
- If this server is down, the count just hides on the site. Nothing else depends on it.
