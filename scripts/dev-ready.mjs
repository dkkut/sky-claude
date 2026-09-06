import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

const run = (cmd, args, opts = {}) => new Promise(res => {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: true,          // shell:true on all platforms fixes Windows null-path bug
    cwd: root,
    ...opts,
  });
  child.on('error', err => { console.error('spawn error:', err.message); res(1); });
  child.on('exit', code => res(code ?? 0));
});

const nodeModules = path.join(root, 'node_modules');

if (!existsSync(nodeModules)) {
  console.log('⚙️  Устанавливаем зависимости...');
  let code = await run('npm', ['install', '--legacy-peer-deps']);
  if (code !== 0) {
    console.warn('⚠️  Пробуем npm install --force...');
    code = await run('npm', ['install', '--force']);
  }
  if (code !== 0) {
    console.error('❌ npm install не удался. Попробуй вручную: npm install --legacy-peer-deps');
    process.exit(1);
  }
}

console.log('');
console.log('✅ Запускаем Sky Ecosystem...');
console.log('🌐 Открой в браузере: http://localhost:4173');
console.log('');

await run('npx', ['vite', '--host', '0.0.0.0', '--port', '4173', '--strictPort']);
