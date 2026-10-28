// 화면(DOM) 담당 — 선택 → API 호출 → 카드 렌더링
(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    tabSearch: $('tabSearch'),
    tabList: $('tabList'),
    panelSearch: $('panelSearch'),
    panelList: $('panelList'),
    placeInput: $('placeInput'),
    placeResults: $('placeResults'),
    placeMsg: $('placeMsg'),
    originChip: $('originChip'),
    hoursChips: $('hoursChips'),
    originSido: $('originSido'),
    originSigungu: $('originSigungu'),
    destArea: $('destArea'),
    searchBtn: $('searchBtn'),
    summary: $('summary'),
    grid: $('grid'),
    state: $('state'),
  };

  const PAGE_SIZE = 24; // 한 번에 보여주는 카드 수
  const PAGE_SIZE_INIT = PAGE_SIZE;
  const ROUTE_CHUNK = 10; // 길찾기는 한 번에 최대 10곳씩 요청해요

  // 이미지가 없거나 불러오기 실패했을 때 보여줄 대체 이미지
  const PLACEHOLDER_IMG =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
        '<rect width="400" height="300" fill="#F2F4F6"/>' +
        '<path d="M120 190l55-70 40 50 25-30 40 50z" fill="#D1D6DB"/>' +
        '<circle cx="260" cy="110" r="14" fill="#D1D6DB"/></svg>'
    );

  let isLoading = false;
  let origin = null; // { lat, lng, label, source: 'search' | 'list' }
  let lastResults = [];
  let hours = 8; // 오늘 쓸 수 있는 시간
  let lastSearch = null; // { items, origin, dest } — 시간을 바꿀 때 다시 불러오지 않고 재계산해요
  let excludedCount = 0;
  let routes = {}; // 카카오 길찾기 결과 { 장소id: { ok, min, km } }
  let routesKey = ''; // routes가 어느 출발지 기준인지
  let routeNote = '';
  let weather = {}; // 목적지 날씨 { 장소id: { ok, tempMax, pop, pty, sky } }
  let weatherNote = '';
  let envFilter = 'all'; // 'all' | 'indoor' | 'outdoor'
  let currentShown = PAGE_SIZE_INIT;
  let pendingRestore = null; // 저장해 둔 마지막 검색을 되살리는 중이면 { shown, envFilter, scrollY }
  let currentMode = 'search';
  const STATE_KEY = 'daytrip:state';
  const STATE_MAX_AGE = 6 * 60 * 60 * 1000; // 6시간 안에 돌아오면 그대로 복원해요
  let renderedPlaces = [];  // 지금 화면에 그려진 장소들 (상세 페이지로 넘길 때 써요)
  const LEVEL_STYLE = {
    '여유': 'bg-toss-soft text-toss-blue',
    '보통': 'bg-toss-bg text-toss-sub',
    '빠듯': 'bg-[#FFF4E6] text-[#F76707]',
  };
  let searchSeq = 0;
  let debounceTimer = null;

  // ---------- 선택 상자 ----------
  function setOptions(select, placeholder, options) {
    select.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    options.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      select.appendChild(op);
    });
  }

  function initSelects() {
    setOptions(els.originSido, '시/도를 골라 주세요', REGIONS.map((r) => ({ value: r.name, label: r.name })));
    setOptions(els.originSigungu, '시/군/구를 골라 주세요', []);
    els.originSigungu.disabled = true;
    setOptions(els.destArea, '가고 싶은 지역을 골라 주세요', REGIONS.map((r) => ({ value: r.areaCode, label: r.name })));
  }

  function updateButton() {
    const ready = origin && els.destArea.value;
    els.searchBtn.disabled = isLoading || !ready;
    els.searchBtn.textContent = isLoading ? '찾는 중이에요' : '여행지 찾아보기';
  }

  function onSidoChange() {
    const sido = REGIONS.find((r) => r.name === els.originSido.value);
    const districts = sido ? sido.districts : [];
    setOptions(els.originSigungu, '시/군/구를 골라 주세요', districts.map((d) => ({ value: d.name, label: d.name })));
    els.originSigungu.disabled = !sido;
    if (origin && origin.source === 'list') setOrigin(null);
    updateButton();
  }

  function onSigunguChange() {
    const sido = REGIONS.find((r) => r.name === els.originSido.value);
    const d = sido && sido.districts.find((x) => x.name === els.originSigungu.value);
    setOrigin(d ? { lat: d.lat, lng: d.lng, label: `${sido.short} ${d.name}`, source: 'list' } : null);
  }

  // ---------- 출발지: 동네 검색 ----------
  function setOrigin(o) {
    origin = o;
    els.originChip.classList.toggle('hidden', !o);
    els.originChip.textContent = o ? `📍 ${o.label}에서 출발해요` : '';
    updateButton();
  }

  function setMode(mode) {
    currentMode = mode;
    const search = mode === 'search';
    els.panelSearch.classList.toggle('hidden', !search);
    els.panelList.classList.toggle('hidden', search);
    [[els.tabSearch, search], [els.tabList, !search]].forEach(([btn, on]) => {
      btn.setAttribute('aria-selected', String(on));
      btn.classList.toggle('bg-white', on);
      btn.classList.toggle('shadow-sm', on);
      btn.classList.toggle('text-toss-mute', !on);
    });
  }

  function showPlaceMsg(text) {
    els.placeMsg.textContent = text;
    els.placeMsg.classList.toggle('hidden', !text);
  }

  function hideResults() {
    els.placeResults.classList.add('hidden');
    els.placeResults.innerHTML = '';
    lastResults = [];
  }

  function onPlaceInput() {
    if (origin && origin.source === 'search') setOrigin(null); // 다시 입력하면 새로 골라야 해요
    clearTimeout(debounceTimer);
    const q = els.placeInput.value.trim();
    if (q.length < 2) { hideResults(); showPlaceMsg(''); return; }
    debounceTimer = setTimeout(() => runPlaceSearch(q), 350);
  }

  async function runPlaceSearch(q) {
    const seq = ++searchSeq; // 늦게 도착한 이전 검색 결과는 무시해요
    showPlaceMsg('찾는 중이에요');
    try {
      const items = await searchPlaces(q);
      if (seq !== searchSeq) return;
      if (items.length === 0) {
        hideResults();
        showPlaceMsg('검색 결과가 없어요. 동 이름이나 주소를 다시 확인해 주세요.');
        return;
      }
      showPlaceMsg('');
      lastResults = items;
      els.placeResults.innerHTML = items
        .map((it, i) => `<li><button type="button" data-i="${i}" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[15px] transition hover:bg-toss-bg focus-visible:bg-toss-bg focus-visible:outline-none"><span class="font-medium">${escapeHtml(it.label)}</span><span class="shrink-0 text-xs text-toss-mute">${escapeHtml(it.kind)}</span></button></li>`)
        .join('');
      els.placeResults.classList.remove('hidden');
    } catch (e) {
      if (seq !== searchSeq) return;
      hideResults();
      showPlaceMsg(e.message || '검색에 실패했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  function pickPlace(i) {
    const it = lastResults[i];
    if (!it) return;
    els.placeInput.value = it.label;
    hideResults();
    showPlaceMsg('');
    setOrigin({ lat: it.lat, lng: it.lng, label: it.label, source: 'search' });
  }

  // ---------- 화면 상태 ----------
  function showState({ emoji, title, desc, actionLabel, onAction }) {
    els.grid.innerHTML = '';
    els.summary.classList.add('hidden');
    els.state.innerHTML = `
      <div class="flex min-h-[420px] flex-col items-center justify-center rounded-3xl bg-white px-6 py-16 text-center">
        <div class="mb-4 text-5xl" aria-hidden="true">${emoji}</div>
        <p class="mb-1 text-xl font-bold">${escapeHtml(title)}</p>
        <p class="max-w-sm text-toss-mute">${escapeHtml(desc)}</p>
        ${actionLabel ? `<button id="stateAction" type="button" class="mt-6 h-12 rounded-2xl bg-toss-soft px-6 font-bold text-toss-blue transition active:scale-95">${escapeHtml(actionLabel)}</button>` : ''}
      </div>`;
    if (actionLabel && onAction) $('stateAction').addEventListener('click', onAction);
  }

  function showSkeleton() {
    els.state.innerHTML = '';
    els.summary.classList.add('hidden');
    els.grid.innerHTML = Array.from({ length: 6 })
      .map(
        () => `
      <div class="animate-pulse rounded-3xl bg-white p-5" aria-hidden="true">
        <div class="aspect-[4/3] rounded-2xl bg-toss-bg"></div>
        <div class="mt-4 h-5 w-2/3 rounded bg-toss-bg"></div>
        <div class="mt-2 h-4 w-full rounded bg-toss-bg"></div>
        <div class="mt-4 h-7 w-24 rounded-full bg-toss-bg"></div>
      </div>`
      )
      .join('');
  }

  // ---------- 찜하기 ----------
  function heartSvg(on) {
    return `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 4.8 6.2 4.8c2 0 3.5 1.1 4.3 2.4.4.6 1.1.6 1.5 0 .8-1.3 2.3-2.4 4.3-2.4 3.5 0 5.3 3.6 3.8 7C19.5 16.4 12 21 12 21z" fill="${on ? '#F04452' : 'none'}" stroke="${on ? '#F04452' : '#8B95A1'}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  function heartHtml(id) {
    const on = Likes.has(id);
    return `<button type="button" data-like="${escapeHtml(id)}" aria-pressed="${on}" aria-label="${on ? '찜 취소' : '찜하기'}" class="absolute right-8 top-8 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow transition active:scale-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-toss-blue/30">${heartSvg(on)}</button>`;
  }

  // 찜 상태가 바뀌면 카드의 하트와 상단 숫자만 바꿔요 (카드를 다시 그리지 않아요)
  function paintHearts() {
    els.grid.querySelectorAll('button[data-like]').forEach((b) => {
      const on = Likes.has(b.dataset.like);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? '찜 취소' : '찜하기');
      b.innerHTML = heartSvg(on);
    });
    const badge = $('likeBadge');
    if (badge) {
      badge.textContent = String(Likes.count());
      badge.classList.toggle('hidden', Likes.count() === 0);
    }
  }

  async function toggleLike(id) {
    const p = renderedPlaces.find((x) => x.id === id);
    if (!p) return;
    try {
      const added = await Likes.toggle(p);
      toast(added ? '찜한 곳에 담았어요' : '찜을 취소했어요');
    } catch (e) {
      console.error(e);
      toast('찜을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  // ---------- 마지막 검색 저장·복원 ----------
  function saveState() {
    if (!lastSearch) return;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        origin: lastSearch.origin,
        sido: els.originSido.value,
        sigungu: els.originSigungu.value,
        mode: currentMode,
        destCode: lastSearch.dest.areaCode,
        hours,
        envFilter,
        shown: currentShown,
        scrollY: Math.round(window.scrollY || 0),
        savedAt: Date.now(),
      }));
    } catch (e) { /* 저장이 안 돼도 검색은 계속 돼요 */ }
  }

  function restoreState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || !s.origin || !s.destCode || Date.now() - s.savedAt > STATE_MAX_AGE) return;
    if (!REGIONS.some((r) => r.areaCode === s.destCode)) return;

    if (s.mode === 'list' && s.sido) {
      setMode('list');
      els.originSido.value = s.sido;
      onSidoChange();
      els.originSigungu.value = s.sigungu;
    } else {
      els.placeInput.value = s.origin.label;
    }
    setOrigin(s.origin);
    els.destArea.value = s.destCode;
    if ([4, 6, 8, 10].includes(s.hours)) setHours(s.hours);
    pendingRestore = { shown: s.shown, envFilter: s.envFilter, scrollY: s.scrollY };
    onSearch();
  }

  const ENV_LABEL = { all: '전체', indoor: '실내', outdoor: '야외' };
  const ADVICE_STYLE = { warn: 'text-[#F76707]', good: 'text-toss-blue' };

  function weatherChip(p) {
    const w = weather[p.id];
    if (!w || !w.ok) return '';
    const style = isRainy(w) ? 'bg-toss-soft text-toss-blue' : 'bg-toss-bg text-toss-sub';
    return `<span class="rounded-full px-3 py-1 text-sm font-medium ${style}">${escapeHtml(weatherChipText(w))}</span>`;
  }

  function weatherAdviceHtml(p) {
    const a = weatherAdvice(p, weather[p.id]);
    return a ? `<p class="mt-3 text-sm font-semibold ${ADVICE_STYLE[a.tone]}">${escapeHtml(a.text)}</p>` : '';
  }

  function envFilterHtml() {
    const buttons = Object.keys(ENV_LABEL)
      .map((k) => `<button type="button" data-env="${k}" aria-pressed="${envFilter === k}" class="h-9 rounded-lg px-4 text-sm font-semibold transition ${envFilter === k ? 'bg-toss-blue text-white' : 'text-toss-sub'}">${ENV_LABEL[k]}</button>`)
      .join('');
    return `<div class="mt-4 inline-grid grid-cols-3 gap-1 rounded-xl bg-white p-1" role="group" aria-label="실내 야외 필터">${buttons}</div>`;
  }

  // 보이는 장소의 절반 이상이 비 예보면 실내 필터를 권해요
  function rainHintHtml(places, shown) {
    if (envFilter === 'indoor') return '';
    const known = places.slice(0, shown).map((p) => weather[p.id]).filter((w) => w && w.ok);
    if (known.length === 0) return '';
    return known.filter(isRainy).length / known.length >= 0.5
      ? `<p class="mt-3 rounded-xl bg-[#FFF4E6] px-4 py-3 text-sm font-semibold text-[#F76707]">이 지역은 비 예보가 있어요. '실내'로 보면 비를 피할 수 있어요.</p>`
      : '';
  }

  function renderPlaces(places, origin, destShort, shown = PAGE_SIZE) {
    currentShown = shown;
    renderedPlaces = places;
    saveState();
    els.state.innerHTML = '';
    els.summary.classList.remove('hidden');
    els.summary.innerHTML = `
      <h2 class="text-2xl font-bold">${escapeHtml(origin.label)}에서 ${hours}시간 안에 다녀올 수 있는 ${escapeHtml(destShort)} 여행지</h2>
      <p class="mt-1 text-toss-mute">${places.length}곳을 찾았어요. 현지에서 오래 머물 수 있는 순서예요.${excludedCount > 0 ? ` 체류 시간이 1시간도 안 되는 ${excludedCount}곳은 뺐어요.` : ''}${places.some((p) => p.exact) ? ' 자동차 시간은 카카오 길찾기 기준이며 교통 상황에 따라 달라질 수 있어요.' : ''}${routeNote ? ` ${escapeHtml(routeNote)}` : ''}${weatherNote ? ` ${escapeHtml(weatherNote)}` : ''}</p>${rainHintHtml(places, shown)}${envFilterHtml()}`;

    els.grid.innerHTML = places
      .slice(0, shown)
      .map(
        (p) => `
      <article data-id="${escapeHtml(p.id)}" class="relative rounded-3xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)]">
        ${heartHtml(p.id)}
        <img src="${escapeHtml(p.image || PLACEHOLDER_IMG)}" alt="${escapeHtml(p.title)}" loading="lazy"
             class="aspect-[4/3] w-full rounded-2xl bg-toss-bg object-cover">
        <h3 class="mt-4 line-clamp-1 text-lg font-bold"><a href="detail.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener" class="after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none focus-visible:after:ring-4 focus-visible:after:ring-toss-blue/30">${escapeHtml(p.title)}</a></h3>
        <p class="mt-1 line-clamp-1 text-sm text-toss-mute">${escapeHtml(p.addr || '주소 정보가 없어요')}</p>
        <div class="mt-4">
          <p class="text-sm font-medium text-toss-mute">현지에서 머물 수 있는 시간</p>
          <p class="mt-0.5 text-2xl font-bold">${formatDuration(p.stayMin)}</p>
          <p class="mt-1 text-sm text-toss-mute">${p.exact ? `자동차 편도 ${formatDuration(p.oneWayMin)} · ${p.roadKm}km` : `편도 약 ${formatDuration(p.oneWayMin)} (추정) · 직선 ${formatDistance(p.distanceKm)}`}</p>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <span class="rounded-full px-3 py-1 text-sm font-semibold ${LEVEL_STYLE[p.level]}">${p.level}</span>
          <span class="rounded-full bg-toss-bg px-3 py-1 text-sm font-medium text-toss-sub">${escapeHtml(p.typeLabel)}</span>
          ${weatherChip(p)}
        </div>
        ${weatherAdviceHtml(p)}
      </article>`
      )
      .join('');

    if (places.length > shown) {
      els.state.innerHTML = `<div class="mt-6 flex justify-center"><button id="moreBtn" type="button" class="h-12 rounded-2xl bg-white px-8 font-bold text-toss-blue shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition active:scale-95">더 보기 (${shown}/${places.length})</button></div>`;
      $('moreBtn').addEventListener('click', () => renderPlaces(places, origin, destShort, shown + PAGE_SIZE));
    }

    enrichVisible(places.slice(0, shown), origin); // 보이는 카드만 실제 이동시간으로 바꿔요

    // 이미지 로딩에 실패하면 대체 이미지로 바꿔요
    els.grid.querySelectorAll('img').forEach((img) => {
      img.addEventListener('error', () => {
        img.onerror = null;
        img.src = PLACEHOLDER_IMG;
      }, { once: true });
    });
  }

  function savePlaceForDetail(id) {
    const p = renderedPlaces.find((x) => x.id === id);
    if (!p) return;
    const w = weather[id];
    try {
      localStorage.setItem(`daytrip:place:${id}`, JSON.stringify({
        ...p,
        weather: w && w.ok ? w : null,
        originLabel: lastSearch ? lastSearch.origin.label : '',
        hours,
        savedAt: Date.now(),
      }));
    } catch (e) { /* 저장이 안 돼도 상세 페이지는 API로 다시 불러와요 */ }
  }

  // ---------- 결과 계산·표시 ----------
  function setHours(h) {
    hours = h;
    els.hoursChips.querySelectorAll('button').forEach((btn) => {
      const on = Number(btn.dataset.hours) === h;
      btn.setAttribute('aria-checked', String(on));
      btn.classList.toggle('bg-toss-blue', on);
      btn.classList.toggle('text-white', on);
      btn.classList.toggle('bg-toss-bg', !on);
      btn.classList.toggle('text-toss-sub', !on);
    });
    if (lastSearch && !isLoading) showResults(); // 시간만 바꾸면 API를 다시 부르지 않고 재계산해요
  }

  function showResults() {
    const { items, origin: from, dest } = lastSearch;
    const all = toPlaces(items, from);
    if (all.length === 0) {
      showState({
        emoji: '🔍',
        title: '보여드릴 여행지가 없어요',
        desc: `${dest.short} 지역에서 조건에 맞는 곳을 찾지 못했어요. 다른 지역을 골라 보세요.`,
      });
      return;
    }
    const key = `${from.lat.toFixed(3)},${from.lng.toFixed(3)}`;
    if (key !== routesKey) { routes = {}; routesKey = key; routeNote = ''; } // 출발지가 바뀌면 이동시간을 새로 받아요
    const { places, excluded } = applyStay(all, hours * 60, routes);
    excludedCount = excluded;
    if (places.length === 0) {
      showState({
        emoji: '⏱️',
        title: '이 시간으로는 다녀오기 어려워요',
        desc: `${hours}시간으로는 ${dest.short}까지 왕복하고 머물 수 있는 곳이 없어요. 시간을 늘리거나 더 가까운 지역을 골라 보세요.`,
      });
      return;
    }
    const view = envFilter === 'all' ? places : places.filter((p) => ENV_BY_TYPE[p.typeId] === envFilter);
    if (view.length === 0) {
      showState({
        emoji: '🔍',
        title: '이 조건에 맞는 곳이 없어요',
        desc: `'${ENV_LABEL[envFilter]}' 장소는 이 시간에 다녀올 수 있는 곳 중에 없어요. 전체로 보면 더 찾을 수 있어요.`,
        actionLabel: '전체 보기',
        onAction: () => { envFilter = 'all'; currentShown = PAGE_SIZE; showResults(); },
      });
      return;
    }
    renderPlaces(view, from, dest.short, currentShown);
  }

  // 화면에 보이는 장소의 실제 자동차 이동시간을 받아 와서 다시 계산해요
  async function enrichVisible(visible, from) {
    const routeTodo = visible.filter((p) => !(p.id in routes));
    const weatherTodo = visible.filter((p) => !(p.id in weather));
    if (routeTodo.length === 0 && weatherTodo.length === 0) return;
    routeTodo.forEach((p) => { routes[p.id] = { ok: false, code: 'PENDING' }; }); // 같은 요청을 중복해서 보내지 않아요
    weatherTodo.forEach((p) => { weather[p.id] = { ok: false, code: 'PENDING' }; });
    const snapshot = lastSearch;
    const split = (arr) => {
      const out = [];
      for (let i = 0; i < arr.length; i += ROUTE_CHUNK) out.push(arr.slice(i, i + ROUTE_CHUNK));
      return out;
    };
    const rChunks = split(routeTodo);
    const wChunks = split(weatherTodo);
    // 이동시간과 날씨를 동시에 받아 와요
    const [rRes, wRes] = await Promise.all([
      Promise.allSettled(rChunks.map((c) => fetchRoutes(from, c))),
      Promise.allSettled(wChunks.map((c) => fetchWeather(c))),
    ]);

    let routeFailed = false;
    rRes.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        Object.assign(routes, r.value || {});
        if (Object.values(r.value || {}).some((x) => x && x.code === 'AUTH')) routeFailed = true;
      } else {
        routeFailed = true;
        rChunks[i].forEach((p) => { routes[p.id] = { ok: false, code: 'FETCH' }; });
      }
    });
    if (routeFailed) routeNote = '길찾기 연결이 어려워 일부는 추정 시간으로 보여드려요.';

    let weatherFailed = false;
    wRes.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        Object.assign(weather, r.value || {});
        if (Object.values(r.value || {}).some((x) => x && x.ok === false && x.code !== 'PENDING')) weatherFailed = true;
      } else {
        weatherFailed = true;
        wChunks[i].forEach((p) => { weather[p.id] = { ok: false, code: 'FETCH' }; });
      }
    });
    if (weatherFailed) weatherNote = '날씨 정보를 불러오지 못한 곳이 있어요.';

    if (snapshot === lastSearch) showResults();
  }

  // ---------- 검색 ----------
  async function onSearch() {
    const dest = REGIONS.find((r) => r.areaCode === els.destArea.value);
    if (!origin || !dest) return;

    isLoading = true;
    updateButton();
    showSkeleton();

    try {
      const items = await fetchAreaBasedList(dest.areaCode);
      lastSearch = { items, origin, dest };
      weather = {};
      weatherNote = '';
      if (pendingRestore) { // 돌아왔을 때: 보던 화면 그대로
        currentShown = Math.max(PAGE_SIZE, Number(pendingRestore.shown) || PAGE_SIZE);
        envFilter = ['all', 'indoor', 'outdoor'].includes(pendingRestore.envFilter) ? pendingRestore.envFilter : 'all';
      } else {
        currentShown = PAGE_SIZE;
        envFilter = 'all';
      }
      const restoreScroll = pendingRestore ? Number(pendingRestore.scrollY) || 0 : 0;
      pendingRestore = null;
      showResults();
      if (restoreScroll) (window.requestAnimationFrame || setTimeout)(() => window.scrollTo(0, restoreScroll));
    } catch (e) {
      console.error(e);
      showState({
        emoji: '😢',
        title: '여행지를 불러오지 못했어요',
        desc: e.message || '잠시 후 다시 시도해 주세요.',
        actionLabel: '다시 시도',
        onAction: onSearch,
      });
    } finally {
      pendingRestore = null;
      isLoading = false;
      updateButton();
    }
  }

  // ---------- 시작 ----------
  initSelects();
  showState({
    emoji: '🧭',
    title: '아직 고른 곳이 없어요',
    desc: '출발지와 가고 싶은 지역을 고르면 여행지를 찾아드려요.',
  });
  els.originSido.addEventListener('change', onSidoChange);
  els.originSigungu.addEventListener('change', onSigunguChange);
  els.tabSearch.addEventListener('click', () => setMode('search'));
  els.tabList.addEventListener('click', () => setMode('list'));
  els.placeInput.addEventListener('input', onPlaceInput);
  els.placeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); pickPlace(0); }
    if (e.key === 'Escape') { hideResults(); }
  });
  els.placeResults.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (btn) pickPlace(Number(btn.dataset.i));
  });
  setMode('search');
  // 카드를 누르는 순간 장소 정보를 저장해 두면, 새 탭의 상세 페이지가 바로 이어서 보여줘요
  els.grid.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('article[data-id]');
    if (card) {
      savePlaceForDetail(card.dataset.id);
      saveState(); // 스크롤 위치까지 저장해 두면 '목록으로' 돌아왔을 때 이어서 볼 수 있어요
    }
  });
  els.grid.addEventListener('click', (e) => {
    const heart = e.target.closest('button[data-like]');
    if (heart) { e.preventDefault(); toggleLike(heart.dataset.like); }
  });
  Likes.onChange(paintHearts);
  els.summary.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-env]');
    if (!btn || !lastSearch) return;
    envFilter = btn.dataset.env;
    currentShown = PAGE_SIZE;
    showResults();
  });
  els.hoursChips.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-hours]');
    if (btn) setHours(Number(btn.dataset.hours));
  });
  setHours(8);
  els.destArea.addEventListener('change', updateButton);
  els.searchBtn.addEventListener('click', () => onSearch());
  updateButton();
  restoreState();
})();
