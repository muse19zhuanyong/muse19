/* 朗读站横幅「活场景」维持脚本 — 纯前端、零后端、零 AI（Lee 2026-11-07 定）。
   北京时间每 6 小时一集：05:30 晨间散步 / 11:30 溪边钓鱼 / 17:30 树枝黄昏 / 23:30 夜晚安睡。
   夜集 23:30–05:30 整段覆盖 00:00–05:30 静默窗，窗口内不发生换集。
   本脚本只做三件事：算集数、给 SVG 设 data-ep 与角色位移、定下一次换集的闹钟。 */
(function () {
  var svg = document.getElementById("sceneSvg");
  if (!svg) return;
  var CAST = {
    totoro: document.getElementById("castTotoro"),
    satsuki: document.getElementById("castSatsuki"),
    mei: document.getElementById("castMei"),
    sign: document.getElementById("propSign")
  };
  var BASE = {}, k;
  for (k in CAST) if (CAST[k]) BASE[k] = CAST[k].getAttribute("transform") || "";
  var EPS = [
    { totoro: "", satsuki: "", mei: "" },
    { totoro: "translate(-40,4)", satsuki: "translate(-150,10)", mei: "translate(-30,10)", sign: "translate(-110,0)" },
    { totoro: "translate(-120,-18) scale(0.85)", satsuki: "translate(40,-16)", mei: "translate(95,-14)" },
    { totoro: "", satsuki: "", mei: "translate(-4,2)" }
  ];
  var BOUND = [330, 690, 1050, 1410]; // 北京时间换集点（分钟）：05:30 / 11:30 / 17:30 / 23:30
  var timer = null;
  function bj() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    return { mins: d.getUTCHours() * 60 + d.getUTCMinutes(), secs: d.getUTCSeconds() };
  }
  function apply() {
    var t = bj();
    var ep = Math.floor(((t.mins - 330 + 1440) % 1440) / 360);
    svg.setAttribute("data-ep", ep);
    var cfg = EPS[ep];
    for (var k2 in CAST) {
      var el = CAST[k2];
      if (!el) continue;
      var v = (BASE[k2] + " " + (cfg[k2] || "")).trim();
      if (v) el.setAttribute("transform", v); else el.removeAttribute("transform");
    }
    var nowSec = t.mins * 60 + t.secs, next = null, i, b;
    for (i = 0; i < BOUND.length; i++) { b = BOUND[i] * 60; if (b > nowSec) { next = b; break; } }
    if (next === null) next = BOUND[0] * 60 + 86400;
    if (timer) clearTimeout(timer);
    timer = setTimeout(apply, (next - nowSec) * 1000 + 400);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) apply(); });
  apply();
})();

/* 扩展段：原画版（Lee 的图）+ 横幅切换 + 龙猫下页散步。集数跟随主段设置的 data-ep。 */
(function () {
  var fig = document.getElementById("scenePhoto");
  var svg = document.getElementById("sceneSvg");
  if (!fig || !svg) return;
  var wrap = fig.parentNode;
  function curEp() { var v = parseInt(svg.getAttribute("data-ep") || "0", 10); return isNaN(v) ? 0 : v; }
  var MODE = "draw";
  try { MODE = localStorage.getItem("qqr-scene-mode") || "draw"; } catch (e) {}
  var urls = {}, pdata = null, pTimer = null, pIdx = 0, pEp = -1;
  function loadPhoto(idx, cb) {
    if (urls[idx]) { cb(urls[idx]); return; }
    if (!pdata) { cb(null); return; }
    var ph = pdata.photos[idx], parts = [], done = 0;
    for (var k = 0; k < ph.parts; k++) { (function (k) {
      fetch("scene-photos-data/p" + idx + ".b64." + k).then(function (r) { return r.text(); }).then(function (t) {
        parts[k] = t; done++;
        if (done === ph.parts) {
          var bin = atob(parts.join("")), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          urls[idx] = URL.createObjectURL(new Blob([arr], { type: ph.mime }));
          cb(urls[idx]);
        }
      }).catch(function () { cb(null); });
    })(k); }
  }
  function showPhoto() {
    if (!pdata || MODE !== "photo") return;
    var list = pdata.slots[pEp]; if (!list || !list.length) return;
    var idx = list[pIdx % list.length];
    loadPhoto(idx, function (u) {
      if (!u || MODE !== "photo") return;
      var fg = document.getElementById("scenePhotoFg"), bg = document.getElementById("scenePhotoBg");
      if (!fg) return;
      var im = new Image();
      im.onload = function () { bg.src = u; fg.src = u; fg.style.opacity = 1; };
      fg.style.opacity = 0; im.src = u;
    });
  }
  function photoTick(ep) {
    var tint = document.getElementById("scenePhotoTint");
    if (tint) { tint.style.opacity = ep === 3 ? .42 : (ep === 2 ? .12 : 0); tint.style.background = ep === 2 ? "#b3541e" : "#16294d"; }
    if (ep !== pEp) {
      pEp = ep; pIdx = 0;
      if (pTimer) { clearInterval(pTimer); pTimer = null; }
      if (MODE === "photo") { showPhoto(); pTimer = setInterval(function () { pIdx++; showPhoto(); }, 45000); }
    }
  }
  function setMode(m) {
    MODE = m;
    try { localStorage.setItem("qqr-scene-mode", m); } catch (e) {}
    wrap.setAttribute("data-mode", m);
    fig.hidden = (m !== "photo");
    var btns = wrap.querySelectorAll(".scene-switch button");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("on", btns[i].getAttribute("data-sm") === m);
    if (pTimer) { clearInterval(pTimer); pTimer = null; }
    if (m === "photo") { pEp = -1; photoTick(curEp()); } else { hideRoam(); }
  }
  var ROAM = '<svg viewBox="0 0 100 118" xmlns="http://www.w3.org/2000/svg"><rect class="u" x="66.7" y="10" width="2.6" height="44" rx="1.3" fill="#3a3f45"/><g class="fL"><ellipse cx="34" cy="108" rx="11" ry="3.6" fill="#43514a"/></g><g class="fR"><ellipse cx="66" cy="108" rx="11" ry="3.6" fill="#43514a"/></g><path d="M36 26 L41 9 L48 23 Z" fill="#55645b"/><path d="M52 23 L59 9 L64 26 Z" fill="#55645b"/><path d="M50 21 C 78 21 92 46 91 70 C 90 94 74 106 50 106 C 26 106 10 94 9 70 C 8 46 22 21 50 21 Z" fill="#59685f"/><ellipse cx="50" cy="82" rx="27" ry="23" fill="#f3e9cf"/><g stroke="#55645b" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M36 78 q4 -5 8 0 M46 73 q4 -5 8 0 M56 78 q4 -5 8 0"/></g><circle cx="36" cy="43" r="4" fill="#fff"/><circle cx="64" cy="43" r="4" fill="#fff"/><circle cx="36.6" cy="42.4" r="1.9" fill="#26221f"/><circle cx="63.4" cy="42.4" r="1.9" fill="#26221f"/><ellipse cx="50" cy="50" rx="4.6" ry="2.2" fill="#33302e"/><g stroke="#3f4a44" stroke-width="1.6" stroke-linecap="round"><path d="M14 47 L2 44 M13 55 L1 55 M14 63 L3 67 M86 47 L98 44 M87 55 L99 55 M86 63 L97 67"/></g><path class="u" d="M40 17 Q68 1 96 17 Q82 10 68 17 Q54 10 40 17 Z" fill="#2f3338"/></svg>';
  var roamEl = null, roamAnim = null;
  /* 满页散步禁行时段（Lee 2026-11-09 定）：北京时间 07:00-16:00 只停满页走的龙猫，
     以免影响听 MP3；横幅内动画、原画轮换、换集等其他动画一律保留。
     页面跨过 07:00 自动停（正在走的当场收起）、跨过 16:00 自动恢复，不用刷新。 */
  var roamQuietTimer = null, roamBoundaryTimer = null;
  function roamReduced() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function bjDaySec() { var d = new Date(Date.now() + 8 * 3600 * 1000); return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(); }
  function roamQuiet() { var m = Math.floor(bjDaySec() / 60); return m >= 420 && m < 960; }
  function scheduleStrollAfterQuiet() {
    if (roamQuietTimer || roamReduced()) return;
    var wait = 960 * 60 - bjDaySec();
    if (wait <= 0) return;
    roamQuietTimer = setTimeout(function () { roamQuietTimer = null; stroll(); }, wait * 1000 + 1000);
  }
  function scheduleRoamBoundary() {
    if (roamBoundaryTimer) clearTimeout(roamBoundaryTimer);
    var now = bjDaySec(), start = 420 * 60;
    var wait = now < start ? start - now : start + 86400 - now;
    roamBoundaryTimer = setTimeout(function () {
      roamBoundaryTimer = null;
      if (roamQuiet()) { hideRoam(); scheduleStrollAfterQuiet(); }
      scheduleRoamBoundary();
    }, wait * 1000 + 500);
  }
  function buildRoam() {
    if (roamEl) return;
    roamEl = document.createElement("div");
    roamEl.id = "totoroRoam";
    roamEl.innerHTML = '<div class="flip"><div class="travel"><div class="shadow"></div><div class="bob">' + ROAM + '</div></div></div>';
    document.body.appendChild(roamEl);
  }
  function hideRoam() { if (roamAnim) { roamAnim.cancel(); roamAnim = null; } if (roamEl) roamEl.style.opacity = 0; }
  function stroll() {
    if (roamQuiet()) { hideRoam(); scheduleStrollAfterQuiet(); return; }
    if (roamAnim && (roamAnim.playState === "running" || roamAnim.playState === "paused")) return;
    if (MODE !== "draw" || document.hidden || !document.documentElement.classList.contains("ghibli-on")) { setTimeout(stroll, 30000); return; }
    buildRoam();
    var H = 109, W = 92, vw = window.innerWidth, vh = window.innerHeight;
    var fromLeft = Math.random() < 0.5;
    roamEl.classList.toggle("flip", !fromLeft);
    roamEl.classList.remove("umb");
    var startX, endX, dur, topPx, lane = null;
    if (Math.random() < 0.5) {
      var cands = [], els = document.querySelectorAll("header,.card,section,.ghibli-scene");
      for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.width > 240 && r.top > 80 && r.top < vh - 150) cands.push(r); }
      if (cands.length) lane = cands[Math.floor(Math.random() * cands.length)];
    }
    if (lane) {
      topPx = lane.top - H + 8;
      startX = fromLeft ? lane.left - W - 12 : lane.right + 12;
      endX = fromLeft ? lane.right + 12 : lane.left - W - 12;
      dur = Math.max(8000, Math.abs(endX - startX) * 40);
    } else {
      var feetY = vh * (0.32 + Math.random() * 0.6);
      topPx = feetY - H;
      startX = fromLeft ? -W - 20 : vw + 20;
      endX = fromLeft ? vw + 20 : -W - 20;
      dur = 23000 + Math.random() * 14000;
    }
    roamEl.style.top = topPx + "px";
    roamEl.style.opacity = 1;
    var travel = roamEl.querySelector(".travel");
    roamAnim = travel.animate([{ transform: "translateX(" + startX + "px)" }, { transform: "translateX(" + endX + "px)" }], { duration: dur, easing: "linear" });
    if (Math.random() < 0.65) {
      setTimeout(function () {
        if (roamAnim && roamAnim.playState === "running") {
          roamAnim.pause(); roamEl.classList.add("umb");
          setTimeout(function () { roamEl.classList.remove("umb"); if (roamAnim) roamAnim.play(); }, 2400 + Math.random() * 1200);
        }
      }, dur * (0.35 + Math.random() * 0.3));
    }
    roamAnim.onfinish = function () { roamEl.style.opacity = 0; roamAnim = null; setTimeout(stroll, 140000 + Math.random() * 220000); };
  }
  var sw = wrap.querySelectorAll(".scene-switch button");
  for (var i = 0; i < sw.length; i++) sw[i].addEventListener("click", function () { setMode(this.getAttribute("data-sm")); });
  new MutationObserver(function () { photoTick(curEp()); backdropTick(); }).observe(svg, { attributes: true, attributeFilter: ["data-ep"] });
  fetch("scene-photos-data/manifest.json").then(function (r) { return r.json(); }).then(function (j) { pdata = j; if (MODE === "photo") { pEp = -1; photoTick(curEp()); } backdropTick(); }).catch(function () {});

  /* 铺景两版：中档=淡云坡+手绘页脚；全页=原图页脚+两侧挂画+标题橡子。正文不动。 */
  var FOOT_SVG = '<svg viewBox="0 0 1200 180" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="180" fill="#f7ecd2"/><circle cx="1050" cy="38" r="24" fill="#ffd94d"/><path d="M0 96 Q 240 44 480 82 T 960 70 T 1200 88 V180 H0 Z" fill="#bfd4e2"/><path d="M0 128 Q 300 88 620 116 T 1200 122 V180 H0 Z" fill="#e9dcb4"/><ellipse cx="810" cy="152" rx="200" ry="17" fill="#a8d8ff"/><path d="M660 150 h90 M790 158 h110" stroke="#ffffff" stroke-width="2.4" opacity=".7" stroke-linecap="round"/><g><rect x="118" y="102" width="52" height="36" fill="#fdf6e3"/><polygon points="108,104 144,78 180,104" fill="#c96f3f"/><rect x="136" y="118" width="15" height="20" fill="#8a5a33"/></g><g><rect x="1018" y="106" width="7" height="34" fill="#8a5a33"/><circle cx="1021" cy="88" r="30" fill="#f2b8c6"/><circle cx="998" cy="100" r="18" fill="#f6ccd7"/><circle cx="1044" cy="100" r="18" fill="#f6ccd7"/></g><g fill="#e2543e"><circle cx="240" cy="158" r="5"/><circle cx="330" cy="166" r="5"/><circle cx="470" cy="160" r="5"/></g><g fill="#7fb2e0"><circle cx="285" cy="168" r="4.5"/><circle cx="420" cy="168" r="4.5"/><circle cx="560" cy="162" r="4.5"/></g><g fill="#ffb84d"><circle cx="360" cy="156" r="4.5"/><circle cx="520" cy="170" r="4.5"/><circle cx="610" cy="158" r="4.5"/></g></svg>';
  var scDiv = document.createElement("div");
  scDiv.id = "pageScenery";
  scDiv.setAttribute("aria-hidden", "true");
  scDiv.innerHTML = '<div class="sc-backdrop" id="scBackdrop"></div><div class="sc-hills"></div><div class="sc-cloud c1"></div><div class="sc-cloud c2"></div><div class="sc-cloud c3"></div>'
    + '<figure class="sc-side sc-left"><img id="scSideL" alt=""></figure><figure class="sc-side sc-right"><img id="scSideR" alt=""></figure>'
    + '<div class="sc-footer"><div class="sc-foot-drawn">' + FOOT_SVG + '</div><img id="scFootImg" alt=""></div>';
  document.body.appendChild(scDiv);
  var scSw = document.createElement("span");
  scSw.className = "scene-switch scenery-switch";
  scSw.innerHTML = '<button type="button" data-sc="off">铺景关</button><button type="button" data-sc="mid">铺景·中</button><button type="button" data-sc="full">铺景·全</button>';
  wrap.appendChild(scSw);
  var SC = "mid", scLoaded = false;
  try { SC = localStorage.getItem("qqr-scenery") || "mid"; } catch (e) {}
  var SC_IMGS = [0, 2, 1];
  function backdropTick() {
    if (SC !== "full") return;
    var bd = document.getElementById("scBackdrop");
    if (!bd) return;
    var days = Math.floor(Date.now() / 86400000);
    var idx = SC_IMGS[(days * 4 + curEp()) % 3];
    loadPhoto(idx, function (u) {
      if (!u || SC !== "full") return;
      var im = new Image();
      im.onload = function () {
        var maxW = Math.min(document.documentElement.clientWidth, im.naturalWidth * 2);
        var grad = idx === 0 ? "linear-gradient(180deg,#6fa3cf,#a9c48a 55%,#e9dcb4)"
          : (idx === 2 ? "linear-gradient(180deg,#8fc1e3,#b7c98a 55%,#eee0b8)"
          : "linear-gradient(180deg,#a9bf7a,#e9e2c0)");
        bd.style.backgroundImage = "url(" + u + "), " + grad;
        bd.style.backgroundSize = maxW + "px auto, 100% 100%";
        bd.style.backgroundPosition = "center top, center top";
      };
      im.src = u;
    });
  }
  function setScenery(v) {
    SC = v;
    try { localStorage.setItem("qqr-scenery", v); } catch (e) {}
    document.documentElement.setAttribute("data-scenery", v);
    var bs = scSw.querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-sc") === v);
    if (v === "full") { document.body.appendChild(scSw); scSw.classList.add("floating"); backdropTick(); }
    else { wrap.appendChild(scSw); scSw.classList.remove("floating"); }
  }
  var scb = scSw.querySelectorAll("button");
  for (var i = 0; i < scb.length; i++) scb[i].addEventListener("click", function () { setScenery(this.getAttribute("data-sc")); });
  var _origFetchCb = null;
  setScenery(SC);
  setMode(MODE);
  scheduleRoamBoundary();
  if (!roamReduced()) setTimeout(stroll, 35000);
})();
