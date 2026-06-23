// ==UserScript==
// @name         ホロライブ公式ショップ：マイオーダー商品名表示
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  マイオーダー表に商品名＋種類自動追加＋未発送リスト（検出中表示＋30分キャッシュ） [refactored]
// @author       demupe3
// @match        https://shop.hololivepro.com/account*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ====================== CONFIG & CONSTANTS ======================
  const CACHE_KEY = "holo_account_order_cache_v2_1";
  const PENDING_CACHE_KEY = "holo_pending_orders_cache";

  const TIMINGS = {
    pendingCacheMs: 30 * 60 * 1000,
    crawlDelayMs: 600,
    maxCrawlPages: 15,
    maxConcurrentDetails: 4,
    recentYears: 1,
    initDelayMs: 1600,
  };

  const SELECTORS = {
    orderTable: "table.AccountTable.Table--large, table.AccountTable",
    orderRow: "tbody tr",
    orderLink: 'a[href*="/account/orders/"]',
    cartItem: "tr.CartItem",
    cartTitle: ".CartItem__Title a, .CartItem__Title",
    cartVariant: ".CartItem__Variant",
    cartImage: ".CartItem__Image",
    cartPrice: ".CartItem__Price .money",
    shippingDesc: ".SectionHeader__Description",
    headerRow: "thead tr",
  };

  const COLORS = {
    primary: "#2ccce4",
    accent: "#e42c64",
    text: "#1f2937",
    muted: "#64748b",
  };

  // ====================== STATE ======================
  let pendingOrders = [];
  let isCrawling = false;

  // ====================== キャッシュ ======================
  const OrderCache = {
    load() {
      const saved = localStorage.getItem(CACHE_KEY);
      if (!saved) return {};
      let cache = JSON.parse(saved);
      // v1 マイグレーション（配列 → {products, shippingDate}）
      Object.keys(cache).forEach((key) => {
        if (Array.isArray(cache[key])) {
          cache[key] = { products: cache[key], shippingDate: "" };
        }
      });
      return cache;
    },
    save(cache) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    },
    clear() {
      localStorage.removeItem(CACHE_KEY);
    },
  };

  const PendingCache = {
    load() {
      const saved = localStorage.getItem(PENDING_CACHE_KEY);
      if (!saved) return null;
      const data = JSON.parse(saved);
      if (Date.now() - data.timestamp > TIMINGS.pendingCacheMs) {
        localStorage.removeItem(PENDING_CACHE_KEY);
        return null;
      }
      return data.orders;
    },
    save(orders) {
      localStorage.setItem(
        PENDING_CACHE_KEY,
        JSON.stringify({
          orders,
          timestamp: Date.now(),
        }),
      );
    },
  };

  // ====================== ユーティリティ ======================
  function parseOrderHash(href) {
    const m = href.match(/orders\/([a-f0-9]+)/i);
    return m ? m[1] : null;
  }

  function parseJapaneseDate(str) {
    const m = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function isUnshippedStatus(text) {
    return text.includes("未発送") || text.includes("発送予定");
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index], index);
      }
    }

    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  // ====================== 商品情報取得 ======================
  async function fetchOrderDetails(orderUrl) {
    try {
      const res = await fetch(orderUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      return parseOrderDocument(doc);
    } catch (e) {
      return {
        products: [{ name: "取得失敗", img: "", variants: [] }],
        shippingDate: "",
      };
    }
  }

  /**
   * 注文詳細ページのHTMLから商品情報と発送予定を抽出
   */
  function parseOrderDocument(doc) {
    const groups = new Map();

    doc.querySelectorAll(SELECTORS.cartItem).forEach((row) => {
      const titleEl = row.querySelector(SELECTORS.cartTitle);
      const name = titleEl ? titleEl.textContent.trim() : "商品名不明";

      const variant = (
        row.querySelector(SELECTORS.cartVariant)?.textContent || "－"
      ).trim();
      const img = row.querySelector(SELECTORS.cartImage)?.src || "";
      const price = (
        row.querySelector(SELECTORS.cartPrice)?.textContent || ""
      ).trim();

      if (!groups.has(name)) {
        groups.set(name, { img, variants: [] });
      }
      const g = groups.get(name);
      g.variants.push({ variant, price, img: img || g.img });
    });

    const products = Array.from(groups.entries()).map(([name, data]) => ({
      name,
      img: data.img,
      variants: data.variants,
    }));

    let shippingDate = "";
    for (const el of doc.querySelectorAll(SELECTORS.shippingDesc)) {
      const text = el.textContent.trim();
      if (text.includes("発送予定日") || text.includes("発送予定")) {
        shippingDate = text;
        break;
      }
    }

    return {
      products:
        products.length > 0
          ? products
          : [{ name: "商品情報なし", img: "", variants: [] }],
      shippingDate,
    };
  }

  function renderProductCell(td, data) {
    const groups = data.products || data;
    const mainGroup = groups[0];
    if (!mainGroup) return;

    const hasMultiVariant = mainGroup.variants && mainGroup.variants.length > 1;
    const hasMultiGroup = groups.length > 1;

    let html = `
      <div style="display:flex; align-items:center; gap:12px; padding:4px 0; position:relative;" class="sp-product-cell">
        ${mainGroup.img ? `<img src="${mainGroup.img}" style="width:42px; height:42px; object-fit:cover; border-radius:10px; flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.08);" loading="lazy">` : ""}
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; font-size:15px; line-height:1.45; color:${COLORS.text};">${mainGroup.name}</div>
    `;

    if (hasMultiVariant) {
      const variantList = mainGroup.variants
        .map(
          (v) =>
            `<span style="display:inline-block; background:#f0f9ff; color:#0e7490; padding:2px 8px; border-radius:9999px; font-size:12px; margin:2px;">${v.variant}</span>`,
        )
        .join("");
      html += `<div style="margin-top:6px; font-size:12.5px; line-height:1.4;"><span style="color:${COLORS.muted}; font-weight:600;">種類:</span><br>${variantList}</div>`;
    } else if (mainGroup.variants?.[0]) {
      html += `<div style="margin-top:4px; font-size:13px; color:${COLORS.muted};">${mainGroup.variants[0].variant}</div>`;
    }

    html += `</div></div>`;
    td.innerHTML = html;

    if (hasMultiVariant || hasMultiGroup) {
      const popup = createVariantPopup(groups, mainGroup);
      const cellEl = td.querySelector(".sp-product-cell");
      cellEl.appendChild(popup);

      cellEl.addEventListener("mouseenter", () => {
        popup.style.display = "block";
      });
      cellEl.addEventListener("mouseleave", () => {
        popup.style.display = "none";
      });
    }
  }

  function createVariantPopup(groups, mainGroup) {
    const popup = document.createElement("div");
    popup.className = "sp-popup";
    popup.style.cssText = `position:absolute;top:100%;left:0;margin-top:8px;background:white;border-radius:16px;box-shadow:0 12px 32px -10px rgba(0,0,0,0.35);padding:14px;width:340px;z-index:10000;font-size:14px;display:none;max-height:420px;overflow-y:auto;`;

    let itemsHTML = "";
    groups.forEach((group) => {
      (group.variants || []).forEach((v) => {
        itemsHTML += `
          <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f1f5f9;">
            ${v.img ? `<img src="${v.img}" style="width:36px;height:36px;object-fit:cover;border-radius:8px;">` : ""}
            <div style="flex:1;">
              <div style="font-weight:600;font-size:14px;">${group.name}</div>
              <div style="font-size:13px;color:${COLORS.muted};">${v.variant}　${v.price}</div>
            </div>
          </div>`;
      });
    });

    const count = mainGroup.variants ? mainGroup.variants.length : 0;
    popup.innerHTML = `
      <div style="font-weight:700;margin-bottom:10px;color:${COLORS.text};">この注文の全種類（${count}種）</div>
      ${itemsHTML}
    `;
    return popup;
  }

  // ====================== 未発送リスト ======================
  async function crawlPendingOrders() {
    if (isCrawling) return;
    isCrawling = true;

    const cached = PendingCache.load();
    if (cached) {
      pendingOrders = cached;
      if (pendingOrders.length > 0) showPendingButton();
      isCrawling = false;
      return;
    }

    showCheckingToast();

    pendingOrders = [];
    const now = new Date();
    const cutoff = new Date(
      now.getFullYear() - TIMINGS.recentYears,
      now.getMonth(),
      now.getDate(),
    );

    let page = 1;

    while (page <= TIMINGS.maxCrawlPages) {
      try {
        const url = page === 1 ? "/account" : `/account?page=${page}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) break;

        const doc = new DOMParser().parseFromString(
          await res.text(),
          "text/html",
        );
        const rows = doc.querySelectorAll("table.AccountTable tbody tr");

        for (const row of rows) {
          const dateTd = row.querySelector("td:nth-child(2)");
          const statusTd = row.querySelector("td:nth-child(5)");
          const orderLink = row.querySelector(SELECTORS.orderLink);

          if (!dateTd || !statusTd || !orderLink) continue;

          const orderDateStr = dateTd.textContent.trim();
          const statusText = statusTd.textContent.trim();
          const orderUrl = orderLink.href;

          const orderDate = parseJapaneseDate(orderDateStr);
          if (!orderDate || orderDate < cutoff) continue;
          if (!isUnshippedStatus(statusText)) continue;

          pendingOrders.push({
            orderUrl,
            orderDate: orderDateStr,
            status: statusText,
          });
        }

        if (rows.length < 5 && page > 3) break;
        page++;
        await new Promise((r) => setTimeout(r, TIMINGS.crawlDelayMs));
      } catch (e) {
        break;
      }
    }

    PendingCache.save(pendingOrders);
    removeCheckingToast();

    if (pendingOrders.length > 0) showPendingButton();
    isCrawling = false;
  }

  // 検出中トースト
  function showCheckingToast() {
    const existing = document.getElementById("sp-checking-toast");
    if (existing) return;

    const toast = document.createElement("div");
    toast.id = "sp-checking-toast";
    toast.style.cssText = `
      position:fixed; bottom:100px; left:24px;
      background:#334155; color:white; padding:12px 24px; border-radius:9999px;
      font-size:14px; z-index:99999; box-shadow:0 4px 15px rgba(0,0,0,0.3);
      display:flex; align-items:center; gap:10px;
    `;
    toast.innerHTML = `🔍 未発送商品をチェック中...`;
    document.body.appendChild(toast);
  }

  function removeCheckingToast() {
    const toast = document.getElementById("sp-checking-toast");
    if (toast) toast.remove();
  }

  function showPendingButton() {
    if (document.getElementById("sp-pending-btn")) return;

    const btn = document.createElement("div");
    btn.id = "sp-pending-btn";
    btn.style.cssText = `
      position:fixed; bottom:30px; left:24px;
      background:linear-gradient(145deg, #e42c64, #c81e52); color:white;
      padding:14px 36px; border-radius:9999px; font-weight:700; font-size:16.5px;
      box-shadow:0 10px 30px -8px rgba(228,44,100,0.5); cursor:pointer; z-index:99999;
    `;
    btn.innerHTML = `📦 未発送商品 <strong>${pendingOrders.length}</strong> 件を表示`;
    btn.onclick = showPendingModal;
    document.body.appendChild(btn);
  }

  async function showPendingModal() {
    const modal = document.createElement("div");
    modal.style.cssText = `position:fixed; inset:0; background:rgba(15,23,42,0.92); backdrop-filter:blur(12px); z-index:100002; display:flex; align-items:center; justify-content:center;`;

    modal.innerHTML = `
      <div style="background:white; border-radius:24px; width:92%; max-width:680px; max-height:88vh; overflow-y:auto; padding:28px;">
        <h2 style="margin:0 0 24px; text-align:center; font-size:24px;">📦 未発送商品一覧 (${pendingOrders.length}件)</h2>
        <div id="pending-content" style="min-height:120px; text-align:center; padding:40px 0;">取得中...</div>
        <div style="text-align:center; margin-top:24px;">
          <button id="modal-close" style="padding:14px 48px; background:#e2e8f0; border:none; border-radius:9999px; font-size:16px; font-weight:700; cursor:pointer;">閉じる</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const contentDiv = document.getElementById("pending-content");
    const closeBtn = document.getElementById("modal-close");
    closeBtn.onclick = () => modal.remove();

    const cache = OrderCache.load();
    let cacheChanged = false;
    const results = await mapWithConcurrency(
      pendingOrders,
      TIMINGS.maxConcurrentDetails,
      async (order) => {
        const orderHash = parseOrderHash(order.orderUrl);
        if (orderHash && cache[orderHash]) return cache[orderHash];

        const data = await fetchOrderDetails(order.orderUrl);
        if (orderHash) {
          cache[orderHash] = data;
          cacheChanged = true;
        }
        return data;
      },
    );

    if (cacheChanged) OrderCache.save(cache);

    let html = "";
    results.forEach((data, i) => {
      const order = pendingOrders[i];
      const main = data.products[0] || { name: "商品情報なし", img: "" };
      html += `
        <div style="background:#f8fafc; border-radius:16px; padding:18px; margin-bottom:14px; border-left:5px solid ${COLORS.accent};">
          <div style="display:flex; gap:16px;">
            ${main.img ? `<img src="${main.img}" style="width:78px;height:78px;object-fit:cover;border-radius:12px;">` : ""}
            <div style="flex:1;">
              <div style="font-weight:700;font-size:16.5px;">${main.name}</div>
              <div style="margin-top:6px;color:${COLORS.muted};">${order.orderDate}</div>
              ${data.shippingDate ? `<div style="margin-top:6px;color:#e42c64;font-weight:600;">${data.shippingDate}</div>` : ""}
            </div>
          </div>
        </div>`;
    });

    contentDiv.innerHTML =
      html ||
      '<p style="text-align:center;padding:60px;color:#888;">未発送商品はありません</p>';
  }

  // ====================== メイン処理 ======================
  async function enhanceMyOrdersTable() {
    const table = document.querySelector(SELECTORS.orderTable);
    if (!table || table.dataset.spEnhanced === "1") return;

    const cache = OrderCache.load();
    const headerRow = table.querySelector(SELECTORS.headerRow);
    if (!headerRow) return;

    removeShippingDateColumn(table, headerRow);
    insertProductNameHeader(headerRow);

    const rows = Array.from(table.querySelectorAll(SELECTORS.orderRow));
    const missingOrders = [];

    for (const row of rows) {
      const orderLink = row.querySelector(SELECTORS.orderLink);
      if (!orderLink) continue;

      const href = orderLink.href;
      const orderHash = parseOrderHash(href);
      if (!orderHash) continue;

      const newTd = document.createElement("td");
      newTd.style.cssText = "vertical-align:top; padding:14px 12px;";
      row.insertBefore(newTd, row.children[1]);

      if (cache[orderHash]) {
        renderProductCell(newTd, cache[orderHash]);
      } else {
        newTd.innerHTML = `<div style="color:${COLORS.muted}; font-size:14px;">取得中…</div>`;
        missingOrders.push({ href, orderHash, td: newTd });
      }
    }

    if (missingOrders.length > 0) {
      await mapWithConcurrency(
        missingOrders,
        TIMINGS.maxConcurrentDetails,
        async ({ href, orderHash, td }) => {
          const data = await fetchOrderDetails(href);
          cache[orderHash] = data;
          renderProductCell(td, data);
        },
      );
      OrderCache.save(cache);
    }

    appendShippingDatesToStatus(table, cache);
    table.dataset.spEnhanced = "1";

    const refreshBtn = document.getElementById("sp-refresh-all");
    if (refreshBtn) {
      refreshBtn.onclick = (e) => {
        e.stopPropagation();
        if (!confirm("すべての注文の商品情報を再取得しますか？")) return;
        OrderCache.clear();
        window.location.reload();
      };
    }

    createSmartPagination();
  }

  function removeShippingDateColumn(table, headerRow) {
    const shippingTh = Array.from(headerRow.querySelectorAll("th")).find(
      (th) =>
        th.textContent.includes("発送予定日") ||
        th.textContent.includes("発送予定"),
    );
    if (!shippingTh) return;

    const idx = Array.from(headerRow.children).indexOf(shippingTh);
    shippingTh.remove();
    table.querySelectorAll("tbody tr").forEach((row) => {
      if (row.children[idx]) row.children[idx].remove();
    });
  }

  function insertProductNameHeader(headerRow) {
    const productTh = document.createElement("th");
    productTh.setAttribute("data-col", "product");
    productTh.style.width = "360px";
    productTh.style.fontWeight = "700";
    productTh.innerHTML = `商品名 <button id="sp-refresh-all" style="margin-left:8px; background:none; border:none; color:${COLORS.primary}; font-size:18px; cursor:pointer;">🔄</button>`;
    headerRow.insertBefore(productTh, headerRow.children[1]);
  }

  function appendShippingDatesToStatus(table, cache) {
    const statusCells = table.querySelectorAll("tbody tr td:nth-child(5)");
    statusCells.forEach((td) => {
      const row = td.parentNode;
      const orderLink = row.querySelector(SELECTORS.orderLink);
      if (!orderLink) return;

      const orderHash = parseOrderHash(orderLink.href);
      if (!orderHash) return;

      const cached = cache[orderHash];
      if (!cached?.shippingDate) return;
      if (td.textContent.trim().includes("発送済")) return;

      td.innerHTML += `<div style="font-size:12px; color:${COLORS.muted}; margin-top:4px; line-height:1.3;">${cached.shippingDate}</div>`;
    });
  }

  function createSmartPagination() {
    const oldPagination = document.querySelector(".Pagination");
    if (!oldPagination) return;

    const currentPageMatch = window.location.search.match(/page=(\d+)/);
    let current = currentPageMatch ? parseInt(currentPageMatch[1], 10) : 1;

    let total = 1;
    document.querySelectorAll('a[href*="/account?page="]').forEach((link) => {
      const m = link.href.match(/page=(\d+)/);
      if (m) total = Math.max(total, parseInt(m[1], 10));
    });

    let html = `<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:center; font-size:15px;">`;

    if (current > 1) {
      html += `<a href="/account?page=${current - 1}" class="Pagination_arrow -prev prtc_pagenation_item" style="padding:8px 14px;">‹</a>`;
    }

    html += `<a href="/account?page=1" class="Pagination_dot prtc_pagenation_item ${current === 1 ? "isActive" : ""}">1</a>`;

    const start = Math.max(2, current - 4);
    const end = Math.min(total - 1, current + 4);

    if (start > 2)
      html += `<span style="padding:0 6px; color:${COLORS.muted};">…</span>`;
    for (let i = start; i <= end; i++) {
      html += `<a href="/account?page=${i}" class="Pagination_dot prtc_pagenation_item ${i === current ? "isActive" : ""}">${i}</a>`;
    }
    if (end < total - 1)
      html += `<span style="padding:0 6px; color:${COLORS.muted};">…</span>`;

    if (total > 1) {
      html += `<a href="/account?page=${total}" class="Pagination_dot prtc_pagenation_item ${current === total ? "isActive" : ""}">${total}</a>`;
    }
    if (current < total) {
      html += `<a href="/account?page=${current + 1}" class="Pagination_arrow -next prtc_pagenation_item" style="padding:8px 14px;">›</a>`;
    }

    html += `
      <div style="margin-left:24px; display:flex; align-items:center; gap:8px; font-size:14px; white-space:nowrap;">
        <span style="color:${COLORS.muted};">ページ</span>
        <input type="number" id="jump-to-page" min="1" max="${total}" value="${current}"
               style="width:68px; padding:7px 10px; border:1px solid #cbd5e1; border-radius:8px; text-align:center; font-size:15px;">
        <button id="jump-go" style="padding:7px 18px; background:${COLORS.primary}; color:white; border:none; border-radius:8px; font-weight:700; cursor:pointer;">移動</button>
      </div>
    `;

    html += `</div>`;
    oldPagination.innerHTML = html;

    const goBtn = document.getElementById("jump-go");
    const input = document.getElementById("jump-to-page");
    if (goBtn && input) {
      goBtn.onclick = () => {
        let page = Math.max(1, Math.min(total, parseInt(input.value, 10) || 1));
        window.location.href = `/account?page=${page}`;
      };
      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") goBtn.click();
      });
    }
  }

  // ====================== INIT ======================
  function init() {
    const start = () => {
      enhanceMyOrdersTable();
      setTimeout(crawlPendingOrders, TIMINGS.initDelayMs);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }

  init();
})();
