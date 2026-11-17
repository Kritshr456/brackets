import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { browserToken } from '../e2e/fixture.js';

const directory = mkdtempSync(join(tmpdir(), 'brackets-browser-'));
const store = openStore(join(directory, 'app.sqlite'));
const server = createApp(store, browserToken);
const port = Number(process.env.BROWSER_TEST_PORT || 4179);
server.listen(port, '127.0.0.1', () => console.log(`Isolated browser test server ready on ${port}`));
server.on('error', () => { store.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => store.close()));
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
