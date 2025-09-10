// ==UserScript==
// @name                 Bilibili Video MP4 Copier + Picker (Sticky Mount, Auto Dark Mode)
// @name:zh-CN           Bilibili 视频直链复制与选择（稳固挂载，自动深色模式）
// @namespace            https://github.com/TZFC
// @version              0.5
// @description          Button + dropdown to copy progressive MP4 URLs. Persistently re-attaches if the player rerenders. Defaults to the lowest quality stream. Respects system dark mode.
// @description:zh-CN    在播放器内提供按钮与下拉菜单复制 MP4 直链；当播放器重绘时自动重新挂载；默认最低画质；跟随系统深色模式。
// @author               TZFC
// @match                *://www.bilibili.com/video/*
// @icon                 https://www.bilibili.com/favicon.ico
// @license              GPL-3.0
// @run-at               document-idle
// @grant                GM_setClipboard
// @grant                GM_xmlhttpRequest
// @connect              api.bilibili.com
// @downloadURL          https://update.greasyfork.org/scripts/548007/Bilibili%20Video%20MP4%20Copier.user.js
// @updateURL            https://update.greasyfork.org/scripts/548007/Bilibili%20Video%20MP4%20Copier.meta.js
// ==/UserScript==

(function () {
  "use strict";

  // Locale
  function determine_locale() {
    const languages = (navigator.languages && navigator.languages.length > 0)
      ? navigator.languages
      : [navigator.language || "en"];
    const primary = String(languages[0] || "en").toLowerCase();
    return primary.startsWith("zh") ? "zh-CN" : "en";
  }
  const current_locale = determine_locale();
  const L = {
    "en": {
      button_idle: "Copy MP4",
      button_fetching: "Fetching…",
      button_copied: "Copied ✅",
      button_error: "Error ❌",
      button_title: "Copy selected MP4 URL (VRChat, players, download)",
      dropdown_title: "Choose MP4 stream (lowest preselected)",
      placeholder: "Select stream…",
      size_unknown: "unknown",
      error_extract_bvid: "Could not extract BV identifier.",
      error_bad_json: "Failed to parse JSON.",
      error_no_mp4: "No MP4 found.",
      error_no_mp4_candidates: "No MP4 candidates."
    },
    "zh-CN": {
      button_idle: "复制 MP4",
      button_fetching: "获取中…",
      button_copied: "已复制 ✅",
      button_error: "出错 ❌",
      button_title: "复制所选 MP4 直链（VRChat、播放器、下载）",
      dropdown_title: "选择 MP4 流（默认最低画质）",
      placeholder: "选择流…",
      size_unknown: "未知",
      error_extract_bvid: "无法提取 BV 号。",
      error_bad_json: "JSON 解析失败。",
      error_no_mp4: "未找到 MP4。",
      error_no_mp4_candidates: "没有可用的 MP4。"
    }
  }[current_locale];

  // Styles (pink–blue palette, auto light/dark, accessible focus)
  const style_text = `
    .bili_mp4_tools { display:flex; align-items:center; gap:8px; margin-left:8px; }

    .bili_mp4_button {
      cursor:pointer; padding:6px 12px; font-size:12px; line-height:1;
      border:none; border-radius:8px;
      background: linear-gradient(135deg, #ff7ac3 0%, #7aa8ff 100%);
      color:#101010; font-weight:700; box-shadow: 0 2px 8px rgba(0,0,0,.15);
      transition: transform .08s ease, box-shadow .12s ease, filter .12s ease; user-select:none;
    }
    .bili_mp4_button:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,.2); filter: brightness(1.03); }
    .bili_mp4_button:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(0,0,0,.15); }
    .bili_mp4_button[disabled] { opacity:.6; cursor:not-allowed; }
    .bili_mp4_button:focus-visible { outline: 2px solid #7aa8ff; outline-offset: 2px; }

    .bili_mp4_select {
      appearance:none; -webkit-appearance:none; -moz-appearance:none;
      padding:6px 30px 6px 10px; font-size:12px; line-height:1;
      border-radius:8px; border:1px solid rgba(0,0,0,.15); color:#111; background:#ffffff;
      box-shadow: 0 1px 4px rgba(0,0,0,.08) inset; min-width:230px;
    }
    .bili_mp4_select:disabled { opacity:.6; cursor:not-allowed; }
    .bili_mp4_select:focus-visible { outline: 2px solid #ff7ac3; outline-offset: 2px; }

    /* Dark mode overrides */
    @media (prefers-color-scheme: dark) {
      .bili_mp4_button {
        color: #0f0f0f; /* bright gradient stays readable with dark UI; black text provides strong contrast */
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
      }
      .bili_mp4_button:hover { box-shadow: 0 4px 16px rgba(0,0,0,.5); }

      .bili_mp4_select {
        color:#e9e9e9;
        background:#16181b;
        border:1px solid rgba(255,255,255,.18);
        box-shadow: 0 1px 6px rgba(0,0,0,.6) inset;
      }
      .bili_mp4_select:focus-visible { outline-color: #7aa8ff; }
    }
  `;
  const style_element = document.createElement("style");
  style_element.textContent = style_text;
  document.documentElement.appendChild(style_element);

  // Utilities
  function extract_bvid_from_pathname() {
    const match = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    if (!match) throw new Error(L.error_extract_bvid);
    return match[1];
  }
  function extract_page_number() {
    const url_object = new URL(location.href);
    return parseInt(url_object.searchParams.get("p") || "1", 10);
  }
  function copy_plain_text_to_clipboard(text) {
    GM_setClipboard(text, { type: "text", mimetype: "text/plain" });
  }
  function http_get_json(url_string) {
    return new Promise((resolve_function, reject_function) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url_string,
        headers: { Referer: "https://www.bilibili.com/" },
        timeout: 30000,
        onload: (response_object) => {
          try { resolve_function(JSON.parse(response_object.responseText)); }
          catch { reject_function(new Error(L.error_bad_json)); }
        },
        onerror: () => reject_function(new Error("Network error: " + url_string)),
        ontimeout: () => reject_function(new Error("Network timeout: " + url_string))
      });
    });
  }
  function format_size(bytes_value) {
    if (!Number.isFinite(bytes_value) || bytes_value <= 0) return L.size_unknown;
    const units_list = ["B", "KB", "MB", "GB"];
    let unit_index = 0, value = bytes_value;
    while (value >= 1024 && unit_index < units_list.length - 1) { value /= 1024; unit_index++; }
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} ${units_list[unit_index]}`;
  }

  // API
  const playurl_cache_map = new Map(); // key = `${bvid}:${cid}`
  async function get_cid_for_page(bvid_value, page_number) {
    const json_result = await http_get_json(
      `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid_value)}&jsonp=jsonp`
    );
    const pages = Array.isArray(json_result?.data) ? json_result.data : [];
    const page_item = pages.find((item) => item.page === page_number) || pages[0];
    return page_item && page_item.cid;
  }
  async function get_progressive_mp4_list(bvid_value, cid_value) {
    const cache_key = `${bvid_value}:${cid_value}`;
    if (playurl_cache_map.has(cache_key)) return playurl_cache_map.get(cache_key);
    const params = new URLSearchParams({
      bvid: String(bvid_value),
      cid: String(cid_value),
      qn: "120",
      fourk: "1",
      fnver: "0",
      fnval: "0", // progressive MP4 (durl)
      otype: "json",
      platform: "html5"
    });
    const api_url = "https://api.bilibili.com/x/player/playurl?" + params.toString();
    const json_result = await http_get_json(api_url);
    const durl_array = json_result?.data?.durl;
    if (!Array.isArray(durl_array) || durl_array.length === 0) throw new Error(L.error_no_mp4);

    const collected = [];
    for (let part_index = 0; part_index < durl_array.length; part_index++) {
      const entry = durl_array[part_index];
      if (!entry) continue;
      const base_size = Number(entry.size || 0);
      const push_if_mp4 = (candidate, is_backup) => {
        if (!candidate) return;
        const lower = String(candidate).toLowerCase();
        if (lower.includes(".mp4") && !lower.includes(".m4s")) {
          collected.push({ url: candidate, size: base_size, is_backup: !!is_backup, part_index });
        }
      };
      push_if_mp4(entry.url, false);
      if (Array.isArray(entry.backup_url)) for (const bu of entry.backup_url) push_if_mp4(bu, true);
    }
    if (collected.length === 0) throw new Error(L.error_no_mp4_candidates);
    collected.sort((a, b) => (a.size || 0) - (b.size || 0)); // smallest first (lowest quality)
    playurl_cache_map.set(cache_key, collected);
    return collected;
  }

  // UI (persistent wrapper that reattaches)
  function create_controls() {
    const wrapper_element = document.createElement("div");
    wrapper_element.className = "bili_mp4_tools";
    wrapper_element.dataset.role = "bili_mp4_tools";

    const select_element = document.createElement("select");
    select_element.className = "bili_mp4_select";
    select_element.title = L.dropdown_title;

    const placeholder_option = document.createElement("option");
    placeholder_option.value = "";
    placeholder_option.disabled = true;
    placeholder_option.selected = true;
    placeholder_option.textContent = L.placeholder;
    select_element.appendChild(placeholder_option);

    const button_element = document.createElement("button");
    button_element.className = "bili_mp4_button";
    button_element.title = L.button_title;
    button_element.textContent = L.button_idle;

    wrapper_element.appendChild(select_element);
    wrapper_element.appendChild(button_element);
    return { wrapper_element, select_element, button_element };
  }
  function set_button_state(button_element, text, disabled) {
    button_element.textContent = text;
    button_element.disabled = !!disabled;
  }
  function populate_dropdown(select_element, item_list) {
    select_element.length = 1; // keep placeholder only
    for (let i = 0; i < item_list.length; i++) {
      const item = item_list[i];
      const option_element = document.createElement("option");
      const tag_text = item.is_backup ? "backup" : `part${item.part_index + 1}`;
      option_element.value = item.url;
      option_element.textContent = `#${i + 1} • ${format_size(item.size)} • ${tag_text}`;
      select_element.appendChild(option_element);
    }
    if (select_element.options.length > 1) select_element.selectedIndex = 1; // lowest quality by default
  }

  const controls = create_controls();
  let controls_loaded = false;
  async function load_streams_once() {
    if (controls_loaded) return;
    controls_loaded = true;
    set_button_state(controls.button_element, L.button_fetching, true);
    try {
      const bvid_value = extract_bvid_from_pathname();
      const page_number = extract_page_number();
      const cid_value = await get_cid_for_page(bvid_value, page_number);
      const list = await get_progressive_mp4_list(bvid_value, cid_value);
      populate_dropdown(controls.select_element, list);
      set_button_state(controls.button_element, L.button_idle, false);
    } catch (error_object) {
      console.error(error_object);
      set_button_state(controls.button_element, L.button_error, true);
    }
  }
  controls.select_element.addEventListener("mousedown", load_streams_once, { passive: true });
  controls.button_element.addEventListener("mousedown", load_streams_once, { passive: true });
  controls.button_element.addEventListener("click", async () => {
    if (!controls_loaded) await load_streams_once();
    if (!controls.select_element.value) {
      set_button_state(controls.button_element, L.button_error, true);
      setTimeout(() => set_button_state(controls.button_element, L.button_idle, false), 1200);
      return;
    }
    try {
      copy_plain_text_to_clipboard(controls.select_element.value);
      set_button_state(controls.button_element, L.button_copied, true);
    } catch (error_object) {
      console.error(error_object);
      set_button_state(controls.button_element, L.button_error, true);
    }
    setTimeout(() => set_button_state(controls.button_element, L.button_idle, false), 1200);
  }, { passive: true });

  // Robust, persistent mounting
  function find_target_container() {
    return document.querySelector("#bilibili-player .bpx-player-primary-area .bpx-player-sending-area");
  }
  function mount_controls_if_needed() {
    const target_container = find_target_container();
    if (!target_container) return;
    const in_document = document.contains(controls.wrapper_element);
    const parent_is_target = controls.wrapper_element.parentElement === target_container;
    if (!in_document || !parent_is_target) {
      try { target_container.appendChild(controls.wrapper_element); } catch {}
    }
  }
  let mount_scheduled = false;
  function schedule_mount() {
    if (mount_scheduled) return;
    mount_scheduled = true;
    requestAnimationFrame(() => { mount_scheduled = false; mount_controls_if_needed(); });
  }
  const mutation_observer = new MutationObserver(() => { schedule_mount(); });
  mutation_observer.observe(document.body, { childList: true, subtree: true });
  setInterval(mount_controls_if_needed, 1500);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule_mount();
  });
  mount_controls_if_needed();
})();
