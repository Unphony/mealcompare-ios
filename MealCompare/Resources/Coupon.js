/* DOM-only adapters for reviewed official coupon pages. Never submits or purchases. */
((request) => {
  "use strict";
  const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const text = (node) => normalize(node && (node.innerText || node.textContent));
  const all = (root, selector) => Array.from(root.querySelectorAll(selector));
  const visible = (node) => {
    if (!node || node.isConnected === false) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let element = node; element; element = element.parentElement) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const shown = (root, selector) => all(root, selector).filter(visible);
  const has = (node, name) => node.classList.contains(name);
  const enabled = (node) => visible(node) && !node.disabled && !node.hasAttribute("disabled")
    && node.getAttribute("aria-disabled") !== "true";
  const dangerous = (value) => /购买|开通|续费|兑换|领取|支付|提交订单|立即下单/.test(value);
  const keyFor = (namespace, value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return namespace + "-" + (hash >>> 0).toString(16) + "-" + value.length;
  };
  let kind = "unsupported";
  let records = [];
  let confirmControls = [];
  let returnControls = [];
  let entryControls = [];
  let selectionNeedsConfirm = false;
  let historyReturn = false;
  let adapter = "";
  const result = (status, message) => JSON.stringify({
    status, message, kind,
    coupons: records.map(({ node, control, ...coupon }) => coupon),
    canConfirm: kind === "coupons" && selectionNeedsConfirm && confirmControls.length === 1
      && enabled(confirmControls[0]) && text(confirmControls[0]) === "确认使用"
      && !has(confirmControls[0], "bottom__btn--padding")
      && records.some((coupon) => coupon.selected)
      && !records.some((coupon) => coupon.selected && (!coupon.available || coupon.requiresRedemption)),
    selectionNeedsConfirm,
    canReturn: kind === "coupons" && (returnControls.length === 1 || historyReturn)
  });
  const action = request && request.action;
  if (!["observe", "open-list", "select", "confirm", "close-list"].includes(action)) {
    return result("invalid", "无法识别优惠操作。");
  }
  if (location.protocol !== "https:") return result("unsupported", "当前页面不是已核实的官方 HTTPS 页面。");

  const taobaoCheckout = location.hostname === "h5.ele.me" && /^\/checkout\/?$/.test(location.pathname);
  const taobaoCoupons = location.hostname === "tb.ele.me"
    && /^\/wow\/zele\/act\/selecthongbao2\/?$/.test(location.pathname);
  const meituanCheckout = location.hostname === "h5.waimai.meituan.com"
    && /^\/waimai\/mindex\/preview\/?$/.test(location.pathname);

  if (taobaoCoupons) {
    adapter = "taobao";
    if (shown(document, ".coupon-list").length !== 1) return result("unsupported", "当前红包列表结构尚未适配。");
    kind = "coupons";
    records = all(document, ".coupon-list .base-coupon__wrap").map((node) => {
      const fullText = text(node);
      const titleCandidates = all(node, ".base-coupon__content-title--long, .base-coupon__content-title--small, .super-vip-coupon__content-title");
      // The membership component has its own title class. Keep one leaf when a
      // wrapper and its child label expose the same title, but reject differing labels.
      const titleNodes = titleCandidates.filter((candidate) => !titleCandidates.some((other) =>
        other !== candidate && candidate.contains(other) && text(candidate) === text(other)));
      const title = titleNodes.length === 1 ? text(titleNodes[0]) : "";
      const requiresRedemption = all(node, ".super-vip-coupon__content-exchange, .super-vip-coupon__right-btn, .super-vip-coupon__confirm-wrap").length > 0;
      return { node, control: node, key: keyFor("taobao", fullText), title,
        selected: has(node, "base-coupon--is-active"), requiresRedemption,
        available: enabled(node) && !!title && !!fullText && !requiresRedemption
          && all(node, ".base-coupon__content--disable").length === 0 };
    });
    confirmControls = shown(document, ".bottom__btn");
    selectionNeedsConfirm = confirmControls.length > 0;
    returnControls = shown(document, "header.header .header-back").filter(enabled);
    try {
      const referrer = new URL(document.referrer);
      historyReturn = referrer.hostname === "h5.ele.me" && /^\/checkout\/?$/.test(referrer.pathname)
        && window.history.length > 1;
    } catch (_) { /* No verified return target. */ }
  } else if (taobaoCheckout) {
    adapter = "taobao";
    entryControls = shown(document, "div.cart-item.hongbao-3aaXb");
    if (entryControls.length === 0) return result("unsupported", "当前结算优惠入口尚未适配。");
    kind = "checkout";
  } else if (meituanCheckout) {
    adapter = "meituan";
    const roots = shown(document, ".root_WiHL_I");
    if (roots.length > 1) return result("ambiguous", "页面出现多个红包弹层，已停止操作。");
    if (roots.length === 1) {
      const root = roots[0];
      if (shown(root, "article.promoContainer_vARkjW").length !== 1) {
        return result("unsupported", "当前美团红包弹层结构尚未适配。");
      }
      kind = "coupons";
      records = all(root, ".couponItemWrapper_L97m6F").map((node) => {
        const list = node.closest("dl.promoList_ltOHuo");
        const headings = list ? all(list, "dt .promoTitle_fXnDgX") : [];
        const titles = all(node, ".name_l6DHTg");
        const controls = all(node, ".select_H5Av1e");
        const fullText = text(node);
        const title = titles.length === 1 ? text(titles[0]) : "";
        const control = controls.length === 1 ? controls[0] : null;
        const requiresRedemption = /未兑换|需兑换|购买|开通|续费/.test(fullText);
        return { node, control, key: keyFor("meituan", fullText), title,
          selected: !!control && has(control, "selected_vaL2S5"), requiresRedemption,
          available: enabled(node) && !!control && enabled(control) && !!title && !!fullText
            && headings.length === 1 && text(headings[0]) === "可使用红包"
            && !has(control, "invalid_p3gayL")
            && all(node, ".invalidContainer_rwYHqz").length === 0 && !requiresRedemption };
      });
      returnControls = shown(root, "section.popover_RsDLDY").filter(enabled);
    } else {
      const previews = shown(document, "#sqt-openh5-preview-info");
      if (previews.length !== 1) return result("unsupported", "当前美团结算结构尚未适配。");
      kind = "checkout";
      entryControls = shown(previews[0], ".promotion_wn2SXT").filter((node) => text(node).startsWith("美团红包"));
    }
  } else {
    return result("unsupported", "仅支持已核实的官方结算页和红包页；当前页面尚未适配。");
  }

  if (action === "observe") return result("ready", kind === "coupons" ? "已读取当前红包列表。" : "已识别结算优惠入口。");
  if (action === "open-list") {
    if (kind === "coupons") return result("ready", "红包列表已经打开。");
    if (entryControls.length !== 1) return result("ambiguous", "未找到唯一的红包入口。");
    const entry = entryControls[0];
    if (!enabled(entry) || has(entry, "disabled") || dangerous(text(entry))) {
      return result("unavailable", "当前红包入口不可自动操作，请在网页核对。");
    }
    entry.click();
    return result("opened", "已尝试打开官方红包列表。");
  }
  if (kind !== "coupons") return result("unavailable", "请先打开红包列表。");
  if (action === "select") {
    if (typeof request.key !== "string" || request.key.length > 100) return result("invalid", "请选择本页读取到的红包。");
    const matches = records.filter((coupon) => coupon.key === request.key);
    if (matches.length !== 1) return result("ambiguous", "红包已变化或存在相同条目，请重新读取。");
    const coupon = matches[0];
    if (coupon.requiresRedemption) return result("redemption-required", "这张券需要兑换或领取，已停止自动操作。");
    if (!coupon.available) return result("unavailable", "这张红包当前不可用。");
    if (coupon.selected) return result("already-selected", "这张红包已选中，保持当前选择。");
    coupon.control.click();
    return result("selected", adapter === "meituan" || !selectionNeedsConfirm
      ? "已选择已有红包，等待官方页面重新计价。" : "已选择已有红包，请等列表刷新后确认使用。");
  }
  if (action === "confirm") {
    if (records.some((coupon) => coupon.selected && (coupon.requiresRedemption || !coupon.available))) {
      return result("unsafe-selection", "已选券包含未兑换或不可用项，请在网页核对；不会自动兑换。");
    }
    const snapshot = JSON.parse(result("ready", ""));
    if (!snapshot.canConfirm) return result("unavailable", "本页没有可确认的已有红包选择。");
    confirmControls[0].click();
    return result("confirmed", "已确认使用已有红包，等待结算页面重新计价。");
  }
  if (returnControls.length === 1) {
    returnControls[0].click();
    return result("closed", "已返回结算页面。");
  }
  if (historyReturn) {
    window.history.back();
    return result("closed", "已返回结算页面。");
  }
  return result("unavailable", "当前页面没有可核实的返回入口，请手动返回。");
})(__MEAL_COUPON_REQUEST__);
