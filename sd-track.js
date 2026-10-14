/*!
 * sd-track.js — 시스디자인 기획페이지 행동 수집 (v1)
 *
 * 기획페이지 HTML 블록 맨 아래에 이 한 줄만 붙이면 됩니다.
 *   <script src="https://sinsia898-rgb.github.io/sd-analytics/sd-track.js"
 *           data-campaign="top_sofareplace_2610"
 *           data-endpoint="https://script.google.com/macros/s/XXXX/exec"
 *           data-key="WRITE_KEY" defer></script>
 *
 * 페이지 쪽 표시
 *   data-sd-root           : 기획페이지 전체를 감싸는 요소 (좌표·스크롤 기준)
 *   data-section="hero"    : 섹션 (위에서부터 순서대로)
 *   data-track="키"        : 클릭을 세고 싶은 버튼·링크 (예: showroom_cta, lineup:브루노)
 *   링크 없는 사진(img, [role=img], .sdp-img, [data-dead])을 누르면 "dead:섹션ID"로 기록
 *   data-sd-extra          : 눌러야 펼쳐지는 영역(드롭다운 등). 캡처 이미지에는 접힌 상태로 찍히므로
 *                            좌표 계산에서 이 높이를 빼고, 안쪽 클릭은 펼쳐지는 위치(맨 위)에 찍음
 *
 * 수집 방식
 *   방문 1회 = 1행. 탭을 벗어나거나 페이지를 떠날 때 sendBeacon으로 전송.
 *   다시 돌아왔다 떠나면 seq를 올려 한 번 더 보내고, 대시보드는 세션별 마지막 seq만 씀.
 */
(function () {
  "use strict";
  var me = document.currentScript;
  if (!me) return;
  var CAMPAIGN = me.getAttribute("data-campaign");
  var ENDPOINT = me.getAttribute("data-endpoint");
  var KEY = me.getAttribute("data-key") || "";
  if (!CAMPAIGN || !ENDPOINT || !navigator.sendBeacon) return;

  var MAX_POINTS = 150;
  var DEAD_SELECTOR = me.getAttribute("data-dead-selector") || "img, picture, [role=img], .sdp-img, [data-dead]";
  var INTERACTIVE = "a, button, input, select, textarea, label, summary, [data-track], [onclick], [role=button]";

  /* ---------- 식별자 ---------- */
  function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function store(type, k, v) {
    try { var s = window[type]; if (v === undefined) return s.getItem(k); s.setItem(k, v); } catch (e) { return null; }
  }
  var visitorId = store("localStorage", "sd_vid") || rid();
  store("localStorage", "sd_vid", visitorId);
  var sessionId = rid();

  /* ---------- UTM (첫 유입값을 탭 안에서 유지) ---------- */
  var qs = new URLSearchParams(location.search);
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var utm = {};
  var saved = null;
  try { saved = JSON.parse(store("sessionStorage", "sd_utm_" + CAMPAIGN) || "null"); } catch (e) {}
  UTM_KEYS.forEach(function (k) { utm[k] = qs.get(k) || (saved && saved[k]) || ""; });
  if (UTM_KEYS.some(function (k) { return qs.get(k); })) store("sessionStorage", "sd_utm_" + CAMPAIGN, JSON.stringify(utm));

  /* ---------- 기기 ---------- */
  var coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  var device = (coarse || window.innerWidth < 768) ? "mobile" : "pc";

  /* ---------- 상태 ---------- */
  var startedAt = new Date();
  var activeMs = 0, activeSince = document.visibilityState === "visible" ? Date.now() : 0;
  var reached = {};          // 섹션ID → true
  var order = [];            // 페이지 순서대로 섹션ID
  var clicks = {};           // 키 → 횟수
  var points = [];           // [x%, y%]
  var maxScroll = 0;
  var seq = 0;
  var root = null;

  function rootEl() { return root || (root = document.querySelector("[data-sd-root]") || document.body); }

  /* ---------- 섹션 도달 (화면 위 60% 지점을 지나면 도달) ---------- */
  function watchSections() {
    var secs = rootEl().querySelectorAll("[data-section]");
    order = Array.prototype.map.call(secs, function (s) { return s.getAttribute("data-section"); });
    if (!secs.length) return;
    if (!("IntersectionObserver" in window)) { order.forEach(function (id) { reached[id] = true; }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { reached[en.target.getAttribute("data-section")] = true; io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -40% 0px", threshold: 0 });
    Array.prototype.forEach.call(secs, function (s) { io.observe(s); });
  }

  /* ---------- 스크롤 깊이 (기획페이지 블록 기준 %) ---------- */
  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var r = rootEl().getBoundingClientRect();
      if (r.height <= 0) return;
      var seen = (window.innerHeight - r.top) / r.height * 100;
      if (seen > maxScroll) maxScroll = Math.min(100, Math.max(0, seen));
    });
  }

  /* ---------- 클릭 ---------- */
  function sectionOf(el) { var s = el.closest && el.closest("[data-section]"); return s ? s.getAttribute("data-section") : ""; }
  function onClick(e) {
    var t = e.target; if (!t || !t.closest) return;
    var r = rootEl().getBoundingClientRect();
    var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) return;
    var key = "";
    var tracked = t.closest("[data-track]");
    if (tracked) key = tracked.getAttribute("data-track");
    else if (!t.closest(INTERACTIVE) && t.closest(DEAD_SELECTOR)) key = "dead:" + (sectionOf(t) || "page");
    if (key) clicks[key] = (clicks[key] || 0) + 1;
    if (points.length < MAX_POINTS) {
      // 펼쳐진 영역 보정: 접힌 상태(캡처 이미지)의 좌표로 환산
      var y = e.clientY - r.top, h = r.height;
      Array.prototype.forEach.call(rootEl().querySelectorAll("[data-sd-extra]"), function (x) {
        var xr = x.getBoundingClientRect(); if (xr.height <= 0) return;
        var top = xr.top - r.top;
        if (y >= top + xr.height) y -= xr.height; else if (y > top) y = top;
        h -= xr.height;
      });
      points.push([
        Math.round((e.clientX - r.left) / r.width * 1000) / 10,
        Math.round(Math.min(100, y / h * 100) * 10) / 10
      ]);
    }
  }

  /* ---------- 체류 (탭이 보일 때만 누적) ---------- */
  function pause() { if (activeSince) { activeMs += Date.now() - activeSince; activeSince = 0; } }
  function resume() { if (!activeSince) activeSince = Date.now(); dirty = true; }

  /* ---------- 전송 ---------- */
  // 바로가기 버튼으로 건너뛴 섹션도 '그 아래까지 내려왔다'면 도달로 봄 (퍼널 = 어디까지 내려왔나)
  function deepest() { var d = -1; order.forEach(function (id, i) { if (reached[id]) d = i; }); return d; }
  var dirty = true;
  function send() {
    pause();
    if (!dirty) return;      // 숨김·이탈 이벤트가 연달아 와도 한 번만 전송
    dirty = false;
    seq++;
    var payload = {
      key: KEY, campaign_id: CAMPAIGN, session_id: sessionId, seq: seq, visitor_id: visitorId,
      started_at: startedAt.toISOString(), device: device, viewport_w: window.innerWidth,
      utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign,
      utm_content: utm.utm_content, utm_term: utm.utm_term,
      referrer: document.referrer ? document.referrer.split("?")[0].slice(0, 200) : "",
      duration_sec: Math.round(activeMs / 1000),
      max_scroll_pct: Math.round(maxScroll),
      sections: order.slice(0, deepest() + 1).join("|"),
      clicks: Object.keys(clicks).map(function (k) { return k + "=" + clicks[k]; }).join("|"),
      click_points: JSON.stringify(points)
    };
    try { navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(payload)], { type: "text/plain;charset=UTF-8" })); } catch (e) {}
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") send(); else resume();
  });
  window.addEventListener("pagehide", function () { if (document.visibilityState !== "hidden") send(); });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", onClick, true);

  function init() { watchSections(); onScroll(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  // 테스트용: 콘솔에서 sdTrack.peek() 으로 현재 수집값 확인
  window.sdTrack = { peek: function () { return { reached: order.slice(0, deepest() + 1), clicks: clicks, points: points.length, maxScroll: Math.round(maxScroll), activeSec: Math.round((activeMs + (activeSince ? Date.now() - activeSince : 0)) / 1000), utm: utm, device: device }; } };
})();
