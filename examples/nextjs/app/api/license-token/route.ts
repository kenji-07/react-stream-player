// Placeholder for YOUR license-token endpoint. Mint a short-lived, scoped token
// for the signed-in viewer here (server side, using secrets from server-only
// environment variables). This example has no DRM provider, so it returns none.
export function GET(): Response {
  return Response.json({ token: null }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
