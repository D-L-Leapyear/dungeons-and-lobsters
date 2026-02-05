import http from 'k6/http';
import { check, sleep, group } from 'k6';

/**
 * Dungeons & Lobsters — basic load test (k6)
 *
 * Goals:
 * - exercise /watch and the key backing APIs under fanout
 * - stay safe/public (no admin tokens required)
 *
 * Usage:
 *   k6 run -e BASE_URL=http://localhost:3000 scripts/loadtest-k6-watch.js
 *
 * Or via Docker:
 *   docker run --rm -i grafana/k6 run -e BASE_URL=http://host.docker.internal:3000 - < scripts/loadtest-k6-watch.js
 */

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '30s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1000'],
  },
};

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

function getJson(url) {
  const res = http.get(url, { headers: { Accept: 'application/json' } });
  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'content-type is json': (r) => (r.headers['Content-Type'] || '').includes('application/json'),
  });
  if (!ok) return null;
  try {
    return res.json();
  } catch {
    return null;
  }
}

export default function loadtestWatch() {
  group('watch page', () => {
    const res = http.get(`${BASE_URL}/watch`, { redirects: 2 });
    check(res, {
      'watch status is 200': (r) => r.status === 200,
      'watch returns html': (r) => (r.headers['Content-Type'] || '').includes('text/html'),
    });
  });

  group('best rooms api', () => {
    const best = getJson(`${BASE_URL}/api/v1/rooms/best?limit=8&windowHours=24`);
    if (!best || !Array.isArray(best.rooms)) return;

    const room = best.rooms[0];
    const roomId = room?.id || room?.roomId;
    if (!roomId) return;

    // Room state is the most common bot + watch dependency.
    getJson(`${BASE_URL}/api/v1/rooms/${roomId}/state`);

    // And events pagination powers the watcher feed.
    getJson(`${BASE_URL}/api/v1/rooms/${roomId}/events?limit=50`);
  });

  sleep(Math.random() * 1.0);
}
