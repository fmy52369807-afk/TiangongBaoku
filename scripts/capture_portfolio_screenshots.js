#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.DEMO_URL || 'http://127.0.0.1:3456';
const outputDir = process.env.SCREENSHOT_DIR || path.resolve(__dirname, '..', 'output', 'playwright');

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const edgeCandidates = [
    process.env.BROWSER_EXECUTABLE,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  const executablePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  async function openSearch(category) {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    if (category && category !== 'novel') await page.locator(`[data-category="${category}"]`).click();
    await page.locator('#bookKeyword').fill('fixture');
    await page.locator('#searchButton').click();
    await page.locator('button.book-row').first().waitFor({ state: 'visible', timeout: 10000 });
  }

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  console.log('SNAPSHOT', (await page.locator('body').innerText()).slice(0, 240).replace(/\n/g, ' | '));
  await page.screenshot({ path: `${outputDir}/portfolio-desktop.png`, fullPage: true });

  await openSearch('novel');
  await page.screenshot({ path: `${outputDir}/portfolio-search.png`, fullPage: true });
  await page.locator('button.book-row').first().click();
  await page.getByRole('button', { name: /查看目录/ }).click();
  await page.locator('button.chapter-item').first().click();
  await page.screenshot({ path: `${outputDir}/portfolio-reader.png`, fullPage: true });

  for (const category of ['comic', 'audio', 'video']) {
    await openSearch(category);
    await page.locator('button.book-row').first().click();
    await page.getByRole('button', { name: /查看(目录|列表)/ }).click();
    await page.locator('button.chapter-item').first().click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${outputDir}/portfolio-${category}.png`, fullPage: true });
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
