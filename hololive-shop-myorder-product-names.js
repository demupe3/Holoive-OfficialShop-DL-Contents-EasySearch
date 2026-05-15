// ==UserScript==
// @name         ホロライブ公式ショップ：マイオーダー商品名表示
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  マイオーダー表に商品名＋Variantを自動追加。発送予定日列は削除し、発送状況が「未発送」の場合のみ発送予定日を小さく表示。右下の不要な浮動ボタンも削除。
// @author       demupe3
// @match        https://shop.hololivepro.com/account*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "holo_account_order_cache_v2_1";

  const COLORS = {
    primary: "#2ccce4",
    accent: "#e42c64",
    text: "#1f2937",
    muted: "#64748b",
    surface: "#f8f9fa"
  };

  function loadCache() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    let cache = JSON.parse(saved);

    // 旧キャッシュ互換性対応
    Object.keys(cache).forEach(key => {
      if (Array.isArray(cache[key])) {
        cache[key] = { products: cache[key], shippingDate: "" };
      }
    });
    return cache;
  }

  function saveCache(cache) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  }

  async function fetchAllProductsInOrder(orderUrl) {
    try {
      const res = await fetch(orderUrl, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP error");

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      // 商品情報
      const groups = new Map();
      doc.querySelectorAll('tr.CartItem').forEach(row => {
        const titleEl = row.querySelector('.CartItem__Title a') || row.querySelector('.CartItem__Title');
        const name = titleEl ? titleEl.textContent.trim() : "商品名不明";

        const variantEl = row.querySelector('.CartItem__Variant');
        const variant = variantEl ? variantEl.textContent.trim() : "－";

        const imgEl = row.querySelector('.CartItem__Image');
        const img = imgEl ? imgEl.src : "";

        const priceEl = row.querySelector('.CartItem__Price .money');
        const price = priceEl ? priceEl.textContent.trim() : "";

        if (!groups.has(name)) groups.set(name, { img, variants: [] });
        groups.get(name).variants.push({ variant, price, img: img || groups.get(name).img });
      });

      const products = Array.from(groups.entries()).map(([name, data]) => ({
        name,
        img: data.img,
        variants: data.variants
      }));

      // 発送予定日取得
      let shippingDate = "";
      const descs = doc.querySelectorAll('.SectionHeader__Description');
      for (const p of descs) {
        const text = p.textContent.trim();
        if (text.includes('発送予定日') || text.includes('発送予定')) {
          shippingDate = text;
          break;
        }
      }

      return { products: products.length > 0 ? products : [{ name: "商品情報なし", img: "", variants: [] }], shippingDate };
    } catch (e) {
      console.error("取得失敗:", orderUrl, e);
      return { products: [{ name: "取得失敗", img: "", variants: [] }], shippingDate: "" };
    }
  }

  function renderProductCell(td, data) {
    const groups = data.products || data;
    const mainGroup = groups[0];
    if (!mainGroup) return;

    const hasMultipleVariants = mainGroup.variants && mainGroup.variants.length > 1;

    let html = `
      <div style="display:flex; align-items:center; gap:12px; padding:4px 0; position:relative;" class="sp-product-cell">
        ${mainGroup.img ? `<img src="${mainGroup.img}" style="width:42px; height:42px; object-fit:cover; border-radius:10px; flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.08);" loading="lazy">` : ''}
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; font-size:15px; line-height:1.45; color:${COLORS.text};">${mainGroup.name}</div>
    `;

    if (hasMultipleVariants) {
      const variantList = mainGroup.variants.map(v => 
        `<span style="display:inline-block; background:#f0f9ff; color:#0e7490; padding:2px 8px; border-radius:9999px; font-size:12px; margin:2px;">${v.variant}</span>`
      ).join('');
      html += `<div style="margin-top:6px; font-size:12.5px; line-height:1.4;"><span style="color:${COLORS.muted}; font-weight:600;">Variant:</span><br>${variantList}</div>`;
    } else if (mainGroup.variants && mainGroup.variants[0]) {
      html += `<div style="margin-top:4px; font-size:13px; color:${COLORS.muted};">${mainGroup.variants[0].variant}</div>`;
    }

    html += `</div></div>`;
    td.innerHTML = html;

    // ホバーポップアップ
    if (hasMultipleVariants || groups.length > 1) {
      let popupItems = '';
      groups.forEach(group => {
        (group.variants || []).forEach(v => {
          popupItems += `<div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f1f5f9;">${v.img ? `<img src="${v.img}" style="width:36px;height:36px;object-fit:cover;border-radius:8px;">` : ''}<div style="flex:1;"><div style="font-weight:600;font-size:14px;">${group.name}</div><div style="font-size:13px;color:${COLORS.muted};">${v.variant}　${v.price}</div></div></div>`;
        });
      });

      const popupHTML = `<div class="sp-popup" style="position:absolute;top:100%;left:0;margin-top:8px;background:white;border-radius:16px;box-shadow:0 12px 32px -10px rgba(0,0,0,0.35);padding:14px;width:340px;z-index:10000;font-size:14px;display:none;max-height:420px;overflow-y:auto;"><div style="font-weight:700;margin-bottom:10px;color:${COLORS.text};">この注文の全Variant (${mainGroup.variants ? mainGroup.variants.length : 0}種)</div>${popupItems}</div>`;
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

    // 1. 発送予定日列を先に削除
    const shippingTh = Array.from(headerRow.querySelectorAll('th')).find(th => 
      th.textContent.includes('発送予定日') || th.textContent.includes('発送予定')
    );
    let shippingColIndex = -1;
    if (shippingTh) {
      shippingColIndex = Array.from(headerRow.children).indexOf(shippingTh);
      shippingTh.remove();
      table.querySelectorAll('tbody tr').forEach(row => {
        if (row.children[shippingColIndex]) row.children[shippingColIndex].remove();
      });
    }

    // 2. 商品名列追加
    const productTh = document.createElement('th');
    productTh.setAttribute('data-col', 'product');
    productTh.style.width = "360px";
    productTh.style.fontWeight = "700";
    productTh.innerHTML = `商品名 <button id="sp-refresh-all" style="margin-left:8px; background:none; border:none; color:${COLORS.primary}; font-size:18px; cursor:pointer;">🔄</button>`;
    headerRow.insertBefore(productTh, headerRow.children[1]);

    // 3. 各行に商品名セルを追加
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
          fetchAllProductsInOrder(href).then(data => {
            cache[orderHash] = data;
            saveCache(cache);
            renderProductCell(newTd, data);
          })
        );
      }
    }

    if (fetchPromises.length > 0) await Promise.all(fetchPromises);

    // 4. 発送状況の下に発送予定日を表示（発送済の場合は非表示）
    const statusCells = table.querySelectorAll('tbody tr td:nth-child(5)'); // 発送状況列
    statusCells.forEach(td => {
      const row = td.parentNode;
      const orderLink = row.querySelector('a[href*="/account/orders/"]');
      if (!orderLink) return;

      const hashMatch = orderLink.href.match(/orders\/([a-f0-9]+)/i);
      if (!hashMatch) return;

      const orderHash = hashMatch[1];
      const cached = cache[orderHash];
      if (!cached || !cached.shippingDate) return;

      // 発送状況のテキストを確認
      const statusText = td.textContent.trim();
      if (statusText.includes('発送済')) return; // 発送済の場合は表示しない

      const dateHTML = `<div style="font-size:12px; color:${COLORS.muted}; margin-top:4px; line-height:1.3;">${cached.shippingDate}</div>`;
      td.innerHTML += dateHTML;
    });

    // 一括更新ボタン
    const refreshBtn = document.getElementById('sp-refresh-all');
    if (refreshBtn) {
      refreshBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("すべての注文の商品情報を再取得しますか？\n（キャッシュをクリアします）")) return;
        localStorage.removeItem(STORAGE_KEY);
        enhanceMyOrdersTable();
      };
    }
  }

  // 右下の浮動ボタンはユーザーの希望により削除

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceMyOrdersTable);
  } else {
    enhanceMyOrdersTable();
  }
})();