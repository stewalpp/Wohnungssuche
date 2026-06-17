/* ============================================================
   Wohnungssuche — Cloudflare Worker: search-trigger proxy

   Lets the PWA start the GitHub Actions "daily-search" workflow with one tap,
   WITHOUT shipping a GitHub token to the browser. The token lives only here as
   an encrypted Worker secret; the Worker calls the GitHub API server-side.

   Secrets (wrangler secret put / dashboard → Settings → Variables, "Encrypt"):
     GH_TOKEN    fine-grained PAT, repo stewalpp/Wohnungssuche, Actions: Read+write
     APP_SECRET  optional shared secret the app must send (X-App-Secret header)

   Plain vars (wrangler.toml [vars] or dashboard, NOT encrypted):
     ALLOW_ORIGIN  e.g. https://stewalpp.github.io   (your GitHub Pages origin)
     REPO          stewalpp/Wohnungssuche            (optional, this is the default)
     WORKFLOW      daily-search.yml                  (optional default)
     REF           main                              (optional default)

   See README.md for the full setup.
   ============================================================ */

const DEFAULT_REPO = 'stewalpp/Wohnungssuche';
const DEFAULT_WORKFLOW = 'daily-search.yml';
const DEFAULT_REF = 'main';
const COOLDOWN_SECONDS = 60; // best-effort throttle so the button can't be spammed

export default {
  async fetch(request, env) {
    const allowOrigin = env.ALLOW_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

    // 1) Origin allowlist (blocks casual cross-site calls from a browser).
    if (env.ALLOW_ORIGIN && env.ALLOW_ORIGIN !== '*') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== env.ALLOW_ORIGIN) {
        return json({ error: 'forbidden_origin' }, 403, cors);
      }
    }

    // 2) Optional shared secret (deters bots that find the URL; not truly secret
    //    since it ships in the app — the real protection is GH_TOKEN staying here).
    if (env.APP_SECRET && request.headers.get('X-App-Secret') !== env.APP_SECRET) {
      return json({ error: 'unauthorized' }, 401, cors);
    }

    if (!env.GH_TOKEN) return json({ error: 'worker_not_configured' }, 500, cors);

    // 3) Best-effort cooldown (per Cloudflare data-centre) to cap abuse.
    const cache = caches.default;
    const cooldownKey = new Request('https://cooldown.invalid/wohnungssuche-trigger');
    if (await cache.match(cooldownKey)) {
      return json({ error: 'cooldown', retry_after_s: COOLDOWN_SECONDS }, 429, cors);
    }
    await cache.put(
      cooldownKey,
      new Response('1', { headers: { 'Cache-Control': `max-age=${COOLDOWN_SECONDS}` } })
    );

    // 4) Fire the workflow_dispatch event.
    const repo = env.REPO || DEFAULT_REPO;
    const workflow = env.WORKFLOW || DEFAULT_WORKFLOW;
    const ref = env.REF || DEFAULT_REF;
    const ghResp = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'wohnungssuche-trigger-worker',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref }),
      }
    );

    // GitHub returns 204 No Content on success.
    if (ghResp.status === 204) return json({ ok: true }, 200, cors);
    const detail = (await ghResp.text()).slice(0, 300);
    return json({ ok: false, github_status: ghResp.status, detail }, 502, cors);
  },
};

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
