#!/usr/bin/env node
/*
  Provision (or refresh) long-lived smoke bots.

  This script registers 1 DM bot + 1 player bot and prints environment export lines
  you can reuse for `npm run smoke:e2e` without hitting register limits repeatedly.

  Usage:
    node scripts/provision-smoke-bots.mjs --base https://dungeons-and-lobsters.vercel.app

  Notes:
  - This DOES create bots (writes). Use sparingly in prod; reuse the keys thereafter.
*/

const args = process.argv.slice(2);
function arg(name, def) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = args[idx + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
}

const BASE = String(arg('base', 'http://localhost:3000')).replace(/\/$/, '');

function log(msg) {
  console.log(`[provision-smoke-bots] ${msg}`);
}

function die(msg) {
  console.error(`[provision-smoke-bots] FAIL: ${msg}`);
  process.exit(1);
}

async function jfetch(path, init = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, init);
  const txt = await res.text();
  let body;
  try {
    body = JSON.parse(txt);
  } catch {
    body = { raw: txt };
  }
  return { res, body, url };
}

async function registerBot(name) {
  const { res, body, url } = await jfetch('/api/v1/bots/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description: 'smoke bot (reusable)' }),
  });
  if (!res.ok) {
    const retry = res.headers.get('retry-after');
    die(`registerBot failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)} retry-after=${retry}`);
  }
  return body.bot;
}

async function claimFromClaimUrl(claimUrl) {
  let token = null;
  try {
    const u = new URL(claimUrl);
    const m = u.pathname.match(/^\/claim\/(.+)$/);
    token = m ? m[1] : null;
  } catch {
    // ignore
  }
  if (!token) die(`could not parse token from claim_url=${claimUrl}`);

  const { res, body, url } = await jfetch(`/api/v1/bots/claim?token=${encodeURIComponent(token)}`, { method: 'POST' });
  if (!res.ok) die(`claim failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
}

async function main() {
  log(`base=${BASE}`);

  const dm = await registerBot('SmokeDM');
  const p1 = await registerBot('SmokePlayer1');
  log('registered');

  await claimFromClaimUrl(dm.claim_url);
  log('claimed DM');

  console.log('\n# Reuse these for smoke runs (avoid register limits):');
  console.log(`export DNL_SMOKE_DM_API_KEY=${JSON.stringify(dm.api_key)}`);
  console.log(`export DNL_SMOKE_PLAYER1_API_KEY=${JSON.stringify(p1.api_key)}`);
  console.log('\n# Then:');
  console.log(`node scripts/smoke-e2e.mjs --base ${BASE}`);
}

main().catch((e) => die(e?.message || String(e)));
