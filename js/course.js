// 하루 코스 화면 — 찜한 곳을 골라 방문 순서·이동시간·체류 시간표를 만들어요
(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const HOURS = [4, 6, 8, 10];
  let origin = null;
  let hours = 8;
  let startMin = 9 * 60;
  const shared = new Map();   // 공유 링크로 들어온, 내 찜에 없는 장소
  const selected = new Set();
  const legsCache = {};       // 순서가 같으면 길찾기를 다시 하지 않아요
  const weather = {};
  let seq = 0;
  let timer = null;
  let note = '';

  // ---------- 시작 값: 공유 링크 > 마지막 검색 ----------
  try {
    const s = JSON.parse(localStorage.getItem('daytrip:state') || 'null');
    if (s && s.origin) { origin = s.origin; if (HOURS.includes(s.hours)) hours = s.hours; }
  } catch (e) { /* 저장된 검색이 없어도 괜찮아요 */ }
  const o = (params.get('o') || '').split(',').map(Number);
  if (o.length === 2 && o.every(Number.isFinite)) origin = { lat: o[0], lng: o[1], label: params.get('ol') || '공유받은 출발지' };
  if (HOURS.includes(Number(params.get('h')))) hours = Number(params.get('h'));
  const st = /^(\d{2}):(\d{2})$/.exec(params.get('s') || '');
  if (st) startMin = Number(st[1]) * 60 + Number(st[2]);

  const all = () => ({ ...Object.fromEntries(shared), ...Likes.all() });
  const esc = escapeHtml;

  // ---------- 왼쪽: 선택 패널 ----------
  function renderControls() {
    $('originLabel').innerHTML = origin
      ? `📍 ${esc(origin.label)}`
      : '<span class="text-[#F76707]">출발지가 아직 없어요</span> <a href="index.html" class="text-toss-blue underline">목록에서 정하기</a>';
    $('hoursChips').innerHTML = HOURS.map((h) =>
      `<button type="button" role="radio" data-hours="${h}" aria-checked="${h === hours}" class="h-11 rounded-xl text-[15px] font-bold transition active:scale-95 ${h === hours ? 'bg-toss-blue text-white' : 'bg-toss-bg text-toss-sub'}">${h}시간</button>`).join('');
    const opts = [];
    for (let m = 6 * 60; m <= 13 * 60; m += 30) opts.push(`<option value="${m}" ${m === startMin ? 'selected' : ''}>${formatClock(m)}</option>`);
    if (!opts.some((x) => x.includes('selected'))) opts.push(`<option value="${startMin}" selected>${formatClock(startMin)}</option>`);
    $('startSelect').innerHTML = opts.join('');
  }

  function renderPicker() {
    const list = Object.values(all());
    $('pickCount').textContent = `${selected.size}/${COURSE.MAX_PLACES}곳 선택`;
    if (list.length === 0) {
      $('picker').innerHTML = '<p class="py-6 text-center text-sm text-toss-mute">아직 찜한 곳이 없어요.<br><a href="index.html" class="font-semibold text-toss-blue underline">여행지를 찾아 하트를 눌러 보세요</a></p>';
      return;
    }
    const full = selected.size >= COURSE.MAX_PLACES;
    $('picker').innerHTML = list.map((p) => {
      const on = selected.has(p.id);
      return `<label class="flex cursor-pointer items-center gap-3 border-b border-toss-line py-3 last:border-0 ${!on && full ? 'opacity-40' : ''}">
        <input type="checkbox" data-pick="${esc(p.id)}" ${on ? 'checked' : ''} ${!on && full ? 'disabled' : ''} class="h-5 w-5 shrink-0 accent-[#3182F6]">
        <span class="min-w-0 flex-1"><span class="block truncate font-semibold">${esc(p.title)}</span><span class="block truncate text-xs text-toss-mute">${esc([p.typeLabel, p.addr].filter(Boolean).join(' · '))}</span></span>
      </label>`;
    }).join('');
  }

  // ---------- 오른쪽: 결과 ----------
  function hint(text) {
    $('result').innerHTML = `<div class="flex min-h-[320px] flex-col items-center justify-center rounded-3xl bg-white px-6 py-16 text-center">
      <div class="mb-4 text-5xl" aria-hidden="true">🗺️</div><p class="max-w-sm text-toss-mute">${text}</p></div>`;
  }

  const BADGE = {
    ok: ['bg-toss-soft text-toss-blue', '여유 있게 다녀올 수 있어요'],
    tight: ['bg-[#FFF4E6] text-[#F76707]', '조금 빠듯해요'],
    impossible: ['bg-[#FFF4E6] text-[#F76707]', '시간이 모자라요'],
  };

  function draw(ordered, legs) {
    const plan = planCourse({ ordered, legs, hoursMin: hours * 60, startMin });
    const [badgeStyle, badgeText] = BADGE[plan.status];
    const needed = plan.travel + COURSE.MIN_STAY * ordered.length;

    // 이동(회색)과 체류(파랑)가 하루에서 차지하는 비율
    const bar = plan.timeline.filter((t) => t.type === 'move' || t.type === 'stay')
      .map((t) => `<div style="flex:${Math.max(1, t.type === 'move' ? t.min : t.stay)};background:${t.type === 'move' ? '#B0B8C1' : '#3182F6'}" title="${t.type === 'move' ? '이동' : '체류'}"></div>`).join('');

    const rows = plan.timeline.map((t) => {
      if (t.type === 'start') return `<li class="flex gap-3"><span class="w-14 shrink-0 text-sm font-bold text-toss-mute">${formatClock(t.at)}</span><p class="font-bold">🏠 ${esc(origin.label)}에서 출발</p></li>`;
      if (t.type === 'end') return `<li class="flex gap-3"><span class="w-14 shrink-0 text-sm font-bold text-toss-mute">${formatClock(t.at)}</span><p class="font-bold">🏠 집에 도착해요</p></li>`;
      if (t.type === 'move') return `<li class="flex gap-3"><span class="w-14 shrink-0"></span><p class="rounded-xl bg-toss-bg px-3 py-2 text-sm text-toss-sub">🚗 ${formatDuration(t.min)} 이동${t.exact ? ` · ${t.km}km` : ' (추정)'}</p></li>`;
      const w = weather[t.place.id];
      const adv = w && w.ok ? weatherAdvice(t.place, w) : null;
      return `<li class="flex gap-3"><span class="w-14 shrink-0 text-sm font-bold text-toss-blue">${formatClock(t.arrive)}</span>
        <div class="min-w-0 flex-1 rounded-2xl border border-toss-line p-4">
          <a href="detail.html?id=${encodeURIComponent(t.place.id)}" target="_blank" rel="noopener" class="block truncate text-lg font-bold hover:underline">${esc(t.place.title)}</a>
          <p class="mt-0.5 text-sm text-toss-mute">${esc([t.place.typeLabel, t.place.addr].filter(Boolean).join(' · '))}</p>
          <p class="mt-2 text-sm font-semibold">${plan.status === 'impossible' ? '⏱️ 시간이 부족해요' : `⏱️ ${formatDuration(t.stay)} 머물러요 (${formatClock(t.arrive)}~${formatClock(t.depart)})`}</p>
          ${w && w.ok ? `<span class="mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${isRainy(w) ? 'bg-toss-soft text-toss-blue' : 'bg-toss-bg text-toss-sub'}">${esc(weatherChipText(w))}</span>` : ''}
          ${adv ? `<p class="mt-2 text-sm font-semibold ${adv.tone === 'warn' ? 'text-[#F76707]' : 'text-toss-blue'}">${esc(adv.text)}</p>` : ''}
        </div></li>`;
    }).join('');

    $('result').innerHTML = `
      <section class="rounded-3xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <span class="inline-block rounded-full px-3 py-1 text-sm font-bold ${badgeStyle}">${badgeText}</span>
        <p class="mt-3 text-2xl font-bold">${hours}시간 동안 ${ordered.length}곳</p>
        <p class="mt-1 text-sm text-toss-mute">총 이동 ${formatDuration(plan.travel)} · 장소에서 ${plan.free > 0 ? formatDuration(plan.free) : '0분'} · 귀가 ${formatClock(plan.endMin)}</p>
        <div class="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-toss-bg" aria-label="이동과 체류 시간 비율">${bar}</div>
        <p class="mt-2 flex gap-4 text-xs text-toss-mute"><span>■ <span style="color:#B0B8C1">이동</span></span><span>■ <span style="color:#3182F6">체류</span></span></p>
        ${plan.status === 'impossible' ? `<p class="mt-4 rounded-xl bg-[#FFF4E6] px-4 py-3 text-sm font-semibold text-[#F76707]">이 조합에는 최소 ${formatDuration(needed)}가 필요해요(이동 ${formatDuration(plan.travel)} + 곳당 ${COURSE.MIN_STAY}분). 곳을 줄이거나 시간을 늘려 보세요.</p>` : ''}
        ${note ? `<p class="mt-3 text-sm font-semibold text-[#F76707]">${esc(note)}</p>` : ''}
      </section>
      <section class="mt-4 rounded-3xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <h2 class="mb-4 text-lg font-bold">시간표</h2>
        <ol class="space-y-3">${rows}</ol>
        <p class="mt-4 text-xs text-toss-mute">방문 순서는 직선거리가 가장 짧은 순서로 정하고, 구간 시간은 카카오 길찾기(자동차) 기준이에요. 교통 상황에 따라 달라질 수 있어요.</p>
      </section>
      <section class="mt-4 rounded-3xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <h2 class="text-lg font-bold">이 코스 공유하기</h2>
        <div class="mt-3 flex gap-2">
          <input id="shareUrl" readonly value="${esc(shareUrl(ordered))}" class="h-12 min-w-0 flex-1 rounded-xl bg-toss-bg px-4 text-sm outline-none">
          <button id="copyBtn" type="button" class="h-12 shrink-0 rounded-xl bg-toss-blue px-5 font-bold text-white transition active:scale-95">복사</button>
        </div>
      </section>`;
  }

  function shareUrl(ordered) {
    const q = new URLSearchParams({
      ids: ordered.map((p) => p.id).join(','), h: String(hours),
      s: formatClock(startMin).replace('다음 날 ', ''), o: `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}`, ol: origin.label,
    });
    return `${location.origin}${location.pathname}?${q}`;
  }

  // ---------- 계산 ----------
  async function build() {
    const mine = ++seq; // 선택이 빠르게 바뀌면 늦게 도착한 이전 결과는 버려요
    const list = [...selected].map((id) => all()[id]).filter(Boolean);
    if (!origin) { hint('출발지가 필요해요. <a href="index.html" class="font-semibold text-toss-blue underline">목록에서 출발지를 먼저 정해 주세요.</a>'); return; }
    if (list.length < 2) { hint('왼쪽에서 가고 싶은 곳을 2곳 이상 골라 주세요.'); return; }

    note = '';
    const ordered = bestOrder(origin, list);
    const key = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}|${ordered.map((p) => p.id).join(',')}`;
    const est = estimateLegs(origin, ordered);
    draw(ordered, legsCache[key] || est);

    if (!legsCache[key]) {
      try {
        const real = await fetchLegs(legPairs(origin, ordered));
        if (mine !== seq) return;
        legsCache[key] = est.map((e, i) => (real[i] && real[i].ok ? { min: real[i].min, km: real[i].km, exact: true } : e));
        if (legsCache[key].some((l) => !l.exact)) note = '일부 구간은 길찾기 대신 추정 시간이에요.';
      } catch (e) {
        console.error(e);
        note = '길찾기 연결이 어려워 추정 시간으로 보여드려요.';
      }
      draw(ordered, legsCache[key] || est);
    }

    const need = ordered.filter((p) => !(p.id in weather) && p.lat && p.lng);
    if (need.length) {
      need.forEach((p) => { weather[p.id] = { ok: false, code: 'PENDING' }; });
      try { Object.assign(weather, await fetchWeather(need)); } catch (e) { console.error(e); }
      if (mine !== seq) return;
      draw(ordered, legsCache[key] || est);
    }
  }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(build, 150); };

  // ---------- 이벤트 ----------
  $('picker').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-pick]');
    if (!cb) return;
    if (cb.checked) selected.add(cb.dataset.pick); else selected.delete(cb.dataset.pick);
    renderPicker();
    schedule();
  });
  $('hoursChips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-hours]');
    if (!b) return;
    hours = Number(b.dataset.hours);
    renderControls();
    schedule();
  });
  $('startSelect').addEventListener('change', (e) => { startMin = Number(e.target.value); schedule(); });
  $('result').addEventListener('click', async (e) => {
    if (!e.target.closest('#copyBtn')) return;
    const input = $('shareUrl');
    try { await navigator.clipboard.writeText(input.value); toast('링크를 복사했어요'); }
    catch (err) { input.select(); toast('링크를 선택했어요. 직접 복사해 주세요'); }
  });

  // ---------- 시작 ----------
  renderControls();
  const ids = (params.get('ids') || '').split(',').filter((x) => /^[\w-]+$/.test(x)).slice(0, COURSE.MAX_PLACES);
  ids.forEach((id) => selected.add(id));

  Likes.onChange(() => {
    const badge = $('likeBadge');
    badge.textContent = String(Likes.count());
    badge.classList.toggle('hidden', Likes.count() === 0);
    [...selected].forEach((id) => { if (!all()[id] && !ids.includes(id)) selected.delete(id); }); // 찜을 취소한 곳은 선택에서도 빼요
    renderPicker();
    schedule();
  });

  // 공유 링크로 들어왔는데 내 찜에 없는 장소는 관광공사에서 정보를 받아 와요
  (async () => {
    const missing = ids.filter((id) => !Likes.has(id));
    await Promise.all(missing.map(async (id) => {
      try {
        const d = await fetchDetail(id);
        if (d) shared.set(id, placeSummary({
          id, title: d.title, addr: [d.addr1, d.addr2].filter(Boolean).join(' '), image: toHttps(d.firstimage || ''),
          typeId: d.contenttypeid, typeLabel: CONFIG.TYPE_LABELS[String(d.contenttypeid)] || '', lat: parseFloat(d.mapy), lng: parseFloat(d.mapx),
        }));
      } catch (e) { console.error(e); }
    }));
    if (missing.length) { renderPicker(); schedule(); }
  })();
})();
