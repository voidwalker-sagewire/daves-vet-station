// Run: node tests/vet-ui.test.cjs (requires Playwright + Chromium).
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES] })); }

(async () => {
  const browser = await playwright.chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], requests = [];
    let failNext = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.SpeechRecognition = class {
        constructor() { window.testRecognition = this; }
        start() { this.onstart?.(); }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
      };
    });
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.includes('/vet/status')) return route.fulfill({ json: { vet_knowledge_docs: 155 } });
      if (url.includes('/vet/ask')) {
        requests.push(route.request().postDataJSON());
        if (failNext) {
          failNext = false;
          return route.fulfill({ status: 503, json: { detail: 'Temporary outage' } });
        }
        return route.fulfill({ json: {
          answer: '**Next step**\n\nAsk a focused question [1]. <img src=x onerror="alert(1)">',
          sources: ['https://example.org/reference', 'javascript:alert(1)'],
          similar_past_cases: ['Earlier conversation, not a confirmed outcome.'],
        } });
      }
      if (url.startsWith('file:')) return route.continue();
      return route.abort();
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../vet.html')).href);
    await page.waitForFunction(() => document.querySelector('#statusBar').textContent.includes('online'));

    await page.click('#micBtn');
    await page.evaluate(() => window.testRecognition.onresult({ results: [[{ transcript: 'A calf has a swollen knee' }]] }));
    assert.equal(requests.length, 0, 'a pause in dictation must not send a partial question');
    await page.click('#micBtn');
    await page.click('#micBtn');
    await page.evaluate(() => window.testRecognition.onresult({ results: [[{ transcript: 'for one week' }]] }));
    await page.click('#micBtn');
    assert.match(await page.inputValue('#questionInput'), /swollen knee for one week/);

    await page.fill('#ctxTag', 'example-tag');
    await page.click('#askBtn');
    await page.waitForFunction(() => !document.querySelector('#askBtn').disabled);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].conversation_history.length, 0);
    assert.ok(requests[0].session_id);
    assert.equal(await page.locator('.msg.assistant strong').first().textContent(), 'Next step');
    assert.equal(await page.locator('.msg.assistant img').count(), 0, 'model HTML stays escaped');
    assert.equal(await page.locator('.sources a').count(), 1, 'only http(s) sources become links');
    assert.match(await page.locator('.past-case-label').textContent(), /outcome unverified/);

    await page.fill('#questionInput', 'The middle feels warm.');
    failNext = true;
    await page.setInputFiles('#photoInput', { name: 'photo.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
    await page.waitForFunction(() => document.querySelector('#photoPreviewBar').style.display === 'flex');
    await page.click('#askBtn');
    await page.waitForFunction(() => !document.querySelector('#askBtn').disabled);
    assert.equal(await page.inputValue('#questionInput'), 'The middle feels warm.');
    assert.equal(await page.locator('#photoPreviewBar').isVisible(), true);
    await page.click('#askBtn');
    await page.waitForFunction(() => !document.querySelector('#askBtn').disabled);
    assert.equal(requests[2].image_base64, requests[1].image_base64);
    assert.equal(requests[2].session_id, requests[0].session_id);
    assert.equal(requests[2].conversation_history.length, 2, 'failed requests do not pollute history');
    assert.equal(await page.locator('#photoPreviewBar').isVisible(), false);

    for (let i = 0; i < 9; i++) {
      await page.fill('#questionInput', `Follow-up ${i}`);
      await page.click('#askBtn');
      await page.waitForFunction(() => !document.querySelector('#askBtn').disabled);
    }
    const last = requests.at(-1);
    assert.equal(last.conversation_history[0].content, requests[0].question);
    assert.equal(last.conversation_history.length, 16);
    const layout = await page.evaluate(() => {
      const input = document.querySelector('.input-bar').getBoundingClientRect();
      const chat = document.querySelector('#chatWrap');
      const message = document.querySelector('.msg:last-child').getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, viewport: innerWidth,
        messageBottom: message.bottom, inputTop: input.top, padding: parseFloat(getComputedStyle(chat).paddingBottom), inputHeight: input.height };
    });
    assert.ok(layout.width <= layout.viewport, 'mobile page must not overflow horizontally');
    assert.ok(layout.padding > layout.inputHeight, 'input bar must not hide the last reply');

    await page.click('#newCaseBtn');
    assert.equal(await page.inputValue('#ctxTag'), '');
    await page.fill('#questionInput', 'A different animal.');
    await page.click('#askBtn');
    await page.waitForFunction(() => !document.querySelector('#askBtn').disabled);
    assert.notEqual(requests.at(-1).session_id, requests[0].session_id);
    assert.deepEqual(requests.at(-1).conversation_history, []);
    assert.deepEqual(errors, []);
    if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH });
    console.log('PASS: dictation review, formatting, source links, retry/photo retention, history, new case, mobile layout');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
