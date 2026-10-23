// DOM fixtures mirror the public minisite order-list bundle; no user orders are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../MealCompare/Resources/History.js'), 'utf8');
let checks = 0;
class Element {
  constructor(classes = '', label = '', children = []) {
    Object.assign(this, { classes: classes.split(/\s+/), label, children, hidden: false,
      isConnected: true, opacity: '1' });
    for (const child of children) child.parentElement = this;
  }
  get innerText() { return [this.label, ...this.children.map(child => child.innerText)].filter(Boolean).join(' '); }
  get textContent() { return this.innerText; }
  getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: 40 }; }
  querySelectorAll(selector) {
    const name = selector.slice(1); const found = [];
    const visit = node => { for (const child of node.children) { child.parentElement = node;
      if (child.classes.includes(name)) found.push(child); visit(child); } };
    visit(this); return found;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.classes.includes(selector.slice(1))) return node;
    return null;
  }
  click() { throw new Error('History must never click any page control'); }
}
const el = (...args) => new Element(...args);
function card({ store = '汉堡王（示例店）', name = '双层厚鸡堡4件套', specs = '果香/可口可乐',
  status = '订单已完成', count = '共1件', multiple = false } = {}) {
  return el('ol-card', '', [el('ol-card-head-name', store), el('ol-card-head-status', status),
    multiple ? el('ol-card-H-multiple-item', '图片') : el('ol-card-H-signal-item', '', [
      el('ol-card-H-signal-item-title', name), ...(specs === null ? [] : [el('ol-card-H-signal-item-sku', specs)])]),
    el('ol-card-template-pricecount-count', count)]);
}
function run(cards = [], { url = 'https://h5.ele.me/minisite/pages/order-list/index', action = 'read', roots = 1 } = {}) {
  const root = el('', '', Array.from({ length: roots }, () => el('ol-page-root', '', cards)));
  const context = {
    document: { querySelectorAll: selector => root.querySelectorAll(selector) },
    location: new URL(url), window: { getComputedStyle: node => ({ display: node.hidden ? 'none' : 'block',
      visibility: 'visible', opacity: node.opacity }) }
  };
  return JSON.parse(vm.runInNewContext(script.replace('__MEAL_HISTORY_REQUEST__', JSON.stringify({ action })), context));
}
function check(name, test) { test(); checks++; process.stdout.write(`PASS ${name}\n`); }

check('reads only the verified completed single-item structure', () => {
  const result = run([card()]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.entries, [{ storeName: '汉堡王(示例店)', items: [
    { name: '双层厚鸡堡4件套', specs: '果香/可口可乐', quantity: 1 }
  ] }]);
  assert.match(result.message, /套餐内容和规格仍需重新核对/);
});
check('supports explicit completed status labels and optional SKU summaries', () => {
  for (const status of ['已完成', '订单已完成', '已送达', '订单已送达']) {
    assert.equal(run([card({ status, specs: null })]).entries[0].items[0].specs, null);
  }
});
check('never imports unpaid, canceled, delivering, refunded, or ambiguous statuses', () => {
  for (const status of ['待支付', '订单已取消', '配送中', '退款成功', '即将完成', '已完成退款', '']) {
    assert.deepEqual(run([card({ status })]).entries, []);
  }
  const order = card(); order.children.push(el('ol-card-head-status', '订单已取消'));
  assert.deepEqual(run([order]).entries, []);
});
check('does not infer item identities or quantities from multi-item summaries', () => {
  for (const options of [{ multiple: true }, { count: '共2件' }, { count: '' }, { count: '共1.0件' }]) {
    assert.deepEqual(run([card(options)]).entries, []);
  }
  const order = card(); order.children.push(el('ol-card-H-signal-item', '', [el('ol-card-H-signal-item-title', '第二商品')]));
  assert.deepEqual(run([order]).entries, []);
});
check('requires unique store, name, SKU, and count fields', () => {
  for (const [cls, content] of [['ol-card-head-name', '另一个店'], ['ol-card-template-pricecount-count', '共1件']]) {
    const order = card(); order.children.push(el(cls, content));
    assert.deepEqual(run([order]).entries, []);
  }
  for (const [cls, content] of [['ol-card-H-signal-item-title', '另一个商品'], ['ol-card-H-signal-item-sku', '另一规格']]) {
    const order = card(); order.querySelectorAll('.ol-card-H-signal-item')[0].children.push(el(cls, content));
    assert.deepEqual(run([order]).entries, []);
  }
});
check('outputs no address, telephone, account, order identifier, payment, price, or whole-card text', () => {
  const order = card();
  order.children.push(el('address', '收货地址 私人路101号'), el('phone', '13812345678'),
    el('account', 'private-account@example.com'), el('orderId', 'ORDER-ID-SECRET'),
    el('ol-card-template-pricecount', '应付¥99.90'), el('payment', '支付流水 PAYMENT-SECRET'));
  const result = run([order]);
  assert.equal(result.entries.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /私人路|13812345678|private-account|ORDER-ID|99\.90|PAYMENT-SECRET/);
  assert.deepEqual(Object.keys(result.entries[0]).sort(), ['items', 'storeName']);
  assert.deepEqual(Object.keys(result.entries[0].items[0]).sort(), ['name', 'quantity', 'specs']);
});
check('never extracts generic page text or recommendations outside an order card', () => {
  const recommendation = el('recommendation', '', [el('ol-card-head-name', '推荐商家'),
    el('ol-card-H-signal-item-title', '推荐餐品'), el('ol-card-head-status', '订单已完成')]);
  assert.deepEqual(run([recommendation]).entries, []);
});
check('rejects private-data-looking content even inside whitelisted text fields', () => {
  for (const options of [{ name: '收货地址 私人路101号' }, { specs: '13812345678' },
    { store: 'private-account@example.com' }, { specs: '订单编号123456789' }]) {
    assert.deepEqual(run([card(options)]).entries, []);
  }
});
check('does not combine values between distinct or nested order cards', () => {
  const incomplete = card(); incomplete.children = incomplete.children.filter(node => !node.classes.includes('ol-card-head-name'));
  const canceled = card({ store: '取消的店', status: '订单已取消' });
  assert.deepEqual(run([incomplete, canceled]).entries, []);
  const outer = card({ store: '外层店' }); outer.children.push(card({ store: '内层店', status: '订单已取消' }));
  assert.equal(run([outer]).entries[0].storeName, '外层店');
});
check('limits extraction to twenty current-page records', () => {
  assert.equal(run(Array.from({ length: 30 }, (_, index) => card({ store: `示例店${index}` }))).entries.length, 20);
});
check('ignores hidden orders without synthesizing replacements', () => {
  const hidden = card(); hidden.hidden = true;
  assert.deepEqual(run([hidden]).entries, []);
});
check('rejects unknown routes, domains, non-HTTPS pages, and unverified page structures', () => {
  for (const url of ['https://h5.ele.me/order/', 'https://h5.ele.me/shop/',
    'https://evil.example/minisite/pages/order-list/index', 'http://h5.ele.me/minisite/pages/order-list/index',
    'https://h5.waimai.meituan.com/waimai/mindex/orders', 'https://h5.ele.me/minisite/pages/order-list/index/other']) {
    assert.equal(run([card()], { url }).status, 'unsupported');
  }
  for (const roots of [0, 2]) assert.equal(run([card()], { roots }).status, 'unsupported');
});
check('invalid actions cause no navigation or extraction', () => {
  const result = run([card()], { action: 'rebuy' });
  assert.equal(result.status, 'invalid'); assert.deepEqual(result.entries, []);
});
process.stdout.write(`${checks} history fixture checks passed. Live platform validation is still required.\n`);
