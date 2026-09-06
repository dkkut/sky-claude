import http from 'node:http';

const target = process.env.HEALTHCHECK_URL || 'http://127.0.0.1:4173';

http.get(target, (res) => {
  if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
    console.log(`[healthcheck] ok ${res.statusCode}`);
    process.exit(0);
  }

  console.error(`[healthcheck] failed ${res.statusCode}`);
  process.exit(1);
}).on('error', (error) => {
  console.error('[healthcheck] failed', error.message);
  process.exit(1);
});
