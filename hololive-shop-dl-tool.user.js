// ==UserScript==
// @name         ホロライブ公式ショップ：ライブラリ内検索＋一括DL
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  UI/UXブラッシュアップ
// @author       demupe3
// @match        https://shop.hololivepro.com/apps/downloads*
// @grant        GM_download
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ====================== 定数・デザインシステム ======================
  const DEFAULT_KEYWORDS = [
    "指定なし", "ASMR", "記念ボイス", "録り下ろし",
    "ときのそら", "ロボ子さん", "さくらみこ", "星街すいせい", "AZKi",
    "白上フブキ", "夏色まつり", "赤井はあと", "アキ・ローゼンタール",
    "湊あくあ", "紫咲シオン", "百鬼あやめ", "癒月ちょこ", "大空スバル",
    "大神ミオ", "猫又おかゆ", "戌神ころね", "兎田ぺこら", "不知火フレア",
    "白銀ノエル", "宝鐘マリン", "天音かなた", "角巻わため", "常闇トワ",
    "姫森ルーナ", "雪花ラミィ", "桃鈴ねね", "獅白ぼたん", "尾丸ポルカ",
    "ラプラス・ダークネス", "鷹嶺ルイ", "博衣こより", "沙花叉クロヱ",
    "風真いろは", "火威青", "音乃瀬奏", "一条莉々華", "儒烏風亭らでん",
    "轟はじめ", "響咲リオナ", "虎金妃笑虎", "水宮枢", "輪堂千速", "綺々羅々ヴィヴィ"
  ];

  const STORAGE_KEY_DATA = "holo_shop_library_data_v2";
  const STORAGE_KEY_CONFIG = "holo_shop_keyword_config_v2";
  const STORAGE_KEY_HISTORY = "holo_shop_download_history_v2";

  // ブランドカラー（ホロライブ公式に寄せた上品な配色）
  const COLORS = {
    primary: "#2ccce4",   // 検索・メイン
    accent: "#e42c64",    // 一括DL・強調
    bg: "#ffffff",
    surface: "#f8f9fa",
    text: "#1f2937",
    muted: "#64748b"
  };

  // ====================== キャッシュ ======================
  let cachedData = null;
  let cachedKeywords = null;

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
    const currentUrl = window.location.href;
    const urlMatch = currentUrl.match(/\/orders\/(\d+)(?:\?logged_in_customer_id=(\d+))?/);
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
      const maxOrderId = data.length ? Math.max(...data.map(i => i.orderId || 0)) : 0;
      data = { items: data, timestamp: Date.now(), maxOrderId };
      localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(data));
    } else if (data.items && typeof data.maxOrderId === "undefined") {
      data.maxOrderId = data.items.length ? Math.max(...data.items.map(i => i.orderId || 0)) : 0;
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
    const maxOrderId = Math.max(...items.map(i => i.orderId || 0));
    cachedData = { items, timestamp: Date.now(), maxOrderId };
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(cachedData));
  }

  function getItems() { return loadData()?.items || []; }
  function getLastUpdated() { return loadData()?.timestamp || 0; }

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
    const safe = filename.replace(/[\/\\]/g, '／');
    const hist = getDownloadHistory();
    if (!hist.includes(safe)) {
      hist.push(safe);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(hist));
    }
  }

  function clearDownloadHistory() {
    if (confirm("ダウンロード履歴をすべてクリアしますか？")) {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      alert("✅ 履歴をクリアしました");
    }
  }

  // ====================== 新着通知（洗練されたトースト） ======================
  function showNewItemsNotification() {
    const existing = document.getElementById("sp-new-toast");
    if (existing) existing.remove();

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
      <button id="sp-update-now" style="background:white; color:#e42c64; border:none; border-radius:9999px; padding:8px 20px; font-weight:700; font-size:14px; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,0.1);">今すぐ更新</button>
      <button id="sp-toast-close" style="background:none; border:none; color:white; font-size:26px; line-height:1; padding:0 6px; opacity:0.8;">×</button>
    `;

    document.body.appendChild(toast);

    toast.querySelector("#sp-update-now").onclick = () => {
      toast.style.transition = "all 0.3s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(20px)";
      setTimeout(() => {
        toast.remove();
        localStorage.removeItem(STORAGE_KEY_DATA);
        cachedData = null;
        startCrawling();
      }, 300);
    };

    toast.querySelector("#sp-toast-close").onclick = () => {
      toast.style.transition = "all 0.3s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(20px)";
      setTimeout(() => toast.remove(), 300);
    };

    // 自動消滅
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.transition = "all 0.3s ease";
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
        setTimeout(() => toast.remove(), 300);
      }
    }, 14000);
  }

  // ====================== 浮動ボタン（最高峰のFABデザイン） ======================
  function createFloatingButton() {
    if (document.getElementById("sp-tool-container")) return;

    const isDetailPage = !!document.querySelector(".skypilot-track-container");
    const items = getItems();
    const hasData = items.length > 0;

    const bottomPos = isDetailPage ? "108px" : "24px";

    const btn = document.createElement("div");
    btn.id = "sp-tool-container";
    btn.style.cssText = `
      position:fixed; bottom:${bottomPos}; right:24px; z-index:99999;
      width:72px; height:72px; border-radius:50%;
      background:linear-gradient(145deg, ${isDetailPage ? COLORS.accent : COLORS.primary}, ${isDetailPage ? "#c81e52" : "#1eb8d0"});
      box-shadow:0 8px 28px -4px ${isDetailPage ? "rgba(228,44,100,0.5)" : "rgba(44,204,228,0.5)"};
      display:flex; flex-direction:column; justify-content:center; align-items:center;
      color:white; font-family:-apple-system,system-ui,sans-serif; cursor:pointer;
      user-select:none; transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);
      overflow:hidden;
    `;

    btn.innerHTML = `
      <div style="font-size:36px; transition:transform 0.4s cubic-bezier(0.34,1.56,0.64,1);">${isDetailPage ? '⬇️' : (hasData ? '🔎' : '📦')}</div>
      <div style="font-size:11px; font-weight:700; margin-top:3px; letter-spacing:0.5px; line-height:1;">
        ${isDetailPage ? '一括DL' : (hasData ? `検索 (${items.length})` : '取得')}
      </div>
    `;

    // ホバー・アクティブ演出
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.12) translateY(-2px)";
      btn.querySelector("div:first-child").style.transform = "scale(1.15)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1) translateY(0)";
      btn.querySelector("div:first-child").style.transform = "scale(1)";
    });
    btn.addEventListener("mousedown", () => btn.style.transform = "scale(0.92)");

    btn.onclick = () => {
      if (isDetailPage) openBulkDownloadModal();
      else if (hasData) showSearchModalInLibrary(items);
      else if (confirm("📥 購入データをすべて読み込みますか？\n（通常1〜2分で完了）")) startCrawling();
    };

    document.body.appendChild(btn);

    if (!isDetailPage && hasData) setTimeout(checkForNewItems, 900);
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
        headers: { Accept: "text/html", "X-Requested-With": "XMLHttpRequest" }
      });
      if (!res.ok) return;

      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const pageItems = extractItems(doc);
      if (!pageItems.length) return;

      const currentMax = Math.max(...pageItems.map(i => i.orderId || 0));
      if (currentMax > cached.maxOrderId) showNewItemsNotification();
    } catch (e) {}
  }

  // ====================== 共通検索UI（モダンカードデザイン） ======================
  function createSearchUI(items, isInline = false) {
    const modalId = isInline ? "sp-results-modal" : "sp-full-modal";
    if (document.getElementById(modalId)) return;

    let sortDescending = true;
    const modal = document.createElement("div");
    modal.id = modalId;

    if (isInline) {
      modal.style.cssText = `margin:24px 0; background:${COLORS.bg}; border-radius:24px; box-shadow:0 12px 40px -8px rgba(0,0,0,0.18); overflow:hidden; font-family:-apple-system,system-ui,sans-serif;`;
      const container = document.querySelector(".sky-pilot-files-list");
      if (container) container.parentNode.insertBefore(modal, container);
    } else {
      modal.style.cssText = `position:fixed; inset:0; background:rgba(15,23,42,0.92); backdrop-filter:blur(12px); z-index:100001; display:flex; flex-direction:column; font-family:-apple-system,system-ui,sans-serif;`;
      document.body.appendChild(modal);
    }

    const header = document.createElement("div");
    const listContainer = document.createElement("div");

    const renderHeader = () => {
      const keywords = loadKeywords();
      const valid = keywords.filter(k => k === "指定なし" || items.some(i => i.title.toLowerCase().includes(k.toLowerCase())));
      const options = valid.map(k => `<option value="${k}">${k}</option>`).join("");
      const timeAgo = getTimeAgo(getLastUpdated());

      header.style.cssText = isInline
        ? `background:${COLORS.surface}; padding:20px 20px 16px; border-bottom:1px solid #e2e8f0;`
        : `background:${COLORS.surface}; padding:20px; padding-top:60px; border-bottom:1px solid #e2e8f0;`;

      header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="margin:0; font-size:19px; font-weight:700; color:${COLORS.text};">商品検索 <span style="font-size:15px; font-weight:500; color:${COLORS.muted};">(${items.length}件)</span></h3>
          <button id="sp-close-btn" style="background:none; border:none; font-size:28px; color:${COLORS.muted}; cursor:pointer; padding:0 8px;">×</button>
        </div>
        <div style="display:flex; gap:12px;">
          <div style="flex:1; position:relative;">
            <select id="sp-select" style="width:100%; padding:14px 16px; font-size:16px; border:1px solid #cbd5e1; border-radius:16px; background:white; appearance:none; box-shadow:0 1px 3px rgba(0,0,0,0.05);">${options}</select>
            <span style="position:absolute; right:16px; top:50%; transform:translateY(-50%); pointer-events:none; color:#94a3b8;">▼</span>
          </div>
          <button id="sp-config-btn" style="width:52px; height:52px; background:white; border:1px solid #cbd5e1; border-radius:16px; font-size:24px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">⚙️</button>
        </div>
        <div style="display:flex; gap:12px; margin-top:14px;">
          <input id="sp-text" type="text" placeholder="追加キーワードで絞り込み" style="flex:1; padding:14px 16px; font-size:16px; border:2px solid ${COLORS.primary}; border-radius:16px; outline:none;">
          <button id="sp-sort-btn" style="padding:0 24px; background:white; border:2px solid ${COLORS.primary}; color:${COLORS.primary}; border-radius:9999px; font-weight:700; white-space:nowrap;">${sortDescending ? "新着順" : "古い順"}</button>
          ${isInline ? `<button id="sp-refresh-btn" style="padding:0 24px; background:${COLORS.primary}; color:white; border:none; border-radius:9999px; font-weight:700;">更新</button>` : ''}
        </div>
        <div style="margin-top:12px; text-align:right; font-size:12.5px; color:${COLORS.muted};">最終更新: ${timeAgo}</div>
      `;

      header.querySelector("#sp-close-btn").onclick = () => modal.remove();
      header.querySelector("#sp-text").addEventListener("input", renderList);
      header.querySelector("#sp-select").addEventListener("change", renderList);
      header.querySelector("#sp-sort-btn").onclick = () => {
        sortDescending = !sortDescending;
        header.querySelector("#sp-sort-btn").textContent = sortDescending ? "新着順" : "古い順";
        renderList();
      };
      if (isInline) {
        header.querySelector("#sp-refresh-btn").onclick = () => {
          if (confirm("最新データを再取得しますか？")) {
            modal.remove();
            localStorage.removeItem(STORAGE_KEY_DATA);
            cachedData = null;
            startCrawling();
          }
        };
      }
      header.querySelector("#sp-config-btn").onclick = () => openKeywordSettings(() => { renderHeader(); renderList(); });
    };

    const renderList = () => {
      const selectVal = header.querySelector("#sp-select")?.value || "指定なし";
      const extra = (header.querySelector("#sp-text")?.value || "").toLowerCase().trim().split(/\s+/).filter(Boolean);

      let filtered = items.filter(item => {
        const t = item.title.toLowerCase();
        if (selectVal !== "指定なし" && !t.includes(selectVal.toLowerCase())) return false;
        return extra.every(k => t.includes(k));
      });

      filtered.sort((a, b) => sortDescending ? (b.orderId - a.orderId) : (a.orderId - b.orderId));

      listContainer.innerHTML = filtered.length === 0
        ? `<div style="padding:100px 20px; text-align:center; color:${COLORS.muted}; font-size:16px;">該当商品が見つかりません</div>`
        : "";

      if (filtered.length === 0) return;

      const frag = document.createDocumentFragment();
      filtered.forEach(item => {
        const card = document.createElement("a");
        card.href = item.link;
        card.style.cssText = isInline
          ? `display:flex; padding:18px 20px; border-bottom:1px solid #f1f5f9; text-decoration:none; color:inherit; transition:all 0.2s;`
          : `display:flex; padding:18px 24px; border-bottom:1px solid #f1f5f9; text-decoration:none; color:inherit; transition:all 0.2s;`;
        card.innerHTML = `
          <div style="width:68px; height:68px; background:#f1f5f9; border-radius:16px; margin-right:20px; flex-shrink:0; overflow:hidden; box-shadow:inset 0 1px 3px rgba(0,0,0,0.1);">
            ${item.imgSrc ? `<img src="${item.imgSrc}" style="width:100%; height:100%; object-fit:cover;" loading="lazy" onerror="this.style.display='none';">` : ''}
          </div>
          <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
            <div style="font-weight:700; font-size:16px; line-height:1.45; color:${COLORS.text};">${item.title}</div>
            <div style="margin-top:8px; font-size:13.5px; color:${COLORS.primary}; font-weight:600;">開く →</div>
          </div>
        `;
        card.addEventListener("mouseenter", () => card.style.background = "#f8fafc");
        card.addEventListener("mouseleave", () => card.style.background = "");
        frag.appendChild(card);
      });
      listContainer.appendChild(frag);
    };

    listContainer.style.cssText = isInline
      ? `max-height:68vh; overflow-y:auto; padding:0 4px; -webkit-overflow-scrolling:touch;`
      : `flex:1; overflow-y:auto; padding:0 4px; -webkit-overflow-scrolling:touch;`;

    renderHeader();
    modal.append(header, listContainer);
    renderList();
  }

  function showSearchModalInLibrary(items) {
    createSearchUI(items, true);
  }

  function showSearchModal(items) {
    createSearchUI(items, false);
  }

  // ====================== クローリング ======================
  async function startCrawling() {
    const container = document.getElementById("sp-tool-container");
    if (!container) return;
    const statusEl = container.querySelector("div:last-child");
    container.style.opacity = "0.6";
    statusEl.textContent = "読み込み中…";

    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      alert("ページ構造を認識できません。\n\nライブラリページ（/apps/downloads*）に移動してから再度お試しください。");
      container.style.opacity = "1";
      statusEl.textContent = "取得";
      return;
    }

    let allItems = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      const pageUrl = `${baseUrl}&line_items_page=${page}`;
      statusEl.textContent = `P.${page} 取得中…`;

      try {
        const res = await fetch(pageUrl, {
          credentials: "include",
          headers: { Accept: "text/html", "X-Requested-With": "XMLHttpRequest" }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const items = extractItems(doc);

        if (items.length === 0) {
          const nextLink = doc.querySelector(".sky-pilot-pagination .next a");
          if (!nextLink) {
            hasNext = false;
          } else {
            await new Promise(r => setTimeout(r, 400));
            const nextRes = await fetch(nextLink.href, { credentials: "include" });
            if (!nextRes.ok) break;
            const nextDoc = new DOMParser().parseFromString(await nextRes.text(), "text/html");
            const nextItems = extractItems(nextDoc);
            if (nextItems.length === 0) break;
            allItems.push(...nextItems);
            hasNext = false;
          }
        } else {
          allItems.push(...items);
          page++;
          await new Promise(r => setTimeout(r, 450));
        }
      } catch (e) {
        console.error("Crawling error:", e);
        if (confirm("取得中にエラーが発生しました。再試行しますか？")) continue;
        break;
      }
    }

    if (allItems.length === 0) {
      alert("商品が検出されませんでした。\nログイン状態やページ構造を確認してください。");
      container.style.opacity = "1";
      statusEl.textContent = "エラー";
      return;
    }

    saveData(allItems);
    container.style.opacity = "1";
    statusEl.textContent = "検索";
    container.querySelector("div:first-child").textContent = "🔍";

    alert(`✅ 取得完了！\n合計 ${allItems.length} 件\n最終更新: ${getTimeAgo(Date.now())}`);
    showSearchModal(allItems);
  }

  function extractItems(doc) {
    const items = [];
    doc.querySelectorAll("a.sky-pilot-list-item").forEach(el => {
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
    const tracks = document.querySelectorAll(".skypilot-track-container .track");
    if (tracks.length === 0) {
      alert("このページにはダウンロード可能なオーディオファイルがありません。\n\n壁紙・PDFなどはページ下部のファイル名を直接クリックして保存してください。");
      return;
    }

    const allFiles = [];

    for (const track of tracks) {
      const actionIcon = track.querySelector(".action-icon");
      if (!actionIcon) continue;

      const baseName = (track.querySelector(".track-name a, .track-name span")?.innerText || "track")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "_");

      actionIcon.click();
      await new Promise(r => setTimeout(r, 280));

      const menu = document.querySelector('ul.rc-menu[data-menu-list="true"]');
      if (menu) {
        menu.querySelectorAll("a.menu-type").forEach(a => {
          const url = a.href;
          const text = a.innerText.trim();
          let ext = null;
          if (text.includes("MP3")) ext = "mp3";
          else if (text.includes("WAV")) ext = "wav";
          else if (text.includes("ZIP")) ext = "zip";
          else if (text.includes("PDF")) ext = "pdf";

          if (ext && url.startsWith("http")) {
            const filename = `${baseName}.${ext}`;
            const safeName = filename.replace(/[\/\\]/g, '／');
            allFiles.push({
              url,
              filename,
              ext,
              downloaded: getDownloadHistory().includes(safeName)
            });
          }
        });
        document.body.click();
      }
    }

    if (allFiles.length === 0) {
      alert("ダウンロード可能なファイルが見つかりませんでした。\n壁紙・PDFなどは手動保存してください。");
      return;
    }

    const uniqueFiles = [];
    const seen = new Set();
    allFiles.forEach(f => {
      const key = `${f.url}|${f.filename}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFiles.push(f);
      }
    });

    const extensions = [...new Set(uniqueFiles.map(f => f.ext))].sort();
    const downloadedCount = uniqueFiles.filter(f => f.downloaded).length;

    const modal = document.createElement("div");
    modal.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:100002; display:flex; align-items:center; justify-content:center; font-family:-apple-system,system-ui,sans-serif;`;
    modal.innerHTML = `
      <div style="background:white; border-radius:16px; width:90%; max-width:420px; max-height:90vh; overflow-y:auto; padding:24px;">
        <h3 style="margin:0 0 16px; font-size:19px; font-weight:600; text-align:center;">一括ダウンロード</h3>
        <div style="background:#f0f8ff; padding:12px; border-radius:8px; margin-bottom:16px; font-size:14px; line-height:1.5;">
          <strong>※ 壁紙・PDF・特典画像</strong><br>
          ページ下部のファイル名を直接タップ／クリックして保存してください（自動取得不可）
        </div>
        <div style="margin-bottom:20px;">
          ${extensions.map(ext => {
            const count = uniqueFiles.filter(f => f.ext === ext).length;
            return `<label style="display:flex; align-items:center; margin:10px 0;">
              <input type="checkbox" class="ext-cb" value="${ext}" checked style="width:22px;height:22px;margin-right:12px;">
              <span style="font-weight:600;">.${ext.toUpperCase()}</span>
              <span style="color:#666; margin-left:6px;">(${count}個)</span>
            </label>`;
          }).join("")}
        </div>
        <label style="display:flex; align-items:center; margin:20px 0; font-size:15px;">
          <input type="checkbox" id="skip-dl" ${downloadedCount > 0 ? "checked" : ""} style="width:20px;height:20px;margin-right:12px;">
          <span>ダウンロード済みを除外</span>
          <span style="color:#888; font-size:13px; margin-left:8px;">（${downloadedCount}個）</span>
        </label>
        <div style="display:flex; gap:16px; margin-top:24px;">
          <button id="cancel-btn" style="flex:1; padding:14px; background:#f0f0f0; border-radius:12px; font-weight:600;">キャンセル</button>
          <button id="start-btn" style="flex:1; padding:14px; background:#e42c64; color:white; border-radius:12px; font-weight:600;">開始（${uniqueFiles.length}ファイル）</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#cancel-btn").onclick = () => modal.remove();
    modal.querySelector("#start-btn").onclick = () => {
      const selected = [...modal.querySelectorAll(".ext-cb:checked")].map(c => c.value);
      const skip = modal.querySelector("#skip-dl").checked;
      const targets = uniqueFiles.filter(f => selected.includes(f.ext) && !(skip && f.downloaded));

      if (targets.length === 0) {
        alert("選択された条件で対象がありません");
        return;
      }
      modal.remove();
      startBulkDownload(targets);
    };
  }

  async function startBulkDownload(files) {
    if (!confirm(`${files.length}ファイルをダウンロードしますか？\n（1ファイルごとに約1.8秒間隔を空けます）`)) return;

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
            onerror: reject
          });
        });
        addToHistory(f.filename);
        success++;
      } catch (e) {
        console.error("DL失敗:", f.filename, e);
      }
      if (i < files.length - 1) await new Promise(r => setTimeout(r, 1800));
    }

    if (statusEl) statusEl.textContent = "完了";
    alert(`✅ ダウンロード完了！\n${success}/${files.length} 件`);
  }

  // ====================== キーワード設定 ======================
  function openKeywordSettings(onClose) {
    const modal = document.createElement("div");
    modal.style.cssText = `position:fixed; inset:0; background:#f2f2f7; z-index:100003; display:flex; flex-direction:column; font-family:-apple-system,system-ui,sans-serif;`;

    let keywords = loadKeywords();

    const render = () => {
      modal.innerHTML = `
        <div style="padding:15px 15px 10px; background:white; border-bottom:1px solid #c6c6c8; padding-top:50px; display:flex; justify-content:space-between; align-items:center;">
          <h2 style="margin:0; font-size:17px; font-weight:600;">キーワード設定</h2>
          <button id="done" style="font-size:17px; color:#007aff; background:none; border:none; font-weight:600;">完了</button>
        </div>
        <div style="padding:15px; background:white;">
          <div style="display:flex; gap:10px;">
            <input id="new-kw" type="text" placeholder="新しいキーワード" style="flex:1; padding:10px; border:1px solid #ccc; border-radius:8px; font-size:16px;">
            <button id="add" style="padding:0 16px; background:#007aff; color:white; border:none; border-radius:8px; font-weight:600;">追加</button>
          </div>
        </div>
        <div style="flex:1; overflow-y:auto; padding:15px 15px 80px; -webkit-overflow-scrolling:touch;">
          <div id="list" style="background:white; border-radius:10px; overflow:hidden;"></div>
        </div>
        <div style="padding:20px; text-align:center; background:white; border-top:1px solid #ddd; display:flex; gap:12px; justify-content:center;">
          <button id="reset" style="color:#ff3b30; background:none; border:none; font-size:15px;">初期設定に戻す</button>
          <button id="clear-history" style="color:#666; background:none; border:none; font-size:15px;">履歴クリア</button>
        </div>
      `;

      const listEl = modal.querySelector("#list");
      listEl.innerHTML = "";
      const frag = document.createDocumentFragment();

      keywords.slice(1).forEach((kw, i) => {
        const div = document.createElement("div");
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:1px solid #e5e5ea;";
        div.innerHTML = `
          <span style="font-size:16px;">${kw}</span>
          <button data-idx="${i + 1}" style="width:32px; height:32px; background:#ff3b30; color:white; border:none; border-radius:50%; font-size:14px;">−</button>
        `;
        div.querySelector("button").onclick = e => {
          e.stopPropagation();
          keywords.splice(parseInt(e.target.dataset.idx), 1);
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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createFloatingButton);
  } else {
    createFloatingButton();
  }
})();