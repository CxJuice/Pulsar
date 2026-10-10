import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const build = spawn('cargo', ['build', '--manifest-path', 'service/Cargo.toml'], { stdio: 'inherit', windowsHide: true });
build.on('exit', async code => {
  if (code !== 0) process.exit(code || 1);
  const nuxt = spawn(process.execPath, ['node_modules/nuxt/bin/nuxt.mjs', 'dev', '--host', '127.0.0.1', '--port', '3000'], { stdio: 'inherit', windowsHide: true });
  let electron;
  const stop = () => { nuxt.kill(); electron?.kill(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const response = await fetch('http://127.0.0.1:3000'); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
    if (attempt === 119) { stop(); throw new Error('Nuxt 启动超时'); }
  }
  const electronEnv = { ...process.env, SCKIT_DEV_URL: 'http://127.0.0.1:3000' };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  electron = spawn(require('electron'), ['.'], { stdio: 'inherit', windowsHide: true, env: electronEnv });
  electron.on('exit', () => { stop(); process.exit(); });
});
