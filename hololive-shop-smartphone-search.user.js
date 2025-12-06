// ==UserScript==
// @name         ホロライブ公式ショップ検索
// @namespace    http://ios.userscript/
// @version      1.1
// @description  スマホ用：購入済み商品の検索・ソート・設定機能付き
// @author       demupe3
// @match        https://shop.hololivepro.com/apps/downloads/*
// @grant        none
// @license MIT
// ==/UserScript==

(function () {
  "use strict";

  // ■ 初回起動時のデフォルトキーワード
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
    "アキ・ローゼンタール",
    "赤井はあと",
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

  const STORAGE_KEY_DATA = "holo_shop_ios_data";
  const STORAGE_KEY_CONFIG = "holo_shop_ios_config_v2";
  const SCAN_INTERVAL = 1000;

  function loadKeywords() {
    const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
    return saved ? JSON.parse(saved) : DEFAULT_KEYWORDS;
  }
  function saveKeywords(list) {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(list));
  }

  window.addEventListener("load", () => {
    const isDetailPage =
      document.querySelector(".skypilot-track-container") !== null;
    if (!isDetailPage) {
      createUI();
    }
  });

  function createUI() {
    if (document.getElementById("sp-tool-container")) return;

    const container = document.createElement("div");
    container.id = "sp-tool-container";
    container.style.cssText = `
            position: fixed; bottom: 90px; right: 15px; z-index: 99990;
            background: #fff; border: 2px solid #2ccce4; padding: 5px;
            border-radius: 50%; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            font-family: -apple-system, sans-serif;
            text-align: center; width: 60px; height: 60px;
            display: flex; flex-direction: column; justify-content: center; align-items: center;
        `;

    const savedData = localStorage.getItem(STORAGE_KEY_DATA);
    const btnText = savedData ? "🔍" : "📥";

    container.innerHTML = `
            <div id="sp-main-btn" style="font-size:28px; line-height:1;">${btnText}</div>
            <div id="sp-status" style="font-size:9px; margin-top:2px;">${
              savedData ? "検索" : "取得"
            }</div>
        `;
    document.body.appendChild(container);

    container.onclick = async () => {
      const currentData = localStorage.getItem(STORAGE_KEY_DATA);
      if (currentData) {
        showResults(JSON.parse(currentData));
      } else {
        if (confirm("全ページを読み込みますか？\n(数分かかる場合があります)")) {
          await startCrawling();
        }
      }
    };
  }

  // --- クロール処理 ---
  function extractItemsFromDoc(doc) {
    const items = [];
    const itemElements = doc.querySelectorAll("a.sky-pilot-list-item");
    itemElements.forEach((el) => {
      const titleEl = el.querySelector(".sky-pilot-file-heading");
      const title = titleEl ? titleEl.innerText.trim() : "名称不明";
      const link = el.getAttribute("href");
      const imgEl = el.querySelector("img.sky-pilot-product-thumbnail");
      const imgSrc = imgEl ? imgEl.src : "";

      let orderId = 0;
      const idMatch = link.match(/\/orders\/(\d+)/);
      if (idMatch && idMatch[1]) {
        orderId = parseInt(idMatch[1], 10);
      }
      items.push({ title, link, imgSrc, orderId });
    });
    return items;
  }

  async function startCrawling() {
    const container = document.getElementById("sp-tool-container");
    const status = document.getElementById("sp-status");

    container.style.opacity = "0.7";
    let allItems = [];
    let pageCount = 1;
    let currentDoc = document;
    let hasNext = true;

    status.innerText = "読込中";

    while (hasNext) {
      const items = extractItemsFromDoc(currentDoc);
      allItems = allItems.concat(items);
      status.innerText = `P.${pageCount}`;

      const nextLinkEl = currentDoc.querySelector(
        ".sky-pilot-pagination .next a"
      );
      if (nextLinkEl && nextLinkEl.href) {
        pageCount++;
        const nextUrl = nextLinkEl.href;
        await new Promise((r) => setTimeout(r, SCAN_INTERVAL));
        try {
          const response = await fetch(nextUrl, {
            credentials: "include",
            headers: {
              Accept: "text/html",
              "X-Requested-With": "XMLHttpRequest",
            },
          });
          const text = await response.text();
          const parser = new DOMParser();
          currentDoc = parser.parseFromString(text, "text/html");
        } catch (err) {
          console.error(err);
          hasNext = false;
        }
      } else {
        hasNext = false;
      }
    }
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(allItems));

    document.getElementById("sp-main-btn").innerText = "🔍";
    status.innerText = "検索";
    container.style.opacity = "1";
    showResults(allItems);
  }

  // --- 設定画面 (iOS最適化) ---
  function openSettingsModal(onClose) {
    const modal = document.createElement("div");
    modal.id = "sp-settings-modal";
    modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: #f2f2f7; z-index: 100001;
            display: flex; flex-direction: column; font-family: -apple-system, sans-serif;
        `;

    let currentKeywords = loadKeywords();

    const renderBody = () => {
      modal.innerHTML = `
                <div style="padding: 15px; background: #fff; border-bottom: 1px solid #c6c6c8; padding-top: 50px; display: flex; justify-content: space-between; align-items: center;">
                    <h2 style="margin: 0; font-size: 17px; font-weight: 600;">キーワード設定</h2>
                    <button id="sp-set-done" style="font-size: 17px; color: #007aff; background: none; border: none; font-weight: 600;">完了</button>
                </div>

                <div style="padding: 15px;">
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <input id="sp-new-kw" type="text" placeholder="新しいキーワードを追加"
                            style="flex: 1; padding: 10px; border: 1px solid #c6c6c8; border-radius: 8px; font-size: 16px;">
                        <button id="sp-add-kw" style="padding: 0 15px; background: #007aff; color: #fff; border: none; border-radius: 8px; font-weight: 600;">追加</button>
                    </div>
                </div>

                <div id="sp-kw-list" style="flex: 1; overflow-y: auto; padding: 0 15px 40px 15px; -webkit-overflow-scrolling: touch;">
                    </div>

                <div style="padding: 20px; text-align: center;">
                    <button id="sp-reset-kw" style="color: #ff3b30; background: none; border: none; font-size: 15px;">初期設定に戻す</button>
                </div>
            `;

      const listEl = modal.querySelector("#sp-kw-list");

      const listWrapper = document.createElement("div");
      listWrapper.style.cssText =
        "background: #fff; border-radius: 10px; overflow: hidden;";

      currentKeywords.forEach((kw, index) => {
        if (kw === "指定なし") return;
        const row = document.createElement("div");
        row.style.cssText = `
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 12px 15px; border-bottom: 1px solid #e5e5ea; font-size: 16px;
                `;
        if (index === currentKeywords.length - 1)
          row.style.borderBottom = "none";

        row.innerHTML = `
                    <span>${kw}</span>
                    <button data-idx="${index}" class="del-btn" style="width:30px; height:30px; background: #ff3b30; color: white; border: none; border-radius: 50%; font-size: 12px; display:flex; justify-content:center; align-items:center;">－</button>
                `;
        listWrapper.appendChild(row);
      });
      listEl.appendChild(listWrapper);

      modal.querySelector("#sp-set-done").onclick = () => {
        saveKeywords(currentKeywords);
        modal.remove();
        if (onClose) onClose();
        setTimeout(() => {
          document
            .querySelector("#sp-search-select")
            ?.dispatchEvent(new Event("change"));
        }, 100);
      };

      modal.querySelector("#sp-add-kw").onclick = () => {
        const val = modal.querySelector("#sp-new-kw").value.trim();
        if (val && !currentKeywords.includes(val)) {
          currentKeywords.push(val);
          renderBody();
          setTimeout(() => modal.querySelector("#sp-new-kw").focus(), 100);
        }
      };

      modal.querySelectorAll(".del-btn").forEach((btn) => {
        btn.onclick = (e) => {
          const idx = parseInt(e.target.dataset.idx);
          currentKeywords.splice(idx, 1);
          renderBody();
        };
      });

      modal.querySelector("#sp-reset-kw").onclick = () => {
        if (confirm("リストを初期状態に戻しますか？")) {
          currentKeywords = [...DEFAULT_KEYWORDS];
          renderBody();
        }
      };
    };

    renderBody();
    document.body.appendChild(modal);
  }

  // --- 検索・ソート画面 ---
  function showResults(items) {
    const existing = document.getElementById("sp-results-modal");
    if (existing) existing.remove();

    let isDescending = true;

    const modal = document.createElement("div");
    modal.id = "sp-results-modal";
    modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: #fff; z-index: 100000;
            display: flex; flex-direction: column; font-family: -apple-system, sans-serif;
        `;

    const header = document.createElement("div");
    header.style.cssText =
      "padding: 10px 15px; background: #f8f9fa; border-bottom: 1px solid #ddd; padding-top: 50px;";

    const renderHeader = () => {
      const keywords = loadKeywords();
      const validKeywords = keywords.filter((kw) => {
        if (kw === "指定なし") return true;
        return items.some((item) =>
          item.title.toLowerCase().includes(kw.toLowerCase())
        );
      });
      let optionsHTML = validKeywords
        .map((kw) => `<option value="${kw}">${kw}</option>`)
        .join("");

      return `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h3 style="margin:0; font-size:16px;">商品検索 (${items.length})</h3>
                    <button id="sp-close-btn" style="padding:8px 15px; border:1px solid #ccc; background:#fff; border-radius:4px; font-weight:600;">閉じる</button>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <div style="display:flex; gap:8px;">
                        <div style="flex:1; position:relative;">
                            <select id="sp-search-select" style="width:100%; padding:10px; font-size:16px; border:1px solid #ccc; border-radius:8px; background:#fff; appearance:none;">
                                ${optionsHTML}
                            </select>
                            <span style="position:absolute; right:10px; top:12px; color:#888; pointer-events:none;">▼</span>
                        </div>
                        <button id="sp-config-btn" style="width:44px; padding:0; border:1px solid #ccc; background:#fff; border-radius:8px; font-size:20px;">⚙️</button>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="sp-search-input" placeholder="キーワード (例: 2024)"
                            style="flex:1; padding:10px; font-size:16px; border:1px solid #2ccce4; border-radius:8px;">
                        <button id="sp-sort-btn" style="padding:0 12px; border:1px solid #2ccce4; background:#fff; color:#2ccce4; border-radius:8px; font-weight:bold; white-space:nowrap;">
                            新着順
                        </button>
                    </div>
                    <div style="text-align:right;">
                        <button id="sp-refresh-btn" style="font-size:12px; color:#2ccce4; background:none; border:none;">🔄 データを更新</button>
                    </div>
                </div>
            `;
    };

    header.innerHTML = renderHeader();
    modal.appendChild(header);

    const listContainer = document.createElement("div");
    listContainer.style.cssText =
      "flex: 1; overflow-y: auto; padding: 0; -webkit-overflow-scrolling: touch;";
    modal.appendChild(listContainer);

    const renderList = () => {
      listContainer.innerHTML = "";
      const selectVal = header.querySelector("#sp-search-select").value;
      const inputVal = header.querySelector("#sp-search-input").value;
      const keywords = inputVal
        .toLowerCase()
        .split(/\s+/)
        .filter((k) => k);

      let filtered = items.filter((item) => {
        const title = item.title.toLowerCase();
        if (
          selectVal !== "指定なし" &&
          !title.includes(selectVal.toLowerCase())
        )
          return false;
        return keywords.every((k) => title.includes(k));
      });

      filtered.sort((a, b) => {
        const idA = a.orderId || 0;
        const idB = b.orderId || 0;
        return isDescending ? idB - idA : idA - idB;
      });

      if (filtered.length === 0) {
        listContainer.innerHTML =
          '<div style="padding:40px; text-align:center; color:#888;">見つかりません</div>';
        return;
      }

      filtered.forEach((item) => {
        const row = document.createElement("a");
        row.href = item.link;
        row.style.cssText = `
                    display: flex; align-items: center; padding: 12px 15px;
                    border-bottom: 1px solid #eee; text-decoration: none; color: inherit;
                `;
        row.innerHTML = `
                    <div style="width:60px; height:60px; flex-shrink:0; margin-right:15px; background:#eee; border-radius:8px; overflow:hidden;">
                        <img src="${item.imgSrc}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'">
                    </div>
                    <div style="flex:1;">
                        <div style="font-weight:bold; color:#333; font-size:14px; margin-bottom:4px; line-height:1.4;">${item.title}</div>
                        <div style="font-size:12px; color:#2ccce4;">開く &gt;</div>
                    </div>
                `;
        listContainer.appendChild(row);
      });
    };

    renderList();

    const bindEvents = () => {
      header
        .querySelector("#sp-search-input")
        .addEventListener("input", renderList);
      header
        .querySelector("#sp-search-select")
        .addEventListener("change", renderList);
      header
        .querySelector("#sp-close-btn")
        .addEventListener("click", () => modal.remove());

      header
        .querySelector("#sp-refresh-btn")
        .addEventListener("click", async () => {
          if (confirm("最新の購入データを読み込みますか？")) {
            modal.remove();
            await startCrawling();
          }
        });

      header.querySelector("#sp-sort-btn").addEventListener("click", () => {
        isDescending = !isDescending;
        header.querySelector("#sp-sort-btn").innerText = isDescending
          ? "新着順"
          : "古い順";
        renderList();
      });

      header.querySelector("#sp-config-btn").addEventListener("click", () => {
        openSettingsModal(() => {
          const oldSelect = header.querySelector("#sp-search-select");
          const selectedVal = oldSelect.value;
          header.innerHTML = renderHeader();
          bindEvents();
          const newSelect = header.querySelector("#sp-search-select");
          if ([...newSelect.options].some((o) => o.value === selectedVal)) {
            newSelect.value = selectedVal;
          }
          renderList();
        });
      });
    };
    bindEvents();
    document.body.appendChild(modal);
  }
})();
