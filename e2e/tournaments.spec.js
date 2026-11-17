import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { browserToken } from './fixture.js';

async function connect(page) {
  await page.goto('/');
  await page.getByLabel('Organizer API token').fill(browserToken);
  await page.getByRole('button', { name: 'Connect / refresh' }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
}
async function create(page, name, format, capacity) {
  await page.locator('#create input[name=name]').fill(name);
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption(format);
  await page.getByLabel('Capacity', { exact: true }).fill(String(capacity));
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Tournament created. Register entrants below.');
  await expect(page.locator('#selected')).toContainText(name);
}
async function register(page, name) {
  await page.getByLabel('Entrant name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Register entrant', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await expect(page.locator('#entrants')).toContainText(name);
}
async function result(page, a, b, expected = 'Saved / refreshed.') {
  await page.locator('#result input[name=scoreA]').fill(String(a));
  await page.locator('#result input[name=scoreB]').fill(String(b));
  await page.getByRole('button', { name: 'Save result', exact: true }).click();
  await expect(page.locator('#status')).toHaveText(expected);
}

test('round-robin organizer flow includes filters, shared leaders, CSV export and persisted reload', async ({ page }) => {
  const errors = [], serverFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) serverFailures.push(response.status()); });
  await connect(page);
  await create(page, 'Browser league', 'round_robin', 3);
  const players = ['=SUM(1,2)', '<img src=x onerror=alert(1)>', 'Team "C"'];
  for (const name of players) await register(page, name);
  await expect(page.locator('#entrants img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start tournament', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await expect(page.locator('#bracket .match')).toHaveCount(3);
  await expect(page.locator('#match-choice option')).toHaveCount(3);
  await expect(page.locator('#standings tbody tr')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('completed');
  await expect(page.locator('#bracket')).toHaveText('No matches match these filters.');
  await result(page, 0, 0);
  await expect(page.locator('#bracket .match')).toHaveCount(1);
  await expect(page.locator('#bracket')).toContainText('Draw');
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('all');
  await page.getByRole('combobox', { name: 'Round', exact: true }).selectOption('2');
  await expect(page.locator('#bracket .match')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Round', exact: true }).selectOption('all');
  await result(page, 0, 0); await result(page, 0, 0);
  await expect(page.locator('#selected')).toContainText('Shared first:');
  await expect(page.locator('#selected')).toContainText('completed');
  for (const row of await page.locator('#standings tbody tr').all()) {
    await expect(row.locator('td').nth(0)).toHaveText('1');
    await expect(row.locator('td').nth(2)).toHaveText('2');
    await expect(row.locator('td').nth(4)).toHaveText('2');
    await expect(row.locator('td').nth(9)).toHaveText('2');
  }
  await expect(page.getByRole('button', { name: 'Save result', exact: true })).toBeDisabled();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^tournament-\d+-standings\.csv$/);
  const csv = await readFile(await file.path(), 'utf8');
  expect(csv).toContain('"\'=SUM(1,2)"'); expect(csv).toContain('"Team ""C"""');
  await page.reload();
  await expect(page.getByLabel('Organizer API token')).toHaveValue('');
  await page.getByLabel('Organizer API token').fill(browserToken);
  await page.getByRole('button', { name: 'Connect / refresh' }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await page.locator('#tournaments button').filter({ hasText: 'Browser league' }).click();
  await expect(page.locator('#selected')).toContainText('Shared first:');
  await expect(page.locator('#standings tbody tr')).toHaveCount(3);
  expect(errors).toEqual([]); expect(serverFailures).toEqual([]);
  if (process.env.BROWSER_SCREENSHOT_PATH) await page.screenshot({ path: process.env.BROWSER_SCREENSHOT_PATH, fullPage: true });
});

test('single-elimination UI still rejects draws and advances a winner', async ({ page }) => {
  await connect(page);
  await create(page, 'Browser cup', 'single_elimination', 2);
  await register(page, 'Alpha'); await register(page, 'Beta');
  await page.getByRole('button', { name: 'Start tournament', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await expect(page.locator('#standings-section')).toBeHidden();
  await result(page, 0, 0, 'Single-elimination matches cannot end in a draw.');
  await expect(page.locator('#bracket .ready')).toHaveCount(1);
  await result(page, 2, 0);
  await expect(page.locator('#selected')).toContainText('Champion: Alpha');
});

test('authentication errors are visible and format limits update without a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Organizer API token').fill('invalid-browser-test-token');
  await page.getByRole('button', { name: 'Connect / refresh' }).click();
  await expect(page.locator('#status')).toHaveText('A valid bearer token is required.');
  await page.getByLabel('Capacity', { exact: true }).fill('128');
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('round_robin');
  await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue('32');
  await expect(page.getByLabel('Capacity', { exact: true })).toHaveAttribute('max', '32');
  await page.getByLabel('Organizer API token').fill(browserToken);
  await page.getByRole('button', { name: 'Connect / refresh' }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
});

test('round-robin table and fixtures remain usable on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connect(page); await create(page, 'Mobile league', 'round_robin', 3);
  for (const name of ['Red', 'Green', 'Blue']) await register(page, name);
  await page.getByRole('button', { name: 'Start tournament', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await expect(page.locator('#standings')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await result(page, 2, 1);
  await expect(page.locator('#standings tbody tr').first().locator('td').nth(9)).toHaveText('3');
});
