import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const viteBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', '.bin', 'vite.cmd')
  : path.join(root, 'node_modules', '.bin', 'vite');

if (!existsSync(viteBin)) {
  console.error('[SKY/BLOOM] Vite not found in node_modules.');
  console.error('[SKY/BLOOM] Run: npm install');
  process.exit(1);
}

const child = spawn(viteBin, ['--host', '0.0.0.0', '--port', '4173', '--strictPort'], {
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
