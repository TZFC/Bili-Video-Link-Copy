// ==UserScript==
// @name                 Bilibili Video MP4 Copier + Picker (All Qualities, Native Select)
// @name:zh-CN           Bilibili 视频直链复制与选择（全清晰度，默认样式下拉）
// @namespace            https://github.com/TZFC
// @version              0.6
// @description          Button + dropdown to copy progressive MP4 URLs. Fetches all available qualities by iterating qn. Defaults to lowest quality. Persistent mounting.
// @description:zh-CN    通过遍历 qn 获取所有可用 MP4 清晰度，默认最低清晰度。支持播放器重绘时自动重新挂载。
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

  // Locale
  const locale = (()=>{
    const langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en"];
    return String(langs[0]||"en").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  })();
  const L = {
    "en": {
      button_idle:"Copy MP4", button_fetching:"Fetching…", button_copied:"Copied ✅", button_error:"Error ❌",
      button_title:"Copy selected MP4 URL",
      dropdown_title:"Choose MP4 stream (lowest preselected)",
      placeholder:"Select stream…", size_unknown:"unknown",
      label_unknown:"Unknown",
      error_extract_bvid:"Could not extract BV identifier.",
      error_bad_json:"Failed to parse JSON.",
      error_no_mp4:"No MP4 found.",
      error_no_mp4_candidates:"No MP4 candidates."
    },
    "zh-CN": {
      button_idle:"复制 MP4", button_fetching:"获取中…", button_copied:"已复制 ✅", button_error:"出错 ❌",
      button_title:"复制所选 MP4 直链",
      dropdown_title:"选择 MP4 流（默认最低画质）",
      placeholder:"选择流…", size_unknown:"未知",
      label_unknown:"未知",
      error_extract_bvid:"无法提取 BV 号。",
      error_bad_json:"JSON 解析失败。",
      error_no_mp4:"未找到 MP4。",
      error_no_mp4_candidates:"没有可用的 MP4。"
    }
  }[locale];

  // Minimal CSS (native select for readability)
  const style = document.createElement("style");
  style.textContent = `
    .bili_mp4_tools { display:flex; align-items:center; gap:8px; margin-left:8px; }
    .bili_mp4_button {
      cursor:pointer; padding:6px 12px; font-size:12px; line-height:1;
      border:none; border-radius:8px;
      background: linear-gradient(135deg, #ff7ac3 0%, #7aa8ff 100%);
      color:#101010; font-weight:700;
    }
    .bili_mp4_button[disabled]{ opacity:.6; cursor:not-allowed; }
    .bili_mp4_select { font-size:12px; min-width:200px; padding:4px 8px; }
  `;
  document.documentElement.appendChild(style);

  // Utils
  const getBV = ()=>{
    const m = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
    if(!m) throw new Error(L.error_extract_bvid);
    return m[1];
  };
  const getPage = ()=> {
    const u = new URL(location.href);
    return parseInt(u.searchParams.get("p") || "1", 10);
  };
  const clip = (t)=> GM_setClipboard(t, { type:"text", mimetype:"text/plain" });
  const fmtSize = (bytes)=>{
    if(!Number.isFinite(bytes) || bytes<=0) return L.size_unknown;
    const units=["B","KB","MB","GB"]; let i=0, v=bytes;
    while(v>=1024 && i<units.length-1){ v/=1024; i++; }
    return `${v.toFixed(v>=100?0:v>=10?1:2)} ${units[i]}`;
  };
  const httpGetJson = (url)=> new Promise((res, rej)=>{
    GM_xmlhttpRequest({
      method:"GET", url, headers:{ Referer:"https://www.bilibili.com/" }, timeout:30000,
      onload: r=>{ try{ res(JSON.parse(r.responseText)); }catch{ rej(new Error(L.error_bad_json)); } },
      onerror: ()=>rej(new Error("Network error: "+url)),
      ontimeout: ()=>rej(new Error("Network timeout: "+url))
    });
  });

  // API helpers
  const pagelistCache = new Map(); // bvid -> [{page,cid,...}]
  const playurlCache = new Map();  // `${bvid}:${cid}:qn=${qn}` -> durl list

  const getCidForPage = async (bvid, page)=>{
    if(!pagelistCache.has(bvid)){
      const js = await httpGetJson(`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}&jsonp=jsonp`);
      pagelistCache.set(bvid, Array.isArray(js?.data) ? js.data : []);
    }
    const arr = pagelistCache.get(bvid);
    const item = arr.find(x=>x.page===page) || arr[0];
    return item && item.cid;
  };

  // Fetch playurl for a specific qn (progressive MP4 via fnval=0)
  const fetchPlayurlForQn = async (bvid, cid, qn)=>{
    const key = `${bvid}:${cid}:qn=${qn}`;
    if(playurlCache.has(key)) return playurlCache.get(key);
    const params = new URLSearchParams({
      bvid:String(bvid), cid:String(cid),
      qn:String(qn), fourk:"1", fnver:"0", fnval:"0", // fnval=0 => progressive (durl)
      otype:"json", platform:"html5"
    });
    const js = await httpGetJson(`https://api.bilibili.com/x/player/playurl?${params.toString()}`);
    playurlCache.set(key, js);
    return js;
  };

  // Build the list of all progressive MP4 options across qualities
  const getAllMp4Options = async (bvid, cid)=>{
    // First call (any qn) to learn available qualities & labels
    const baseParams = new URLSearchParams({
      bvid:String(bvid), cid:String(cid),
      qn:"120", fourk:"1", fnver:"0", fnval:"0", otype:"json", platform:"html5"
    });
    const first = await httpGetJson(`https://api.bilibili.com/x/player/playurl?${baseParams.toString()}`);

    // Prefer support_formats (has new_description/display_desc), else accept_quality
    const support = Array.isArray(first?.data?.support_formats) ? first.data.support_formats : [];
    const acceptQ = Array.isArray(first?.data?.accept_quality) ? first.data.accept_quality : [];

    // From highest to lowest (as API usually lists). We want lowest default, so we’ll reverse later.
    let qualities = support.length
      ? support.map(s => ({ qn: s.quality, label: s.new_description || s.display_desc || String(s.quality) }))
      : acceptQ.map(qn => ({ qn, label: String(qn) }));

    // Dedup in case of overlaps, then sort by numeric qn ascending (so lowest first)
    const seen = new Set();
    qualities = qualities.filter(q=>{
      const k = String(q.qn);
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a,b)=> a.qn - b.qn);

    // For each quality, fetch progressive durl and pick first MP4 URL (primary)
    const results = [];
    for(const q of qualities){
      try{
        const js = await fetchPlayurlForQn(bvid, cid, q.qn);
        const durl = js?.data?.durl;
        if(!Array.isArray(durl) || durl.length===0) continue;

        // Find an entry that’s truly .mp4 (not .m4s)
        let picked = null;
        for(const e of durl){
          if(e?.url && String(e.url).toLowerCase().includes(".mp4") && !String(e.url).toLowerCase().includes(".m4s")){
            picked = { url: e.url, size: Number(e.size||0) };
            break;
          }
          if(Array.isArray(e?.backup_url)){
            const b = e.backup_url.find(u => String(u).toLowerCase().includes(".mp4") && !String(u).toLowerCase().includes(".m4s"));
            if(b){ picked = { url: b, size: Number(e.size||0) }; break; }
          }
        }
        if(picked){
          results.push({
            qn: q.qn,
            label: q.label || L.label_unknown,
            url: picked.url,
            size: picked.size
          });
        }
      }catch(e){
        // Ignore a failing tier; continue others
        console.debug("qn fetch failed", q.qn, e);
      }
    }

    // Fallback: if nothing was found via per-qn calls, try whatever durl came with first response
    if(results.length===0){
      const durl = first?.data?.durl;
      if(Array.isArray(durl)){
        for(const e of durl){
          if(e?.url && e.url.toLowerCase().includes(".mp4") && !e.url.toLowerCase().includes(".m4s")){
            results.push({ qn: first?.data?.quality ?? 0, label: L.label_unknown, url: e.url, size: Number(e.size||0) });
          }
        }
      }
    }

    // Sort by size ascending if sizes exist (smaller ~ lower quality), otherwise by qn ascending
    const haveSize = results.every(r => Number.isFinite(r.size) && r.size>0);
    results.sort((a,b)=>{
      return haveSize ? (a.size - b.size) : (a.qn - b.qn);
    });

    return results;
  };

  // UI
  const createControls = ()=>{
    const wrap = document.createElement("div");
    wrap.className = "bili_mp4_tools";

    const sel = document.createElement("select");
    sel.className = "bili_mp4_select";
    sel.title = L.dropdown_title;
    const ph = document.createElement("option");
    ph.value = ""; ph.disabled = true; ph.selected = true; ph.textContent = L.placeholder;
    sel.appendChild(ph);

    const btn = document.createElement("button");
    btn.className = "bili_mp4_button";
    btn.title = L.button_title;
    btn.textContent = L.button_idle;

    wrap.appendChild(sel);
    wrap.appendChild(btn);
    return { wrap, sel, btn };
  };

  const setBtn = (btn, label, dis)=>{ btn.textContent = label; btn.disabled = !!dis; };

  const populate = (sel, list)=>{
    sel.length = 1; // keep placeholder
    for(const it of list){
      const o = document.createElement("option");
      // Example label: "360P • 12.3 MB (qn=16)"
      const sizeTxt = fmtSize(it.size);
      o.value = it.url;
      o.textContent = `${it.label} • ${sizeTxt} (qn=${it.qn})`;
      sel.appendChild(o);
    }
    if(sel.options.length>1) sel.selectedIndex = 1; // default lowest
  };

  // Persistent mount
  const controls = createControls();
  let loaded = false;
  const loadOnce = async ()=>{
    if(loaded) return;
    loaded = true;
    setBtn(controls.btn, L.button_fetching, true);
    try{
      const bvid = getBV();
      const page = getPage();
      const cid = await getCidForPage(bvid, page);
      const list = await getAllMp4Options(bvid, cid);
      if(!list || list.length===0) throw new Error(L.error_no_mp4_candidates);
      populate(controls.sel, list);
      setBtn(controls.btn, L.button_idle, false);
    }catch(e){
      console.error(e);
      setBtn(controls.btn, L.button_error, true);
    }
  };
  controls.sel.addEventListener("mousedown", loadOnce, { passive:true });
  controls.btn.addEventListener("mousedown", loadOnce, { passive:true });
  controls.btn.addEventListener("click", async ()=>{
    if(!loaded) await loadOnce();
    if(!controls.sel.value){
      setBtn(controls.btn, L.button_error, true);
      setTimeout(()=>setBtn(controls.btn, L.button_idle, false), 1200);
      return;
    }
    try{
      clip(controls.sel.value);
      setBtn(controls.btn, L.button_copied, true);
    }catch(e){
      console.error(e);
      setBtn(controls.btn, L.button_error, true);
    }
    setTimeout(()=>setBtn(controls.btn, L.button_idle, false), 1200);
  }, { passive:true });

  function findTarget(){
    return document.querySelector("#bilibili-player .bpx-player-primary-area .bpx-player-sending-area");
  }
  function mountIfNeeded(){
    const t = findTarget();
    if(!t) return;
    if(controls.wrap.parentElement !== t){
      try{ t.appendChild(controls.wrap); }catch{}
    }
  }
  let rafPending = false;
  function scheduleMount(){
    if(rafPending) return;
    rafPending = true;
    requestAnimationFrame(()=>{ rafPending = false; mountIfNeeded(); });
  }
  const mo = new MutationObserver(()=>{ scheduleMount(); });
  mo.observe(document.body, { childList:true, subtree:true });
  setInterval(mountIfNeeded, 1500);
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") scheduleMount(); });
  mountIfNeeded();
})();
