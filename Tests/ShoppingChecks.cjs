// Reviewed official H5 DOM fixtures; no account, order submission, or payment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../MealCompare/Resources/Shopping.js'), 'utf8');
const mtURL = 'https://h5.waimai.meituan.com/waimai/mindex/menu';
const tbURL = 'https://h5.ele.me/shop/fixture';
let checks = 0;

class Element {
  constructor(tag = 'div', classes = '', label = '', children = [], attributes = {}) {
    Object.assign(this, { tagName: tag.toUpperCase(), classes: classes.split(/\s+/).filter(Boolean),
      label, children, attributes, clicks: 0, isConnected: true, hidden: false, disabled: false,
      style: { opacity: '1' }, backgroundColor: 'rgb(255, 200, 0)' });
    this.classList = { contains: name => this.classes.includes(name) };
    children.forEach(child => { child.parentElement = this; });
  }
  get innerText() { return [this.label, ...this.children.map(child => child.innerText)].filter(Boolean).join(' '); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() {
    for (let node = this; node; node = node.parentElement) if (node.hidden) return { width: 0, height: 0 };
    return { width: 100, height: 40 };
  }
  click() { this.clicks++; }
  matches(selector) {
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    const simple = selector.replace(/\[[^\]]*\]/g, '');
    const id = simple.match(/#([\w-]+)/);
    const tag = simple.match(/^[a-zA-Z][\w-]*/);
    const classes = [...simple.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
    return (!tag || this.tagName === tag[0].toUpperCase())
      && (!id || this.attributes.id === id[1]) && classes.every(name => this.classes.includes(name))
      && attributes.every(([, name, value]) => name in this.attributes
        && (value === undefined || this.attributes[name] === value));
  }
  querySelectorAll(selector) {
    // Commas inside an aria-label are data, and > requires the actual direct parent.
    const chains = selector.split(/,(?=(?:[^"\[]|"[^"]*"|\[[^\]]*\])*$)/)
      .map(value => value.trim().split(/\s+(?![^\[]*\])/));
    const matchesChain = (node, chain, index = chain.length - 1) => {
      if (!node || !node.matches(chain[index])) return false;
      if (index === 0) return true;
      if (chain[index - 1] === '>') return matchesChain(node.parentElement, chain, index - 2);
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (matchesChain(ancestor, chain, index - 1)) return true;
      }
      return false;
    };
    const descendants = [];
    const visit = node => { for (const child of node.children) { descendants.push(child); visit(child); } };
    visit(this);
    return descendants.filter(node => chains.some(chain => matchesChain(node, chain)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
}
const el = (...args) => new Element(...args);
const body = (...children) => el('body', '', '', children);
function run(root, request = {}, url = mtURL) {
  return JSON.parse(vm.runInNewContext(script, {
    __MEAL_SHOPPING_REQUEST__: { action: 'observe', ...request }, location: new URL(url),
    document: root, window: {
      getComputedStyle: node => ({ display: node.hidden ? 'none' : 'block', visibility: 'visible',
        backgroundColor: node.backgroundColor }),
      setTimeout() { throw new Error('Shopping must not schedule later clicks'); }
    }
  }));
}
function check(name, test) { test(); checks++; process.stdout.write(`PASS ${name}\n`); }
function zeroClicks(root) {
  assert.equal(root.clicks, 0);
  const visit = node => { for (const child of node.children) { assert.equal(child.clicks, 0); visit(child); } };
  visit(root);
}
const addRequest = { action: 'add-product', name: '鸡腿饭', currentQuantity: 0, desiredQuantity: 1 };
function mtButton(label = '加入购物车') {
  const child = el('i', 'clickArea_qHUDMY');
  return { wrapper: el('div', '', '', [child], { 'aria-label': label }), child };
}
function menu(mt, { name = '鸡腿饭', quantity = 0, group = false, choose = false } = {}) {
  const button = mt ? mtButton(choose ? '选择规格' : '加入购物车')
    : { wrapper: el('a', '', '+', [], { role: 'button', 'aria-label': '添加商品' }) };
  const control = mt && group ? el('div', 'sqt-menu-add-buttons mBtnGroup_ho5pZr', '选规格')
    : button.wrapper;
  const counter = el('span', mt ? 'count_Itszr_' : 'cartbutton-entityquantity_-YXiq', String(quantity));
  const children = [el('div', mt ? 'name_hTGUTi' : 'fooddetails-nameText_250s_', name),
    mt && group ? control : el('div', mt ? 'sqt-menu-add-buttons' : '', '', [counter, control])];
  if (mt) children.push(el('div', '', '', [el('span', 'cprice_RfVnJ3', '¥12.50')], { 'data-tag': 'price' }));
  const card = el('dd', '', '', children, mt ? { 'data-tag': 'spu' } : { role: 'menuitem', 'aria-label': name });
  return { root: mt ? card : el('dl', '', '', [card], { role: 'menu' }), card,
    control: mt && !group ? button.child : control, wrapper: button.wrapper };
}
function cart(mt, { open = true, empty = false, quantity = '1', row = null, checkout = null } = {}) {
  const entry = el('div', mt ? '' : 'bottomNav-carticon_E1nII_0', '', [],
    mt ? { role: 'button', 'aria-label': empty ? '购物车,没有商品' : '购物车' }
      : { role: 'button', 'aria-label': '购物车', 'attr-quantity': quantity });
  const panel = el('div', mt ? 'cartPanel_BfpkSO' : 'cartview-cartbody_3QIXw cartview-cartbodyOpen_m7_NT', '', row ? [row] : []);
  panel.hidden = !open;
  return { entry, panel, root: mt ? el('div', '', '', [entry, panel, ...(checkout ? [checkout] : [])], { id: 'cart' })
    : el('div', '', '', [entry, panel, ...(checkout ? [checkout] : [])]) };
}
function cartRow(mt, specs = '大份，微辣') {
  const add = mt ? mtButton() : { wrapper: el('a', '', '+', [], { role: 'button', 'aria-label': '添加商品' }) };
  const minus = mt ? mtButton('移出购物车') : { wrapper: el('a', '', '-', [], { role: 'button', 'aria-label': '删减商品' }) };
  return { add: mt ? add.child : add.wrapper, minus: mt ? minus.child : minus.wrapper,
    minusWrapper: minus.wrapper,
    root: el(mt ? 'div' : 'li', mt ? 'cartItem_eJAXVf' : 'entityList-entityrow_2JEtG_0', '', [
      el(mt ? 'div' : 'em', mt ? 'name_lW7VgX' : 'entityList-name_3fhQR_0', '鸡腿饭'),
      el(mt ? 'div' : 'p', mt ? 'attrStr_opNqW6' : 'entityList-entityspecs_bSo9n_0', specs),
      el('span', mt ? 'count_Itszr_' : 'cartbutton-entityquantity_-YXiq', '1'), add.wrapper, minus.wrapper
    ]) };
}
function specPanel(mt, { multi = false, disabled = false, children = false } = {}) {
  const selected = mt ? 'selected_G3xf3i' : 'panel-item-active_3HD_u_0';
  const itemClass = mt ? 'tag_nx79mf' : 'panel-item-item_2J1e-_0';
  const large = el(mt ? 'div' : 'span', `${itemClass} ${selected}`, '大份');
  const small = el(mt ? 'div' : 'span', `${itemClass}${multi ? ` ${selected}` : ''}`, '小份');
  if (disabled) {
    if (mt) small.classes.push('soldoff_RCOJ6k');
    else small.style.opacity = '0.3';
  }
  const group = mt ? el('dl', 'spec_AXWaUg', '', [el('dt', '', '份量'), el('dd', '', '', [large, small])])
    : el('div', '', '', [el('p', 'specpanel-colTitle_1qeDW', '份量'),
      el('div', 'specpanel-colBody_zwCNl', '', [large, small])]);
  const close = el(mt ? 'button' : 'a', mt ? '' : 'specpanel-close_2ypTM', '', [],
    mt ? { 'aria-label': '关闭商品规格选择弹窗' }
      : { href: 'javascript:;', role: 'button', 'aria-label': '关闭' });
  const confirm = el('button', mt ? 'addToCartBtn_bQzcZn' : 'specpanel-doneBtn_WnF6t', '加入购物车');
  const tabs = children ? [el('li', 'specpanel-tabItem_2JQbE specpanel-active_1a2mV', '主食'),
    el('li', 'specpanel-tabItem_2JQbE', '饮品')] : [];
  const root = el('div', mt ? 'dContainer_YKbguG' : 'specpanel-root_QLZIb', '', [
    el(mt ? 'div' : 'p', mt ? 'spuName_iWwbf8' : 'specpanel-name_GORAG', '鸡腿饭'), close,
    mt ? group : el('div', 'specpanel-body_2yQ2u', '', [group]), confirm,
    ...(children ? [el('div', 'specpanel-tabContainer_3vPOq', '', [el('ul', 'specpanel-tab_1PvR9', '', tabs)])] : [])
  ]);
  return { root, large, small, close, confirm, tabs };
}

check('unadapted domains and unknown DOM never receive clicks', () => {
  for (const url of ['https://h5.waimai.meituan.com.evil.example/', 'https://ele.me/', 'https://example.test/']) {
    const fixture = menu(true); const root = body(fixture.root);
    assert.equal(run(root, addRequest, url).status, 'unsupported'); zeroClicks(root);
  }
  const root = body(el('button', '', '加入购物车'), el('button', '', '提交订单'));
  assert.equal(run(root).status, 'unknown');
  assert.equal(run(root, addRequest).status, 'ambiguous'); zeroClicks(root);
});
check('Meituan clicks the direct inner add/spec button or its reviewed mBtnGroup', () => {
  for (const options of [{}, { choose: true }, { group: true }]) {
    const fixture = menu(true, options); const root = body(fixture.root);
    assert.equal(run(root).menu[0].priceCents, 1250);
    assert.equal(run(root, addRequest).status, 'attempted');
    assert.equal(fixture.control.clicks, 1); assert.equal(fixture.card.clicks, 0);
    if (!options.group) assert.equal(fixture.wrapper.clicks, 0);
  }
});
check('sold-out, disabled, hidden, and duplicate product controls are not guessed', () => {
  for (const variant of ['grey', 'soldOut', 'sellOff', 'disabled', 'hidden', 'duplicate']) {
    const fixture = menu(true); const extra = [];
    if (variant === 'grey') fixture.card.classes.push('grey_Ss80U_');
    if (variant === 'soldOut') fixture.card.children.push(el('div', 'soldOut_O72tpf'));
    if (variant === 'sellOff') fixture.card.children.push(el('div', 'btnSellOf_Hi8NHt'));
    if (variant === 'disabled') fixture.control.attributes['aria-disabled'] = 'true';
    if (variant === 'hidden') fixture.control.hidden = true;
    if (variant === 'duplicate') extra.push(menu(true).root);
    const root = body(fixture.root, ...extra);
    assert.equal(run(root, addRequest).status, variant === 'duplicate' ? 'ambiguous' : 'unavailable');
    zeroClicks(root);
  }
});
check('menu quantities are guarded observations, not claims of completed SKU changes', () => {
  const fixture = menu(true, { quantity: 2 }); const root = body(fixture.root);
  assert.equal(run(root, addRequest).status, 'changed');
  assert.equal(run(root, { ...addRequest, currentQuantity: 2, desiredQuantity: 2 }).status, 'nochange');
  zeroClicks(root);
  const result = run(root, { ...addRequest, currentQuantity: 2, desiredQuantity: 4 });
  assert.equal(result.status, 'attempted'); assert.equal(result.menu[0].totalQuantity, 2);
  assert.equal(fixture.control.clicks, 1);
});
check('Meituan spec options require unique available choices and unambiguous selection', () => {
  const fixture = specPanel(true, { disabled: true }); const root = body(fixture.root);
  assert.equal(run(root, { action: 'choose-option', group: '份量', option: '小份' }).status, 'unavailable');
  assert.equal(run(root, { action: 'choose-option', group: '份量', option: '大份' }).status, 'nochange');
  assert.equal(run(root, { action: 'choose-option', group: '份量', option: '中份' }).status, 'ambiguous');
  zeroClicks(root);
  const multi = specPanel(true, { multi: true }); const multiRoot = body(multi.root);
  assert.equal(run(multiRoot).spec.complex, true);
  assert.equal(run(multiRoot, { action: 'confirm-spec', name: '鸡腿饭' }).status, 'unavailable');
  assert.equal(run(multiRoot, { action: 'choose-option', group: '份量', option: '小份' }).status, 'unsupported');
  zeroClicks(multiRoot);
});
check('recognized spec selection, confirmation, and close target only exact controls', () => {
  for (const mt of [true, false]) {
    const fixture = specPanel(mt); const root = body(fixture.root); const url = mt ? mtURL : tbURL;
    assert.equal(run(root, { action: 'choose-option', group: '份量', option: '小份' }, url).status, 'attempted');
    assert.equal(fixture.small.clicks, 1);
    assert.equal(run(root, addRequest, url).status, 'needs-spec');
    assert.equal(run(root, { action: 'confirm-spec', name: '其他商品' }, url).status, 'changed');
    assert.equal(run(root, { action: 'confirm-spec', name: '鸡腿饭' }, url).status, 'attempted');
    assert.equal(fixture.confirm.clicks, 1);
    assert.equal(run(root, { action: 'close-spec' }, url).status, 'attempted');
    assert.equal(fixture.close.clicks, 1);
  }
});
check('Taobao faded options and grey/disabled confirmations never receive clicks', () => {
  const fixture = specPanel(false, { disabled: true }); const root = body(fixture.root);
  assert.equal(run(root, { action: 'choose-option', group: '份量', option: '小份' }, tbURL).status, 'unavailable');
  for (const color of ['#bbb', '#bbbbbb', 'rgb(187, 187, 187)']) {
    fixture.confirm.backgroundColor = color;
    assert.equal(run(root, { action: 'confirm-spec', name: '鸡腿饭' }, tbURL).status, 'unavailable');
  }
  fixture.confirm.backgroundColor = 'rgb(0, 100, 255)'; fixture.confirm.disabled = true;
  assert.equal(run(root, { action: 'confirm-spec', name: '鸡腿饭' }, tbURL).status, 'unavailable');
  zeroClicks(root);
});
check('Taobao combo confirmation requires verified index and name for every child', () => {
  const fixture = specPanel(false, { children: true }); const root = body(fixture.root);
  const request = { action: 'confirm-spec', name: '鸡腿饭' };
  const verifiedChildren = [{ index: 0, name: '主食' }, { index: 1, name: '饮品' }];
  for (const verified of [undefined, verifiedChildren.slice(0, 1),
    [verifiedChildren[0], verifiedChildren[0]], [{ index: 0, name: '主食' }, { index: 1, name: '汤' }]]) {
    assert.equal(run(root, { ...request, verifiedChildren: verified }, tbURL).status, 'needs-input');
  }
  zeroClicks(root);
  assert.equal(run(root, { action: 'select-child', index: 1, name: '饮品' }, tbURL).status, 'attempted');
  assert.equal(fixture.tabs[1].clicks, 1);
  assert.equal(run(root, { ...request, verifiedChildren }, tbURL).status, 'attempted');
  assert.equal(fixture.confirm.clicks, 1);
});
check('cart open and close use a single verified entry on either platform', () => {
  for (const mt of [true, false]) {
    const url = mt ? mtURL : tbURL;
    for (const open of [true, false]) {
      const fixture = cart(mt, { open }); const root = body(fixture.root);
      assert.equal(run(root, { action: open ? 'open-cart' : 'close-cart' }, url).status, 'nochange');
      assert.equal(run(root, { action: open ? 'close-cart' : 'open-cart' }, url).status, 'attempted');
      assert.equal(fixture.entry.clicks, 1);
    }
    const first = cart(mt, { open: false }); const second = cart(mt, { open: false });
    const duplicate = body(first.root, second.root);
    assert.equal(run(duplicate, { action: 'open-cart' }, url).status, 'ambiguous'); zeroClicks(duplicate);
    const generic = body(el('button', '', '购物车'));
    assert.equal(run(generic, { action: 'open-cart' }, url).status, 'ambiguous'); zeroClicks(generic);
  }
});
check('Meituan empty cart requires its explicit aria label plus loaded zero-quantity menu', () => {
  const fixture = cart(true, { open: false, empty: true });
  const root = body(menu(true).root, fixture.root);
  assert.equal(run(root).cartKnown, true); assert.deepEqual(run(root).cart, []);
  assert.equal(run(root, { action: 'open-cart' }).status, 'nochange'); zeroClicks(root);
  assert.equal(run(body(fixture.root)).cartKnown, false);
  const nonempty = body(menu(true, { quantity: 1 }).root, fixture.root);
  assert.equal(run(nonempty).cartKnown, false);
  const noEvidence = body(menu(true).root);
  assert.equal(run(noEvidence).cartKnown, false);
});
check('Taobao empty cart uses the global attr-quantity zero and never missing rows alone', () => {
  const fixture = cart(false, { open: false, quantity: '0' });
  const root = body(menu(false).root, fixture.root);
  assert.equal(run(root, {}, tbURL).cartKnown, true);
  assert.equal(run(root, { action: 'open-cart' }, tbURL).status, 'nochange'); zeroClicks(root);
  assert.equal(run(body(fixture.root), {}, tbURL).cartKnown, false);
  assert.equal(run(body(menu(false).root), {}, tbURL).cartKnown, false);
  fixture.entry.attributes['attr-quantity'] = '2';
  assert.equal(run(root, {}, tbURL).cartKnown, false);
  fixture.entry.attributes['attr-quantity'] = '0';
  assert.equal(run(body(menu(false, { quantity: 1 }).root, fixture.root), {}, tbURL).cartKnown, false);
  const row = cartRow(false);
  assert.equal(run(body(menu(false).root, fixture.root, row.root), {}, tbURL).cartKnown, false);
});
check('cart mutations match complete normalized specs and click only the exact row +/-', () => {
  for (const mt of [true, false]) {
    const target = cartRow(mt); const other = cartRow(mt, '小份，微辣');
    const fixture = cart(mt, { row: el('div', '', '', [target.root, other.root]) });
    const root = body(menu(mt).root, fixture.root); const url = mt ? mtURL : tbURL;
    const request = { action: 'change-cart', name: '鸡腿饭', expectedSpecs: ['微辣', '大份'] };
    assert.equal(run(root, { ...request, delta: 1 }, url).status, 'attempted');
    assert.equal(run(root, { ...request, delta: -1 }, url).status, 'attempted');
    assert.equal(target.add.clicks, 1); assert.equal(target.minus.clicks, 1);
    zeroClicks(other.root); assert.equal(target.root.clicks, 0);
  }
});
check('cart mutations stop on partial specs, duplicate rows, unknown carts and grey decrement', () => {
  for (const mt of [true, false]) {
    const url = mt ? mtURL : tbURL;
    const request = { action: 'change-cart', name: '鸡腿饭', expectedSpecs: ['大份', '微辣'], delta: -1 };
    const row = cartRow(mt); const fixture = cart(mt, { row: row.root });
    const root = body(menu(mt).root, fixture.root);
    assert.equal(run(root, { ...request, expectedSpecs: ['大份'] }, url).status, 'ambiguous');
    fixture.panel.children.push(cartRow(mt).root);
    assert.equal(run(root, request, url).status, 'ambiguous'); zeroClicks(root);
    fixture.panel.children.pop(); fixture.panel.hidden = true;
    assert.equal(run(root, request, url).status, 'unknown'); zeroClicks(root);
  }
  const row = cartRow(true); row.minusWrapper.classes.push('minusGrey_d0jEPI');
  const root = body(cart(true, { row: row.root }).root);
  assert.equal(run(root, { action: 'change-cart', name: '鸡腿饭', expectedSpecs: ['大份', '微辣'], delta: -1 }).status, 'unavailable');
  zeroClicks(root);
});
check('checkout needs a known nonempty cart and rejects disabled or dangerous submit controls', () => {
  for (const mt of [true, false]) {
    const url = mt ? mtURL : tbURL;
    for (const variant of ['valid', 'disabled', 'aria', 'grey', 'submit', 'pay', 'danger-id', 'danger-child', 'missing-menu', 'missing-row']) {
      const checkout = el(mt ? 'div' : 'a', mt ? 'goToPreview_oTQlfa' : 'submit-btn-submitbutton_3t114_0',
        variant === 'submit' ? '提交订单' : variant === 'pay' ? '立即支付' : '去结算', [], mt ? {} : { role: 'button' });
      if (variant === 'disabled') checkout.disabled = true;
      if (variant === 'aria') checkout.attributes['aria-disabled'] = 'true';
      if (variant === 'grey') checkout.classes.push(mt ? 'grayBtn_awLpTd' : 'submit-btn-disabled_1DLSl_0');
      if (variant === 'danger-id') checkout.attributes.id = 'sqt-openh5-preview-submit-btn';
      if (variant === 'danger-child') checkout.children.push(el('button', '', '提交订单', [], { id: 'sqt-openh5-preview-submit-btn' }));
      const fixture = cart(mt, { checkout, row: variant === 'missing-row' ? null : cartRow(mt).root });
      const order = el('button', '', '提交订单'); const pay = el('button', '', '立即支付');
      const root = body(...(variant === 'missing-menu' ? [] : [menu(mt).root]), fixture.root, order, pay);
      const status = run(root, { action: 'checkout' }, url).status;
      assert.equal(status, variant === 'valid' ? 'attempted' : variant.startsWith('missing-') ? 'needs-input' : 'unavailable');
      assert.equal(checkout.clicks, variant === 'valid' ? 1 : 0);
      assert.equal(order.clicks, 0); assert.equal(pay.clicks, 0);
      if (variant !== 'valid') zeroClicks(root);
    }
  }
});
check('unsupported order/payment actions and invalid quantities cannot trigger shopping clicks', () => {
  const fixture = menu(true); const root = body(fixture.root, el('button', '', '提交订单'), el('button', '', '立即支付'));
  for (const action of ['submit-order', 'pay', 'purchase-coupon']) assert.equal(run(root, { action }).status, 'unsupported');
  for (const invalid of [{ currentQuantity: -1 }, { desiredQuantity: 0 }, { desiredQuantity: 1.5 }, { name: '' }]) {
    assert.equal(run(root, { ...addRequest, ...invalid }).status, 'invalid');
  }
  assert.equal(run(root, { ...addRequest, name: '"); throw Error("injection"); //' }).status, 'ambiguous');
  zeroClicks(root);
});
process.stdout.write(`${checks} shopping fixture checks passed. Live platform validation is still required.\n`);
