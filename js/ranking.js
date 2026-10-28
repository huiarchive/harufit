// 인기 랭킹 — 찜 수 TOP과 혼잡도 제보 현황을 Firebase에서 실시간으로 받아 그려요
(function () {
  const $ = (id) => document.getElementById(id);
  const PLACEHOLDER_IMG =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect width="112" height="112" fill="#F2F4F6"/><path d="M28 78l20-26 14 18 9-11 14 19z" fill="#D1D6DB"/></svg>');
  const LEVEL = Object.fromEntries(CROWD.LEVELS.map((l) => [l.key, l]));
  let likesList = null; // null = 아직 받는 중
  let feed = null;

  const empty = (text) => `<p class="py-8 text-center text-sm text-toss-mute">${text}</p>`;

  function renderLikes() {
    if (likesList === null) { $('likesList').innerHTML = empty('불러오는 중이에요'); return; }
    if (likesList.length === 0) { $('likesList').innerHTML = empty('아직 찜한 곳이 없어요. 첫 찜의 주인공이 되어 보세요!'); return; }
    const top = likesList.slice(0, 10);
    const max = top[0].likes;
    $('likesList').innerHTML = top.map((p, i) => `
      <div class="flex items-center gap-3 border-b border-toss-line py-3 last:border-0">
        <span class="w-6 shrink-0 text-center text-lg font-extrabold ${i < 3 ? 'text-toss-blue' : 'text-toss-mute'}">${i + 1}</span>
        <img src="${escapeHtml(toHttps(p.image) || PLACEHOLDER_IMG)}" alt="" loading="lazy" class="h-14 w-14 shrink-0 rounded-xl bg-toss-bg object-cover">
        <div class="min-w-0 flex-1">
          <a href="detail.html?id=${encodeURIComponent(p.id)}" class="block truncate font-bold hover:underline">${escapeHtml(p.title)}</a>
          <p class="truncate text-xs text-toss-mute">${escapeHtml([p.typeLabel, p.addr].filter(Boolean).join(' · '))}</p>
          <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-toss-bg"><div class="h-full rounded-full ${i < 3 ? 'bg-toss-blue' : 'bg-[#B0B8C1]'}" style="width:${Math.max(4, Math.round((p.likes / max) * 100))}%"></div></div>
        </div>
        <span class="shrink-0 text-sm font-bold text-toss-sub">${p.likes}명</span>
      </div>`).join('');
  }

  function renderCrowd() {
    if (feed === null) { $('crowdList').innerHTML = empty('불러오는 중이에요'); return; }
    const agg = aggregateFeed(feed, Date.now()).slice(0, 5);
    if (agg.length === 0) { $('crowdList').innerHTML = empty('최근 2시간 동안 제보가 없어요. 상세 페이지에서 제보해 보세요.'); return; }
    $('crowdList').innerHTML = agg.map((g) => {
      const top = LEVEL[g.topKey];
      const segs = CROWD.LEVELS.filter((l) => g.counts[l.key] > 0)
        .map((l) => `<div style="flex:${g.counts[l.key]};background:${l.color}" title="${l.label} ${g.counts[l.key]}건"></div>`).join('');
      return `<div class="border-b border-toss-line py-3 last:border-0">
        <div class="flex items-baseline justify-between gap-3">
          <a href="detail.html?id=${encodeURIComponent(g.id)}" class="truncate font-bold hover:underline">${escapeHtml(g.title || '이름 없는 장소')}</a>
          <span class="shrink-0 text-sm font-semibold text-toss-sub">${top ? `${top.emoji} ${top.label}` : '의견이 나뉘어요'} · ${g.total}건</span>
        </div>
        <div class="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-toss-bg">${segs}</div>
      </div>`;
    }).join('');
  }

  function renderTicker() {
    if (feed === null) { $('ticker').innerHTML = empty('불러오는 중이에요'); return; }
    const now = Date.now();
    const recent = feed.filter((r) => r && r.level in LEVEL && typeof r.ts === 'number' && r.ts >= now - CROWD.WINDOW_MS).sort((a, b) => b.ts - a.ts).slice(0, 8);
    if (recent.length === 0) { $('ticker').innerHTML = empty('아직 올라온 제보가 없어요.'); return; }
    $('ticker').innerHTML = recent.map((r) => `
      <div class="flex items-center gap-2 py-2 text-sm">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:${LEVEL[r.level].color}" aria-hidden="true"></span>
        <span class="shrink-0 font-semibold">${LEVEL[r.level].emoji} ${LEVEL[r.level].label}</span>
        <a href="detail.html?id=${encodeURIComponent(r.id)}" class="min-w-0 flex-1 truncate text-toss-sub hover:underline">${escapeHtml(r.title || '')}</a>
        <span class="shrink-0 text-xs text-toss-mute">${timeAgo(r.ts, now)}</span>
      </div>`).join('');
  }

  function render() { renderLikes(); renderCrowd(); renderTicker(); }

  function fail(text) {
    $('notice').textContent = text;
    $('notice').classList.remove('hidden');
  }

  function start() {
    const store = window.rankingStore;
    if (!store) {
      likesList = []; feed = [];
      render();
      fail('Firebase에 연결되면 랭킹이 보여요. js/firebase-config.js 설정과 익명 로그인 사용 설정을 확인해 주세요.');
      return;
    }
    render();
    store.watchLikes((list) => { likesList = list; render(); }, (e) => { console.error(e); fail('찜 랭킹을 불러오지 못했어요.'); });
    store.watchFeed(Date.now() - CROWD.WINDOW_MS, (list) => { feed = list; render(); }, (e) => { console.error(e); fail('제보 현황을 불러오지 못했어요.'); });
    setInterval(render, 60 * 1000); // 2시간이 지난 제보가 빠지고, 시간 표시가 갱신돼요
  }

  Likes.onChange(() => {
    const badge = $('likeBadge');
    badge.textContent = String(Likes.count());
    badge.classList.toggle('hidden', Likes.count() === 0);
  });
  if (window.__firebaseReady) start();
  else window.addEventListener('firebase-ready', start, { once: true });
  render();
})();
