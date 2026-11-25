// Network-free runtime checks. Browser rendering is covered separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '../vet.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.style = {}; this.children = [];
    this.value = ''; this.innerHTML = ''; this.textContent = ''; this.offsetHeight = 180;
    this.classList = { add() {}, remove() {} };
    this.outerHTML = '<div id="emptyState"></div>';
  }
  appendChild(child) { this.children.push(child); child.parent = this; }
  addEventListener() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  querySelector() { return this.label ||= new Element('span'); }
}

const elements = new Map();
const getElement = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
const requests = [];
let failNext = false;
const context = {
  console, setTimeout, crypto: { randomUUID },
  localStorage: { getItem() { return null; }, setItem() {} },
  document: { getElementById: getElement, createElement: tag => new Element(tag), querySelector: getElement },
  SpeechRecognition: class {
    constructor() { context.testRecognition = this; }
    start() { this.onstart(); }
    abort() { this.onend(); }
    stop() { this.onend(); }
  },
  FileReader: class { readAsDataURL(file) { this.onload({ target: { result: file.data } }); } },
  fetch: async (url, options) => {
    if (url.endsWith('/vet/status')) return { json: async () => ({ vet_knowledge_docs: 155 }) };
    requests.push(JSON.parse(options.body));
    if (failNext) { failNext = false; return { ok: false, json: async () => ({ detail: 'Unavailable' }) }; }
    return { ok: true, json: async () => ({ answer: '**Next step**\n\nInformation [1]. <img src=x>',
      sources: ['https://example.org/reference', 'javascript:alert(1)'], similar_past_cases: ['Unverified earlier conversation'] }) };
  },
};
context.window = context;
vm.createContext(context);
vm.runInContext(script, context);
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };

(async () => {
  for (const match of html.matchAll(/onclick="([^"]*)"/g)) {
    new vm.Script(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  }
  await flush();
  context.toggleVoiceInput();
  context.testRecognition.onresult({ results: [[{ transcript: 'A calf has a swollen knee' }]] });
  assert.equal(requests.length, 0);
  context.toggleVoiceInput();
  context.toggleVoiceInput();
  context.testRecognition.onresult({ results: [[{ transcript: 'for one week' }]] });
  context.toggleVoiceInput();
  assert.equal(getElement('questionInput').value, 'A calf has a swollen knee for one week');
  context.askQuestion(); await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].conversation_history.length, 0);
  const assistant = getElement('chatWrap').children.find(e => e.className === 'msg assistant');
  assert.match(assistant.children[0].innerHTML, /<strong>Next step<\/strong>/);
  assert.match(assistant.children[0].innerHTML, /&lt;img/);
  assert.equal(assistant.children[1].children[0].tagName, 'A');
  assert.equal(assistant.children[1].children[1].tagName, 'SPAN');
  assert.match(assistant.children[2].innerHTML, /outcome unverified/);

  getElement('questionInput').value = 'Warm in the middle.';
  context.handlePhoto({ files: [{ type: 'image/png', data: 'data:image/png;base64,abc' }] });
  failNext = true;
  context.askQuestion(); await flush();
  assert.equal(getElement('questionInput').value, 'Warm in the middle.');
  assert.equal(getElement('photoPreviewBar').style.display, 'flex');
  context.askQuestion(); await flush();
  assert.equal(requests[2].image_base64, 'abc');
  assert.equal(requests[2].conversation_history.length, 2);
  assert.equal(requests[2].session_id, requests[0].session_id);
  assert.equal(getElement('photoPreviewBar').style.display, 'none');

  for (let i = 0; i < 10; i++) {
    getElement('questionInput').value = `Follow-up ${i}`;
    context.askQuestion(); await flush();
  }
  assert.equal(requests.at(-1).conversation_history.length, 16);
  assert.equal(requests.at(-1).conversation_history[0].content, requests[0].question);
  getElement('ctxTag').value = 'old-tag';
  context.newCase();
  assert.equal(getElement('ctxTag').value, '');
  getElement('questionInput').value = 'Another animal';
  context.askQuestion(); await flush();
  assert.equal(requests.at(-1).conversation_history.length, 0);
  assert.notEqual(requests.at(-1).session_id, requests[0].session_id);
  console.log('PASS: inline handlers, dictation, formatting, source links, failed-request retry, photo retention, history, new case');
})().catch(error => { console.error(error); process.exitCode = 1; });
