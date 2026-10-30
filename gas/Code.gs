/**
 * 당일치기 - 공공데이터 프록시 (Google Apps Script)
 *
 * 역할
 *  1) 인증키를 '스크립트 속성'에 숨겨서 프론트 코드에 노출되지 않게 해요.
 *  2) HTTPS 페이지(GitHub Pages)에서 공공데이터 API를 안전하게 부를 수 있게 중계해요.
 *  3) 필요한 필드만 골라 응답 크기를 줄이고, 6시간 동안 결과를 캐싱해요.
 *
 * 준비: 프로젝트 설정 → 스크립트 속성에 TOUR_API_KEY 이름으로 인증키를 저장하세요.
 */

const BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';
const CACHE_SECONDS = 6 * 60 * 60; // CacheService 최대 6시간

// 프록시가 대신 호출해 줄 오퍼레이션 목록 (여기 없는 요청은 거절해요)
// 이후 단계에서 detailCommon2 같은 오퍼레이션을 추가하면 돼요.
const ALLOWED_OPS = {
  areaBasedList2: { params: ['areaCode', 'numOfRows', 'pageNo', 'arrange', 'contentTypeId'] },
  // 장소 상세: 소개(overview)까지 받아요
  detailCommon2: {
    params: ['contentId'],
    fields: ['contentid', 'contenttypeid', 'title', 'addr1', 'addr2', 'firstimage', 'mapx', 'mapy', 'overview'],
  },
};

// 목록 응답에서 앱이 쓰는 필드만 남겨요
const ITEM_FIELDS = [
  'contentid', 'contenttypeid', 'title', 'addr1', 'addr2', 'firstimage', 'firstimage2', 'mapx', 'mapy',
];

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const op = p.op;
    if (op === 'legs') return handleLegs(p); // 하루 코스: 구간별 자동차 소요시간
    if (op === 'weather') return handleWeather(p); // 목적지 날씨 (기상청 단기예보)
    if (op === 'routes') return handleRoutes(p); // 출발지 → 여러 목적지의 자동차 소요시간 (카카오 길찾기)
    if (op === 'geocode') return handleGeocode(p.query); // 동네·주소 → 좌표 (카카오 로컬 API)
    if (!ALLOWED_OPS[op]) {
      return jsonOut({ ok: false, code: 'BAD_OP', message: '지원하지 않는 요청이에요.' });
    }

    // 캐시에 있으면 바로 돌려줘요
    const cache = CacheService.getScriptCache();
    const cacheKey = makeCacheKey(op, p, ALLOWED_OPS[op].params);
    const hit = cache.get(cacheKey);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

    const apiKey = PropertiesService.getScriptProperties().getProperty('TOUR_API_KEY');
    if (!apiKey) {
      return jsonOut({ ok: false, code: 'KEY_MISSING', message: '스크립트 속성에 TOUR_API_KEY가 없어요.' });
    }

    const url = buildUrl(op, p, apiKey);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const text = res.getContentText();

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      // 인증 오류 등은 JSON이 아니라 XML로 올 때가 있어요 (키는 응답에 포함하지 않아요)
      return jsonOut({
        ok: false,
        code: 'UPSTREAM_PARSE',
        message: '공공데이터포털 응답을 읽을 수 없어요. 인증키와 활용신청 상태를 확인해 주세요.',
        detail: text.slice(0, 200),
      });
    }

    const header = data.response && data.response.header;
    if (!header) {
      return jsonOut({ ok: false, code: 'UNEXPECTED', message: '예상과 다른 응답이에요.', detail: text.slice(0, 200) });
    }
    if (header.resultCode !== '0000') {
      return jsonOut({ ok: false, code: header.resultCode, message: header.resultMsg });
    }

    // 결과가 0건이면 items가 '', 1건이면 객체로 와요
    const raw = data.response.body && data.response.body.items && data.response.body.items.item;
    const list = !raw ? [] : Array.isArray(raw) ? raw : [raw];
    const fields = ALLOWED_OPS[op].fields || ITEM_FIELDS;
    const items = list.map(function (it) { return pickFields(it, fields); });

    const out = JSON.stringify({ ok: true, items: items, cachedAt: new Date().toISOString() });
    if (out.length < 90000) cache.put(cacheKey, out, CACHE_SECONDS); // CacheService 값 한도(약 100KB)
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return jsonOut({ ok: false, code: 'SERVER_ERROR', message: '프록시에서 오류가 났어요: ' + err.message });
  }
}

function pickFields(item, fields) {
  const o = {};
  fields.forEach(function (f) { o[f] = item[f] || ''; });
  return o;
}

function makeCacheKey(op, p, allowed) {
  const parts = allowed.map(function (k) { return k + '=' + (p[k] || ''); });
  return (op + ':' + parts.join('&')).slice(0, 240);
}

function buildUrl(op, p, apiKey) {
  // Encoding 키(이미 %가 들어 있음)는 그대로, Decoding 키는 인코딩해서 써요
  const key = apiKey.indexOf('%') >= 0 ? apiKey : encodeURIComponent(apiKey);
  const query = [
    'serviceKey=' + key,
    'MobileOS=ETC',
    'MobileApp=DayTrip',
    '_type=json',
  ];
  ALLOWED_OPS[op].params.forEach(function (k) {
    if (p[k] !== undefined && p[k] !== '') query.push(k + '=' + encodeURIComponent(p[k]));
  });
  return BASE_URL + '/' + op + '?' + query.join('&');
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 편집기에서 직접 실행해 보는 테스트 함수 (처음 실행하면 권한 승인 창이 떠요) */
function testRun() {
  const out = doGet({ parameter: { op: 'areaBasedList2', areaCode: '39', numOfRows: '3', pageNo: '1', arrange: 'Q' } });
  Logger.log(out.getContent());
}

// ---------- 동네·주소 검색 (카카오 로컬 API) ----------
// 준비: 스크립트 속성에 KAKAO_REST_KEY 이름으로 카카오 REST API 키를 저장하세요.
function handleGeocode(query) {
  const q = String(query || '').trim();
  if (q.length < 2 || q.length > 50) {
    return jsonOut({ ok: false, code: 'BAD_QUERY', message: '두 글자 이상 입력해 주세요.' });
  }
  const cache = CacheService.getScriptCache();
  const cacheKey = 'geo:' + q;
  const hit = cache.get(cacheKey);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

  const key = (PropertiesService.getScriptProperties().getProperty('KAKAO_REST_KEY') || '').trim(); // 복사하며 생긴 앞뒤 공백 제거
  if (!key) return jsonOut({ ok: false, code: 'KEY_MISSING', message: '스크립트 속성에 KAKAO_REST_KEY가 없어요.' });

  // 1) 주소·동네 이름으로 먼저 찾고, 2) 결과가 없으면 장소(역, 건물 등) 이름으로 찾아요
  let found = kakaoSearch('address', q, key);
  if (found.error) return jsonOut(found.error);
  if (found.items.length === 0) {
    found = kakaoSearch('keyword', q, key);
    if (found.error) return jsonOut(found.error);
  }

  const out = JSON.stringify({ ok: true, items: found.items });
  if (found.items.length > 0) cache.put(cacheKey, out, CACHE_SECONDS);
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

function kakaoSearch(kind, q, key) {
  const url = 'https://dapi.kakao.com/v2/local/search/' + kind + '.json?size=7&query=' + encodeURIComponent(q);
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true });
  const status = res.getResponseCode();
  if (status === 401 || status === 403) {
    // 카카오가 알려 주는 거절 이유를 그대로 보여 줘요 (키 값은 포함되지 않아요)
    return { error: { ok: false, code: 'KAKAO_AUTH', message: '카카오가 요청을 거절했어요. 아래 이유를 확인해 주세요.', detail: 'HTTP ' + status + ' ' + res.getContentText().slice(0, 200) } };
  }
  let data;
  try { data = JSON.parse(res.getContentText()); } catch (e) {
    return { error: { ok: false, code: 'KAKAO_PARSE', message: '카카오 응답을 읽을 수 없어요.' } };
  }
  if (!data.documents) {
    return { error: { ok: false, code: 'KAKAO_ERROR', message: (data.message || '카카오 검색에 실패했어요.') } };
  }
  const items = data.documents.map(function (d) {
    const isPlace = kind === 'keyword';
    return {
      label: isPlace ? d.place_name + (d.address_name ? ' · ' + d.address_name : '') : d.address_name,
      kind: isPlace ? '장소' : (d.address_type === 'REGION' ? '동네' : '주소'),
      lat: parseFloat(d.y),
      lng: parseFloat(d.x),
    };
  }).filter(function (it) { return isFinite(it.lat) && isFinite(it.lng); });
  return { items: items };
}

/** 카카오 연결 진단: 편집기에서 실행한 뒤 '실행 로그'를 확인하세요 (키 값은 로그에 찍히지 않아요) */
function testKakao() {
  const raw = PropertiesService.getScriptProperties().getProperty('KAKAO_REST_KEY');
  if (!raw) { Logger.log('KAKAO_REST_KEY가 저장되어 있지 않아요.'); return; }
  const key = raw.trim();
  Logger.log('키 길이: ' + key.length + '자 (REST API 키는 보통 32자) / 앞뒤 공백 있었음: ' + (raw !== key));
  const res = UrlFetchApp.fetch(
    'https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent('회기동'),
    { headers: { Authorization: 'KakaoAK ' + key }, muteHttpExceptions: true }
  );
  Logger.log('응답 코드: ' + res.getResponseCode());
  Logger.log('응답 내용: ' + res.getContentText().slice(0, 300));
}

// ---------- 자동차 길찾기 (카카오모빌리티) ----------
// 같은 KAKAO_REST_KEY를 사용해요. 카카오 개발자 설정에서 길찾기 API 사용이 가능해야 해요.
const DIRECTIONS_URL = 'https://apis-navi.kakaomobility.com/v1/directions';
const ROUTE_CACHE_SECONDS = 60 * 60; // 교통 상황이 바뀌니 1시간만 보관해요
const MAX_ROUTE_DESTS = 12;

function parseLngLat(s) {
  const parts = String(s || '').split(',');
  const lng = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  if (!isFinite(lng) || !isFinite(lat) || lng < 124 || lng > 132 || lat < 33 || lat > 39) return null;
  return { lng: lng, lat: lat };
}

// origin="경도,위도", dests="id:경도,위도|id:경도,위도|..."
function handleRoutes(p) {
  const origin = parseLngLat(p.origin);
  const dests = String(p.dests || '').split('|').slice(0, MAX_ROUTE_DESTS).map(function (s) {
    const i = s.indexOf(':');
    const c = i > 0 ? parseLngLat(s.slice(i + 1)) : null;
    return c ? { id: s.slice(0, i), c: c } : null;
  }).filter(Boolean);
  if (!origin || dests.length === 0) {
    return jsonOut({ ok: false, code: 'BAD_QUERY', message: '출발지나 목적지 좌표가 올바르지 않아요.' });
  }
  const key = (PropertiesService.getScriptProperties().getProperty('KAKAO_REST_KEY') || '').trim();
  if (!key) return jsonOut({ ok: false, code: 'KEY_MISSING', message: '스크립트 속성에 KAKAO_REST_KEY가 없어요.' });

  const cache = CacheService.getScriptCache();
  const routes = {};
  const todo = [];
  dests.forEach(function (d) {
    const ck = 'route:' + origin.lng.toFixed(3) + ',' + origin.lat.toFixed(3) + '>' + d.c.lng.toFixed(4) + ',' + d.c.lat.toFixed(4);
    const hit = cache.get(ck);
    if (hit) routes[d.id] = JSON.parse(hit);
    else todo.push({ d: d, ck: ck });
  });

  if (todo.length > 0) {
    const reqs = todo.map(function (t) {
      return {
        url: DIRECTIONS_URL + '?origin=' + origin.lng + ',' + origin.lat + '&destination=' + t.d.c.lng + ',' + t.d.c.lat + '&priority=RECOMMEND&summary=true',
        headers: { Authorization: 'KakaoAK ' + key },
        muteHttpExceptions: true,
      };
    });
    const res = UrlFetchApp.fetchAll(reqs); // 목적지별 호출을 동시에 실행해요
    res.forEach(function (r, i) {
      const out = parseRoute(r);
      routes[todo[i].d.id] = out;
      if (out.ok) cache.put(todo[i].ck, JSON.stringify(out), ROUTE_CACHE_SECONDS);
    });
  }
  return jsonOut({ ok: true, routes: routes });
}

function parseRoute(res) {
  const status = res.getResponseCode();
  const text = res.getContentText();
  if (status === 401 || status === 403) return { ok: false, code: 'AUTH', detail: 'HTTP ' + status + ' ' + text.slice(0, 160) };
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, code: 'PARSE' }; }
  const r = data.routes && data.routes[0];
  if (!r) return { ok: false, code: 'NO_ROUTE', detail: text.slice(0, 120) };
  if (r.result_code !== 0) return { ok: false, code: 'R' + r.result_code, detail: r.result_msg };
  return { ok: true, min: Math.round(r.summary.duration / 60), km: Math.round(r.summary.distance / 100) / 10 };
}

/** 편집기에서 실행하는 길찾기 진단: 동대문구 → 강릉 (로그에서 응답 코드를 확인하세요) */
function testRoute() {
  const out = handleRoutes({ origin: '127.0554,37.5908', dests: 'test:128.8761,37.7519' });
  Logger.log(out.getContent());
}

// ---------- 날씨 (기상청 단기예보 조회서비스) ----------
// 공공데이터포털에서 '기상청_단기예보 조회서비스' 활용신청이 필요하고, 키는 TOUR_API_KEY(같은 인증키)를 써요.
const WX_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const WX_CACHE_SECONDS = 3 * 60 * 60; // 예보는 3시간마다 갱신돼요
const WX_BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]; // 발표 시각
const MAX_WX_POINTS = 12;

// 위도·경도 → 기상청 격자(nx, ny) (기상청 공식 Lambert 변환식)
function toGrid(lat, lng) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180;
  const re = RE / GRID, slat1 = SLAT1 * D, slat2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = lng * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

function kstInfo() {
  const now = new Date();
  const f = function (d, fmt) { return Utilities.formatDate(d, 'Asia/Seoul', fmt); };
  return {
    today: f(now, 'yyyyMMdd'),
    yesterday: f(new Date(now.getTime() - 86400000), 'yyyyMMdd'),
    tomorrow: f(new Date(now.getTime() + 86400000), 'yyyyMMdd'),
    minutes: parseInt(f(now, 'H'), 10) * 60 + parseInt(f(now, 'm'), 10),
  };
}

// 지금 조회할 수 있는 가장 최근 발표 시각 (발표 후 약 10분 뒤부터 조회돼요)
function pickBase(k) {
  const m = k.minutes - 10;
  let h = null;
  WX_BASE_HOURS.forEach(function (b) { if (b * 60 <= m) h = b; });
  if (h === null) return { date: k.yesterday, time: '2300' };
  return { date: k.today, time: (h < 10 ? '0' : '') + h + '00' };
}

// 오전 9시~오후 6시(당일치기 시간대)의 예보를 한 줄로 요약해요. 저녁 6시 이후에는 내일 예보를 써요.
function summarizeForecast(items, targetDate) {
  const day = items.filter(function (it) { return it.fcstDate === targetDate; });
  const win = day.filter(function (it) { const h = parseInt(it.fcstTime.slice(0, 2), 10); return h >= 9 && h <= 18; });
  const rows = win.length ? win : day;
  const nums = function (cat) {
    return rows.filter(function (it) { return it.category === cat; })
      .map(function (it) { return parseFloat(it.fcstValue); }).filter(function (v) { return isFinite(v); });
  };
  const mode = function (arr) {
    const cnt = {}; let best = arr[0];
    arr.forEach(function (v) { cnt[v] = (cnt[v] || 0) + 1; if (cnt[v] > cnt[best]) best = v; });
    return best;
  };
  const tmp = nums('TMP'), pop = nums('POP'), sky = nums('SKY');
  const pty = nums('PTY').filter(function (v) { return v > 0; });
  if (tmp.length === 0 && pop.length === 0 && sky.length === 0) return { ok: false, code: 'WX_NO_DATA' };
  return {
    ok: true,
    date: targetDate,
    tempMax: tmp.length ? Math.round(Math.max.apply(null, tmp)) : null,
    tempMin: tmp.length ? Math.round(Math.min.apply(null, tmp)) : null,
    pop: pop.length ? Math.max.apply(null, pop) : 0,   // 강수확률(%) 최댓값
    pty: pty.length ? mode(pty) : 0,                    // 강수형태: 0 없음, 1 비, 2 비/눈, 3 눈, 4 소나기
    sky: sky.length ? mode(sky) : 1,                    // 하늘상태: 1 맑음, 3 구름많음, 4 흐림
  };
}

// points="id:경도,위도|id:경도,위도|..." → { id: 날씨 요약 }
function handleWeather(p) {
  const points = String(p.points || '').split('|').slice(0, MAX_WX_POINTS).map(function (s) {
    const i = s.indexOf(':');
    const c = i > 0 ? parseLngLat(s.slice(i + 1)) : null;
    return c ? { id: s.slice(0, i), grid: toGrid(c.lat, c.lng) } : null;
  }).filter(Boolean);
  if (points.length === 0) return jsonOut({ ok: false, code: 'BAD_QUERY', message: '좌표가 올바르지 않아요.' });
  const apiKey = (PropertiesService.getScriptProperties().getProperty('TOUR_API_KEY') || '').trim();
  if (!apiKey) return jsonOut({ ok: false, code: 'KEY_MISSING', message: '스크립트 속성에 TOUR_API_KEY가 없어요.' });

  const k = kstInfo();
  const base = pickBase(k);
  const target = k.minutes >= 18 * 60 ? k.tomorrow : k.today;
  const cache = CacheService.getScriptCache();
  const byGrid = {}; // 같은 격자(약 5km)는 한 번만 조회해요
  const todo = [];
  points.forEach(function (pt) {
    const gk = pt.grid.nx + ',' + pt.grid.ny;
    if (byGrid[gk] !== undefined) return;
    const ck = 'wx:' + gk + ':' + base.date + base.time + ':' + target;
    const hit = cache.get(ck);
    if (hit) { byGrid[gk] = JSON.parse(hit); return; }
    byGrid[gk] = null;
    todo.push({ gk: gk, ck: ck, grid: pt.grid });
  });

  if (todo.length > 0) {
    const key = apiKey.indexOf('%') >= 0 ? apiKey : encodeURIComponent(apiKey);
    const reqs = todo.map(function (t) {
      return {
        url: WX_URL + '?serviceKey=' + key + '&numOfRows=1000&pageNo=1&dataType=JSON&base_date=' + base.date +
          '&base_time=' + base.time + '&nx=' + t.grid.nx + '&ny=' + t.grid.ny,
        muteHttpExceptions: true,
      };
    });
    UrlFetchApp.fetchAll(reqs).forEach(function (r, i) {
      const out = parseForecast(r, target);
      byGrid[todo[i].gk] = out;
      if (out.ok) cache.put(todo[i].ck, JSON.stringify(out), WX_CACHE_SECONDS);
    });
  }

  const weather = {};
  points.forEach(function (pt) { weather[pt.id] = byGrid[pt.grid.nx + ',' + pt.grid.ny]; });
  return jsonOut({ ok: true, weather: weather });
}

function parseForecast(res, target) {
  const text = res.getContentText();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    // 인증·활용신청 오류는 JSON이 아닌 XML로 올 때가 있어요
    return { ok: false, code: 'WX_PARSE', detail: text.slice(0, 160) };
  }
  const header = data.response && data.response.header;
  if (!header) return { ok: false, code: 'WX_UNEXPECTED', detail: text.slice(0, 160) };
  if (header.resultCode !== '00' && header.resultCode !== '0000') {
    return { ok: false, code: 'WX' + header.resultCode, detail: header.resultMsg };
  }
  const raw = data.response.body && data.response.body.items && data.response.body.items.item;
  const items = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  return summarizeForecast(items, target);
}

/** 편집기에서 실행하는 날씨 진단: 강릉 좌표 (로그에서 결과를 확인하세요) */
function testWeather() {
  Logger.log('격자: ' + JSON.stringify(toGrid(37.7519, 128.8761)));
  Logger.log(handleWeather({ points: 'test:128.8761,37.7519' }).getContent());
}

// ---------- 하루 코스: 구간별 길찾기 ----------
// pairs="경도,위도>경도,위도|경도,위도>경도,위도|..." (최대 6구간) → { legs: [{ ok, min, km } ...] } (입력 순서 그대로)
const MAX_LEGS = 6;
function handleLegs(p) {
  const raw = String(p.pairs || '').split('|').filter(Boolean);
  const pairs = raw.slice(0, MAX_LEGS).map(function (s) {
    const ab = s.split('>');
    const o = parseLngLat(ab[0]);
    const d = parseLngLat(ab[1]);
    return o && d ? { o: o, d: d } : null;
  });
  if (pairs.length === 0 || pairs.some(function (x) { return !x; })) {
    return jsonOut({ ok: false, code: 'BAD_QUERY', message: '구간 좌표가 올바르지 않아요.' });
  }
  const key = (PropertiesService.getScriptProperties().getProperty('KAKAO_REST_KEY') || '').trim();
  if (!key) return jsonOut({ ok: false, code: 'KEY_MISSING', message: '스크립트 속성에 KAKAO_REST_KEY가 없어요.' });

  const cache = CacheService.getScriptCache();
  const legs = new Array(pairs.length);
  const todo = [];
  pairs.forEach(function (pr, i) {
    const ck = 'leg:' + pr.o.lng.toFixed(4) + ',' + pr.o.lat.toFixed(4) + '>' + pr.d.lng.toFixed(4) + ',' + pr.d.lat.toFixed(4);
    const hit = cache.get(ck);
    if (hit) legs[i] = JSON.parse(hit);
    else todo.push({ i: i, ck: ck, pr: pr });
  });
  if (todo.length > 0) {
    const reqs = todo.map(function (t) {
      return {
        url: DIRECTIONS_URL + '?origin=' + t.pr.o.lng + ',' + t.pr.o.lat + '&destination=' + t.pr.d.lng + ',' + t.pr.d.lat + '&priority=RECOMMEND&summary=true',
        headers: { Authorization: 'KakaoAK ' + key },
        muteHttpExceptions: true,
      };
    });
    UrlFetchApp.fetchAll(reqs).forEach(function (r, j) {
      const out = parseRoute(r);
      legs[todo[j].i] = out;
      if (out.ok) cache.put(todo[j].ck, JSON.stringify(out), ROUTE_CACHE_SECONDS);
    });
  }
  return jsonOut({ ok: true, legs: legs });
}
