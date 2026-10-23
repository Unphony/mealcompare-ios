// Representative page fixtures; these do not prove either live platform is supported.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../MealCompare/Resources/Probe.js'), 'utf8');
let checks = 0;

class Element {
  constructor(options = {}) {
    Object.assign(this, { type: 'text', placeholder: '', innerText: '', disabled: false,
      readOnly: false, hidden: false, attributes: {}, events: [], clicks: 0 }, options);
  }
  getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: 40 }; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  dispatchEvent(event) { this.events.push(event.type); }
  click() { this.clicks++; }
}
class Input extends Element {
  get value() { return this.currentValue ?? ''; }
  set value(value) { this.currentValue = value; }
}

function run({ text = '', inputs = [], buttons = [], action = 'inspect', query = '' } = {}) {
  const timers = [];
  const context = {
    document: {
      body: { innerText: text },
      querySelectorAll: selector => selector === 'input' ? inputs : buttons
    },
    window: {
      getComputedStyle: element => ({ visibility: element.hidden ? 'hidden' : 'visible', display: 'block' }),
      setTimeout: callback => timers.push(callback)
    },
    location: { origin: 'https://fixture.example', href: 'https://fixture.example/?token=secret' },
    HTMLInputElement: Input,
    Event: class { constructor(type) { this.type = type; } }
  };
  const result = JSON.parse(vm.runInNewContext(script.replace('__MEAL_COMPARE_REQUEST__',
    JSON.stringify({ action, query })), context));
  timers.forEach(callback => callback());
  return result;
}

function check(name, test) {
  test();
  checks++;
  process.stdout.write(`PASS ${name}\n`);
}

check('reads labeled checkout candidates using integer cents', () => {
  const result = run({ text: '应付金额：￥28.90\n实付 0元\n合计 ¥12.5\n提交订单' });
  assert.deepEqual(result.prices, [
    { label: '应付金额', cents: 2890 }, { label: '实付', cents: 0 }, { label: '合计', cents: 1250 }
  ]);
  assert.equal(result.checkoutLikely, true);
  assert.equal(result.addressRequired, false);
});
check('does not treat listing prices or item counts as payable totals', () => {
  assert.deepEqual(run({ text: '鸡腿堡 ¥19.90\n配送费 ¥3\n合计 2 件\n总计12份\n合计 30分钟' }).prices, []);
});
check('does not truncate malformed or unsupported amount formats', () => {
  assert.deepEqual(run({ text: '应付 12.345\n合计123456789元\n实付-1元\n总计1,234元\n待支付12.元' }).prices, []);
});
check('deduplicates candidates but preserves conflicting labeled amounts', () => {
  assert.deepEqual(run({ text: '合计 18元\n合计18.00元\n实付15元' }).prices,
    [{ label: '合计', cents: 1800 }, { label: '实付', cents: 1500 }]);
});
check('keeps delivery text as evidence rather than inventing an ETA', () => {
  const result = run({ text: '预计 30～40 分钟送达\n12:35送达\n预计 30～40 分钟送达\n已售100单' });
  assert.deepEqual(result.deliveryHints, ['预计 30～40 分钟送达', '12:35送达']);
});
check('preserves the full Eleme clock interval instead of just its last endpoint', () => {
  const result = run({ text: '确认订单\n请选择收货地址\n立即送出\n预计16:22-16:37送达\n1对1急送 可再提前13分钟 ¥3.1\n合计¥30.4\n已优惠¥42.6\n立即支付' });
  assert.deepEqual(result.prices, [{ label: '合计', cents: 3040 }]);
  assert.deepEqual(result.deliveryHints, ['预计16:22-16:37送达']);
  assert.equal(result.addressRequired, true);
  assert.equal(result.checkoutLikely, true);
});
check('reads the Meituan checkout total without selecting a fee or discount', () => {
  const result = run({ text: '提交订单\n立即送出\n大约16:35送达\n商品 ¥49\n打包费 ¥2\n配送费 ¥0\n美团红包 -¥7\n小计 ¥43\n已优惠12.3\n合计¥43\n提交订单' });
  assert.deepEqual(result.prices, [{ label: '合计', cents: 4300 }]);
  assert.deepEqual(result.deliveryHints, ['大约16:35送达']);
  assert.equal(result.addressRequired, false);
});
check('recognizes clock intervals with alternate separators and midnight boundaries', () => {
  const result = run({ text: '预计 23:50～00:20 送达\n预计9:05至9:35送达\n预计30-40分钟送达' });
  assert.deepEqual(result.deliveryHints, ['预计 23:50～00:20 送达', '预计9:05至9:35送达', '预计30-40分钟送达']);
});
check('does not invent valid times by truncating invalid clock hours or minutes', () => {
  assert.deepEqual(run({ text: '预计25:35送达\n预计16:75送达' }).deliveryHints, []);
});
check('detects explicit missing-address prompts without exporting address text', () => {
  for (const text of ['请选择收货地址', '请先添加配送地址', '请先选择地址']) {
    assert.equal(run({ text }).addressRequired, true);
  }
  const result = run({ text: '收货地址：私人地址\n地址管理\n确认订单' });
  assert.equal(result.addressRequired, false);
  assert.doesNotMatch(JSON.stringify(result), /私人地址/);
});
check('report does not export credentials, raw page, or URL query', () => {
  const input = new Input({ type: 'password', currentValue: 'password-secret' });
  const result = run({ inputs: [input], text: '收货地址：私人地址\n手机号13800000000\n验证码668899\n会员券\n打开美团App' });
  assert.equal(result.hasLoginInput, true);
  assert.equal(result.hasCouponText, true);
  assert.equal(result.hasOpenAppHint, true);
  assert.equal(result.origin, 'https://fixture.example');
  assert.deepEqual(Object.keys(result).sort(), ['version', 'origin', 'searchInputCount', 'hasLoginInput',
    'hasCouponText', 'checkoutLikely', 'addressRequired', 'hasOpenAppHint', 'prices', 'deliveryHints'].sort());
  assert.doesNotMatch(JSON.stringify(result), /secret|13800000000|668899|私人地址/);
});
check('fills a unique product search and clicks only its exact search action', () => {
  const search = new Input({ placeholder: '搜索商家、商品' });
  const address = new Input({ type: 'search', placeholder: '搜索收货地址' });
  const submitSearch = new Element({ innerText: '搜索' });
  const order = new Element({ innerText: '提交订单' });
  const result = run({ action: 'search', query: '  鸡腿堡  ', inputs: [search, address], buttons: [submitSearch, order] });
  assert.equal(result.status, 'submitted');
  assert.equal(search.value, '鸡腿堡');
  assert.deepEqual(search.events, ['input', 'change']);
  assert.equal(address.value, '');
  assert.equal(submitSearch.clicks, 1);
  assert.equal(order.clicks, 0);
});
check('does not modify login or address-only pages', () => {
  const inputs = [new Input({ placeholder: '搜索地址', type: 'search' }),
    new Input({ placeholder: '手机号' }), new Input({ placeholder: '验证码' })];
  assert.equal(run({ action: 'search', query: '饭', inputs }).status, 'unsupported');
  inputs.forEach(input => assert.equal(input.value, ''));
});
check('ambiguous product fields require platform adapter knowledge', () => {
  const inputs = [new Input({ type: 'search' }), new Input({ placeholder: '搜索' })];
  assert.equal(run({ action: 'search', query: '饭', inputs }).status, 'unsupported');
  inputs.forEach(input => assert.equal(input.value, ''));
});
check('hidden and disabled search controls are ignored', () => {
  const input = new Input({ placeholder: '搜索商品' });
  const inputs = [input, new Input({ type: 'search', hidden: true }), new Input({ type: 'search', disabled: true })];
  const buttons = [new Element({ innerText: '搜索', hidden: true }), new Element({ innerText: '搜索', disabled: true })];
  assert.equal(run({ action: 'search', query: '面', inputs, buttons }).status, 'filled');
  assert.equal(input.value, '面');
  buttons.forEach(button => assert.equal(button.clicks, 0));
});
check('duplicate search buttons are not guessed', () => {
  const buttons = [new Element({ innerText: '搜索' }), new Element({ innerText: '搜索' })];
  assert.equal(run({ action: 'search', query: '面', inputs: [new Input({ type: 'search' })], buttons }).status, 'filled');
  buttons.forEach(button => assert.equal(button.clicks, 0));
});
check('empty or oversized searches make no page changes', () => {
  for (const query of ['', '  ', '饭'.repeat(101)]) {
    const input = new Input({ type: 'search' });
    assert.equal(run({ action: 'search', query, inputs: [input] }).status, 'invalid');
    assert.equal(input.value, '');
  }
});
check('query characters remain text and never execute as code', () => {
  const query = '\"); throw new Error("injection"); //';
  const input = new Input({ type: 'search' });
  assert.equal(run({ action: 'search', query, inputs: [input] }).status, 'filled');
  assert.equal(input.value, query);
});
process.stdout.write(`${checks} page-probe fixture checks passed. Live platform validation is still required.\n`);
