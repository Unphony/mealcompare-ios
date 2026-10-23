// Small DOM fixtures use classes from the reviewed official bundles, not live accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../MealCompare/Resources/Coupon.js'), 'utf8');
let checks = 0;

class Element {
  constructor(tag = 'div', classes = '', label = '', children = [], attributes = {}) {
    Object.assign(this, { tagName: tag.toUpperCase(), classes: classes.split(/\s+/).filter(Boolean),
      label, children, attributes, clicks: 0, isConnected: true, hidden: false, disabled: false,
      opacity: '1' });
    this.classList = { contains: name => this.classes.includes(name) };
    for (const child of children) child.parentElement = this;
  }
  get innerText() { return [this.label, ...this.children.map(child => child.innerText)].filter(Boolean).join(' '); }
  get textContent() { return this.innerText; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  getBoundingClientRect() { return { width: this.hidden ? 0 : 100, height: 40 }; }
  click() { this.clicks++; }
  matches(selector) {
    const id = selector.match(/#([\w-]+)/);
    const tag = selector.match(/^[a-zA-Z][\w-]*/);
    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
    return (!id || this.attributes.id === id[1]) && (!tag || this.tagName === tag[0].toUpperCase())
      && classes.every(name => this.classes.includes(name));
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(item => item.trim().split(/\s+/));
    const matchesChain = (node, chain) => {
      if (!node.matches(chain[chain.length - 1])) return false;
      let ancestor = node.parentElement;
      for (let index = chain.length - 2; index >= 0; index--) {
        while (ancestor && !ancestor.matches(chain[index])) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    };
    const descendants = [];
    const visit = node => { for (const child of node.children) { descendants.push(child); visit(child); } };
    visit(this);
    return descendants.filter(node => selectors.some(chain => matchesChain(node, chain)));
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  contains(other) {
    for (let node = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
}
const el = (...args) => new Element(...args);
function run(root, request = {}, url = 'https://tb.ele.me/wow/zele/act/selecthongbao2', referrer = '') {
  const history = { length: referrer ? 2 : 1, calls: 0, back() { this.calls++; } };
  const context = {
    document: { querySelectorAll: selector => root.querySelectorAll(selector), referrer },
    window: { history, getComputedStyle: node => ({ display: node.hidden ? 'none' : 'block',
      visibility: 'visible', opacity: node.opacity }),
      setTimeout() { throw new Error('Coupon adapter must not schedule actions'); } },
    location: new URL(url), URL
  };
  const result = JSON.parse(vm.runInNewContext(script.replace('__MEAL_COUPON_REQUEST__',
    JSON.stringify({ action: 'observe', ...request })), context));
  return { ...result, history };
}
function taobaoCard({ title = '已有会员红包', selected = false, disabled = false, redemption = false } = {}) {
  return el('div', `base-coupon__wrap hongbao-coupon__wrap${selected ? ' base-coupon--is-active' : ''}`, '', [
    el('div', `base-coupon__content${disabled ? ' base-coupon__content--disable' : ''}`, '', [
      el('div', 'hongbao-coupon__left-acount', '¥9'),
      el('div', 'base-coupon__content-title--long', title),
      el('div', 'hongbao-coupon__content-limit', '满30元可用'),
      ...(redemption ? [el('div', 'super-vip-coupon__content-exchange', '未兑换 需1次领取机会')] : [])
    ])
  ]);
}
function taobaoFixture(cards, { confirm = false, back = true } = {}) {
  const button = el('div', 'bottom__btn', '确认使用');
  const returnButton = el('div', 'header-back');
  return { root: el('body', '', '', [el('header', 'header', '', back ? [returnButton] : []),
    el('div', 'coupon-list', '', cards), ...(confirm ? [button] : [])]), button, returnButton };
}
function mtCard({ title = '天天神券', selected = false, disabled = false } = {}) {
  return el('div', 'couponItemWrapper_L97m6F', '', [el('div', 'container_Xh707E', '', [
    el('div', 'name_l6DHTg', title), el('div', 'discount_W9p0el', '7'),
    el('div', 'discountDesc_fgh8L7', '满25元可用'),
    el('div', `select_H5Av1e${selected ? ' selected_vaL2S5' : ' canceled_FU_XgQ'}${disabled ? ' invalid_p3gayL' : ''}`)
  ])]);
}
function mtFixture(cards, heading = '可使用红包') {
  const close = el('section', 'popover_RsDLDY');
  return { root: el('body', '', '', [el('div', 'root_WiHL_I', '', [close,
    el('article', 'promoContainer_vARkjW', '', [el('dl', 'promoList_ltOHuo', '', [
      el('dt', '', '', [el('span', 'promoTitle_fXnDgX', heading)]),
      el('dd', 'promoContent_C96_ID', '', cards)
    ])])])]), close };
}
const mtURL = 'https://h5.waimai.meituan.com/waimai/mindex/preview';
function check(name, test) { test(); checks++; process.stdout.write(`PASS ${name}\n`); }

check('observes existing Taobao coupons using only local DOM keys', () => {
  const { root } = taobaoFixture([taobaoCard()]);
  const result = run(root);
  assert.equal(result.kind, 'coupons');
  assert.equal(result.coupons[0].title, '已有会员红包');
  assert.equal(result.coupons[0].available, true);
  assert.match(result.coupons[0].key, /^taobao-[\da-f]+-\d+$/);
  assert.equal(result.canReturn, true);
  assert.equal(result.canConfirm, false);
  assert.deepEqual(Object.keys(result.coupons[0]).sort(), ['key', 'title', 'selected', 'available', 'requiresRedemption'].sort());
});
check('selects one unique existing coupon without any timer or payment click', () => {
  const card = taobaoCard();
  const { root } = taobaoFixture([card]);
  const payment = el('button', 'payment', '立即支付'); root.children.push(payment);
  const key = run(root).coupons[0].key;
  assert.equal(run(root, { action: 'select', key }).status, 'selected');
  assert.equal(card.clicks, 1);
  assert.equal(payment.clicks, 0);
});
check('does not toggle an already selected coupon off', () => {
  const card = taobaoCard({ selected: true });
  const { root } = taobaoFixture([card]);
  assert.equal(run(root, { action: 'select', key: run(root).coupons[0].key }).status, 'already-selected');
  assert.equal(card.clicks, 0);
});
check('rejects disabled and unredeemed membership coupons', () => {
  for (const options of [{ disabled: true }, { redemption: true }]) {
    const card = taobaoCard(options);
    const { root } = taobaoFixture([card]);
    const result = run(root);
    assert.equal(result.coupons[0].available, false);
    assert.equal(result.coupons[0].requiresRedemption, !!options.redemption);
    assert.notEqual(run(root, { action: 'select', key: result.coupons[0].key }).status, 'selected');
    assert.equal(card.clicks, 0);
  }
});
check('selects redeemed membership coupons with their dedicated title class', () => {
  const card = taobaoCard({ title: '已兑换超级吃货卡红包' });
  card.querySelectorAll('.base-coupon__content-title--long')[0].classes = ['super-vip-coupon__content-title'];
  const { root } = taobaoFixture([card]);
  const observed = run(root);
  assert.equal(observed.coupons[0].title, '已兑换超级吃货卡红包');
  assert.equal(observed.coupons[0].available, true);
  assert.equal(observed.coupons[0].requiresRedemption, false);
  assert.equal(run(root, { action: 'select', key: observed.coupons[0].key }).status, 'selected');
  assert.equal(card.clicks, 1);
});
check('still rejects unredeemed membership coupons with their dedicated title class', () => {
  const card = taobaoCard({ title: '超级会员专享红包', redemption: true, selected: true });
  card.querySelectorAll('.base-coupon__content-title--long')[0].classes = ['super-vip-coupon__content-title'];
  const { root, button } = taobaoFixture([card], { confirm: true });
  const observed = run(root);
  assert.equal(observed.coupons[0].requiresRedemption, true);
  assert.equal(observed.coupons[0].available, false);
  assert.equal(run(root, { action: 'select', key: observed.coupons[0].key }).status, 'redemption-required');
  assert.equal(run(root, { action: 'confirm' }).status, 'unsafe-selection');
  assert.equal(card.clicks, 0); assert.equal(button.clicks, 0);
});
check('deduplicates identical nested membership titles but rejects conflicting labels', () => {
  for (const same of [true, false]) {
    const card = taobaoCard();
    const title = card.querySelectorAll('.base-coupon__content-title--long')[0];
    const original = title.label;
    title.classes = ['super-vip-coupon__content-title'];
    title.label = same ? '' : '另一张券';
    const child = el('span', 'base-coupon__content-title--long', original);
    child.parentElement = title; title.children = [child];
    const { root } = taobaoFixture([card]);
    assert.equal(run(root).coupons[0].available, same);
  }
});
check('requeries cards and rejects stale or duplicate keys', () => {
  const first = taobaoFixture([taobaoCard()]);
  const key = run(first.root).coupons[0].key;
  const changed = taobaoFixture([taobaoCard({ title: '另一张券' })]);
  assert.equal(run(changed.root, { action: 'select', key }).status, 'ambiguous');
  const cards = [taobaoCard(), taobaoCard()];
  const duplicate = taobaoFixture(cards);
  assert.equal(run(duplicate.root, { action: 'select', key }).status, 'ambiguous');
  cards.forEach(card => assert.equal(card.clicks, 0));
});
check('confirms only selected usable coupons through the exact coupon confirmation control', () => {
  const { root, button } = taobaoFixture([taobaoCard({ selected: true })], { confirm: true });
  assert.equal(run(root).canConfirm, true);
  assert.equal(run(root).selectionNeedsConfirm, true);
  assert.equal(run(root, { action: 'confirm' }).status, 'confirmed');
  assert.equal(button.clicks, 1);
});
check('never confirms a selection containing unredeemed or unavailable coupons', () => {
  for (const options of [{ redemption: true }, { disabled: true }]) {
    const { root, button } = taobaoFixture([taobaoCard({ selected: true, ...options })], { confirm: true });
    assert.equal(run(root).canConfirm, false);
    assert.equal(run(root, { action: 'confirm' }).status, 'unsafe-selection');
    assert.equal(button.clicks, 0);
  }
});
check('rejects pending, duplicate, or purchase-looking confirmation controls', () => {
  for (const variant of ['pending', 'duplicate', 'purchase', 'empty']) {
    const { root, button } = taobaoFixture([taobaoCard({ selected: variant !== 'empty' })], { confirm: true });
    if (variant === 'pending') button.classes.push('bottom__btn--padding');
    if (variant === 'duplicate') root.children.push(el('div', 'bottom__btn', '确认使用'));
    if (variant === 'purchase') button.label = '购买会员';
    assert.equal(run(root).canConfirm, false);
    assert.equal(run(root, { action: 'confirm' }).status, 'unavailable');
    assert.equal(button.clicks, 0);
  }
});
check('closes via the known Taobao header or a verified checkout referrer', () => {
  const fixture = taobaoFixture([]);
  assert.equal(run(fixture.root, { action: 'close-list' }).status, 'closed');
  assert.equal(fixture.returnButton.clicks, 1);
  const noHeader = taobaoFixture([], { back: false });
  const returned = run(noHeader.root, { action: 'close-list' }, undefined, 'https://h5.ele.me/checkout/');
  assert.equal(returned.status, 'closed');
  assert.equal(returned.history.calls, 1);
  assert.equal(run(noHeader.root, { action: 'close-list' }, undefined, 'https://other.example/').status, 'unavailable');
});
check('opens only the verified Taobao checkout coupon entry', () => {
  const entry = el('div', 'cart-item hongbao-3aaXb', '闪购红包 -¥9');
  const order = el('button', '', '立即支付');
  const root = el('body', '', '', [entry, order]);
  assert.equal(run(root, { action: 'open-list' }, 'https://h5.ele.me/checkout/').status, 'opened');
  assert.equal(entry.clicks, 1); assert.equal(order.clicks, 0);
  entry.label = '开通会员领取红包';
  assert.equal(run(root, { action: 'open-list' }, 'https://h5.ele.me/checkout/').status, 'unavailable');
  assert.equal(entry.clicks, 1);
});
check('recognizes legacy Meituan coupons and clicks their exact selection control', () => {
  const card = mtCard(); const { root } = mtFixture([card]);
  const result = run(root, {}, mtURL);
  assert.equal(result.coupons[0].title, '天天神券');
  assert.equal(result.coupons[0].available, true);
  assert.equal(result.selectionNeedsConfirm, false);
  assert.equal(run(root, { action: 'select', key: result.coupons[0].key }, mtURL).status, 'selected');
  assert.equal(card.clicks, 0);
  assert.equal(card.querySelectorAll('.select_H5Av1e')[0].clicks, 1);
});
check('Meituan unavailable sections and invalid controls are never selected', () => {
  for (const heading of ['不可使用红包', '已失效红包']) {
    const card = mtCard(); const { root } = mtFixture([card], heading);
    const result = run(root, {}, mtURL);
    assert.equal(result.coupons[0].available, false);
    assert.equal(run(root, { action: 'select', key: result.coupons[0].key }, mtURL).status, 'unavailable');
  }
  const { root } = mtFixture([mtCard({ disabled: true })]);
  assert.equal(run(root, {}, mtURL).coupons[0].available, false);
});
check('Meituan selected coupons are retained and legacy overlays close without confirmation', () => {
  const card = mtCard({ selected: true }); const { root, close } = mtFixture([card]);
  assert.equal(run(root, { action: 'select', key: run(root, {}, mtURL).coupons[0].key }, mtURL).status, 'already-selected');
  assert.equal(card.querySelectorAll('.select_H5Av1e')[0].clicks, 0);
  assert.equal(run(root, { action: 'close-list' }, mtURL).status, 'closed');
  assert.equal(close.clicks, 1);
});
check('opens only the Meituan red packet row within its known checkout container', () => {
  const entry = el('div', 'promotion_wn2SXT', '美团红包 -¥7');
  const merchant = el('div', 'promotion_wn2SXT', '商家代金券 暂无可用');
  const root = el('body', '', '', [el('div', '', '', [entry, merchant], { id: 'sqt-openh5-preview-info' })]);
  assert.equal(run(root, { action: 'open-list' }, mtURL).status, 'opened');
  assert.equal(entry.clicks, 1); assert.equal(merchant.clicks, 0);
});
check('unknown paths, spoofed domains, MachPro, and missing structures are unsupported', () => {
  const { root } = taobaoFixture([taobaoCard()]);
  for (const url of ['https://evil.example/wow/zele/act/selecthongbao2',
    'https://tb.ele.me/wow/zele/act/buycoupon', 'http://tb.ele.me/wow/zele/act/selecthongbao2', 'https://h5.ele.me/shop/',
    'https://h5.waimai.meituan.com/machpro/red_packet',
    'https://h5.waimai.meituan.com/waimai/mindex/preview/other']) {
    assert.equal(run(root, { action: 'confirm' }, url).kind, 'unsupported');
  }
  assert.equal(run(el('body'), {}, 'https://tb.ele.me/wow/zele/act/selecthongbao2').kind, 'unsupported');
});
check('hidden coupons and controls are not actionable', () => {
  const card = taobaoCard(); card.hidden = true;
  const { root, button } = taobaoFixture([card], { confirm: true });
  button.hidden = true;
  assert.equal(run(root).coupons[0].available, false);
  assert.equal(run(root).canConfirm, false);
});
check('request key is data and cannot execute code', () => {
  const { root } = taobaoFixture([taobaoCard()]);
  assert.equal(run(root, { action: 'select', key: '"); throw Error("injection"); //' }).status, 'ambiguous');
});
process.stdout.write(`${checks} coupon fixture checks passed. Live platform validation is still required.\n`);
