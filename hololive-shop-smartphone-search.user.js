// ==UserScript==
// @name         ホロライブ公式ショップ検索（高速化・最適化版）
// @namespace    http://ios.userscript/
// @version      2.0
// @description  スマホ用：超高速クローリング・検索・ソート・設定機能付き
// @author       demupe3 (optimized by assistant)
// @match        https://shop.hololivepro.com/apps/downloads*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const DEFAULT_KEYWORDS = [
    "指定なし", "ASMR", "記念ボイス", "録り下ろし", "ときのそら", "ロボ子さん", "さくらみこ",
    "星街すいせい", "AZKi", "白上フブキ", "夏色まつり", "アキ・ローゼンタール", "赤井はあと",
    "湊あくあ", "紫咲シオン", "百鬼あやめ", "癒月ちょこ", "大空スバル", "大神ミオ",
    "猫又おかゆ", "戌神ころね", "兎田ぺこら", "不知火フレア", "白銀ノエル", "宝鐘マリン",
    "天音かなた", "角巻わため", "常闇トワ", "姫森ルーナ", "雪花ラミィ", "桃鈴ねね",
    "獅白ぼたん", "尾丸ポルカ", "ラプラス・ダークネス", "鷹嶺ルイ", "博衣こより",
    "沙花叉クロヱ", "風真いろは", "火威青", "音乃瀬奏", "一条莉々華", "儒烏風亭らでん",
    "轟はじめ", "響咲リオナ", "虎金妃笑虎", "水宮枢", "輪堂千速", "綺々羅々ヴィヴィ"
  ];

  const STORAGE_KEY_DATA = "holo_shop_ios_data_v2";
  const STORAGE_KEY_CONFIG = "holo_shop_ios_config_v2";

  let cachedItems = null;
  let cachedKeywords = null;

  function loadKeywords() {
    if (cachedKeywords) return cachedKeywords;
    const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
    cachedKeywords = saved ? JSON.parse(saved) : [...DEFAULT_KEYWORDS];
    return cachedKeywords;
  }

  function saveKeywords(list) {
    cachedKeywords = list;
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(list));
  }

  function loadItems() {
    if (cachedItems) return cachedItems;
    const saved = localStorage.getItem(STORAGE_KEY_DATA);
    cachedItems = saved ? JSON.parse(saved) : null;
    return cachedItems;
  }

  function saveItems(items) {
    cachedItems = items;
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(items));
  }

  // UI作成（フローティングボタン）
  function createFloatingButton() {
    if (document.getElementById("sp-tool-container")) return;

    const container = document.createElement("div");
    container.id = "sp-tool-container";
    container.style.cssText = `
      position:fixed; bottom:90px; right:15px; z-index:99990;
      width:60px; height:60px; border-radius:50%;
      background:#fff; border:3px solid #2ccce4;
      box-shadow:0 4px 15px rgba(0,0,0,0.3);
      display:flex; flex-direction:column; justify-content:center; align-items:center;
      font-family:-apple-system,sans-serif; cursor:pointer;
      user-select:none; -webkit-tap-highlight-color:transparent;
    `;

    const hasData = !!loadItems();
    container.innerHTML = `
      <div id="sp-main-btn" style="font-size:28px;">${hasData ? "🔍" : "📥"}</div>
      <div id="sp-status" style="font-size:9px; margin-top:2px;">${hasData ? "検索" : "取得"}</div>
    `;

    container.onclick = () => {
      const items = loadItems();
      if (items) {
        showResults(items);
      } else if (confirm("購入データをすべて読み込みますか？\n（通常1〜2分で完了します）")) {
        startCrawling();
      }
    };

    document.body.appendChild(container);
  }

  // 高速クローリング（?page=n 直指定）
  async function startCrawling() {
    const container = document.getElementById("sp-tool-container");
    const status = document.getElementById("sp-status");
    container.style.opacity = "0.6";
    status.textContent = "読込中";

    const allItems = [];
    let page = 1;

    while (true) {
      const url = `https://shop.hololivepro.com/apps/downloads/?page=${page}`;
      status.textContent = `P.${page}`;

      let html;
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) break;
        html = await res.text();
      } catch (e) {
        console.error("Fetch error:", e);
        break;
      }

      const doc = new DOMParser().parseFromString(html, "text/html");
      const items = extractItemsFromDoc(doc);

      if (items.length === 0) break;

      allItems.push(...items);
      page++;

      // サーバー負荷軽減（300msで十分高速）
      await new Promise(r => setTimeout(r, 300));
    }

    saveItems(allItems);

    document.getElementById("sp-main-btn").textContent = "🔍";
    status.textContent = "検索";
    container.style.opacity = "1";

    alert(`読み込み完了！\n合計 ${allItems.length} 件の商品を検出しました。`);
    showResults(allItems);
  }

  function extractItemsFromDoc(doc) {
    const items = [];
    doc.querySelectorAll("a.sky-pilot-list-item").forEach(el => {
      const titleEl = el.querySelector(".sky-pilot-file-heading");
      const title = titleEl?.innerText.trim() || "名称不明";
      const link = el.href;
      const match = link.match(/\/orders\/(\d+)/);
      const orderId = match ? parseInt(match[1], 10) : 0;

      items.push({ title, link, orderId });
    });
    return items;
  }

  // 設定モーダル
  function openSettingsModal(onClose) {
    const modal = document.createElement("div");
    modal.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background:#f2f2f7; z-index:100001; font-family:-apple-system,sans-serif;
      display:flex; flex-direction:column;
    `;

    let keywords = loadKeywords();

    const render = () => {
      modal.innerHTML = `
        <div style="padding:15px 15px 10px; background:#fff; border-bottom:1px solid #c6c6c8; padding-top:50px; display:flex; justify-content:space-between; align-items:center;">
          <h2 style="margin:0; font-size:17px; font-weight:600;">キーワード設定</h2>
          <button id="done-btn" style="font-size:17px; color:#007aff; background:none; border:none; font-weight:600;">完了</button>
        </div>
        <div style="padding:15px; background:#fff;">
          <div style="display:flex; gap:10px;">
            <input id="new-kw" type="text" placeholder="新しいキーワード" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:8px; font-size:16px;">
            <button id="add-btn" style="padding:0 16px; background:#007aff; color:#fff; border:none; border-radius:8px; font-weight:600;">追加</button>
          </div>
        </div>
        <div style="flex:1; overflow-y:auto; padding:15px 15px 80px; -webkit-overflow-scrolling:touch;">
          <div id="kw-list" style="background:#fff; border-radius:10px; overflow:hidden;"></div>
        </div>
        <div style="padding:20px; text-align:center;">
          <button id="reset-btn" style="color:#ff3b30; background:none; border:none;">初期設定に戻す</button>
        </div>
      `;

      const list = modal.querySelector("#kw-list");
      list.innerHTML = "";
      const frag = document.createDocumentFragment();

      keywords.slice(1).forEach((kw, i) => {
        const div = document.createElement("div");
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:12px 15px; border-bottom:1px solid #e5e5ea;";
        div.innerHTML = `
          <span style="font-size:16px;">${kw}</span>
          <button data-idx="${i + 1}" style="width:30px; height:30px; background:#ff3b30; color:#fff; border:none; border-radius:50%; font-size:14px;">−</button>
        `;
        div.querySelector("button").onclick = (e) => {
          e.stopPropagation();
          keywords.splice(parseInt(e.target.dataset.idx), 1);
          render();
        };
        frag.appendChild(div);
      });
      list.appendChild(frag);

      modal.querySelector("#done-btn").onclick = () => {
        saveKeywords(keywords);
        modal.remove();
        onClose?.();
      };

      modal.querySelector("#add-btn").onclick = () => {
        const input = modal.querySelector("#new-kw");
        const val = input.value.trim();
        if (val && !keywords.includes(val)) {
          keywords.push(val);
          input.value = "";
          render();
        }
      };

      modal.querySelector("#reset-btn").onclick = () => {
        if (confirm("キーワードを初期状態に戻しますか？")) {
          keywords = [...DEFAULT_KEYWORDS];
          render();
        }
      };
    };

    render();
    document.body.appendChild(modal);
  }

  // 検索結果モーダル
  function showResults(items) {
    if (document.getElementById("sp-results-modal")) return;

    let sortDescending = true;

    const modal = document.createElement("div");
    modal.id = "sp-results-modal";
    modal.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%; background:#fff;
      z-index:100000; display:flex; flex-direction:column; font-family:-apple-system,sans-serif;
    `;

    const header = document.createElement("div");
    header.style.cssText = "background:#f8f9fa; border-bottom:1px solid #ddd; padding:15px 15px 10px; padding-top:50px;";

    const renderHeader = () => {
      const keywords = loadKeywords();
      const valid = keywords.filter(k => k === "指定なし" || items.some(i => i.title.toLowerCase().includes(k.toLowerCase())));
      const options = valid.map(k => `<option value="${k}">${k}</option>`).join("");

      header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="margin:0; font-size:16px;">商品検索 (${items.length}件)</h3>
          <button id="close-btn" style="padding:6px 12px; border:1px solid #ccc; background:#fff; border-radius:4px;">閉じる</button>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <div style="flex:1; position:relative;">
            <select id="select-kw" style="width:100%; padding:10px; font-size:16px; border:1px solid #ccc; border-radius:8px; background:#fff; appearance:none;">${options}</select>
            <span style="position:absolute; right:10px; top:50%; transform:translateY(-50%); pointer-events:none; color:#888;">▼</span>
          </div>
          <button id="config-btn" style="width:44px; height:44px; border:1px solid #ccc; background:#fff; border-radius:8px; font-size:20px;">⚙️</button>
        </div>
        <div style="display:flex; gap:8px;">
          <input id="text-search" type="text" placeholder="追加キーワード (例: 2024)" style="flex:1; padding:10px; font-size:16px; border:2px solid #2ccce4; border-radius:8px;">
          <button id="sort-btn" style="padding:0 14px; border:2px solid #2ccce4; background:#fff; color:#2ccce4; border-radius:8px; font-weight:bold;">新着順</button>
        </div>
        <div style="text-align:right; margin-top:8px;">
          <button id="refresh-btn" style="font-size:13px; color:#2ccce4; background:none; border:none;">データを再取得</button>
        </div>
      `;
    };

    const listContainer = document.createElement("div");
    listContainer.style.cssText = "flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch;";

    const renderList = () => {
      const selectVal = header.querySelector("#select-kw").value;
      const inputVal = header.querySelector("#text-search").value.trim();
      const extraKeywords = inputVal.toLowerCase().split(/\s+/).filter(Boolean);

      let filtered = items.filter(item => {
        const title = item.title.toLowerCase();
        if (selectVal !== "指定なし" && !title.includes(selectVal.toLowerCase())) return false;
        return extraKeywords.every(k => title.includes(k));
      });

      filtered.sort((a, b) => sortDescending ? (b.orderId - a.orderId) : (a.orderId - b.orderId));

      listContainer.innerHTML = "";
      if (filtered.length === 0) {
        listContainer.innerHTML = '<div style="padding:60px 20px; text-align:center; color:#888; font-size:15px;">該当する商品がありません</div>';
        return;
      }

      const frag = document.createDocumentFragment();
      filtered.forEach(item => {
        const a = document.createElement("a");
        a.href = item.link;
        a.style.cssText = "display:flex; padding:12px 15px; border-bottom:1px solid #eee; text-decoration:none; color:inherit;";
        a.innerHTML = `
          <div style="width:60px; height:60px; background:#f0f0f0; border-radius:8px; margin-right:15px; overflow:hidden; flex-shrink:0;">
            <div style="width:100%; height:100%; background:#ddd;"></div>
          </div>
          <div style="flex:1;">
            <div style="font-weight:600; font-size:14px; line-height:1.4; margin-bottom:4px; color:#333;">${item.title}</div>
            <div style="font-size:12px; color:#2ccce4;">開く →</div>
          </div>
        `;
        frag.appendChild(a);
      });
      listContainer.appendChild(frag);
    };

    renderHeader();
    modal.appendChild(header);
    modal.appendChild(listContainer);
    renderList();

    // イベントバインディング
    const bindEvents = () => {
      header.querySelector("#text-search").addEventListener("input", renderList);
      header.querySelector("#select-kw").addEventListener("change", renderList);
      header.querySelector("#close-btn").addEventListener("click", () => modal.remove());
      header.querySelector("#sort-btn").addEventListener("click", () => {
        sortDescending = !sortDescending;
        header.querySelector("#sort-btn").textContent = sortDescending ? "新着順" : "古い順";
        renderList();
      });
      header.querySelector("#refresh-btn").addEventListener("click", () => {
        if (confirm("最新データを再取得しますか？")) {
          modal.remove();
          localStorage.removeItem(STORAGE_KEY_DATA);
          cachedItems = null;
          startCrawling();
        }
      });
      header.querySelector("#config-btn").addEventListener("click", () => {
        openSettingsModal(() => {
          renderHeader();
          bindEvents();
          renderList();
        });
      });
    };
    bindEvents();

    document.body.appendChild(modal);
  }

  // 初期化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createFloatingButton);
  } else {
    createFloatingButton();
  }
})();