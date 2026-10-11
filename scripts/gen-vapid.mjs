// Ключи для Web Push: node scripts/gen-vapid.mjs  (запускать там, где стоит server/node_modules)
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const webpush = require('web-push');
const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:you@example.com`);
