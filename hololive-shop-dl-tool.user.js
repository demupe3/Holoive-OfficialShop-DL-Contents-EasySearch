// ==UserScript==
// @name         ホロライブ公式ショップ：ライブラリ内検索＋一括DL
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  UI/UXブラッシュアップ・更新後表示バグ修正
// @author       demupe3
// @match        https://shop.hololivepro.com/apps/downloads*
// @grant        GM_download
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ====================== 定数・デザインシステム ======================
  const DEFAULT_KEYWORDS = [
    "指定なし",
    "ASMR",
    "記念ボイス",
    "録り下ろし",
    "ときのそら",
    "ロボ子さん",
    "さくらみこ",
    "星街すいせい",
    "AZKi",
    "白上フブキ",
    "夏色まつり",
    "赤井はあと",
    "アキ・ローゼンタール",
    "湊あくあ",
    "紫咲シオン",
    "百鬼あやめ",
    "癒月ちょこ",
    "大空スバル",
    "大神ミオ",
    "猫又おかゆ",
    "戌神ころね",
    "兎田ぺこら",
    "不知火フレア",
    "白銀ノエル",
    "宝鐘マリン",
    "天音かなた",
    "角巻わため",
    "常闇トワ",
    "姫森ルーナ",
    "雪花ラミィ",
    "桃鈴ねね",
    "獅白ぼたん",
    "尾丸ポルカ",
    "ラプラス・ダークネス",
    "鷹嶺ルイ",
    "博衣こより",
    "沙花叉クロヱ",
    "風真いろは",
    "火威青",
    "音乃瀬奏",
    "一条莉々華",
    "儒烏風亭らでん",
    "轟はじめ",
    "響咲リオナ",
    "虎金妃笑虎",
    "水宮枢",
    "輪堂千速",
    "綺々羅々ヴィヴィ",
  ];

  const STORAGE_KEY_DATA = "holo_shop_library_data_v2";
  const STORAGE_KEY_CONFIG = "holo_shop_keyword_config_v2";
  const STORAGE_KEY_HISTORY = "holo_shop_download_history_v2";

  const MODAL_IDS = {
    inline: "sp-results-modal",
    dialog: "sp-dialog-modal",
    overlay: "sp-overlay-root",
  };

  const COLORS = {
    primary: "#2ccce4",
    accent: "#e42c64",
    bg: "#ffffff",
    surface: "#f8f9fa",
    text: "#1f2937",
    muted: "#64748b",
  };

  // ====================== キャッシュ ======================
  let cachedData = null;
  let cachedKeywords = null;

  // ====================== ページ判定・スタイル ======================
  function isDetailPage() {
    return !!document.querySelector(".skypilot-track-container");
  }

  function isLibraryPage() {
    return !!document.querySelector(".sky-pilot-files-list");
  }

  function getSearchUIMode() {
    return isLibraryPage() ? "inline" : "dialog";
  }

  function injectStyles() {
    if (document.getElementById("sp-tool-styles")) return;
    const style = document.createElement("style");
    style.id = "sp-tool-styles";
    style.textContent = `
      @keyframes spToastPop {
        from { opacity: 0; transform: translateY(16px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes spModalIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes spFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      #sp-results-modal { animation: spModalIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
      #sp-dialog-modal { animation: spFadeIn 0.25s ease; }
      #sp-dialog-modal .sp-dialog-panel { animation: spModalIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
      .sp-search-card:hover { background: #f8fafc !important; }
      #sp-tool-container.sp-crawling { pointer-events: none; }
    `;
    document.head.appendChild(style);
  }

  function removeSearchModals() {
    Object.values(MODAL_IDS).forEach((id) => {
      if (id === MODAL_IDS.overlay) return;
      document.getElementById(id)?.remove();
    });
  }

  // ====================== ヘルパー ======================
  function getTimeAgo(timestamp) {
    if (!timestamp) return "不明";
    const diffMs = Date.now() - timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "たった今";
    if (diffMin < 60) return `${diffMin}分前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}時間前`;
    return `${Math.floor(diffHr / 24)}日前`;
  }

  function getBaseUrl() {
    const urlMatch = window.location.href.match(
      /\/orders\/(\d+)(?:\?logged_in_customer_id=(\d+))?/,
    );
    if (!urlMatch) return null;
    const orderId = urlMatch[1];
    const customerId = urlMatch[2] || orderId;
    return `https://shop.hololivepro.com/apps/downloads/orders/${orderId}?logged_in_customer_id=${customerId}`;
  }

  function loadData() {
    if (cachedData !== null) return cachedData;
    const saved = localStorage.getItem(STORAGE_KEY_DATA);
    if (!saved) return null;

    let data = JSON.parse(saved);
    if (Array.isArray(data)) {
      const maxOrderId = data.length
        ? Math.max(...data.map((i) => i.orderId || 0))
        : 0;
      data = { items: data, timestamp: Date.now(), maxOrderId };
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(data));
    } else if (data.items && typeof data.maxOrderId === "undefined") {
      data.maxOrderId = data.items.length
        ? Math.max(...data.items.map((i) => i.orderId || 0))
        : 0;
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(data));
    }
    cachedData = data;
    return cachedData;
  }

  function saveData(items) {
    if (!items?.length) {
      cachedData = null;
      localStorage.removeItem(STORAGE_KEY_DATA);
      return;
    }
    const maxOrderId = Math.max(...items.map((i) => i.orderId || 0));
    cachedData = { items, timestamp: Date.now(), maxOrderId };
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(cachedData));
  }

  function getItems() {
    return loadData()?.items || [];
  }
  function getLastUpdated() {
    return loadData()?.timestamp || 0;
  }

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

  function getDownloadHistory() {
    const saved = localStorage.getItem(STORAGE_KEY_HISTORY);
    return saved ? JSON.parse(saved) : [];
  }

  function addToHistory(filename) {
    const safe = filename.replace(/[\/\\]/g, "／");
    const hist = getDownloadHistory();
    if (!hist.includes(safe)) {
      hist.push(safe);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(hist));
    }
  }

  function clearDownloadHistory() {
    if (confirm("ダウンロード履歴をすべてクリアしますか？")) {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      showToast("履歴をクリアしました", "success");
    }
  }

  // ====================== トースト通知 ======================
  function showToast(message, type = "info", duration = 5000) {
    document.getElementById("sp-new-toast")?.remove();

    const palette = {
      info: "linear-gradient(135deg, #ff9500, #e42c64)",
      success: "linear-gradient(135deg, #22c55e, #16a34a)",
      error: "linear-gradient(135deg, #ef4444, #dc2626)",
    };

    const toast = document.createElement("div");
    toast.id = "sp-new-toast";
    toast.style.cssText = `
      position:fixed; bottom:130px; right:20px; z-index:100000;
      background:${palette[type] || palette.info};
      color:white; padding:14px 18px; border-radius:16px;
      box-shadow:0 10px 30px -5px rgba(0,0,0,0.25);
      display:flex; align-items:center; gap:12px; max-width:320px;
      font-family:-apple-system,system-ui,sans-serif; font-size:14px; font-weight:600;
      animation:spToastPop 0.4s cubic-bezier(0.34,1.56,0.64,1);
    `;
    toast.innerHTML = `
      <span style="flex:1; line-height:1.45;">${message}</span>
      <button type="button" aria-label="閉じる" style="background:none; border:none; color:white; font-size:22px; line-height:1; padding:0 4px; opacity:0.85; cursor:pointer;">×</button>
    `;

    const dismiss = () => {
      toast.style.transition = "all 0.3s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(12px)";
      setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector("button").onclick = dismiss;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) dismiss();
    }, duration);
  }

  function showNewItemsNotification() {
    document.getElementById("sp-new-toast")?.remove();

    const toast = document.createElement("div");
    toast.id = "sp-new-toast";
    toast.style.cssText = `
      position:fixed; bottom:130px; right:20px; z-index:100000;
      background:linear-gradient(135deg, #ff9500, #e42c64);
      color:white; padding:16px 20px; border-radius:20px;
      box-shadow:0 10px 30px -5px rgba(228,44,100,0.4);
      display:flex; align-items:center; gap:14px; max-width:300px;
      font-family:-apple-system,system-ui,sans-serif; font-size:15px; font-weight:700;
      animation:spToastPop 0.4s cubic-bezier(0.34,1.56,0.64,1);
    `;
    toast.innerHTML = `
      <span style="font-size:24px;">🆕</span>
      <div style="flex:1; line-height:1.4;">新着商品が届きました！</div>
      <button id="sp-update-now" style="background:white; color:#e42c64; border:none; border-radius:9999px; padding:8px 20px; font-weight:700; font-size:14px; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,0.1); cursor:pointer;">今すぐ更新</button>
      <button id="sp-toast-close" style="background:none; border:none; color:white; font-size:26px; line-height:1; padding:0 6px; opacity:0.8; cursor:pointer;">×</button>
    `;

    document.body.appendChild(toast);

    const dismiss = () => {
      toast.style.transition = "all 0.3s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(20px)";
      setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector("#sp-update-now").onclick = () => {
      dismiss();
      removeSearchModals();
      localStorage.removeItem(STORAGE_KEY_DATA);
      cachedData = null;
      startCrawling();
    };
    toast.querySelector("#sp-toast-close").onclick = dismiss;
    setTimeout(() => {
      if (toast.parentNode) dismiss();
    }, 14000);
  }

  // ====================== 浮動ボタン ======================
  function updateFloatingButton() {
    const btn = document.getElementById("sp-tool-container");
    if (!btn || isDetailPage()) return;

    const items = getItems();
    const hasData = items.length > 0;
    btn.classList.remove("sp-crawling");
    btn.style.opacity = "1";
    btn.querySelector("div:first-child").textContent = hasData ? "🔎" : "📦";
    btn.querySelector("div:last-child").textContent = hasData
      ? `検索 (${items.length})`
      : "取得";
  }

  function setFabCrawling(active, text = "読み込み中…") {
    const btn = document.getElementById("sp-tool-container");
    if (!btn) return;
    const statusEl = btn.querySelector("div:last-child");
    btn.classList.toggle("sp-crawling", active);
    btn.style.opacity = active ? "0.65" : "1";
    if (statusEl) statusEl.textContent = text;
  }

  function createFloatingButton() {
    if (document.getElementById("sp-tool-container")) return;

    injectStyles();

    const detailPage = isDetailPage();
    const items = getItems();
    const hasData = items.length > 0;
    const bottomPos = detailPage ? "108px" : "24px";

    const btn = document.createElement("div");
    btn.id = "sp-tool-container";
    btn.setAttribute("role", "button");
    btn.setAttribute(
      "aria-label",
      detailPage ? "一括ダウンロード" : hasData ? "商品検索" : "データ取得",
    );
    btn.style.cssText = `
      position:fixed; bottom:${bottomPos}; right:24px; z-index:99999;
      width:72px; height:72px; border-radius:50%;
      background:linear-gradient(145deg, ${detailPage ? COLORS.accent : COLORS.primary}, ${detailPage ? "#c81e52" : "#1eb8d0"});
      box-shadow:0 8px 28px -4px ${detailPage ? "rgba(228,44,100,0.5)" : "rgba(44,204,228,0.5)"};
      display:flex; flex-direction:column; justify-content:center; align-items:center;
      color:white; font-family:-apple-system,system-ui,sans-serif; cursor:pointer;
      user-select:none; transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);
      overflow:hidden;
    `;

    btn.innerHTML = `
      <div style="font-size:36px; transition:transform 0.4s cubic-bezier(0.34,1.56,0.64,1);">${detailPage ? "⬇️" : hasData ? "🔎" : "📦"}</div>
      <div style="font-size:11px; font-weight:700; margin-top:3px; letter-spacing:0.5px; line-height:1;">
        ${detailPage ? "一括DL" : hasData ? `検索 (${items.length})` : "取得"}
      </div>
    `;

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.12) translateY(-2px)";
      btn.querySelector("div:first-child").style.transform = "scale(1.15)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1) translateY(0)";
      btn.querySelector("div:first-child").style.transform = "scale(1)";
    });
    btn.addEventListener("mousedown", () => {
      btn.style.transform = "scale(0.92)";
    });

    btn.onclick = () => {
      if (detailPage) openBulkDownloadModal();
      else if (getItems().length > 0) showSearchResults(getItems());
      else if (
        confirm("📥 購入データをすべて読み込みますか？\n（通常1〜2分で完了）")
      )
        startCrawling();
    };

    document.body.appendChild(btn);
    if (!detailPage && hasData) setTimeout(checkForNewItems, 900);
  }

  // ====================== 新着自動チェック ======================
  async function checkForNewItems() {
    const cached = loadData();
    if (!cached?.maxOrderId) return;

    const baseUrl = getBaseUrl();
    if (!baseUrl) return;

    try {
      const res = await fetch(`${baseUrl}&line_items_page=1`, {
        credentials: "include",
        headers: { Accept: "text/html", "X-Requested-With": "XMLHttpRequest" },
      });
      if (!res.ok) return;

      const doc = new DOMParser().parseFromString(
        await res.text(),
        "text/html",
      );
      const pageItems = extractItems(doc);
      if (!pageItems.length) return;

      const currentMax = Math.max(...pageItems.map((i) => i.orderId || 0));
      if (currentMax > cached.maxOrderId) showNewItemsNotification();
    } catch (_) {}
  }

  // ====================== 検索UI ======================
  function createSearchUI(items, mode = getSearchUIMode()) {
    const modalId = mode === "inline" ? MODAL_IDS.inline : MODAL_IDS.dialog;
    removeSearchModals();

    let sortDescending = true;
    const shell = document.createElement("div");
    shell.id = modalId;

    const panel = document.createElement("div");
    panel.className = mode === "dialog" ? "sp-dialog-panel" : "";

    if (mode === "inline") {
      shell.style.cssText = `
        margin:24px 0; background:${COLORS.bg}; border-radius:24px;
        box-shadow:0 12px 40px -8px rgba(0,0,0,0.18); overflow:hidden;
        font-family:-apple-system,system-ui,sans-serif;
      `;
      const container = document.querySelector(".sky-pilot-files-list");
      if (container) {
        container.parentNode.insertBefore(shell, container);
      } else {
        mode = "dialog";
        shell.id = MODAL_IDS.dialog;
      }
    }

    if (mode === "dialog") {
      shell.style.cssText = `
        position:fixed; inset:0; z-index:100001;
        background:rgba(15,23,42,0.45); backdrop-filter:blur(8px);
        display:flex; align-items:center; justify-content:center;
        padding:24px; font-family:-apple-system,system-ui,sans-serif;
      `;
      panel.style.cssText = `
        width:100%; max-width:720px; max-height:85vh;
        background:${COLORS.bg}; border-radius:24px;
        box-shadow:0 20px 50px -12px rgba(0,0,0,0.35);
        display:flex; flex-direction:column; overflow:hidden;
      `;
      shell.appendChild(panel);
      document.body.appendChild(shell);

      shell.addEventListener("click", (e) => {
        if (e.target === shell) closeModal();
      });
    }

    const root = mode === "dialog" ? panel : shell;
    const header = document.createElement("div");
    const listContainer = document.createElement("div");

    const closeModal = () => shell.remove();

    const renderHeader = () => {
      const keywords = loadKeywords();
      const valid = keywords.filter(
        (k) =>
          k === "指定なし" ||
          items.some((i) => i.title.toLowerCase().includes(k.toLowerCase())),
      );
      const options = valid
        .map((k) => `<option value="${k}">${k}</option>`)
        .join("");
      const timeAgo = getTimeAgo(getLastUpdated());
      const showRefresh = mode === "inline" || mode === "dialog";

      header.style.cssText = `background:${COLORS.surface}; padding:20px; ${mode === "dialog" ? "" : "padding-top:20px;"} border-bottom:1px solid #e2e8f0; flex-shrink:0;`;

      header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="margin:0; font-size:19px; font-weight:700; color:${COLORS.text};">
            商品検索 <span style="font-size:15px; font-weight:500; color:${COLORS.muted};">(${items.length}件)</span>
          </h3>
          <button type="button" id="sp-close-btn" aria-label="閉じる" style="background:${COLORS.surface}; border:1px solid #e2e8f0; border-radius:12px; font-size:15px; color:${COLORS.muted}; cursor:pointer; padding:8px 14px; font-weight:600;">閉じる</button>
        </div>
        <div style="display:flex; gap:12px;">
          <div style="flex:1; position:relative;">
            <select id="sp-select" style="width:100%; padding:14px 16px; font-size:16px; border:1px solid #cbd5e1; border-radius:16px; background:white; appearance:none; box-shadow:0 1px 3px rgba(0,0,0,0.05);">${options}</select>
            <span style="position:absolute; right:16px; top:50%; transform:translateY(-50%); pointer-events:none; color:#94a3b8;">▼</span>
          </div>
          <button type="button" id="sp-config-btn" aria-label="キーワード設定" style="width:52px; height:52px; background:white; border:1px solid #cbd5e1; border-radius:16px; font-size:24px; box-shadow:0 1px 3px rgba(0,0,0,0.05); cursor:pointer;">⚙️</button>
        </div>
        <div style="display:flex; gap:12px; margin-top:14px; flex-wrap:wrap;">
          <input id="sp-text" type="search" placeholder="追加キーワードで絞り込み" style="flex:1; min-width:180px; padding:14px 16px; font-size:16px; border:2px solid ${COLORS.primary}; border-radius:16px; outline:none;">
          <button type="button" id="sp-sort-btn" style="padding:0 24px; background:white; border:2px solid ${COLORS.primary}; color:${COLORS.primary}; border-radius:9999px; font-weight:700; white-space:nowrap; cursor:pointer;">${sortDescending ? "新着順" : "古い順"}</button>
          ${showRefresh ? `<button type="button" id="sp-refresh-btn" style="padding:0 24px; background:${COLORS.primary}; color:white; border:none; border-radius:9999px; font-weight:700; cursor:pointer;">更新</button>` : ""}
        </div>
        <div style="margin-top:12px; text-align:right; font-size:12.5px; color:${COLORS.muted};">最終更新: ${timeAgo}</div>
      `;

      header.querySelector("#sp-close-btn").onclick = closeModal;
      header.querySelector("#sp-text").addEventListener("input", renderList);
      header.querySelector("#sp-select").addEventListener("change", renderList);
      header.querySelector("#sp-sort-btn").onclick = () => {
        sortDescending = !sortDescending;
        header.querySelector("#sp-sort-btn").textContent = sortDescending
          ? "新着順"
          : "古い順";
        renderList();
      };

      const refreshBtn = header.querySelector("#sp-refresh-btn");
      if (refreshBtn) {
        refreshBtn.onclick = () => {
          if (confirm("最新データを再取得しますか？")) {
            closeModal();
            localStorage.removeItem(STORAGE_KEY_DATA);
            cachedData = null;
            startCrawling();
          }
        };
      }

      header.querySelector("#sp-config-btn").onclick = () => {
        openKeywordSettings(() => {
          renderHeader();
          renderList();
        });
      };
    };

    const renderList = () => {
      const selectVal = header.querySelector("#sp-select")?.value || "指定なし";
      const extra = (header.querySelector("#sp-text")?.value || "")
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      let filtered = items.filter((item) => {
        const t = item.title.toLowerCase();
        if (selectVal !== "指定なし" && !t.includes(selectVal.toLowerCase()))
          return false;
        return extra.every((k) => t.includes(k));
      });

      filtered.sort((a, b) =>
        sortDescending ? b.orderId - a.orderId : a.orderId - b.orderId,
      );

      listContainer.innerHTML = "";
      if (filtered.length === 0) {
        listContainer.innerHTML = `<div style="padding:80px 20px; text-align:center; color:${COLORS.muted}; font-size:16px;">該当商品が見つかりません</div>`;
        return;
      }

      const frag = document.createDocumentFragment();
      filtered.forEach((item) => {
        const card = document.createElement("a");
        card.href = item.link;
        card.className = "sp-search-card";
        card.style.cssText = `display:flex; padding:18px ${mode === "dialog" ? "24px" : "20px"}; border-bottom:1px solid #f1f5f9; text-decoration:none; color:inherit; transition:background 0.2s;`;
        card.innerHTML = `
          <div style="width:68px; height:68px; background:#f1f5f9; border-radius:16px; margin-right:20px; flex-shrink:0; overflow:hidden; box-shadow:inset 0 1px 3px rgba(0,0,0,0.1);">
            ${item.imgSrc ? `<img src="${item.imgSrc}" alt="" style="width:100%; height:100%; object-fit:cover;" loading="lazy" onerror="this.style.display='none';">` : ""}
          </div>
          <div style="flex:1; display:flex; flex-direction:column; justify-content:center; min-width:0;">
            <div style="font-weight:700; font-size:16px; line-height:1.45; color:${COLORS.text};">${item.title}</div>
            <div style="margin-top:8px; font-size:13.5px; color:${COLORS.primary}; font-weight:600;">開く →</div>
          </div>
        `;
        frag.appendChild(card);
      });
      listContainer.appendChild(frag);
    };

    listContainer.style.cssText =
      mode === "dialog"
        ? "flex:1; overflow-y:auto; padding:0 4px; -webkit-overflow-scrolling:touch;"
        : "max-height:68vh; overflow-y:auto; padding:0 4px; -webkit-overflow-scrolling:touch;";

    renderHeader();
    root.append(header, listContainer);
    renderList();

    if (mode === "inline") {
      requestAnimationFrame(() => {
        shell.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  function showSearchResults(items) {
    createSearchUI(items, getSearchUIMode());
  }

  // ====================== クローリング ======================
  async function startCrawling() {
    const container = document.getElementById("sp-tool-container");
    if (!container) return;

    setFabCrawling(true, "読み込み中…");

    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      showToast("ライブラリページで再度お試しください", "error");
      setFabCrawling(false);
      updateFloatingButton();
      return;
    }

    let allItems = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      const pageUrl = `${baseUrl}&line_items_page=${page}`;
      setFabCrawling(true, `P.${page} 取得中…`);

      try {
        const res = await fetch(pageUrl, {
          credentials: "include",
          headers: {
            Accept: "text/html",
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const pageItems = extractItems(doc);

        if (pageItems.length === 0) {
          const nextLink = doc.querySelector(".sky-pilot-pagination .next a");
          if (!nextLink) {
            hasNext = false;
          } else {
            await new Promise((r) => setTimeout(r, 400));
            const nextRes = await fetch(nextLink.href, {
              credentials: "include",
            });
            if (!nextRes.ok) break;
            const nextDoc = new DOMParser().parseFromString(
              await nextRes.text(),
              "text/html",
            );
            const nextItems = extractItems(nextDoc);
            if (nextItems.length === 0) break;
            allItems.push(...nextItems);
            hasNext = false;
          }
        } else {
          allItems.push(...pageItems);
          page++;
          await new Promise((r) => setTimeout(r, 450));
        }
      } catch (e) {
        console.error("Crawling error:", e);
        if (!confirm("取得中にエラーが発生しました。再試行しますか？")) break;
      }
    }

    if (allItems.length === 0) {
      showToast(
        "商品が検出されませんでした。ログイン状態を確認してください。",
        "error",
        7000,
      );
      setFabCrawling(false);
      updateFloatingButton();
      return;
    }

    saveData(allItems);
    updateFloatingButton();
    showToast(
      `取得完了！ 合計 ${allItems.length} 件（${getTimeAgo(Date.now())}）`,
      "success",
      6000,
    );
    showSearchResults(allItems);
  }

  function extractItems(doc) {
    const items = [];
    doc.querySelectorAll("a.sky-pilot-list-item").forEach((el) => {
      const titleEl = el.querySelector(".sky-pilot-file-heading");
      const title = titleEl?.innerText.trim() || "名称不明";
      const link = el.href;

      let imgSrc = "";
      const imgEl = el.querySelector("img.sky-pilot-product-thumbnail");
      if (imgEl) {
        imgSrc = imgEl.src || imgEl.getAttribute("data-src") || "";
        if (imgSrc && !imgSrc.startsWith("http")) {
          imgSrc = new URL(imgSrc, window.location.origin).href;
        }
      }

      const orderMatch = link.match(/\/orders\/(\d+)/);
      const orderId = orderMatch ? parseInt(orderMatch[1], 10) : 0;

      items.push({ title, link, imgSrc, orderId });
    });
    return items;
  }

  // ====================== 一括ダウンロード ======================
  async function openBulkDownloadModal() {
    const tracks = document.querySelectorAll(
      ".skypilot-track-container .track",
    );
    if (tracks.length === 0) {
      alert(
        "このページにはダウンロード可能なオーディオファイルがありません。\n\n壁紙・PDFなどはページ下部のファイル名を直接クリックして保存してください。",
      );
      return;
    }

    const allFiles = [];

    for (const track of tracks) {
      const actionIcon = track.querySelector(".action-icon");
      if (!actionIcon) continue;

      const baseName = (
        track.querySelector(".track-name a, .track-name span")?.innerText ||
        "track"
      )
        .trim()
        .replace(/[\\/:*?"<>|]/g, "_");

      actionIcon.click();
      await new Promise((r) => setTimeout(r, 280));

      const menu = document.querySelector('ul.rc-menu[data-menu-list="true"]');
      if (menu) {
        menu.querySelectorAll("a.menu-type").forEach((a) => {
          const url = a.href;
          const text = a.innerText.trim();
          let ext = null;
          if (text.includes("MP3")) ext = "mp3";
          else if (text.includes("WAV")) ext = "wav";
          else if (text.includes("ZIP")) ext = "zip";
          else if (text.includes("PDF")) ext = "pdf";

          if (ext && url.startsWith("http")) {
            const filename = `${baseName}.${ext}`;
            const safeName = filename.replace(/[\/\\]/g, "／");
            allFiles.push({
              url,
              filename,
              ext,
              downloaded: getDownloadHistory().includes(safeName),
            });
          }
        });
        document.body.click();
      }
    }

    if (allFiles.length === 0) {
      alert(
        "ダウンロード可能なファイルが見つかりませんでした。\n壁紙・PDFなどは手動保存してください。",
      );
      return;
    }

    const uniqueFiles = [];
    const seen = new Set();
    allFiles.forEach((f) => {
      const key = `${f.url}|${f.filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFiles.push(f);
      }
    });

    const extensions = [...new Set(uniqueFiles.map((f) => f.ext))].sort();
    const downloadedCount = uniqueFiles.filter((f) => f.downloaded).length;

    const modal = document.createElement("div");
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.55); backdrop-filter:blur(6px);
      z-index:100002; display:flex; align-items:center; justify-content:center;
      padding:20px; font-family:-apple-system,system-ui,sans-serif;
    `;
    modal.innerHTML = `
      <div style="background:white; border-radius:20px; width:100%; max-width:420px; max-height:90vh; overflow-y:auto; padding:24px; box-shadow:0 20px 50px -12px rgba(0,0,0,0.35);">
        <h3 style="margin:0 0 16px; font-size:19px; font-weight:600; text-align:center;">一括ダウンロード</h3>
        <div style="background:#f0f8ff; padding:12px; border-radius:12px; margin-bottom:16px; font-size:14px; line-height:1.5;">
          <strong>※ 壁紙・PDF・特典画像</strong><br>
          ページ下部のファイル名を直接タップ／クリックして保存してください（自動取得不可）
        </div>
        <div style="margin-bottom:20px;">
          ${extensions
            .map((ext) => {
              const count = uniqueFiles.filter((f) => f.ext === ext).length;
              return `<label style="display:flex; align-items:center; margin:10px 0; cursor:pointer;">
              <input type="checkbox" class="ext-cb" value="${ext}" checked style="width:22px;height:22px;margin-right:12px;">
              <span style="font-weight:600;">.${ext.toUpperCase()}</span>
              <span style="color:#666; margin-left:6px;">(${count}個)</span>
            </label>`;
            })
            .join("")}
        </div>
        <label style="display:flex; align-items:center; margin:20px 0; font-size:15px; cursor:pointer;">
          <input type="checkbox" id="skip-dl" ${downloadedCount > 0 ? "checked" : ""} style="width:20px;height:20px;margin-right:12px;">
          <span>ダウンロード済みを除外</span>
          <span style="color:#888; font-size:13px; margin-left:8px;">（${downloadedCount}個）</span>
        </label>
        <div style="display:flex; gap:16px; margin-top:24px;">
          <button type="button" id="cancel-btn" style="flex:1; padding:14px; background:#f0f0f0; border:none; border-radius:12px; font-weight:600; cursor:pointer;">キャンセル</button>
          <button type="button" id="start-btn" style="flex:1; padding:14px; background:#e42c64; color:white; border:none; border-radius:12px; font-weight:600; cursor:pointer;">開始（${uniqueFiles.length}ファイル）</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    modal.querySelector("#cancel-btn").onclick = () => modal.remove();
    modal.querySelector("#start-btn").onclick = () => {
      const selected = [...modal.querySelectorAll(".ext-cb:checked")].map(
        (c) => c.value,
      );
      const skip = modal.querySelector("#skip-dl").checked;
      const targets = uniqueFiles.filter(
        (f) => selected.includes(f.ext) && !(skip && f.downloaded),
      );

      if (targets.length === 0) {
        showToast("選択された条件で対象がありません", "error");
        return;
      }
      modal.remove();
      startBulkDownload(targets);
    };
  }

  async function startBulkDownload(files) {
    if (
      !confirm(
        `${files.length}ファイルをダウンロードしますか？\n（1ファイルごとに約1.8秒間隔を空けます）`,
      )
    )
      return;

    const container = document.getElementById("sp-tool-container");
    const statusEl = container?.querySelector("div:last-child");
    if (statusEl) statusEl.textContent = "DL中…";

    let success = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (statusEl) statusEl.textContent = `${i + 1}/${files.length}`;
      try {
        await new Promise((resolve, reject) => {
          GM_download({
            url: f.url,
            name: f.filename,
            onload: resolve,
            onerror: reject,
          });
        });
        addToHistory(f.filename);
        success++;
      } catch (e) {
        console.error("DL失敗:", f.filename, e);
      }
      if (i < files.length - 1) await new Promise((r) => setTimeout(r, 1800));
    }

    if (statusEl) statusEl.textContent = "完了";
    showToast(
      `ダウンロード完了！ ${success}/${files.length} 件`,
      "success",
      6000,
    );
    setTimeout(updateFloatingButton, 2500);
  }

  // ====================== キーワード設定 ======================
  function openKeywordSettings(onClose) {
    const modal = document.createElement("div");
    modal.style.cssText = `
      position:fixed; inset:0; background:#f2f2f7; z-index:100003;
      display:flex; flex-direction:column; font-family:-apple-system,system-ui,sans-serif;
    `;

    let keywords = loadKeywords();

    const render = () => {
      modal.innerHTML = `
        <div style="padding:15px 15px 10px; background:white; border-bottom:1px solid #c6c6c8; padding-top:50px; display:flex; justify-content:space-between; align-items:center;">
          <h2 style="margin:0; font-size:17px; font-weight:600;">キーワード設定</h2>
          <button type="button" id="done" style="font-size:17px; color:#007aff; background:none; border:none; font-weight:600; cursor:pointer;">完了</button>
        </div>
        <div style="padding:15px; background:white;">
          <div style="display:flex; gap:10px;">
            <input id="new-kw" type="text" placeholder="新しいキーワード" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:8px; font-size:16px;">
            <button type="button" id="add" style="padding:0 16px; background:#007aff; color:white; border:none; border-radius:8px; font-weight:600; cursor:pointer;">追加</button>
          </div>
        </div>
        <div style="flex:1; overflow-y:auto; padding:15px 15px 80px; -webkit-overflow-scrolling:touch;">
          <div id="list" style="background:white; border-radius:10px; overflow:hidden;"></div>
        </div>
        <div style="padding:20px; text-align:center; background:white; border-top:1px solid #ddd; display:flex; gap:12px; justify-content:center;">
          <button type="button" id="reset" style="color:#ff3b30; background:none; border:none; font-size:15px; cursor:pointer;">初期設定に戻す</button>
          <button type="button" id="clear-history" style="color:#666; background:none; border:none; font-size:15px; cursor:pointer;">履歴クリア</button>
        </div>
      `;

      const listEl = modal.querySelector("#list");
      listEl.innerHTML = "";
      const frag = document.createDocumentFragment();

      keywords.slice(1).forEach((kw, i) => {
        const div = document.createElement("div");
        div.style.cssText =
          "display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:1px solid #e5e5ea;";
        div.innerHTML = `
          <span style="font-size:16px;">${kw}</span>
          <button type="button" data-idx="${i + 1}" style="width:32px; height:32px; background:#ff3b30; color:white; border:none; border-radius:50%; font-size:14px; cursor:pointer;">−</button>
        `;
        div.querySelector("button").onclick = (e) => {
          e.stopPropagation();
          keywords.splice(parseInt(e.target.dataset.idx, 10), 1);
          render();
        };
        frag.appendChild(div);
      });
      listEl.appendChild(frag);

      modal.querySelector("#done").onclick = () => {
        saveKeywords(keywords);
        modal.remove();
        onClose?.();
      };

      modal.querySelector("#add").onclick = () => {
        const val = modal.querySelector("#new-kw").value.trim();
        if (val && !keywords.includes(val)) {
          keywords.push(val);
          modal.querySelector("#new-kw").value = "";
          render();
        }
      };

      modal.querySelector("#reset").onclick = () => {
        if (confirm("キーワードを初期状態に戻しますか？")) {
          keywords = [...DEFAULT_KEYWORDS];
          render();
        }
      };

      modal.querySelector("#clear-history").onclick = clearDownloadHistory;
    };

    render();
    document.body.appendChild(modal);
  }

  // ====================== 初期化 ======================
  injectStyles();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createFloatingButton);
  } else {
    createFloatingButton();
  }
})();
