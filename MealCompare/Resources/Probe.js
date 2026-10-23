/* Runs in the page. It never submits orders, selects coupons, or reads credentials. */
((request) => {
  "use strict";
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const searchInputs = Array.from(document.querySelectorAll("input")).filter((input) => {
    const type = (input.type || "text").toLowerCase();
    const label = [input.placeholder, input.getAttribute("aria-label"), input.getAttribute("role")].filter(Boolean).join(" ");
    if (!["text", "search"].includes(type) || input.disabled || input.readOnly || !visible(input)) return false;
    if (/地址|位置|手机号|验证码|密码|address|phone|password/i.test(label)) return false;
    return type === "search" || /搜|search/i.test(label);
  });

  if (request.action === "search") {
    const query = typeof request.query === "string" ? request.query.trim() : "";
    const outcome = (status, message) => JSON.stringify({ status, message });
    if (!query || query.length > 100) return outcome("invalid", "请输入 1–100 字的商品名称");
    if (searchInputs.length !== 1) return outcome("unsupported", searchInputs.length === 0
      ? "未识别到商品搜索框。请先完成登录并进入搜索页，然后重试。"
      : "页面有多个搜索框，尚不能确定商品搜索位置。请先进入商品搜索页。");
    const input = searchInputs[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const buttons = Array.from(document.querySelectorAll("button, [role='button'], input[type='submit']"))
      .filter((button) => visible(button) && !button.disabled
        && /^(搜索|搜一下|search)$/i.test((button.innerText || button.value || button.getAttribute("aria-label") || "").trim()));
    if (buttons.length === 1) {
      // Allow a controlled React/Vue input to process its change before the search action.
      window.setTimeout(() => buttons[0].click(), 120);
      return outcome("submitted", "已填写商品名称并尝试点击搜索，请核对网页搜索结果。");
    }
    return outcome("filled", "已填写商品名称。此页面尚未识别到唯一的搜索按钮，请在网页点搜索。");
  }

  if (request.action !== "inspect") throw new Error("Unsupported probe action");
  const text = (document.body ? document.body.innerText : "").replace(/\u00a0/g, " ");
  const prices = [];
  // Both the explicit label and its nearby numeric amount are required. Item prices are not quotes.
  const pattern = /(实付(?:金额)?|应付(?:金额)?|待支付|合计|总计)\s*[:：]?\s*[¥￥]?\s*(\d{1,8}(?:\.\d{1,2})?)(?![\d.,，]|\s*(?:件|份|个|项|种|商品|分钟|公里|km))/g;
  for (const match of text.matchAll(pattern)) {
    const [whole, fraction = ""] = match[2].split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!prices.some((price) => price.label === match[1] && price.cents === cents)) {
      prices.push({ label: match[1], cents });
    }
    if (prices.length >= 8) break;
  }
  const deliveryHints = [];
  const etaPattern = /(?:预计\s*(?:送达\s*)?\d{1,3}\s*(?:[-~～至]\s*\d{1,3}\s*)?分钟(?:内)?(?:送达)?|(?:(?:预计|大约)\s*)?(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:[-~～至—–]\s*(?:[01]?\d|2[0-3]):[0-5]\d\s*)?送达)/g;
  for (const match of text.matchAll(etaPattern)) {
    if (match.index > 0 && /[\d:]/.test(text[match.index - 1])) continue;
    const hint = match[0].replace(/\s+/g, " ").trim();
    if (!deliveryHints.includes(hint)) deliveryHints.push(hint);
    if (deliveryHints.length >= 8) break;
  }
  return JSON.stringify({
    version: 2,
    origin: location.origin,
    searchInputCount: searchInputs.length,
    hasLoginInput: Array.from(document.querySelectorAll("input")).some((input) => visible(input)
      && (input.type === "password" || /手机号|验证码|password/i.test(input.placeholder || ""))),
    hasCouponText: /红包|会员券|优惠券/.test(text),
    checkoutLikely: /提交订单|确认订单|去支付/.test(text),
    addressRequired: /请选择(?:收货|配送)?地址|请先(?:选择|添加)(?:收货|配送)?地址|请添加(?:收货|配送)?地址/.test(text),
    hasOpenAppHint: /打开\s*(?:美团|饿了么|淘宝)?\s*App|唤起\s*App/i.test(text),
    prices,
    deliveryHints
  });
})(__MEAL_COMPARE_REQUEST__);
