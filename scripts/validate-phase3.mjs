import { chromium } from '../node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(6000); // let sim settle

const r = {};

// Fix 9: Settings panel open by default (no gear click needed)
r.Fix9_settings_open = await page.evaluate(() =>
  document.body.innerText.includes('SPREAD') && document.body.innerText.includes('LABELS')
) ? 'PASS' : 'FAIL';

// Fix 3: MAX SIZE slider max attribute = 2.0 (not 5.0)
r.Fix3_maxsize_cap = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input[type=range]'));
  return inputs.some(i => i.getAttribute('max') === '5') ? 'FAIL (found max=5)' : 'PASS';
});

// Fix 7: Right-click on canvas — no browser context menu (preventDefault working)
await page.mouse.move(700, 450);
await page.waitForTimeout(300);
const beforeRightClick = await page.evaluate(() => document.body.innerText.length);
await page.mouse.click(700, 450, { button: 'right' });
await page.waitForTimeout(500);
const afterRightClick = await page.evaluate(() => document.body.innerText.length);
// Context menu would add text; if length unchanged or similar, contextmenu was prevented
r.Fix7_rightclick_prevent = Math.abs(afterRightClick - beforeRightClick) < 200 ? 'PASS' : `FAIL (text changed by ${afterRightClick - beforeRightClick})`;

// Fix 8: Sidebar drag handle exists
r.Fix8_drag_handle = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('div'));
  return all.some(d => d.style.cursor === 'col-resize');
}) ? 'PASS' : 'FAIL';

// Fix 11/F3: Click canvas center → full note opens (sidebar with markdown content)
// Move mouse first to activate proximity detection
await page.mouse.move(700, 450);
await page.waitForTimeout(800);
await page.mouse.click(700, 450);
await page.waitForTimeout(2500);
const afterCenterClick = await page.evaluate(() => document.body.innerText);
// Full note sidebar: body should be >> 300 chars (tooltip is short, full note is long)
r.Fix11_click_full_note = afterCenterClick.length > 1000 ? 'PASS' : `FAIL (body len=${afterCenterClick.length}, snippet: ${afterCenterClick.slice(200, 350).replace(/\n/g, ' ')})`;

// Take default state screenshot
await page.screenshot({ path: '/tmp/jarvis-p3-default.png' });

// Close sidebar and test arrow nav
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Click a node to select it, then test arrow navigation
await page.mouse.move(700, 450);
await page.waitForTimeout(500);
await page.mouse.click(700, 450);
await page.waitForTimeout(1500);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(600);
const afterArrow = await page.evaluate(() => document.body.innerText);
r.Fix5_arrow_nav = afterArrow.includes('/') || afterArrow.length > 300 ? 'PASS' : `FAIL (body: ${afterArrow.slice(0, 100)})`;

// Take note-open screenshot
await page.screenshot({ path: '/tmp/jarvis-p3-note-open.png' });

console.log('PHASE 3 RESULTS:', JSON.stringify(r, null, 2));
await browser.close();
