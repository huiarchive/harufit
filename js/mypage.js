// 찜한 곳 보관함 — 찜한 장소를 지금 기준의 이동시간·날씨·혼잡도와 함께 보여줘요
(function () {
  const $ = (id) => document.getElementById(id);
  const STATE_KEY = 'daytrip:state';
  const CHUNK = 10;
  const PLACEHOLDER_IMG =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#F2F4F6"/><path d="M120 190l55-70 40 50 25-30 40 50z" fill="#D1D6DB"/><circle cx="260" cy="110" r="14" fill="#D1D6DB"/></svg>');

  let search = null;              // 마지막 검색(출발지·시간) — 있으면 이동시간을 계산해요
  let routes = {};
  let weather = {};
  let crowd = {};                 // { id: 혼잡도 집계 }
  const asked = { routes: new Set(), weather: new Set(), crowd: new Set() };
  let notice = '';

  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (s && s.origin && [4, 6, 8, 10].includes(s.hours)) search = { origin: s.origin, hours: s.hours };
  } catch (e) { search = null; }

  const heart = (on) =>
    `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 4.8 6.2 4.8c2 0 3.5 1.1 4.3 2.4.4.6 1.1.6 1.5 0 .8-1.3 2.3-2.4 4.3-2.4 3.5 0 5.3 3.6 3.8 7C19.5 16.4 12 21 12 21z" fill="${on ? '#F04452' : 'none'}" stroke="${on ? '#F04452' : '#8B95A1'}" stroke-width="2" stroke-linejoin="round"/></svg>`;

  // 찜한 장소마다 지금 기준의 정보를 붙여요
  function decorate(p) {
    const w = weather[p.id];
    const d = { ...p, w: w && w.ok ? w : null };
    const rainOut = isRainy(d.w) && ENV_BY_TYPE[p.typeId] === 'outdoor';
    d.rainOut = rainOut;
    if (search && p.lat && p.lng) {
      const straight = haversineKm(search.origin.lat, search.origin.lng, p.lat, p.lng);
      const real = routes[p.id];
      d.exact = !!(real && real.ok);
      d.oneWay = d.exact ? real.min : estimateOneWayMinutes(straight);
      d.roadKm = d.exact ? real.km : null;
      d.stay = search.hours * 60 - d.oneWay * 2;
    }
    return d;
  }

  function sorted(list) {
    // 비 예보가 있는 야외 장소는 뒤로, 그다음 오래 머물 수 있는 순 (출발지가 없으면 최근에 찜한 순)
    return list.sort((a, b) =>
      (a.rainOut - b.rainOut) ||
      (a.stay !== undefined && b.stay !== undefined ? b.stay - a.stay : (b.savedAt || 0) - (a.savedAt || 0)));
  }

  function crowdChip(id) {
    const c = crowd[id];
    if (!c) return '';
    if (c.total === 0) return '<span class="rounded-full bg-toss-bg px-3 py-1 text-sm font-medium text-toss-mute">혼잡도 제보 없음</span>';
    const top = CROWD.LEVELS.find((l) => l.key === c.topKey);
    return `<span class="rounded-full bg-toss-bg px-3 py-1 text-sm font-medium text-toss-sub">${top ? `${top.emoji} ${top.label}` : '의견이 나뉘어요'} · ${c.total}명</span>`;
  }

  function render() {
    const all = Object.values(Likes.all());
    const ctx = $('context');
    ctx.textContent = search
      ? `${search.origin.label}에서 ${search.hours}시간을 쓸 때 기준이에요. 비 예보가 있는 야외 장소는 뒤로 보내요.`
      : '목록에서 출발지를 정하면 이동시간과 체류 시간도 계산해 드려요.';
    $('notice').textContent = [notice, Likes.mode === 'local' ? '지금은 이 기기에만 저장돼요. (Firebase에 연결되면 계정에 저장돼요)' : ''].filter(Boolean).join(' ');
    $('notice').classList.toggle('hidden', !$('notice').textContent);

    const list = sorted(all.map(decorate));
    $('grid').innerHTML = list.map((d) => `
      <article data-id="${escapeHtml(d.id)}" class="relative rounded-3xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
        <button type="button" data-unlike="${escapeHtml(d.id)}" aria-label="찜 취소" class="absolute right-8 top-8 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow transition active:scale-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-toss-blue/30">${heart(true)}</button>
        <img src="${escapeHtml(toHttps(d.image) || PLACEHOLDER_IMG)}" alt="${escapeHtml(d.title)}" loading="lazy" class="aspect-[4/3] w-full rounded-2xl bg-toss-bg object-cover">
        <h3 class="mt-4 line-clamp-1 text-lg font-bold"><a href="detail.html?id=${encodeURIComponent(d.id)}" class="after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none focus-visible:after:ring-4 focus-visible:after:ring-toss-blue/30">${escapeHtml(d.title)}</a></h3>
        <p class="mt-1 line-clamp-1 text-sm text-toss-mute">${escapeHtml(d.addr || '주소 정보가 없어요')}</p>
        ${d.stay === undefined ? '' : `<div class="mt-4">
          <p class="text-sm font-medium text-toss-mute">현지에서 머물 수 있는 시간</p>
          <p class="mt-0.5 text-2xl font-bold ${d.stay < TRAVEL.MIN_STAY_MIN ? 'text-[#F76707]' : ''}">${d.stay < TRAVEL.MIN_STAY_MIN ? '시간이 모자라요' : formatDuration(d.stay)}</p>
          <p class="mt-1 text-sm text-toss-mute">${d.exact ? `자동차 편도 ${formatDuration(d.oneWay)} · ${d.roadKm}km` : `편도 약 ${formatDuration(d.oneWay)} (추정)`}</p>
        </div>`}
        <div class="mt-4 flex flex-wrap gap-2">
          ${d.typeLabel ? `<span class="rounded-full bg-toss-bg px-3 py-1 text-sm font-medium text-toss-sub">${escapeHtml(d.typeLabel)}</span>` : ''}
          ${d.w ? `<span class="rounded-full px-3 py-1 text-sm font-medium ${isRainy(d.w) ? 'bg-toss-soft text-toss-blue' : 'bg-toss-bg text-toss-sub'}">${escapeHtml(weatherChipText(d.w))}</span>` : ''}
          ${crowdChip(d.id)}
        </div>
        ${d.w && weatherAdvice(d, d.w) ? `<p class="mt-3 text-sm font-semibold ${weatherAdvice(d, d.w).tone === 'warn' ? 'text-[#F76707]' : 'text-toss-blue'}">${escapeHtml(weatherAdvice(d, d.w).text)}</p>` : ''}
      </article>`).join('');

    $('empty').innerHTML = all.length === 0
      ? `<div class="flex min-h-[320px] flex-col items-center justify-center rounded-3xl bg-white px-6 py-16 text-center">
           <div class="mb-4 text-5xl" aria-hidden="true">🤍</div>
           <p class="mb-1 text-xl font-bold">아직 찜한 곳이 없어요</p>
           <p class="max-w-sm text-toss-mute">목록에서 하트를 눌러 가고 싶은 곳을 담아 보세요.</p>
           <a href="index.html" class="mt-6 flex h-12 items-center rounded-2xl bg-toss-blue px-6 font-bold text-white transition active:scale-95">여행지 찾으러 가기</a>
         </div>`
      : '';

    enrich(all);
  }

  const chunks = (arr) => { const out = []; for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK)); return out; };

  // 아직 안 받은 정보만 받아 와서 다시 그려요 (이동시간·날씨·혼잡도)
  async function enrich(all) {
    const need = (set) => all.filter((p) => !set.has(p.id) && p.lat && p.lng);
    const rTodo = search ? need(asked.routes) : [];
    const wTodo = need(asked.weather);
    rTodo.forEach((p) => asked.routes.add(p.id));
    wTodo.forEach((p) => asked.weather.add(p.id));

    if (window.crowdStore) {
      const cTodo = all.filter((p) => !asked.crowd.has(p.id));
      cTodo.forEach((p) => asked.crowd.add(p.id)); // 먼저 모두 표시해 두어야 중복 구독이 생기지 않아요
      cTodo.forEach((p) => {
        window.crowdStore.subscribe(p.id, Date.now() - CROWD.WINDOW_MS,
          (list) => { crowd[p.id] = summarizeReports(list); render(); },
          (err) => console.error(err));
      });
    }
    if (rTodo.length === 0 && wTodo.length === 0) return;

    const [rRes, wRes] = await Promise.all([
      Promise.allSettled(chunks(rTodo).map((c) => fetchRoutes(search.origin, c))),
      Promise.allSettled(chunks(wTodo).map((c) => fetchWeather(c))),
    ]);
    rRes.forEach((r) => { if (r.status === 'fulfilled') Object.assign(routes, r.value || {}); else notice = '이동시간·날씨 일부를 불러오지 못했어요.'; });
    wRes.forEach((r) => { if (r.status === 'fulfilled') Object.assign(weather, r.value || {}); else notice = '이동시간·날씨 일부를 불러오지 못했어요.'; });
    render();
  }

  $('grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-unlike]');
    if (!btn) return;
    e.preventDefault();
    try {
      await Likes.remove(btn.dataset.unlike);
      toast('찜을 취소했어요');
    } catch (err) {
      console.error(err);
      toast('찜을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  });

  // Firebase 연결 후에야 혼잡도 구독이 가능해서, 연결이 끝나면 한 번 더 그려요
  if (window.__firebaseReady) render();
  else window.addEventListener('firebase-ready', () => render());
  Likes.onChange(() => render());
})();
