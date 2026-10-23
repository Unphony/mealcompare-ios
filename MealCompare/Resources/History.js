/* Read-only history hints from reviewed official DOM. Historical prices are never read. */
((request) => {
  "use strict";
  const reply = (status, message, entries = []) => JSON.stringify({ status, message, entries });
  if (!request || request.action !== "read") return reply("invalid", "无法识别历史记录操作。");
  if (location.protocol !== "https:" || location.hostname !== "h5.ele.me"
      || !/^\/minisite\/pages\/order-list\/index\/?$/.test(location.pathname)) {
    return reply("unsupported", "当前历史订单页面尚未适配；请使用已核实的淘宝闪购订单列表。");
  }
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
  const roots = all(document, ".ol-page-root").filter(visible);
  if (roots.length !== 1) return reply("unsupported", "当前订单列表结构尚未适配，请等待官方页面完成载入。");
  const within = (card, selector) => all(card, selector).filter((node) => node.closest(".ol-card") === card && visible(node));
  const usable = (value, limit) => !!value && value.length <= limit
    && !/(?:\+?86[- ]?)?1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|收货地址|收货人|手机号码?|订单编号|订单号码?|支付流水/.test(value);
  const completed = new Set(["已完成", "订单已完成", "已送达", "订单已送达"]);
  const entries = [];
  const cards = all(roots[0], ".ol-card").filter(visible).slice(0, 200);
  for (const card of cards) {
    if (entries.length >= 20) break;
    const statuses = within(card, ".ol-card-head-status");
    if (statuses.length !== 1 || !completed.has(text(statuses[0]))) continue;
    const stores = within(card, ".ol-card-head-name");
    const items = within(card, ".ol-card-H-signal-item");
    const multiple = within(card, ".ol-card-H-multiple-item");
    const counts = within(card, ".ol-card-template-pricecount-count");
    // Public list DOM exposes per-item names only in this single-item branch. Its
    // quantity is usable only when the separate order total explicitly says one item.
    if (stores.length !== 1 || items.length !== 1 || multiple.length > 0
        || counts.length !== 1 || !/^共\s*1\s*件$/.test(text(counts[0]))) continue;
    const names = all(items[0], ".ol-card-H-signal-item-title").filter(visible);
    const specifications = all(items[0], ".ol-card-H-signal-item-sku").filter(visible);
    if (names.length !== 1 || specifications.length > 1) continue;
    const storeName = text(stores[0]);
    const name = text(names[0]);
    const specs = specifications.length === 1 ? text(specifications[0]) : "";
    if (!usable(storeName, 120) || !usable(name, 200) || (specs && !usable(specs, 500))) continue;
    entries.push({ storeName, items: [{ name, specs: specs || null, quantity: 1 }] });
  }
  return reply("ready", entries.length > 0
    ? "已读取当前页的已完成单商品摘要。多商品、数量不明或状态不明确的订单已跳过；套餐内容和规格仍需重新核对。"
    : "当前页没有可完整读取的已完成单商品摘要。多商品订单在该列表仅显示图片，无法据此导入餐品或推断数量。", entries);
})(__MEAL_HISTORY_REQUEST__);
