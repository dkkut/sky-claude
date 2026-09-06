import { spawn } from 'node:child_process';

if (process.platform !== 'win32') {
  console.error('[SKY/BLOOM] dev:win is only for Windows terminals.');
  console.error('[SKY/BLOOM] Use: npm run dev:local');
  process.exit(1);
}

const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/run-windows.ps1'], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
