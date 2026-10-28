// 하루 코스 — 방문 순서 정하기와 시간표 계산 (화면·네트워크와 분리된 순수 계산이라 따로 테스트할 수 있어요)
const COURSE = {
  MIN_STAY: 45,   // 한 곳에서 최소한 머물러야 하는 시간(분)
  TIGHT_STAY: 60, // 곳당 평균 체류가 이보다 짧으면 '빠듯해요'
  MAX_PLACES: 4,  // 한 번에 묶을 수 있는 장소 수
  // 장소 유형별 기본 체류 비율 (관광공사 콘텐츠 유형 기준, 남는 시간을 이 비율대로 나눠요)
  WEIGHT: { '12': 90, '14': 90, '15': 90, '28': 120, '38': 60, '39': 60 },
};

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => {
    permutations(arr.slice(0, i).concat(arr.slice(i + 1))).forEach((rest) => out.push([x].concat(rest)));
  });
  return out;
}

// 출발지 → 각 장소 → 출발지로 돌아오는 직선거리 합(km)
function routeLengthKm(origin, seq) {
  const pts = [origin].concat(seq, [origin]);
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) sum += haversineKm(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
  return sum;
}

// 4곳 이하라서 모든 순서를 직접 비교해도 24가지뿐이에요 (가장 짧은 순서를 골라요)
function bestOrder(origin, places) {
  if (places.length <= 1) return places.slice();
  let best = null;
  let bestLen = Infinity;
  permutations(places).forEach((seq) => {
    const len = routeLengthKm(origin, seq);
    if (len < bestLen - 1e-9) { best = seq; bestLen = len; }
  });
  return best;
}

// 구간 목록: 출발 → 1번 → 2번 → … → 마지막 → 출발지 (장소 수 + 1개)
function legPairs(origin, ordered) {
  const pts = [origin].concat(ordered, [origin]);
  const pairs = [];
  for (let i = 0; i < pts.length - 1; i++) pairs.push({ from: pts[i], to: pts[i + 1] });
  return pairs;
}

// 길찾기 결과가 오기 전에 쓰는 추정 구간 시간
function estimateLegs(origin, ordered) {
  return legPairs(origin, ordered).map((p) => ({
    min: estimateOneWayMinutes(haversineKm(p.from.lat, p.from.lng, p.to.lat, p.to.lng)),
    km: null,
    exact: false,
  }));
}

function formatClock(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${min >= 1440 ? '다음 날 ' : ''}${hh}:${mm}`;
}

// legs: [{ min, km, exact }] (장소 수 + 1개), hoursMin: 쓸 수 있는 총 시간(분), startMin: 출발 시각(자정부터 분)
function planCourse({ ordered, legs, hoursMin, startMin }) {
  const k = ordered.length;
  const travel = legs.reduce((a, l) => a + l.min, 0);
  const free = hoursMin - travel; // 이동을 빼고 남는 시간 = 장소에서 쓸 수 있는 총 체류 시간
  const status = free < COURSE.MIN_STAY * k ? 'impossible' : free / k < COURSE.TIGHT_STAY ? 'tight' : 'ok';

  // 남는 시간을 유형별 비율대로 나누고 5분 단위로 맞춰요 (자투리는 앞 장소부터 5분씩)
  const weights = ordered.map((p) => COURSE.WEIGHT[p.typeId] || 90);
  const sumW = weights.reduce((a, b) => a + b, 0);
  let stays = weights.map((w) => (free > 0 ? Math.floor((free * w) / sumW / 5) * 5 : 0));
  let left = Math.max(0, free) - stays.reduce((a, b) => a + b, 0);
  for (let i = 0; left >= 5; i++, left -= 5) stays[i % k] += 5;

  const timeline = [{ type: 'start', at: startMin }];
  let cursor = startMin;
  ordered.forEach((p, i) => {
    timeline.push({ type: 'move', from: cursor, to: cursor + legs[i].min, min: legs[i].min, km: legs[i].km, exact: legs[i].exact });
    cursor += legs[i].min;
    timeline.push({ type: 'stay', place: p, arrive: cursor, depart: cursor + stays[i], stay: stays[i] });
    cursor += stays[i];
  });
  timeline.push({ type: 'move', from: cursor, to: cursor + legs[k].min, min: legs[k].min, km: legs[k].km, exact: legs[k].exact });
  cursor += legs[k].min;
  timeline.push({ type: 'end', at: cursor });

  return { status, travel, free, stays, timeline, endMin: cursor, avgStay: k ? free / k : 0 };
}
