// 날씨 표시와 '실내/야외' 판단 규칙

// 관광공사 콘텐츠 유형 → 실내/야외
const ENV_BY_TYPE = {
  '12': 'outdoor', // 관광지
  '14': 'indoor',  // 문화시설
  '15': 'outdoor', // 축제·공연
  '28': 'outdoor', // 레포츠
  '38': 'indoor',  // 쇼핑
  '39': 'indoor',  // 음식점
};
const RAIN_POP = 60; // 강수확률이 이 값 이상이면 비 오는 날로 봐요

function isRainy(w) {
  return !!(w && w.ok && (w.pty > 0 || w.pop >= RAIN_POP));
}

function weatherLabel(w) {
  if (w.pty === 1) return { icon: '🌧️', label: '비' };
  if (w.pty === 2) return { icon: '🌨️', label: '비·눈' };
  if (w.pty === 3) return { icon: '❄️', label: '눈' };
  if (w.pty === 4) return { icon: '🌦️', label: '소나기' };
  if (w.pop >= RAIN_POP) return { icon: '🌦️', label: '비 가능성' };
  if (w.sky === 4) return { icon: '☁️', label: '흐림' };
  if (w.sky === 3) return { icon: '⛅', label: '구름 많음' };
  return { icon: '☀️', label: '맑음' };
}

// 카드에 붙는 날씨 칩 문구 예) "☀️ 맑음 18°" / "🌧️ 비 18° · 강수 70%"
function weatherChipText(w) {
  const l = weatherLabel(w);
  const temp = w.tempMax !== null && w.tempMax !== undefined ? ` ${w.tempMax}°` : '';
  const rain = w.pop >= 30 ? ` · 강수 ${w.pop}%` : '';
  return `${l.icon} ${l.label}${temp}${rain}`;
}

// 날씨와 장소 유형을 함께 보고 한 줄 조언을 만들어요
function weatherAdvice(place, w) {
  if (!isRainy(w)) return null;
  const env = ENV_BY_TYPE[place.typeId];
  if (env === 'outdoor') return { tone: 'warn', text: '비 예보가 있어 야외 일정은 아쉬울 수 있어요' };
  if (env === 'indoor') return { tone: 'good', text: '비가 와도 즐기기 좋아요' };
  return null;
}
