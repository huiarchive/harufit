// 장소 상세 페이지 — 목록에서 넘겨받은 정보 + 관광공사 상세(소개 글)
(function () {
  const $ = (id) => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('id');
  const PLACEHOLDER_IMG =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#F2F4F6"/><path d="M280 320l100-130 80 95 50-60 90 95z" fill="#D1D6DB"/><circle cx="520" cy="170" r="24" fill="#D1D6DB"/></svg>');

  let current = null; // 찜할 때 저장할 장소 요약

  function refreshLike() {
    const btn = $('likeBtn');
    const on = !!current && Likes.has(current.id);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '♥ 찜한 곳' : '♡ 찜하기';
    btn.classList.toggle('text-[#F04452]', on);
    btn.classList.toggle('text-toss-sub', !on);
  }

  function updateBadge() {
    const badge = $('likeBadge');
    badge.textContent = String(Likes.count());
    badge.classList.toggle('hidden', Likes.count() === 0);
  }

  function loadStored() {
    try {
      const raw = localStorage.getItem(`daytrip:place:${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // 소개 글에 섞인 HTML 태그를 없애고 줄바꿈만 남겨요
  function cleanText(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .trim();
  }

  function setImage(src) {
    const img = $('placeImage');
    img.addEventListener('error', () => { img.onerror = null; img.src = PLACEHOLDER_IMG; }, { once: true });
    img.src = src ? toHttps(src) : PLACEHOLDER_IMG;
  }

  function addChip(text, style) {
    const span = document.createElement('span');
    span.className = `rounded-full px-3 py-1 text-sm font-medium ${style}`;
    span.textContent = text;
    $('chips').appendChild(span);
  }

  function paintStored(p) {
    if (p.stayMin) {
      $('stayCard').classList.remove('hidden');
      $('stayTime').textContent = formatDuration(p.stayMin);
      $('stayDetail').textContent =
        `${p.originLabel || '출발지'}에서 ${p.hours}시간을 쓸 때 · ` +
        (p.exact ? `자동차 편도 ${formatDuration(p.oneWayMin)} · ${p.roadKm}km` : `편도 약 ${formatDuration(p.oneWayMin)} (추정)`);
    }
    if (p.level) addChip(p.level, p.level === '여유' ? 'bg-toss-soft text-toss-blue' : p.level === '빠듯' ? 'bg-[#FFF4E6] text-[#F76707]' : 'bg-toss-bg text-toss-sub');
    if (p.weather && p.weather.ok) {
      addChip(weatherChipText(p.weather), isRainy(p.weather) ? 'bg-toss-soft text-toss-blue' : 'bg-toss-bg text-toss-sub');
      const a = weatherAdvice(p, p.weather);
      if (a) {
        const el = $('advice');
        el.textContent = a.text;
        el.className = `mt-3 text-sm font-semibold ${a.tone === 'warn' ? 'text-[#F76707]' : 'text-toss-blue'}`;
      }
    }
  }

  async function init() {
    if (!id) {
      $('title').textContent = '장소를 찾을 수 없어요';
      $('addr').textContent = '목록에서 장소를 골라 다시 들어와 주세요.';
      setImage('');
      return;
    }
    const stored = loadStored();
    if (stored) {
      document.title = `${stored.title} - DayFit`;
      $('title').textContent = stored.title;
      $('addr').textContent = stored.addr || '';
      setImage(stored.image);
      if (stored.typeLabel) addChip(stored.typeLabel, 'bg-toss-bg text-toss-sub');
      paintStored(stored);
      current = placeSummary(stored);
      refreshLike();
    } else {
      setImage('');
    }

    try {
      const d = await fetchDetail(id);
      if (!d) throw new Error('NO_DETAIL');
      if (!stored) {
        document.title = `${d.title} - DayFit`;
        $('title').textContent = d.title;
        $('addr').textContent = [d.addr1, d.addr2].filter(Boolean).join(' ');
        setImage(d.firstimage);
        current = placeSummary({
          id, title: d.title, addr: [d.addr1, d.addr2].filter(Boolean).join(' '), image: toHttps(d.firstimage || ''),
          typeId: d.contenttypeid, typeLabel: CONFIG.TYPE_LABELS[String(d.contenttypeid)] || '', lat: parseFloat(d.mapy), lng: parseFloat(d.mapx),
        });
        refreshLike();
      }
      const text = cleanText(d.overview);
      $('overview').textContent = text || '등록된 소개 글이 없어요.';
    } catch (e) {
      console.error(e);
      if (!stored) $('title').textContent = '장소 정보를 불러오지 못했어요';
      $('overview').textContent = '소개 글을 불러오지 못했어요.';
    }
  }

  $('likeBtn').addEventListener('click', async () => {
    if (!current) { toast('장소 정보를 불러온 뒤에 찜할 수 있어요'); return; }
    try {
      const added = await Likes.toggle(current);
      toast(added ? '찜한 곳에 담았어요' : '찜을 취소했어요');
    } catch (e) {
      console.error(e);
      toast('찜을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  });
  Likes.onChange(() => { refreshLike(); updateBadge(); });

  init();
})();
