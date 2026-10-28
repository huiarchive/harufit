// 설정값 모음
const CONFIG = {
  // GAS 웹 앱 배포 주소 (…/exec). 인증키는 프론트가 아니라 GAS 스크립트 속성에 있어요.
  PROXY_URL: 'https://script.google.com/macros/s/AKfycbzynjcvhFcQi-WYUAAXoxbT_Hfym03KwLPkfEJjaFJIaH-7vSwACoH_g-5UbpsINLT0/exec',

  NUM_OF_ROWS: 100,

  // 정렬 기준: 'Q' = 대표 이미지가 있는 것만, 수정일순. 오류가 나면 'C'로 바꿔 보세요.
  ARRANGE: 'Q',

  // 당일치기에 맞지 않는 유형은 제외해요. (25: 여행코스, 32: 숙박)
  EXCLUDE_TYPES: ['25', '32'],

  TYPE_LABELS: {
    '12': '관광지', '14': '문화시설', '15': '축제·공연', '25': '여행코스',
    '28': '레포츠', '32': '숙박', '38': '쇼핑', '39': '음식점',
  },

  // 같은 지역을 다시 조회할 때 API를 또 부르지 않도록 브라우저에 보관하는 시간
  CACHE_TTL_MS: 30 * 60 * 1000,
};
