/* Exact, current-store controls only. Every mutation needs a later observation. */
((request) => {
  "use strict";
  const host = location.hostname;
  const mt = host === "h5.waimai.meituan.com";
  const tb = host === "h5.ele.me";
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const all = (root, selector) => Array.from(root.querySelectorAll(selector));
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const shown = (root, selector) => all(root, selector).filter(visible);
  const disabled = (element) => !visible(element) || element.disabled
    || element.getAttribute("aria-disabled") === "true";
  const one = (root, selector) => {
    const matches = shown(root, selector);
    return matches.length === 1 ? matches[0] : null;
  };
  const read = (root, selector) => text(one(root, selector)?.innerText);
  const integer = (value) => /^\d+$/.test(text(value)) && Number.isSafeInteger(Number(text(value)))
    ? Number(text(value)) : null;
  const count = (root, selector, missingIsZero) => {
    const nodes = shown(root, selector);
    if (!nodes.length) return missingIsZero ? 0 : null;
    if (nodes.length !== 1) return null;
    const label = nodes[0].getAttribute("aria-label") || "";
    const match = /^已选(\d+)份$/.exec(text(label));
    return integer(match ? match[1] : nodes[0].innerText);
  };
  const price = (value) => {
    const match = /^[¥￥]?\s*(\d{1,8})(?:\.(\d{1,2}))?\s*元?$/.exec(text(value));
    return match ? Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0")) : null;
  };
  const empty = { menu: [], cart: [], cartKnown: false, spec: null };
  const encode = (status, message, state = empty) => JSON.stringify({ status, message, ...state });
  if (!mt && !tb) return encode("unsupported", "当前不是已适配的官方外卖网页，未执行操作。");
  if (!request || typeof request.action !== "string") return encode("invalid", "缺少购物操作。");

  let specRoot = null;
  let closeControl = null;
  let confirmControl = null;
  let groupControls = [];
  let childControls = [];
  let spec = null;
  let unknownSpec = false;
  if (mt) {
    const close = shown(document, 'button[aria-label="关闭商品规格选择弹窗"]');
    const roots = [...new Set(close.map((button) => button.closest(".dContainer_YKbguG")).filter(visible))];
    unknownSpec = close.length > 0 && (roots.length !== 1 || close.length !== 1);
    if (roots.length === 1 && close.length === 1) {
      specRoot = roots[0];
      closeControl = close[0];
      groupControls = shown(specRoot, 'dl.spec_AXWaUg, dl[data-tag="attribute"]').map((group) => ({
        name: read(group, "dt"),
        options: shown(group, "dd div.tag_nx79mf").map((option) => ({
          name: text(option.innerText), selected: option.classList.contains("selected_G3xf3i"),
          available: !disabled(option) && !option.classList.contains("soldoff_RCOJ6k"), element: option
        }))
      }));
      confirmControl = one(specRoot, ".addToCartBtn_bQzcZn");
    }
  } else {
    const roots = shown(document, ".specpanel-root_QLZIb");
    unknownSpec = roots.length > 1;
    if (roots.length === 1) {
      specRoot = roots[0];
      closeControl = one(specRoot, 'a.specpanel-close_2ypTM[href="javascript:;"][role="button"][aria-label="关闭"]');
      groupControls = shown(specRoot, ".specpanel-body_2yQ2u > div").map((group) => ({
        name: read(group, "p.specpanel-colTitle_1qeDW"),
        options: shown(group, "div.specpanel-colBody_zwCNl span.panel-item-item_2J1e-_0").map((option) => ({
          name: text(option.innerText), selected: option.classList.contains("panel-item-active_3HD_u_0"),
          available: !disabled(option) && String(option.style.opacity) !== "0.3", element: option
        }))
      }));
      confirmControl = one(specRoot, "button.specpanel-doneBtn_WnF6t");
      childControls = shown(specRoot, ".specpanel-tabContainer_3vPOq .specpanel-tab_1PvR9 li.specpanel-tabItem_2JQbE").map((element, index) => ({
        name: text(element.innerText), index,
        selected: element.classList.contains("specpanel-active_1a2mV"), element
      }));
    }
  }
  if (specRoot) {
    const name = read(specRoot, mt ? ".spuName_iWwbf8" : "p.specpanel-name_GORAG");
    const invalidTabs = childControls.length > 0 && (childControls.some((child) => !child.name)
      || new Set(childControls.map((child) => child.name)).size !== childControls.length
      || childControls.filter((child) => child.selected).length !== 1);
    const duplicateGroups = new Set(groupControls.map((group) => group.name)).size !== groupControls.length;
    const complex = invalidTabs || !name || !groupControls.length || duplicateGroups
      || groupControls.some((group) => !group.name || !group.options.length
        || new Set(group.options.map((option) => option.name)).size !== group.options.length
        || group.options.some((option) => !option.name)
        || group.options.filter((option) => option.selected).length > 1);
    const color = confirmControl ? window.getComputedStyle(confirmControl).backgroundColor : "";
    const greyConfirmation = tb && /^(?:#bbb(?:bbb)?|rgb\(\s*187\s*,\s*187\s*,\s*187\s*\))$/i.test(color);
    spec = {
      name,
      groups: groupControls.map((group) => ({ name: group.name,
        options: group.options.map(({ name, selected, available }) => ({ name, selected, available })) })),
      children: childControls.map(({ name, index, selected }) => ({ name, index, selected })),
      canConfirm: !complex && !disabled(confirmControl) && !greyConfirmation
        && groupControls.every((group) => group.options.filter((option) => option.selected && option.available).length === 1),
      complex: Boolean(complex)
    };
  }

  const cards = shown(document, mt ? 'dd[data-tag="spu"]' : 'dl[role="menu"] > dd[role="menuitem"][aria-label]');
  const products = cards.map((element) => {
    const name = read(element, mt ? ".name_hTGUTi" : ".fooddetails-nameText_250s_");
    const totalQuantity = count(element, mt ? ".sqt-menu-add-buttons .count_Itszr_" : ".cartbutton-entityquantity_-YXiq", true);
    const specButtons = mt ? shown(element, ".sqt-menu-add-buttons.mBtnGroup_ho5pZr") : [];
    const choose = mt ? shown(element, '[aria-label="选择规格"] > .clickArea_qHUDMY') : [];
    const add = shown(element, mt ? '[aria-label="加入购物车"] > .clickArea_qHUDMY'
      : 'a[role="button"][aria-label="添加商品"]');
    const controls = specButtons.length ? specButtons : choose.length ? choose : add;
    const soldOut = mt && (element.classList.contains("grey_Ss80U_")
      || shown(element, ".soldOut_O72tpf, .btnSellOf_Hi8NHt").length > 0);
    return { element, controls, data: {
      name, priceCents: mt ? price(read(element, '[data-tag="price"] .cprice_RfVnJ3')) : null,
      totalQuantity, hasSpecs: Boolean(specButtons.length || choose.length || spec?.name === name),
      specsKnown: mt || spec?.name === name,
      available: !soldOut && controls.length === 1 && !disabled(controls[0])
    } };
  });
  const cartRows = shown(document, mt ? ".cartItem_eJAXVf" : "li.entityList-entityrow_2JEtG_0");
  const cartEntries = cartRows.map((element) => ({ element, data: {
    name: read(element, mt ? ".name_lW7VgX" : "em.entityList-name_3fhQR_0"),
    specs: read(element, mt ? ".attrStr_opNqW6" : "p.entityList-entityspecs_bSo9n_0"),
    quantity: count(element, mt ? ".count_Itszr_" : ".cartbutton-entityquantity_-YXiq", false)
  } }));
  const validCart = cartEntries.every(({ data }) => data.name && data.quantity > 0);
  const cartOpen = mt ? shown(document, ".cartPanel_BfpkSO").length === 1
    : shown(document, ".cartview-cartbody_3QIXw.cartview-cartbodyOpen_m7_NT").length === 1;
  // Taobao's attr-quantity is the official full-cart count, not a count of rendered menu rows.
  const emptyCartControl = mt
    ? shown(document, '#cart [aria-label="购物车,没有商品"]')
    : shown(document, '.bottomNav-carticon_E1nII_0[role="button"][aria-label="购物车"][attr-quantity="0"]');
  const knownEmpty = cartRows.length === 0 && products.length > 0
    && products.every(({ data }) => data.totalQuantity === 0) && emptyCartControl.length === 1;
  const cartKnown = validCart && (cartOpen || knownEmpty);
  const state = {
    menu: products.filter(({ data }) => data.name && data.totalQuantity !== null).map(({ data }) => data),
    cart: cartEntries.filter(({ data }) => data.name && data.quantity > 0).map(({ data }) => data),
    cartKnown, spec
  };
  const result = (status, message) => encode(status, message, state);
  const attempt = (element, message) => {
    if (disabled(element)) return result("unavailable", "该控件当前不可用，未执行操作。");
    element.click();
    return result("attempted", message + "请重新读取页面核对结果。");
  };
  const exactText = (value) => typeof value === "string" && text(value) && text(value).length <= 200;
  if (request.action === "observe") {
    return result(unknownSpec ? "unknown" : spec ? "spec" : cartKnown && cartEntries.length ? "cart"
      : state.menu.length ? "menu" : "unknown", unknownSpec ? "规格面板结构尚未适配。"
      : "已读取当前页面可识别的商品、规格和购物车；菜单数量是商品跨规格汇总数。");
  }
  if (unknownSpec) return result("unsupported", "规格面板结构不明确，已暂停自动操作。");
  if (request.action === "close-spec") {
    if (!spec) return result("nochange", "当前没有已识别的规格面板。");
    return attempt(closeControl, "已尝试关闭规格面板。");
  }
  if (request.action === "choose-option") {
    if (!exactText(request.group) || !exactText(request.option)) return result("invalid", "请提供完整规格组名和选项名。");
    if (!spec || spec.complex) return result("unsupported", "当前规格面板未就绪，或包含尚未适配的套餐结构。");
    const groups = groupControls.filter((group) => group.name === text(request.group));
    const options = groups.length === 1 ? groups[0].options.filter((option) => option.name === text(request.option)) : [];
    if (options.length !== 1) return result("ambiguous", "未找到唯一的精确规格选项。");
    if (!options[0].available) return result("unavailable", "该规格当前不可选。");
    if (options[0].selected) return result("nochange", "该规格已选中。");
    return attempt(options[0].element, "已尝试选择指定规格。");
  }
  if (request.action === "select-child") {
    if (!exactText(request.name) || !Number.isSafeInteger(request.index) || request.index < 0) return result("invalid", "套餐子商品信息无效。");
    if (!spec || spec.complex) return result("needs-input", "套餐结构尚未完整识别，请先在网页核对。");
    const children = childControls.filter((child) => child.index === request.index && child.name === text(request.name));
    if (children.length !== 1) return result("changed", "套餐子商品信息已变化。");
    if (children[0].selected) return result("nochange", "当前已打开该套餐子商品。");
    return attempt(children[0].element, "已尝试切换套餐子商品；需分别核对每个子商品规格。");
  }
  if (request.action === "confirm-spec") {
    if (!exactText(request.name)) return result("invalid", "请提供完整商品名称。");
    if (!spec || spec.name !== text(request.name)) return result("changed", "当前规格商品与目标不一致。");
    if (childControls.length > 1 && (!Array.isArray(request.verifiedChildren)
      || request.verifiedChildren.length !== childControls.length
      || childControls.some((child) => !request.verifiedChildren.some((verified) => verified
        && verified.index === child.index && verified.name === child.name)))) {
      return result("needs-input", "套餐的每个子商品都须先逐项读取、选规格并核对，再确认加购。");
    }
    if (!spec.canConfirm) return result("unavailable", "规格未选齐、已售罄或套餐结构尚未适配，未确认加购。");
    return attempt(confirmControl, "已尝试确认规格加购；尚未证明购物车中的目标规格数量。");
  }
  if (spec) return result("needs-spec", "请先完成或关闭当前规格面板。");
  if (request.action === "add-product") {
    if (!exactText(request.name) || !Number.isSafeInteger(request.currentQuantity) || request.currentQuantity < 0
      || !Number.isSafeInteger(request.desiredQuantity) || request.desiredQuantity <= 0) return result("invalid", "商品名称或数量无效。");
    const matches = products.filter(({ data }) => data.name === text(request.name));
    if (matches.length !== 1 || matches[0].data.totalQuantity === null) return result("ambiguous", "未找到唯一且数量明确的同名商品。");
    const { data, controls } = matches[0];
    if (data.totalQuantity !== request.currentQuantity) return result("changed", "菜单汇总数量已变化，请重新读取。");
    if (data.totalQuantity >= request.desiredQuantity) return result("nochange", "菜单汇总数量已达到该值；仍需在购物车核对完整规格，不能据此认定目标SKU已完成。");
    if (!data.available) return result("unavailable", "该商品已售罄或没有唯一可用的加购控件。");
    return attempt(controls[0], "已尝试单次加购或打开规格面板；菜单汇总数量不代表目标SKU数量。");
  }
  if (request.action === "open-cart" || request.action === "close-cart") {
    const opening = request.action === "open-cart";
    if (opening === cartOpen) return result("nochange", opening ? "购物车已展开。" : "购物车已关闭。");
    if (opening && knownEmpty) return result("nochange", "已确认购物车为空，空购物车入口没有展开操作。");
    const controls = mt ? shown(document, '#cart [role="button"][aria-label="购物车"], #cart [role="button"][aria-label="购物车,没有商品"]')
      : shown(document, '.bottomNav-carticon_E1nII_0[role="button"][aria-label="购物车"][attr-quantity]');
    if (controls.length !== 1) return result("ambiguous", "没有唯一的已确认购物车入口。");
    return attempt(controls[0], opening ? "已尝试打开购物车。" : "已尝试关闭购物车。");
  }
  if (request.action === "checkout") {
    if (!state.menu.length || !cartKnown || !state.cart.length) return result("needs-input", "须先在门店页展开并核对非空购物车，才能进入结算。");
    const controls = shown(document, mt ? "#cart .goToPreview_oTQlfa"
      : 'a.submit-btn-submitbutton_3t114_0[role="button"]');
    if (controls.length !== 1) return result("ambiguous", "未找到唯一的门店去结算入口。");
    const control = controls[0];
    if (text(control.innerText) !== "去结算" || control.closest("#sqt-openh5-preview-submit-btn")
      || control.querySelector("#sqt-openh5-preview-submit-btn")
      || control.closest(mt ? ".grayBtn_awLpTd" : ".submit-btn-disabled_1DLSl_0")) {
      return result("unavailable", "当前入口不是可用的门店去结算按钮，未点击。");
    }
    return attempt(control, "已尝试从门店进入结算页；没有提交订单或支付。");
  }
  if (request.action === "change-cart") {
    if (!exactText(request.name) || !Array.isArray(request.expectedSpecs)
      || !request.expectedSpecs.every(exactText) || ![1, -1].includes(request.delta)) return result("invalid", "购物车商品、规格或增减数量无效。");
    if (!cartKnown) return result("unknown", "购物车尚未可靠读取，未修改商品。");
    const tokens = (value) => text(value).split(/[,，/、;；|]+/).map(text).filter(Boolean).sort();
    const expected = request.expectedSpecs.flatMap(tokens).sort();
    const matches = cartEntries.filter(({ data }) => data.name === text(request.name)
      && JSON.stringify(tokens(data.specs)) === JSON.stringify(expected));
    if (matches.length !== 1) return result("ambiguous", "未找到名称和完整规格均唯一匹配的购物车行。");
    const selector = mt ? (request.delta === 1 ? '[aria-label="加入购物车"] > .clickArea_qHUDMY'
      : '[aria-label="移出购物车"] > .clickArea_qHUDMY')
      : (request.delta === 1 ? 'a[role="button"][aria-label="添加商品"]' : 'a[role="button"][aria-label="删减商品"]');
    const control = one(matches[0].element, selector);
    if (request.delta === -1 && control?.closest(".minusGrey_d0jEPI")) return result("unavailable", "该行当前不可减少。");
    return attempt(control, "已尝试单次修改指定购物车行。");
  }
  return result("unsupported", "此操作尚未适配；没有执行订单、支付或购券动作。");
})(__MEAL_SHOPPING_REQUEST__);
