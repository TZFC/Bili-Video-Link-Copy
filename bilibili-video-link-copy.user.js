// ==UserScript==
// @name                 Bilibili Video MP4 Copier
// @name:zh-CN           Bilibili 视频直链复制按钮
// @namespace            https://github.com/TZFC
// @version              0.1
// @description          Add a button inside the Bilibili player controls that copies the highest available progressive MP4 URL. Useful for VRChat, custom players, or direct download.
// @description:zh-CN    在Bilibili播放器工具栏内添加一个“复制MP4直链”按钮。复制的链接可用于VRChat、自定义播放器或直接下载。
// @downloadURL          https://raw.githubusercontent.com/SirHelper/Bili-Video-Link-Copy/main/bilibili-video-link-copy.user.js
// @updateURL            https://raw.githubusercontent.com/SirHelper/Bili-Video-Link-Copy/main/bilibili-video-link-copy.user.js
// @author               TZFC
// @match                *://www.bilibili.com/video/*
// @icon                 https://www.bilibili.com/favicon.ico
// @license              GPL-3.0
// @run-at               document-idle
// @grant                GM_setClipboard
// @grant                GM_xmlhttpRequest
// @connect              api.bilibili.com
// ==/UserScript==

(function () {
  "use strict";

  // -------------------------------
  // Locale Detection And Messages
  // -------------------------------
  function determine_locale() {
    const navigator_languages = (navigator.languages && navigator.languages.length > 0) ? navigator.languages : [navigator.language || "en"];
    const primary_language = String(navigator_languages[0] || "en").toLowerCase();
    if (primary_language.startsWith("zh")) return "zh-CN";
    return "en";
  }

  const current_locale = determine_locale();

  const locale_messages = {
    "en": {
      button_idle: "Copy MP4",
      button_fetching: "Fetching…",
      button_copied: "Copied ✅",
      button_error: "Error ❌",
      button_title: "Copy highest MP4 URL for VRChat",
      error_extract_bvid: "Could not extract BV identifier.",
      error_bad_json: "Failed to parse JSON.",
      error_no_mp4: "No MP4 found.",
      error_no_mp4_candidates: "No MP4 candidates.",
    },
    "zh-CN": {
      button_idle: "复制 MP4",
      button_fetching: "获取中…",
      button_copied: "已复制 ✅",
      button_error: "出错 ❌",
      button_title: "复制最高画质 MP4 直链（适用于 VRChat）",
      error_extract_bvid: "无法提取 BV 号。",
      error_bad_json: "JSON 解析失败。",
      error_no_mp4: "未找到 MP4。",
      error_no_mp4_candidates: "没有可用的 MP4。",
    }
  };

  const L = locale_messages[current_locale] || locale_messages["en"];

  // -------------------------------
  // Create A Styled Player Button
  // -------------------------------
  function create_download_button() {
    const button_element = document.createElement("div");
    button_element.textContent = L.button_idle;
    button_element.style.cursor = "pointer";
    button_element.style.padding = "4px 8px";
    button_element.style.fontSize = "12px";
    button_element.style.border = "1px solid #ccc";
    button_element.style.borderRadius = "6px";
    button_element.style.background = "#fff";
    button_element.style.marginLeft = "8px";
    button_element.style.userSelect = "none";
    button_element.title = L.button_title;
    return button_element;
  }

  function set_button_state(button_element, label_text, is_disabled) {
    button_element.textContent = label_text;
    button_element.style.opacity = is_disabled ? "0.6" : "1";
  }

  function copy_text_to_clipboard(plain_text) {
    GM_setClipboard(plain_text, { type: "text", mimetype: "text/plain" });
  }

  // -------------------------------
  // Bilibili API Calls
  // -------------------------------
  function extract_bvid() {
    const match_result = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    if (!match_result) throw new Error(L.error_extract_bvid);
    return match_result[1];
  }

  function extract_page_number() {
    const url_object = new URL(location.href);
    return parseInt(url_object.searchParams.get("p") || "1", 10);
  }

  function http_get_json(url_string) {
    return new Promise((resolve_function, reject_function) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url_string,
        headers: { Referer: "https://www.bilibili.com/" },
        timeout: 30000,
        onload: (response_object) => {
          try {
            resolve_function(JSON.parse(response_object.responseText));
          } catch {
            reject_function(new Error(L.error_bad_json));
          }
        },
        onerror: () => reject_function(new Error("Network error: " + url_string)),
        ontimeout: () => reject_function(new Error("Network timeout: " + url_string)),
      });
    });
  }

  async function get_cid_for_page(bvid_value, page_number) {
    const json_result = await http_get_json(
      `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid_value)}&jsonp=jsonp`
    );
    const page_item = json_result.data.find((item) => item.page === page_number) || json_result.data[0];
    return page_item.cid;
  }

  async function get_best_progressive_mp4(bvid_value, cid_value) {
    const params = new URLSearchParams({
      bvid: String(bvid_value),
      cid: String(cid_value),
      qn: "120",
      fourk: "1",
      fnver: "0",
      fnval: "0",
      otype: "json",
      platform: "html5",
    });
    const api_url = "https://api.bilibili.com/x/player/playurl?" + params.toString();
    const json_result = await http_get_json(api_url);

    if (!json_result.data?.durl) throw new Error(L.error_no_mp4);

    const candidate_urls = [];
    for (const entry of json_result.data.durl) {
      if (entry.url && entry.url.toLowerCase().includes(".mp4") && !entry.url.toLowerCase().includes(".m4s")) {
        candidate_urls.push({ url: entry.url, size: Number(entry.size || 0) });
      }
      if (Array.isArray(entry.backup_url)) {
        for (const backup of entry.backup_url) {
          if (backup && backup.toLowerCase().includes(".mp4") && !backup.toLowerCase().includes(".m4s")) {
            candidate_urls.push({ url: backup, size: Number(entry.size || 0) });
          }
        }
      }
    }
    if (candidate_urls.length === 0) throw new Error(L.error_no_mp4_candidates);

    candidate_urls.sort((a, b) => (b.size || 0) - (a.size || 0));
    return candidate_urls[0].url;
  }

  // -------------------------------
  // Attach Button To Player Controls
  // -------------------------------
  function add_download_button() {
    const target_area = document.querySelector(
      "#bilibili-player > div > div > div.bpx-player-primary-area > div.bpx-player-sending-area > div"
    );

    if (target_area && !target_area.querySelector(".download-btn")) {
      const download_button = create_download_button();
      download_button.classList.add("download-btn");
      target_area.appendChild(download_button);

      download_button.addEventListener("click", async () => {
        set_button_state(download_button, L.button_fetching, true);
        try {
          const bvid_value = extract_bvid();
          const page_number = extract_page_number();
          const cid_value = await get_cid_for_page(bvid_value, page_number);
          const mp4_url = await get_best_progressive_mp4(bvid_value, cid_value);
          copy_text_to_clipboard(mp4_url);
          set_button_state(download_button, L.button_copied, true);
        } catch (error_object) {
          console.error(error_object);
          set_button_state(download_button, L.button_error, true);
        }
        setTimeout(() => set_button_state(download_button, L.button_idle, false), 1500);
      });
    }
  }

  const mutation_observer = new MutationObserver(add_download_button);
  mutation_observer.observe(document.body, { childList: true, subtree: true });
  add_download_button();
})();
