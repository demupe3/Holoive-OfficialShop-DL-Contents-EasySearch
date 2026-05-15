// ==UserScript==
// @name         ホロライブ公式ショップ：マイオーダー商品名表示
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  初期リリース
// @author       demupe3
// @match        https://shop.hololivepro.com/account*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "holo_account_order_cache_v2_1"; // Variant対応で更新

  const COLORS = {
    primary: "#2ccce4",
    accent: "#e42c64",
    text: "#1f2937",
    muted: "#64748b",
    surface: "#f8f9fa"
  };

  function loadCache() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  }

  function saveCache(cache) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  }

  // 注文詳細ページから全商品を「商品名」でグループ化して取得
  async function fetchAllProductsInOrder(orderUrl) {
    try {
      const res = await fetch(orderUrl, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP error");

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      const groups = new Map(); // 商品名 → {img, variants: [{variant, price, img}] }

      doc.querySelectorAll('tr.CartItem').forEach(row => {
        const titleEl = row.querySelector('.CartItem__Title a') || row.querySelector('.CartItem__Title');
        const name = titleEl ? titleEl.textContent.trim() : "商品名不明";

        const variantEl = row.querySelector('.CartItem__Variant');
        const variant = variantEl ? variantEl.textContent.trim() : "－";

        const imgEl = row.querySelector('.CartItem__Image');
        const img = imgEl ? imgEl.src : "";

        const priceEl = row.querySelector('.CartItem__Price .money');
        const price = priceEl ? priceEl.textContent.trim() : "";

        if (!groups.has(name)) {
          groups.set(name, { img, variants: [] });
        }

        groups.get(name).variants.push({ variant, price, img: img || groups.get(name).img });
      });

      // Mapを配列に変換（出現順を保持）
      const result = Array.from(groups.entries()).map(([name, data]) => ({
        name,
        img: data.img,
        variants: data.variants
      }));

      return result.length > 0 ? result : [{ name: "商品情報なし", img: "", variants: [] }];
    } catch (e) {
      console.error("商品情報取得失敗:", orderUrl, e);
      return [{ name: "取得失敗", img: "", variants: [] }];
    }
  }

  // 商品セル描画（Variant対応）
  function renderProductCell(td, groups) {
    // 通常は1グループ（同じ商品名）だが、念のため複数対応
    const mainGroup = groups[0];
    const hasMultipleVariants = mainGroup.variants.length > 1;

    let html = `
      <div style="display:flex; align-items:center; gap:12px; padding:4px 0; position:relative;" class="sp-product-cell">
        ${mainGroup.img ? `
          <img src="${mainGroup.img}"
               style="width:42px; height:42px; object-fit:cover; border-radius:10px; flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.08);"
               loading="lazy">
        ` : ''}

        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; font-size:15px; line-height:1.45; color:${COLORS.text};">
            ${mainGroup.name}
          </div>
    `;

    // Variant表示
    if (hasMultipleVariants) {
      const variantList = mainGroup.variants.map(v =>
        `<span style="display:inline-block; background:#f0f9ff; color:#0e7490; padding:2px 8px; border-radius:9999px; font-size:12px; margin:2px;">${v.variant}</span>`
      ).join('');

      html += `
        <div style="margin-top:6px; font-size:12.5px; line-height:1.4;">
          <span style="color:${COLORS.muted}; font-weight:600;">Variant:</span><br>
          ${variantList}
        </div>
      `;
    } else if (mainGroup.variants[0]) {
      html += `
        <div style="margin-top:4px; font-size:13px; color:${COLORS.muted};">
          ${mainGroup.variants[0].variant}
        </div>
      `;
    }

    html += `</div></div>`;

    td.innerHTML = html;

    // ホバー詳細ポップアップ（全Variant詳細）
    if (hasMultipleVariants || groups.length > 1) {
      let popupItems = '';
      groups.forEach(group => {
        group.variants.forEach(v => {
          popupItems += `
            <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f1f5f9;">
              ${v.img ? `<img src="${v.img}" style="width:36px; height:36px; object-fit:cover; border-radius:8px;">` : ''}
              <div style="flex:1;">
                <div style="font-weight:600; font-size:14px;">${group.name}</div>
                <div style="font-size:13px; color:${COLORS.muted};">${v.variant}　${v.price}</div>
              </div>
            </div>`;
        });
      });

      const popupHTML = `
        <div style="position:absolute; top:100%; left:0; margin-top:8px; background:white; border-radius:16px; box-shadow:0 12px 32px -10px rgba(0,0,0,0.35);
                    padding:14px; width:340px; z-index:10000; font-size:14px; display:none; max-height:420px; overflow-y:auto;" class="sp-popup">
          <div style="font-weight:700; margin-bottom:10px; color:${COLORS.text};">この注文の全Variant (${mainGroup.variants.length}種)</div>
          ${popupItems}
        </div>
      `;

      td.querySelector('.sp-product-cell').insertAdjacentHTML('beforeend', popupHTML);

      const cell = td.querySelector('.sp-product-cell');
      const popup = cell.querySelector('.sp-popup');
      cell.addEventListener('mouseenter', () => popup.style.display = 'block');
      cell.addEventListener('mouseleave', () => popup.style.display = 'none');
    }
  }

  async function enhanceMyOrdersTable() {
    const table = document.querySelector('table.AccountTable.Table--large') || document.querySelector('table.AccountTable');
    if (!table || table.querySelector('th[data-col="product"]')) return;

    const cache = loadCache();
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;

    const productTh = document.createElement('th');
    productTh.setAttribute('data-col', 'product');
    productTh.style.width = "360px";
    productTh.style.fontWeight = "700";
    productTh.innerHTML = `商品名 <button id="sp-refresh-all" style="margin-left:8px; background:none; border:none; color:${COLORS.primary}; font-size:18px; cursor:pointer;">🔄</button>`;
    headerRow.insertBefore(productTh, headerRow.children[1]);

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const fetchPromises = [];

    for (const row of rows) {
      const orderLink = row.querySelector('a[href*="/account/orders/"]');
      if (!orderLink) continue;

      const href = orderLink.href;
      const hashMatch = href.match(/orders\/([a-f0-9]+)/i);
      if (!hashMatch) continue;
      const orderHash = hashMatch[1];

      const newTd = document.createElement('td');
      newTd.style.verticalAlign = "top";
      newTd.style.padding = "14px 12px";
      row.insertBefore(newTd, row.children[1]);

      if (cache[orderHash]) {
        renderProductCell(newTd, cache[orderHash]);
      } else {
        newTd.innerHTML = `<div style="color:${COLORS.muted}; font-size:14px;">取得中…</div>`;
        fetchPromises.push(
          fetchAllProductsInOrder(href).then(groups => {
            cache[orderHash] = groups;
            saveCache(cache);
            renderProductCell(newTd, groups);
          })
        );
      }
    }

    if (fetchPromises.length > 0) await Promise.all(fetchPromises);

    document.getElementById('sp-refresh-all').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("すべての注文の商品情報を再取得しますか？")) return;
      localStorage.removeItem(STORAGE_KEY);
      enhanceMyOrdersTable();
    };
  }

  function createFloatingRefreshButton() {
    if (document.getElementById("sp-account-fab")) return;
    const fab = document.createElement("div");
    fab.id = "sp-account-fab";
    fab.style.cssText = `position:fixed; bottom:24px; right:24px; z-index:99999; width:64px; height:64px; border-radius:50%; background:linear-gradient(145deg, #2ccce4, #1eb8d0); box-shadow:0 8px 28px -4px rgba(44,204,228,0.5); display:flex; align-items:center; justify-content:center; color:white; font-size:28px; cursor:pointer; transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);`;
    fab.innerHTML = `🔄`;
    fab.onclick = () => enhanceMyOrdersTable();
    document.body.appendChild(fab);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      enhanceMyOrdersTable();
      createFloatingRefreshButton();
    });
  } else {
    enhanceMyOrdersTable();
    createFloatingRefreshButton();
  }
})();