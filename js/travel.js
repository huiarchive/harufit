// 이동시간과 '현지 체류 가능 시간' 계산
// 기본은 직선거리로 추정하고, 카카오 길찾기 결과가 도착한 곳은 실제 시간으로 바꿔요.

const TRAVEL = {
  DETOUR: 1.25,         // 직선거리 → 도로거리 보정 (도로는 직선보다 구불구불해요)
  BASE_KMH: 25,         // 시내 평균 속도
  KMH_PER_KM: 0.6,      // 멀어질수록 빠른 도로(고속도로)를 타서 평균 속도가 올라가요
  MAX_KMH: 85,          // 평균 속도의 상한 (휴게소·정체 포함)
  MIN_STAY_MIN: 60,     // 현지에서 1시간도 못 머무는 곳은 추천에서 빼요
  LEVELS: [             // 체류 시간에 따른 여유 정도 (분 단위, 큰 값부터)
    { minStay: 180, label: '여유' },
    { minStay: 120, label: '보통' },
    { minStay: 0, label: '빠듯' },
  ],
};

// 직선거리(km) → 예상 편도 이동시간(분, 5분 단위)
function estimateOneWayMinutes(straightKm) {
  const roadKm = straightKm * TRAVEL.DETOUR;
  const kmh = Math.min(TRAVEL.MAX_KMH, TRAVEL.BASE_KMH + roadKm * TRAVEL.KMH_PER_KM);
  const minutes = (roadKm / kmh) * 60;
  return Math.max(5, Math.round(minutes / 5) * 5);
}

// 분 → '1시간 20분'
function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// 쓸 수 있는 시간에서 왕복 이동시간을 빼 체류 시간을 구하고, 너무 짧은 곳은 제외해요
// routes[id]에 카카오 길찾기 결과({ ok, min, km })가 있으면 그 값을, 없으면 추정값을 써요
function applyStay(places, availableMin, routes = {}) {
  const result = [];
  let excluded = 0;
  places.forEach((p) => {
    const real = routes[p.id];
    const exact = !!(real && real.ok);
    const oneWayMin = exact ? Math.max(5, real.min) : estimateOneWayMinutes(p.distanceKm); // 실제 값은 반올림 없이 그대로 보여줘요
    const stayMin = availableMin - oneWayMin * 2;
    if (stayMin < TRAVEL.MIN_STAY_MIN) { excluded++; return; }
    const level = TRAVEL.LEVELS.find((l) => stayMin >= l.minStay).label;
    const estStay = availableMin - estimateOneWayMinutes(p.distanceKm) * 2; // 정렬은 추정값 기준으로 고정해요
    result.push({ ...p, oneWayMin, stayMin, level, exact, roadKm: exact ? real.km : null, estStay });
  });
  // 길찾기 결과가 도착할 때마다 카드 순서가 뒤섞이지 않도록, 순서는 추정 체류 시간으로 고정하고 숫자만 실제 값으로 바꿔요
  result.sort((a, b) => b.estStay - a.estStay || a.distanceKm - b.distanceKm);
  return { places: result, excluded };
}
