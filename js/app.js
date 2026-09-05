/* 结构转换器 - 主应用逻辑 */

"use strict";

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    screens: $$(".screen"),
    navItems: $$(".nav-item"),
    dropzone: $("#dropzone"),
    fileInput: $("#file-input"),
    dzIcon: $("#dz-icon"),
    fmtSection: $("#format-section"),
    fmtChips: $("#fmt-chips"),
    btnConvert: $("#btn-convert"),
    btnHistory: $("#btn-history"),
    workFile: $("#work-file"),
    ringFg: $("#ring-fg"),
    ringPct: $("#ring-pct"),
    ringState: $("#ring-state"),
    workStatus: $("#work-status"),
    doneCard: $("#done-card"),
    historyList: $("#history-list"),
    btnClearHistory: $("#btn-clear-history"),
    toast: $("#toast"),
  };

  const state = {
    files: [],
    selectedFmt: null,
    converting: false,
    history: JSON.parse(localStorage.getItem("sc_history") || "[]"),
  };

  /* ---------- 工具 ---------- */

  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  function fmtName(id) {
    const f = Converter.FORMATS.find(x => x.id === id);
    return f ? f.label : id;
  }

  function showScreen(name) {
    els.screens.forEach(s => s.classList.toggle("active", s.id === "screen-" + name));
    els.navItems.forEach(n => n.classList.toggle("active", n.dataset.screen === name));
  }

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  }

  function pushHistory(entry) {
    state.history.unshift(entry);
    if (state.history.length > 30) state.history.length = 30;
    localStorage.setItem("sc_history", JSON.stringify(state.history));
    renderHistory();
  }

  function renderHistory() {
    if (!state.history.length) {
      els.historyList.innerHTML = '<div class="history-empty">暂无转换记录</div>';
      return;
    }
    els.historyList.innerHTML = state.history.map((h, i) => `
      <div class="history-item glass" data-idx="${i}" data-name="${escapeAttr(h.name)}" data-blob="${h.blobId}">
        <div class="history-icon">⬢</div>
        <div class="history-meta">
          <div class="history-name">${escapeHtml(h.name)}</div>
          <div class="history-info">${escapeHtml(h.srcName)} → ${escapeHtml(fmtName(h.fmt))} · ${humanSize(h.size)}</div>
        </div>
      </div>`).join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------- 文件选择 ---------- */

  function handleFiles(fileList) {
    const files = Array.from(fileList);
    const valid = files.filter(f => Converter.SOURCE_EXTS["." + (f.name || "").toLowerCase().split(".").pop()]);
    if (!valid.length) {
      toast("仅支持 litematic / mcstructure / schematic 文件");
      return;
    }
    if (files.length !== valid.length) {
      toast("已忽略不支持的文件");
    }
    state.files = valid;
    state.selectedFmt = null;
    els.fmtSection.hidden = false;
    renderFormatChips();
    els.btnConvert.disabled = true;
    toast(`${valid.length} 个文件已选择`);
    els.dropzone.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderFormatChips() {
    const srcExts = new Set(state.files.map(f => "." + f.name.toLowerCase().split(".").pop()));
    const srcFmt = Converter.SOURCE_EXTS[Array.from(srcExts)[0]];
    const targets = Converter.FORMATS.filter(f => f.id !== srcFmt);
    els.fmtChips.innerHTML = targets.map(f => `
      <button class="fmt-chip" data-fmt="${f.id}">${f.label.split(" ")[0].replace(/[()]/g, "")}</button>`).join("");
    $$(".fmt-chip").forEach(chip => {
      chip.onclick = () => {
        $$(".fmt-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
        state.selectedFmt = chip.dataset.fmt;
        els.btnConvert.disabled = state.converting;
      };
    });
  }

  /* ---------- 转换流程 ---------- */

  function setProgress(pct, label) {
    const r = 52, c = 2 * Math.PI * r;
    els.ringFg.style.strokeDashoffset = c * (1 - pct);
    els.ringPct.textContent = Math.round(pct * 100) + "%";
    els.ringState.textContent = label || "";
  }

  async function startConvert() {
    if (state.converting || !state.files.length || !state.selectedFmt) return;
    state.converting = true;
    els.btnConvert.disabled = true;
    showScreen("working");
    els.workFile.textContent = state.files.map(f => f.name).join("、");
    setProgress(0, "准备中");
    els.workStatus.textContent = "正在解析文件…";

    // 逐个转换
    const results = [];
    const total = state.files.length;
    try {
      for (let i = 0; i < total; i++) {
        const file = state.files[i];
        els.workFile.textContent = file.name;
        els.workStatus.textContent = `正在解析 ${i + 1}/${total}…`;
        const res = await Converter.convertFile(file, state.selectedFmt, (p, label) => {
          setProgress(p * 0.9 + i / total * 0.1, label);
          els.workStatus.textContent = label || "";
        });
        results.push(res);
      }
      setProgress(1, "完成");
      els.workStatus.textContent = "转换完成";
      showDone(results);
    } catch (e) {
      console.error(e);
      els.workStatus.textContent = "";
      toast("转换失败：" + (e.message || "未知错误"));
      setTimeout(() => {
        showScreen("home");
        state.converting = false;
        els.btnConvert.disabled = false;
      }, 900);
    }
  }

  function showDone(results) {
    const single = results.length === 1;
    const first = results[0];
    els.doneCard.innerHTML = `
      <div class="done-check">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
      </div>
      <div class="done-title">${single ? "转换完成" : results.length + " 个文件转换完成"}</div>
      <div class="done-desc">${escapeHtml(single ? first.name : results.map(r => r.name).join("、"))}</div>
      <div class="done-actions">
        <button class="btn-primary" id="btn-download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12m0 0l-4-4m4 4l4-4"/><path d="M4 20h16"/></svg>
          下载${single ? "" : "全部"}
        </button>
        <button class="btn-secondary" id="btn-share" ${single ? "" : "disabled"}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
          分享
        </button>
        <button class="btn-back" id="btn-back">再转一个</button>
      </div>`;

    // 记录历史（保留 blob 引用以便下载）
    const blobRefs = results.map(r => {
      const blob = new Blob([r.data], { type: "application/octet-stream" });
      const blobId = "b" + Date.now() + Math.random().toString(36).slice(2);
      window[blobId] = blob;
      return { name: r.name, srcName: state.files[0].name, fmt: state.selectedFmt, size: r.data.length, blobId };
    });
    blobRefs.forEach(entry => {
      pushHistory(entry);
      state.history = state.history.filter(h => h.blobId !== entry.blobId || h === entry);
    });
    state.history = state.history.filter(h => blobRefs.some(b => b.blobId === h.blobId));
    localStorage.setItem("sc_history", JSON.stringify(state.history));
    renderHistory();

    $("#btn-download").onclick = () => {
      if (single) {
        downloadBlob(window[firstBlobId()], first.name);
      } else {
        results.forEach(r => downloadBlob(window[rBlobId(r)], r.name));
      }
    };
    const firstBlobId = () => blobRefs[0].blobId;
    const rBlobId = (r) => blobRefs.find(b => b.name === r.name).blobId;
    const shareBtn = $("#btn-share");
    if (shareBtn && !shareBtn.disabled) {
      shareBtn.onclick = async () => {
        const f = blobRefs[0];
        try {
          const shareData = {
            files: [new File([window[f.blobId]], f.name, { type: "application/octet-stream" })],
          };
          if (navigator.canShare && navigator.canShare(shareData)) {
            await navigator.share(shareData);
          } else {
            downloadBlob(window[f.blobId], f.name);
          }
        } catch (e) {
          if (e.name !== "AbortError") downloadBlob(window[f.blobId], f.name);
        }
      };
    }
    $("#btn-back").onclick = () => {
      state.converting = false;
      els.btnConvert.disabled = false;
      showScreen("home");
    };

    showScreen("done");
    state.converting = false;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* ---------- 事件绑定 ---------- */

  els.dropzone.onclick = () => els.fileInput.click();
  els.dropzone.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); }
  };
  els.fileInput.onchange = (e) => handleFiles(e.target.files);
  els.btnConvert.onclick = startConvert;
  els.btnHistory.onclick = () => showScreen("history");

  let dragCounter = 0;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    els.dropzone.classList.add("dragging");
  });
  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) els.dropzone.classList.remove("dragging");
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    els.dropzone.classList.remove("dragging");
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  els.dropzone.addEventListener("mousemove", (e) => {
    const rect = els.dropzone.getBoundingClientRect();
    els.dropzone.style.setProperty("--mx", (e.clientX - rect.left) + "px");
    els.dropzone.style.setProperty("--my", (e.clientY - rect.top) + "px");
  });

  $$(".nav-item").forEach(n => {
    n.onclick = () => {
      if (n.dataset.screen === "history") renderHistory();
      showScreen(n.dataset.screen);
    };
  });

  els.historyList.onclick = (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;
    const blob = window[item.dataset.blob];
    if (blob) {
      downloadBlob(blob, item.dataset.name);
      toast("已开始下载");
    } else {
      toast("文件已过期，请重新转换");
    }
  };

  els.btnClearHistory.onclick = () => {
    state.history = [];
    localStorage.setItem("sc_history", "[]");
    renderHistory();
    toast("历史已清空");
  };

  /* 拖放区跟随指针光斑 */
  els.dropzone.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    const rect = els.dropzone.getBoundingClientRect();
    els.dropzone.style.setProperty("--mx", (t.clientX - rect.left) + "px");
    els.dropzone.style.setProperty("--my", (t.clientY - rect.top) + "px");
  }, { passive: true });

  /* ---------- 初始化 ---------- */

  renderHistory();

  /* 更新检查 */
  async function initUpdate() {
    try {
      const { hasUpdate, force, latest } = await Updater.check();
      if (hasUpdate && latest) {
        const go = await Updater.prompt(latest, force);
        if (go) await Updater.apply();
      }
    } catch (e) {
      console.warn("[update]", e);
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/app/sw.js").catch(e => console.warn("[sw]", e));
  }
  // 记录安装版本（首次访问即视为 v1.0.0）
  if (!localStorage.getItem("sc_installed_version")) {
    Updater.setInstalledVersion("1.0.0");
  }

  // 启动更新检查（延迟，避免阻塞首屏）
  setTimeout(initUpdate, 1500);
})();