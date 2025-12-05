// ==UserScript==
// @name         ホロライブ公式ショップ：DL商品検索＆一括DLツール
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  購入済み商品の検索（設定・ソート機能）と、詳細ページでの高機能一括ダウンロード（形式指定・履歴管理）
// @author       demupe3
// @match        https://shop.hololivepro.com/apps/downloads/*
// @grant        GM_download
// ==/UserScript==

(function () {
  "use strict";

  // ■ 初回起動時のデフォルトキーワード
  const DEFAULT_KEYWORDS = [
    "指定なし",
    "ときのそら",
    "ロボ子さん",
    "さくらみこ",
    "星街すいせい",
    "AZKi",
    "白上フブキ",
    "夏色まつり",
    "夜空メル",
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
    "ASMR",
    "記念ボイス",
  ];

  const STORAGE_KEY_DATA = "holo_shop_library_data_sortable";
  const STORAGE_KEY_CONFIG = "holo_shop_keyword_config";
  const STORAGE_KEY_HISTORY = "holo_shop_download_history";

  const SCAN_INTERVAL = 1000;
  const DL_INTERVAL = 2000;

  function loadKeywords() {
    const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
    return saved ? JSON.parse(saved) : DEFAULT_KEYWORDS;
  }
  function saveKeywords(list) {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(list));
  }
  function getHistory() {
    const saved = localStorage.getItem(STORAGE_KEY_HISTORY);
    return saved ? JSON.parse(saved) : [];
  }
  function addHistory(filename) {
    const hist = getHistory();
    if (!hist.includes(filename)) {
      hist.push(filename);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(hist));
    }
  }

  window.addEventListener("load", () => {
    const isDetailPage =
      document.querySelector(".skypilot-track-container") !== null;
    createUI(isDetailPage);
  });

  function createUI(isDetailPage) {
    if (document.getElementById("sp-tool-container")) return;

    const container = document.createElement("div");
    container.id = "sp-tool-container";
    container.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 99990;
            background: #fff; border: 2px solid #2ccce4; padding: 15px;
            border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            font-family: sans-serif; max-width: 300px; text-align: center;
        `;

    const btn = document.createElement("button");
    btn.id = "sp-main-btn";

    if (isDetailPage) {
      btn.innerHTML =
        '⬇️ <b>一括ダウンロード</b><br><span style="font-size:11px">形式選択・履歴チェック</span>';
      btn.style.background = "#e42c64";
      btn.onclick = openDownloadSettings;
    } else {
      const savedData = localStorage.getItem(STORAGE_KEY_DATA);
      btn.innerHTML = savedData
        ? '🔍 <b>検索する</b><br><span style="font-size:11px">購入履歴から探す</span>'
        : '📥 <b>データ取得</b><br><span style="font-size:11px">初回読み込みを実行</span>';
      btn.style.background = "#2ccce4";
      btn.onclick = async () => {
        const currentData = localStorage.getItem(STORAGE_KEY_DATA);
        if (currentData) {
          showResults(JSON.parse(currentData));
        } else {
          await startCrawling();
        }
      };
    }

    btn.style.cssText += `
            width: 100%; padding: 10px; color: white;
            border: none; border-radius: 6px; cursor: pointer; font-size: 14px;
            transition: opacity 0.3s;
        `;
    btn.onmouseover = () => (btn.style.opacity = "0.8");
    btn.onmouseout = () => (btn.style.opacity = "1");

    const status = document.createElement("div");
    status.id = "sp-status";
    status.style.marginTop = "8px";
    status.style.fontSize = "11px";
    status.style.color = "#666";
    status.innerText = isDetailPage
      ? ""
      : localStorage.getItem(STORAGE_KEY_DATA)
      ? "準備完了"
      : "データ未取得";

    container.appendChild(btn);
    container.appendChild(status);
    document.body.appendChild(container);
    observePlayerVisibility(container);
  }

  function observePlayerVisibility(toolContainer) {
    const playerContainer = document.querySelector(
      ".skypilot-player-container"
    );
    if (!playerContainer) return;

    const checkVisibility = () => {
      const isVisible =
        !playerContainer.classList.contains("hidden") &&
        window.getComputedStyle(playerContainer).display !== "none";
      if (isVisible) {
        toolContainer.style.display = "none";
      } else {
        toolContainer.style.display = "block";
      }
    };
    checkVisibility();
    const observer = new MutationObserver(checkVisibility);
    observer.observe(playerContainer, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

  function openDownloadSettings() {
    const trackEls = document.querySelectorAll(
      ".skypilot-track-container .track"
    );
    if (trackEls.length === 0) return;

    const files = [];
    const history = getHistory();

    trackEls.forEach((el, idx) => {
      const titleEl =
        el.querySelector(".track-name a") || el.querySelector(".track-name");
      let baseTitle = titleEl ? titleEl.innerText.trim() : `track_${idx + 1}`;
      baseTitle = baseTitle.replace(/[\\/:*?"<>|]/g, "_");

      const urlCandidates = new Set();
      el.querySelectorAll("a").forEach((a) => {
        if (a.href) urlCandidates.add(a.href);
      });
      el.querySelectorAll("audio, source").forEach((media) => {
        if (media.src) urlCandidates.add(media.src);
      });

      urlCandidates.forEach((url) => {
        if (!url.startsWith("http")) return;
        let ext = null;
        const lowerUrl = url.toLowerCase();

        if (lowerUrl.includes(".wav")) ext = "wav";
        else if (lowerUrl.includes(".mp3")) ext = "mp3";
        else if (lowerUrl.includes(".zip")) ext = "zip";
        else if (lowerUrl.includes(".pdf")) ext = "pdf";
        else if (lowerUrl.includes(".flac")) ext = "flac";
        else if (lowerUrl.includes(".m4a")) ext = "m4a";
        else if (lowerUrl.includes(".jpg") || lowerUrl.includes(".png"))
          ext = "image";

        if (
          !ext &&
          (lowerUrl.includes("/stream/") || lowerUrl.includes("/downloads/"))
        ) {
          ext = lowerUrl.includes("stream") ? "mp3" : "wav";
        }

        if (ext) {
          let fullTitle = baseTitle;
          if (!fullTitle.toLowerCase().endsWith("." + ext) && ext !== "image") {
            fullTitle += "." + ext;
          }
          const isDownloaded = history.includes(fullTitle);
          files.push({ url, title: fullTitle, ext, isDownloaded });
        }
      });
    });

    const uniqueFiles = [];
    const seenUrls = new Set();
    files.forEach((f) => {
      if (!seenUrls.has(f.url)) {
        seenUrls.add(f.url);
        uniqueFiles.push(f);
      }
    });

    const extensions = [...new Set(uniqueFiles.map((f) => f.ext))].sort();

    const modal = document.createElement("div");
    modal.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 320px; background: white; z-index: 100002;
            border-radius: 12px; box-shadow: 0 0 40px rgba(0,0,0,0.6);
            padding: 20px; font-family: sans-serif;
        `;

    let checkBoxesHTML = "";
    extensions.forEach((ext) => {
      const count = uniqueFiles.filter((f) => f.ext === ext).length;
      checkBoxesHTML += `
                <label style="display:flex; align-items:center; margin:8px 0; cursor:pointer;">
                    <input type="checkbox" class="sp-ext-chk" value="${ext}" checked
                        style="width:18px; height:18px; margin-right:10px; cursor:pointer;">
                    <span style="font-weight:bold; text-transform:uppercase;">${ext}</span>
                    <span style="margin-left:5px; color:#666;">(${count}ファイル)</span>
                </label>
            `;
    });

    const downloadedCount = uniqueFiles.filter((f) => f.isDownloaded).length;

    modal.innerHTML = `
            <h3 style="margin:0 0 15px 0; color:#333; font-size:18px;">ダウンロード設定</h3>
            <div style="margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:10px;">
                <div style="font-size:14px; color:#666; margin-bottom:5px;">形式を選択:</div>
                ${checkBoxesHTML}
            </div>
            <div style="margin-bottom:15px; background:#f9f9f9; padding:10px; border-radius:6px;">
                <label style="display:flex; align-items:center; cursor:pointer; font-size:14px;">
                    <input type="checkbox" id="sp-skip-downloaded" ${
                      downloadedCount > 0 ? "checked" : ""
                    }
                         style="width:16px; height:16px; margin-right:8px;">
                    <span>ダウンロード済みを除外</span>
                </label>
                <div style="font-size:11px; color:#888; margin-left:24px; margin-top:2px;">
                    (過去に保存した ${downloadedCount} ファイルをスキップ)
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="sp-dl-cancel" style="padding:8px 15px; border:1px solid #ccc; background:#fff; border-radius:4px; cursor:pointer;">キャンセル</button>
                <button id="sp-dl-start" style="padding:8px 20px; background:#e42c64; color:#fff; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">開始</button>
            </div>
        `;

    document.body.appendChild(modal);

    modal.querySelector("#sp-dl-cancel").onclick = () => modal.remove();

    modal.querySelector("#sp-dl-start").onclick = () => {
      const selectedExts = [
        ...modal.querySelectorAll(".sp-ext-chk:checked"),
      ].map((c) => c.value);
      const skipDownloaded = modal.querySelector("#sp-skip-downloaded").checked;

      const targetFiles = uniqueFiles.filter((f) => {
        if (!selectedExts.includes(f.ext)) return false;
        if (skipDownloaded && f.isDownloaded) return false;
        return true;
      });

      if (targetFiles.length === 0) {
        alert(
          "ダウンロード対象のファイルがありません。条件を変更してください。"
        );
        return;
      }

      modal.remove();
      executeDownload(targetFiles);
    };
  }

  async function executeDownload(fileList) {
    const btn = document.getElementById("sp-main-btn");
    const status = document.getElementById("sp-status");

    if (
      !confirm(
        `選択された ${fileList.length} ファイルのダウンロードを開始します。よろしいですか？`
      )
    ) {
      return;
    }

    btn.disabled = true;
    btn.style.opacity = "0.6";

    let successCount = 0;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      status.innerText = `保存中 (${i + 1}/${fileList.length}):\n${file.title}`;

      try {
        await downloadViaTampermonkey(file.url, file.title);
        addHistory(file.title);
        successCount++;
      } catch (e) {
        console.error("Download failed:", e);
        status.innerText = `エラー: ${file.title}`;
      }

      if (i < fileList.length - 1) {
        await new Promise((r) => setTimeout(r, DL_INTERVAL));
      }
    }

    status.innerText = `完了 (${successCount}/${fileList.length} 件)`;
    btn.disabled = false;
    btn.style.opacity = "1";
    alert("すべてのダウンロードが完了しました。");
  }

  function downloadViaTampermonkey(url, filename) {
    return new Promise((resolve, reject) => {
      GM_download({
        url: url,
        name: filename,
        onload: () => {
          resolve();
        },
        onerror: (err) => {
          reject(err);
        },
      });
    });
  }

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
    const btn = document.getElementById("sp-main-btn");
    const status = document.getElementById("sp-status");
    btn.disabled = true;
    btn.style.opacity = "0.7";
    let allItems = [];
    let pageCount = 1;
    let currentDoc = document;

    const modal = document.getElementById("sp-results-modal");
    if (modal) modal.remove();

    status.innerText = "データを読み込み中...";

    while (true) {
      const items = extractItemsFromDoc(currentDoc);
      allItems = allItems.concat(items);
      status.innerText = `${pageCount}ページ目を解析中...`;
      const nextLinkEl = currentDoc.querySelector(
        ".sky-pilot-pagination .next a"
      );
      if (nextLinkEl && nextLinkEl.href) {
        pageCount++;
        const nextUrl = nextLinkEl.href;
        await new Promise((r) => setTimeout(r, SCAN_INTERVAL));
        try {
          const response = await fetch(nextUrl);
          const text = await response.text();
          const parser = new DOMParser();
          currentDoc = parser.parseFromString(text, "text/html");
        } catch (err) {
          console.error(err);
          break;
        }
      } else {
        break;
      }
    }
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(allItems));
    status.innerText = `完了 (${allItems.length} 件)`;
    btn.innerHTML =
      '🔍 <b>検索する</b><br><span style="font-size:11px">購入履歴から探す</span>';
    btn.disabled = false;
    btn.style.opacity = "1";
    showResults(allItems);
  }

  function openSettingsModal(onClose) {
    const modal = document.createElement("div");
    modal.id = "sp-settings-modal";
    modal.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 320px; max-height: 80%; background: white; z-index: 100001;
            border-radius: 12px; box-shadow: 0 0 40px rgba(0,0,0,0.6);
            display: flex; flex-direction: column; overflow: hidden; font-family: sans-serif;
        `;

    let currentKeywords = loadKeywords();

    const renderBody = () => {
      modal.innerHTML = `
                <div style="padding:15px; background:#eee; font-weight:bold; border-bottom:1px solid #ddd; display:flex; justify-content:space-between;">
                    <span>絞り込みキーワード設定</span>
                    <button id="sp-set-close" style="cursor:pointer; border:none; background:none;">✕</button>
                </div>
                <div style="padding:10px; border-bottom:1px solid #ddd; display:flex;">
                    <input id="sp-new-kw" type="text" placeholder="新しいキーワード" style="flex:1; padding:8px;">
                    <button id="sp-add-kw" style="padding:8px 12px; margin-left:5px; cursor:pointer; background:#2ccce4; color:#fff; border:none; border-radius:4px;">追加</button>
                </div>
                <div id="sp-kw-list" style="flex:1; overflow-y:auto; padding:10px;"></div>
                <div style="padding:10px; text-align:right; border-top:1px solid #ddd; background:#f9f9f9;">
                    <button id="sp-reset-kw" style="font-size:10px; color:#999; border:none; background:none; cursor:pointer; float:left; margin-top:5px;">初期値に戻す</button>
                    <button id="sp-set-ok" style="padding:8px 20px; background:#2ccce4; color:#fff; border:none; border-radius:4px; cursor:pointer;">決定</button>
                </div>
            `;

      const listEl = modal.querySelector("#sp-kw-list");
      currentKeywords.forEach((kw, index) => {
        if (kw === "指定なし") return;
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid #eee;";
        row.innerHTML = `<span>${kw}</span> <button data-idx="${index}" class="del-btn" style="color:red; border:none; background:none; cursor:pointer;">🗑️</button>`;
        listEl.appendChild(row);
      });

      modal.querySelector("#sp-set-close").onclick = () => modal.remove();
      modal.querySelector("#sp-set-ok").onclick = () => {
        saveKeywords(currentKeywords);
        modal.remove();
        if (onClose) onClose();
      };
      modal.querySelector("#sp-add-kw").onclick = () => {
        const val = modal.querySelector("#sp-new-kw").value.trim();
        if (val && !currentKeywords.includes(val)) {
          currentKeywords.push(val);
          renderBody();
          modal.querySelector("#sp-new-kw").focus();
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
        if (confirm("設定を初期状態に戻しますか？")) {
          currentKeywords = [...DEFAULT_KEYWORDS];
          renderBody();
        }
      };
    };
    renderBody();
    document.body.appendChild(modal);
  }

  function showResults(items) {
    const existing = document.getElementById("sp-results-modal");
    if (existing) existing.remove();

    let isDescending = true;
    const modal = document.createElement("div");
    modal.id = "sp-results-modal";
    modal.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 85%; height: 85%; background: white; z-index: 100000;
            border-radius: 12px; box-shadow: 0 0 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; overflow: hidden; font-family: sans-serif;
        `;
    const header = document.createElement("div");
    header.style.cssText =
      "padding: 20px; background: #f8f9fa; border-bottom: 1px solid #ddd;";

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
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h3 style="margin:0; color:#333;">購入商品 (${
                      items.length
                    }件)</h3>
                    <div style="display:flex; gap:10px;">
                         <button id="sp-refresh-btn" style="padding:8px 12px; cursor:pointer; border:1px solid #2ccce4; color:#2ccce4; background:#fff; border-radius:4px; font-weight:bold; font-size:12px;">🔄 更新</button>
                        <button id="sp-close-btn" style="padding:8px 16px; cursor:pointer; border:1px solid #ccc; background:#fff; border-radius:4px; font-size:12px;">閉じる</button>
                    </div>
                </div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <select id="sp-search-select" style="padding:12px; font-size:14px; border:2px solid #ccc; border-radius:6px; cursor:pointer; max-width:150px;">
                        ${optionsHTML}
                    </select>
                    <button id="sp-config-btn" style="padding:0 12px; cursor:pointer; border:1px solid #ccc; background:#fff; border-radius:6px; height:43px;" title="キーワード設定">⚙️</button>
                    <input type="text" id="sp-search-input" placeholder="さらにキーワード (例: 2024, ボイス...)"
                        style="flex:1; padding:12px; font-size:16px; border:2px solid #2ccce4; border-radius:6px; box-sizing:border-box;">
                    <button id="sp-sort-btn" style="padding:0 15px; cursor:pointer; border:1px solid #2ccce4; background:#fff; color:#2ccce4; border-radius:6px; font-weight:bold; height:43px; white-space:nowrap;">
                        ${isDescending ? "⇅ 新しい順" : "⇅ 古い順"}
                    </button>
                </div>
            `;
    };

    header.innerHTML = renderHeader();
    modal.appendChild(header);

    const listContainer = document.createElement("div");
    listContainer.style.cssText = "flex: 1; overflow-y: auto; padding: 0 20px;";
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
          '<div style="padding:20px; text-align:center; color:#888;">見つかりませんでした</div>';
        return;
      }

      filtered.forEach((item) => {
        const row = document.createElement("a");
        row.href = item.link;
        row.target = "_blank";
        row.style.cssText = `
                    display: flex; align-items: center; padding: 12px;
                    border-bottom: 1px solid #eee; text-decoration: none; color: inherit; transition: background 0.2s;
                `;
        row.onmouseover = () => (row.style.background = "#f0f8ff");
        row.onmouseout = () => (row.style.background = "transparent");
        row.innerHTML = `
                    <div style="width:60px; height:60px; flex-shrink:0; margin-right:15px; background:#eee; border-radius:6px; overflow:hidden;">
                        <img src="${item.imgSrc}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'">
                    </div>
                    <div style="flex:1;">
                        <div style="font-weight:bold; color:#333; margin-bottom:4px;">${item.title}</div>
                        <div style="font-size:12px; color:#999;">詳細ページを開く</div>
                    </div>
                `;
        listContainer.appendChild(row);
      });
    };

    renderList();

    const bindHeaderEvents = () => {
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
          if (confirm("購入データを最新の情報に更新しますか？")) {
            modal.remove();
            await startCrawling();
          }
        });
      header.querySelector("#sp-config-btn").addEventListener("click", () => {
        openSettingsModal(() => {
          const oldSelect = header.querySelector("#sp-search-select");
          const selectedVal = oldSelect.value;
          header.innerHTML = renderHeader();
          bindHeaderEvents();
          const newSelect = header.querySelector("#sp-search-select");
          if ([...newSelect.options].some((o) => o.value === selectedVal)) {
            newSelect.value = selectedVal;
          }
          renderList();
        });
      });
      header.querySelector("#sp-sort-btn").addEventListener("click", () => {
        isDescending = !isDescending;
        const btn = header.querySelector("#sp-sort-btn");
        btn.innerText = isDescending ? "⇅ 新しい順" : "⇅ 古い順";
        renderList();
      });
    };
    bindHeaderEvents();

    document.addEventListener("keydown", function close(e) {
      if (e.key === "Escape") {
        if (document.getElementById("sp-settings-modal")) return;
        modal.remove();
        document.removeEventListener("keydown", close);
      }
    });
    document.body.appendChild(modal);
    header.querySelector("#sp-search-input").focus();
  }
})();
