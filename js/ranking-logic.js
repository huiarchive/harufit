// 인기 랭킹 계산 (순수 함수 — Firebase 없이 따로 테스트할 수 있어요)
//
// 찜 수를 '숫자를 올리고 내리는' 방식으로 세면, 빠르게 두 번 누르거나 탭이 겹칠 때 숫자가 틀어질 수 있어요.
// 그래서 장소마다 '찜한 계정 목록(voters)'을 두고, 그 목록의 크기를 찜 수로 써요.
// 같은 계정이 몇 번 찜해도 목록에는 한 번만 들어가서(멱등) 숫자가 틀어지지 않아요.

// 찜할 때 한 번에 저장할 경로들 (장소 정보 + 내 계정을 찜한 사람 목록에 추가)
export function voteUpdates(place, uid) {
  const base = `ranking/${place.id}`;
  const s = (v, n) => String(v || '').slice(0, n);
  return {
    [`${base}/title`]: s(place.title, 150),
    [`${base}/addr`]: s(place.addr, 200),
    [`${base}/image`]: s(place.image, 400),
    [`${base}/typeId`]: s(place.typeId, 10),
    [`${base}/typeLabel`]: s(place.typeLabel, 30),
    [`${base}/voters/${uid}`]: true,
  };
}

// ranking 전체 데이터 → 찜 많은 순 목록 (최대 30곳, 찜이 0인 곳은 빼요)
export function rankingFromData(data) {
  return Object.entries(data || {})
    .map(([id, v]) => ({
      id,
      title: (v && v.title) || '',
      addr: (v && v.addr) || '',
      image: (v && v.image) || '',
      typeId: (v && v.typeId) || '',
      typeLabel: (v && v.typeLabel) || '',
      likes: v && v.voters ? Object.keys(v.voters).length : 0,
    }))
    .filter((x) => x.likes > 0)
    .sort((a, b) => b.likes - a.likes || a.title.localeCompare(b.title))
    .slice(0, 30);
}
