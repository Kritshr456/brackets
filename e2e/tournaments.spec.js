import { test, expect } from './browser.js';
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

test('correcting a knockout winner reopens the cup and retains an audit trail after reload', async ({ page }) => {
  await connect(page);
  await create(page, 'Correction cup', 'single_elimination', 4);
  for (const name of ['Correction Alpha', 'Correction Beta', 'Correction Gamma', 'Correction Delta']) await register(page, name);
  await page.getByRole('button', { name: 'Start tournament', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await result(page, 2, 0); await result(page, 2, 0); await result(page, 2, 0);
  await expect(page.locator('#selected')).toContainText('Champion: Correction Alpha');
  await page.setViewportSize({ width: 390, height: 844 });
  const target = await page.locator('#correction-match option').first().getAttribute('value');
  await page.locator('#correction-match').selectOption(target);
  await expect(page.locator('#correction input[name=scoreA]')).toHaveValue('2');
  await page.locator('#correction input[name=scoreA]').fill('0');
  await page.locator('#correction input[name=scoreB]').fill('3');
  const reason = '<img src=x onerror=alert(1)> Score entered backwards';
  await page.getByLabel('Correction reason', { exact: true }).fill(reason);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Correct saved score', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Result corrected. 1 dependent result(s) cleared.');
  await expect(page.locator('#selected')).toContainText('running');
  await expect(page.locator('#bracket .ready')).toHaveCount(1);
  await expect(page.locator('#result-history')).toContainText('Cleared after correction');
  await expect(page.locator('#result-history')).toContainText(reason);
  await expect(page.locator('#result-history img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload(); await connect(page);
  await page.locator('#tournaments button').filter({ hasText: 'Correction cup' }).click();
  await expect(page.locator('#result-history')).toContainText(reason);
  await result(page, 4, 0);
  await expect(page.locator('#selected')).toContainText('Champion: Correction Delta');
  if (process.env.BROWSER_CORRECTION_SCREENSHOT_PATH)
    await page.screenshot({ path: process.env.BROWSER_CORRECTION_SCREENSHOT_PATH, fullPage: true });
});

test('correcting a completed league updates its champion and exported standings', async ({ page }) => {
  await connect(page); await create(page, 'Corrected league', 'round_robin', 2);
  await register(page, 'League Alpha'); await register(page, 'League Beta');
  await page.getByRole('button', { name: 'Start tournament', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await result(page, 0, 0);
  await expect(page.locator('#selected')).toContainText('Shared first:');
  await page.locator('#correction input[name=scoreA]').fill('2');
  await page.locator('#correction input[name=scoreB]').fill('0');
  await page.getByLabel('Correction reason', { exact: true }).fill('Confirmed score with the organizer');
  const expectedChampion = await page.locator('#correction-side-a').textContent();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Correct saved score', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Result corrected. 0 dependent result(s) cleared.');
  await expect(page.locator('#selected')).toContainText(`Champion: ${expectedChampion.replace(/ score$/, '')}`);
  await expect(page.locator('#standings tbody tr').first().locator('td').nth(9)).toHaveText('3');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const file = await download, csv = await readFile(await file.path(), 'utf8');
  expect(csv).toContain('"2","0","2","3"');
  await expect(page.locator('#result-history li')).toHaveCount(2);
});

test('result history pages retain older correction reasons', async ({ page }) => {
  await connect(page); await create(page, 'History cup', 'single_elimination', 2);
  await register(page, 'History Alpha'); await register(page, 'History Beta');
  await page.getByRole('button', { name: 'Start tournament', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await result(page, 1, 0);
  const id = (await page.locator('#selected').textContent()).match(/^#(\d+)/)[1];
  const headers = { Authorization: `Bearer ${browserToken}` };
  let current = await (await page.request.get(`/api/tournaments/${id}`, { headers })).json();
  for (let i = 0; i < 22; i++) {
    const match = current.matches[0];
    const response = await page.request.post(`/api/tournaments/${id}/correct-result`, { headers, data: {
      matchId: match.id, scoreA: i + 2, scoreB: 0, reason: `Verified score ${i}`,
      expectedScoreA: match.score_a, expectedScoreB: match.score_b, expectedRevision: match.revision,
    } });
    expect(response.status()).toBe(200); current = await response.json();
  }
  await page.getByRole('button', { name: 'Connect / refresh' }).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await expect(page.locator('#history-summary')).toHaveText('Page 1 of 2 · 23 events');
  await expect(page.locator('#result-history li')).toHaveCount(20);
  await page.getByRole('button', { name: 'Next history page', exact: true }).click();
  await expect(page.locator('#history-summary')).toHaveText('Page 2 of 2 · 23 events');
  await expect(page.locator('#result-history li')).toHaveCount(3);
  await expect(page.locator('#result-history')).toContainText('Verified score 0');
  await expect(page.getByRole('button', { name: 'Next history page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous history page', exact: true }).click();
  await expect(page.locator('#history-summary')).toHaveText('Page 1 of 2 · 23 events');
});

test('an old result form cannot score new participants after another organizer corrects a feeder', async ({ page }) => {
  await connect(page); await create(page, 'Stale result cup', 'single_elimination', 4);
  for (const name of ['Stale Alpha','Stale Beta','Stale Gamma','Stale Delta']) await register(page,name);
  await page.getByRole('button',{name:'Start tournament',exact:true}).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await result(page,2,0);await result(page,2,0);
  const id=(await page.locator('#selected').textContent()).match(/^#(\d+)/)[1];
  const headers={Authorization:`Bearer ${browserToken}`};
  const before=await(await page.request.get(`/api/tournaments/${id}`,{headers})).json(),semi=before.matches[0];
  const corrected=await page.request.post(`/api/tournaments/${id}/correct-result`,{headers,data:{
    matchId:semi.id,scoreA:0,scoreB:3,expectedScoreA:semi.score_a,expectedScoreB:semi.score_b,expectedRevision:semi.revision,reason:'Second organizer corrected the winner',
  }});expect(corrected.status()).toBe(200);
  await result(page,2,0,'This match changed. Refresh and send its current expectedRevision before reporting a result.');
  const unchanged=await(await page.request.get(`/api/tournaments/${id}`,{headers})).json();
  expect(unchanged.status).toBe('running');expect(unchanged.matches.at(-1).score_a).toBe(null);
  await page.getByRole('button',{name:'Connect / refresh'}).click();
  await expect(page.locator('#status')).toHaveText('Saved / refreshed.');
  await result(page,2,0);await expect(page.locator('#selected')).toContainText('Champion: Stale Delta');
});
