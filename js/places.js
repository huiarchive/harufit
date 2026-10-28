// API 응답을 화면에 쓰기 좋은 형태로 바꾸는 함수들

function toHttps(url) {
  return url ? url.replace(/^http:\/\//i, 'https://') : '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDistance(km) {
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}

// items(API 원본) + 출발지 → 거리 계산 후 가까운 순으로 정렬된 목록
function toPlaces(items, origin) {
  return items
    .filter((it) => !CONFIG.EXCLUDE_TYPES.includes(String(it.contenttypeid)))
    .map((it) => {
      const lat = parseFloat(it.mapy); // 위도
      const lng = parseFloat(it.mapx); // 경도
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
      return {
        id: it.contentid,
        title: (it.title || '이름 없는 장소').trim(),
        addr: [it.addr1, it.addr2].filter(Boolean).join(' ').trim(),
        image: toHttps(it.firstimage || it.firstimage2 || ''),
        typeId: String(it.contenttypeid),
        typeLabel: CONFIG.TYPE_LABELS[String(it.contenttypeid)] || '기타',
        lat,
        lng,
        distanceKm: haversineKm(origin.lat, origin.lng, lat, lng),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
