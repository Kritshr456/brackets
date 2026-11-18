import { test as base, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { browserToken } from './fixture.js';

export const test = base.extend({
  baseURL: async ({}, use) => {
    const directory = mkdtempSync(join(tmpdir(), 'brackets-browser-'));
    const store = openStore(join(directory, 'app.sqlite'));
    const server = createApp(store, browserToken);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      await use(`http://127.0.0.1:${server.address().port}`);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
});
export { expect };
