// 프록시(GAS) 호출 담당 — 화면(DOM)은 건드리지 않아요.

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 브라우저 sessionStorage에 잠깐 저장해서 같은 요청을 반복하지 않아요(캐싱)
function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > CONFIG.CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return v;
  } catch (e) {
    return null;
  }
}

function cacheSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
  } catch (e) {
    /* 저장 공간이 없어도 앱은 계속 동작해요 */
  }
}

// 프록시 호출 공통 처리: 네트워크·응답 형식·오류 코드를 한곳에서 다뤄요
async function callProxy(params) {
  if (!CONFIG.PROXY_URL || CONFIG.PROXY_URL.includes('여기에')) {
    throw new ApiError('PROXY_MISSING', 'js/config.js에 GAS 웹 앱 주소를 먼저 넣어 주세요.');
  }
  let res;
  try {
    res = await fetch(`${CONFIG.PROXY_URL}?${params}`);
  } catch (e) {
    throw new ApiError('NETWORK', '네트워크에 연결할 수 없어요. 인터넷 연결과 프록시 주소를 확인해 주세요.');
  }
  if (!res.ok) {
    throw new ApiError('HTTP', `서버 응답에 문제가 있어요. (상태 코드 ${res.status})`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ApiError('PARSE', '프록시 응답을 읽을 수 없어요. 웹 앱 배포 설정(액세스: 모든 사용자)을 확인해 주세요.');
  }
  if (!data.ok) {
    throw new ApiError(data.code || 'PROXY', data.message || '요청을 처리하지 못했어요.');
  }
  return data;
}

// 지역기반 관광정보 조회 (areaBasedList2)
async function fetchAreaBasedList(areaCode) {
  const pageCount = CONFIG.PAGES || 5; // 한 번에 100개씩, 페이지를 동시에 받아 후보를 늘려요
  const cacheKey = `areaBasedList2:${areaCode}:${CONFIG.ARRANGE}:${pageCount}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const results = await Promise.allSettled(
    Array.from({ length: pageCount }, (_, i) =>
      callProxy(new URLSearchParams({
        op: 'areaBasedList2',
        areaCode: areaCode,
        numOfRows: String(CONFIG.NUM_OF_ROWS),
        pageNo: String(i + 1),
        arrange: CONFIG.ARRANGE,
      }))
    )
  );
  if (results[0].status === 'rejected') throw results[0].reason; // 첫 페이지가 실패하면 오류로 처리
  const seen = new Set();
  const items = results
    .filter((r) => r.status === 'fulfilled') // 뒤쪽 페이지가 실패해도 받은 만큼은 보여줘요
    .flatMap((r) => r.value.items)
    .filter((it) => !seen.has(it.contentid) && seen.add(it.contentid));

  cacheSet(cacheKey, items);
  return items;
}

// 동네·주소·장소 검색 → [{label, kind, lat, lng}]
async function searchPlaces(query) {
  const cacheKey = `geocode:${query}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const data = await callProxy(new URLSearchParams({ op: 'geocode', query: query }));
  cacheSet(cacheKey, data.items);
  return data.items;
}

// 출발지 → 여러 목적지의 자동차 소요시간 (프록시가 카카오 길찾기를 대신 호출해요)
// places: [{ id, lat, lng }] (최대 12개) → { [id]: { ok, min, km } | { ok:false, code } }
async function fetchRoutes(origin, places) {
  const params = new URLSearchParams({
    op: 'routes',
    origin: `${origin.lng.toFixed(5)},${origin.lat.toFixed(5)}`,
    dests: places.map((p) => `${p.id}:${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join('|'),
  });
  const data = await callProxy(params);
  return data.routes || {};
}

// 목적지 날씨 (프록시가 기상청 단기예보를 대신 호출해요)
// places: [{ id, lat, lng }] (최대 12개) → { [id]: { ok, tempMax, tempMin, pop, pty, sky } | { ok:false, code } }
async function fetchWeather(places) {
  const params = new URLSearchParams({
    op: 'weather',
    points: places.map((p) => `${p.id}:${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join('|'),
  });
  const data = await callProxy(params);
  return data.weather || {};
}

// 장소 상세 (소개 글 포함) — 프록시가 detailCommon2를 대신 호출해요
async function fetchDetail(contentId) {
  const cacheKey = `detailCommon2:${contentId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const data = await callProxy(new URLSearchParams({ op: 'detailCommon2', contentId: String(contentId) }));
  const item = (data.items && data.items[0]) || null;
  if (item) cacheSet(cacheKey, item);
  return item;
}

// 하루 코스: 구간별 자동차 소요시간. pairs: [{ from:{lat,lng}, to:{lat,lng} }] (최대 6개)
async function fetchLegs(pairs) {
  const f = (pt) => `${pt.lng.toFixed(5)},${pt.lat.toFixed(5)}`;
  const data = await callProxy(new URLSearchParams({ op: 'legs', pairs: pairs.map((p) => `${f(p.from)}>${f(p.to)}`).join('|') }));
  return data.legs || [];
}
