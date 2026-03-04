import { chromium } from '../node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

// Load app
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000); // Let sim settle

// Screenshot 1: default state
await page.screenshot({ path: '/tmp/jarvis-p2-screenshot-default.png' });

// Test tag filter: type #drops and Enter
await page.keyboard.press('/');
await page.waitForTimeout(500);
await page.keyboard.type('#drops');
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/jarvis-p2-screenshot-tag-filter.png' });

// Escape to clear
await page.keyboard.press('Escape');

// Check HUD text
const body = await page.evaluate(() => document.body.innerText);
const canvas = await page.locator('canvas').count();

console.log(JSON.stringify({
  canvas,
  errors: errors.slice(0, 5),
  screenshots: ['/tmp/jarvis-p2-screenshot-default.png', '/tmp/jarvis-p2-screenshot-tag-filter.png']
}, null, 2));

await browser.close();
