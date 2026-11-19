# Vercel frontend and Render API routing

This document records the same-origin deployment contract for the existing static site and Express API. It does not configure or deploy either service.

## Current browser contract

Browser API requests use relative `/api/v1/...` paths or derive that path from `window.location.origin`. The Admin portal also requests `/health`. No API call uses a hardcoded localhost or Render origin. Keep these URLs same-origin in the browser.

The Node server serves the same `public/` directory and API locally. A Vercel static deployment needs an external rewrite for the API and the exact health path. There is no checked-in `vercel.json` because the actual Render service hostname is not known. Do not commit a guessed host or a placeholder destination.

## Vercel setup after Render provides its service hostname

Set the Vercel project root to this application repository, use the `Other` framework preset, leave the build command empty, and set the output directory to `public`. The site consists of static pages; do not add a catch-all rewrite to `index.html`.

At deployment time, create `vercel.json` in the project root using the actual HTTPS hostname supplied by Render. Replace the placeholder below before saving; it is documentation, not valid deploy configuration:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/api/v1/:path*",
      "destination": "https://<ACTUAL_RENDER_SERVICE_HOST>/api/v1/:path*"
    },
    {
      "source": "/health",
      "destination": "https://<ACTUAL_RENDER_SERVICE_HOST>/health"
    }
  ]
}
```

The API rule is intentionally limited to `/api/v1/*`; `/health` is a separate exact route used by the Admin UI. Do not add a root wildcard that sends static HTML, scripts, styles, or images to Render. External rewrites are Vercel's reverse-proxy mechanism. Validate query parameters, methods, request bodies, status codes, response headers, and `Set-Cookie` behavior in a Vercel preview after the real hostname is available. Do not enable API response caching; confirm authentication responses are not cached.

## Authentication and security

The application authenticates from an HTTP-only cookie. Login and logout cookies use `SameSite=Strict`, and `Secure` is enabled when `NODE_ENV=production`. Keep those settings. With the browser URL remaining on Vercel and `/api/v1/*` rewritten server-side, requests are same-origin from the browser's perspective; do not change to `SameSite=None` to support a direct cross-site API call.

The cookie has no explicit `Domain`, so it remains host-only. Confirm in preview that the proxied login response's `Set-Cookie` reaches the browser for the Vercel site and that subsequent protected requests include it. JavaScript must not read or store the JWT.

The API uses cookie authentication and `SameSite=Strict`; no CSRF token or explicit Origin/Fetch-Metadata validation was found in the inspected path. Keep `SameSite=Strict`; separately review Origin/Fetch-Metadata enforcement if untrusted same-site sibling hosts or additional cross-origin clients are introduced. Do not treat CORS as authorization.

Logout currently expires/replaces the browser cookie but does not increment the server-side `tokenVersion`; a copied token can remain valid until its JWT expiry. This behavior is unchanged by the routing work and needs a separate auth-policy decision if immediate server-side revocation is required.

## Render settings to select when the service exists

- Start command: `npm start`; the app listens on Render's `PORT`.
- Health check path: `/health`; it reports MongoDB readiness only, not Redis or email-worker readiness.
- Set production `CORS_ORIGIN` to explicit HTTPS origins. Same-origin proxy traffic does not require browser CORS, but production startup still requires this setting. Do not use `*` or broaden it to compensate for routing.
- `FRONTEND_URL` (or `SCHOOL_WEBSITE`) must be the actual public Vercel URL so activation and recovery links lead back to the frontend. Production URL validation requires HTTPS.
- `server.js` sets Express `trust proxy` from `TRUST_PROXY_HOPS`, which defaults to `0`. Set it only after confirming the Render proxy-hop behavior; do not blindly trust all forwarded headers.

## Preview acceptance checklist

1. Static pages and assets load from Vercel, including nested `/portal/...` pages and print pages.
2. `/api/v1/...` requests reach the actual Render service without changing the browser URL; `/health` reaches Render through its exact rule.
3. GET query strings, POST/PUT/PATCH/DELETE methods, JSON bodies, API status codes, and error responses arrive unchanged.
4. Login sets the HTTP-only, Secure, Strict cookie on the Vercel site; `/auth/me` succeeds; logout clears it; no token is exposed to JavaScript.
5. Invitation and recovery emails link to the Vercel frontend URL.
6. No API response is cached, and production CORS contains only approved HTTPS origins.

These checks require a configured Vercel preview and Render service. They have not been run in this repository phase.
