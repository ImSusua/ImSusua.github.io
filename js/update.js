/* 更新发放模块
 * - 启动时静默检查版本清单
 * - 可选更新：弹窗提示，用户选择
 * - 强制更新：当本地版本低于 min_supported 时，禁止跳过
 * - 更新方式：刷新页面 → Service Worker 拉取新资源
 */

"use strict";

const Updater = (() => {
  const MANIFEST_URL = "https://napcat.susua.cc.cd/api/app/manifest";
  const LS_KEY_VERSION = "sc_installed_version";
  const LS_KEY_SKIP = "sc_skip_version";
  const LS_KEY_LAST_CHECK = "sc_last_check";

  let manifest = null;

  async function fetchManifest() {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("manifest " + res.status);
    return res.json();
  }

  function getInstalledVersion() {
    return localStorage.getItem(LS_KEY_VERSION) || "0.0.0";
  }

  function setInstalledVersion(v) {
    localStorage.setItem(LS_KEY_VERSION, v);
  }

  function semverCmp(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  }

  /* 应用自身版本号（构建时写入） */
  const APP_VERSION = "1.0.0";

  /* 检查更新；返回 { hasUpdate, force, latest } */
  async function check() {
    try {
      manifest = await fetchManifest();
    } catch (e) {
      console.warn("[updater] 清单获取失败:", e.message);
      return { hasUpdate: false, force: false, latest: null, offline: true };
    }
    const latest = manifest.latest;
    if (!latest) return { hasUpdate: false, force: false, latest: null };
    const local = getInstalledVersion();

    // 灰度：按安装版本 hash 决定是否进入灰度池
    if (manifest.latest && manifest.latest.gray && manifest.latest.gray.enabled) {
      const pct = manifest.latest.gray.percent || 100;
      let h = 0;
      const s = APP_VERSION + "|" + (navigator.userAgent || "");
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      if ((h % 100) >= pct) return { hasUpdate: false, force: false, latest };
    }

    const hasUpdate = semverCmp(latest.version, local) > 0;
    const minSup = manifest.latest.min_supported || "0.0.0";
    // 强制：本地版本低于 min_supported，或清单标记 force_above 且本地低于它
    const force = semverCmp(local, minSup) < 0 ||
      (manifest.latest.force_above && semverCmp(local, manifest.latest.force_above) < 0);

    const skipped = localStorage.getItem(LS_KEY_SKIP);
    if (hasUpdate && !force && skipped === latest.version) {
      return { hasUpdate: false, force: false, latest };
    }
    return { hasUpdate, force, latest };
  }

  /* 展示更新弹窗；返回用户是否选择更新 */
  async function prompt(latest, force) {
    const mask = document.getElementById("update-mask");
    const title = document.getElementById("update-title");
    const ver = document.getElementById("update-version");
    const changelog = document.getElementById("update-changelog");
    const skipBtn = document.getElementById("btn-update-skip");

    title.textContent = force ? "需要更新" : "发现新版本";
    ver.textContent = "v" + latest.version + (latest.name ? " · " + latest.name : "");
    changelog.innerHTML = (latest.changelog || ["暂无更新说明"])
      .map(x => `<li>${escapeHtml(x)}</li>`).join("");
    skipBtn.style.display = force ? "none" : "";

    mask.hidden = false;
    document.body.style.overflow = "hidden";

    return new Promise(resolve => {
      const done = (update) => {
        mask.hidden = true;
        document.body.style.overflow = "";
        skipBtn.onclick = null;
        document.getElementById("btn-update-now").onclick = null;
        resolve(update);
      };
      skipBtn.onclick = () => {
        localStorage.setItem(LS_KEY_SKIP, latest.version);
        done(false);
      };
      document.getElementById("btn-update-now").onclick = () => {
        localStorage.setItem(LS_KEY_SKIP, "");
        setInstalledVersion(latest.version);
        done(true);
      };
    });
  }

  /* 执行更新：强制 SW 更新 + 重载 */
  async function apply() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    } catch (e) { /* 忽略 */ }
    location.reload();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* 更新日志页（历史版本） */
  function renderVersions(container) {
    if (!manifest) return;
    const list = manifest.versions || [];
    if (!list.length) {
      container.innerHTML = '<div class="history-empty">暂无版本记录</div>';
      return;
    }
    container.innerHTML = list.slice().reverse().map(v => `
      <div class="history-item glass">
        <div class="history-icon">⬢</div>
        <div class="history-meta">
          <div class="history-name">v${v.version} ${v.name || ""}</div>
          <div class="history-info">${(v.changelog || []).join(" · ") || "无更新说明"}</div>
        </div>
      </div>`).join("");
  }

  return { check, prompt, apply, getInstalledVersion, setInstalledVersion, renderVersions, APP_VERSION };
})();