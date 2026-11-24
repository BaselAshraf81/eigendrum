/**
 * One command for Eigendrum and the Erae simulator: `npm run erae`.
 *
 * Starts tools/serve.mjs on port 8080, waits until it answers, then opens the
 * Eigendrum in the default browser. The simulator is docked inside that page.
 * Pass --no-open to skip opening.
 * Ctrl+C stops the server.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 8080;
const BASE = `http://localhost:${PORT}`;
const SIM_URL = `${BASE}/tools/erae-sim/sim.html`;
const APP_URL = `${BASE}/?sim`;
const shouldOpen = !process.argv.includes('--no-open');

let server = null;
let stopping = false;

function fail(message) {
  console.error(message);
  if (server) server.kill();
  process.exit(1);
}

async function answers() {
  try {
    await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  const opener = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  opener.on('error', () => {});
  opener.unref();
}

process.on('SIGINT', () => {
  stopping = true;
  if (server) server.kill();
  process.exit(0);
});

if (await answers()) {
  console.log(`Port ${PORT} is already in use, so the server already running there is used.`);
} else {
  const serve = fileURLToPath(new URL('../serve.mjs', import.meta.url));
  server = spawn(process.execPath, [serve], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  server.on('exit', (code) => {
    if (!stopping) fail(`The server stopped with exit code ${code}. Another program may be using port ${PORT}.`);
  });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    ready = await answers();
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) fail(`The server did not answer on ${BASE} within 10 seconds.`);
}

console.log(`Eigendrum with the simulator docked: ${APP_URL}`);
console.log(`Simulator on its own, for reference: ${SIM_URL}`);
if (shouldOpen) openInBrowser(APP_URL);
