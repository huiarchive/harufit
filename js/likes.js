// 찜하기 — 저장소를 갈아 끼울 수 있게 만들었어요.
// 기본은 이 기기(localStorage)이고, Firebase에 연결되면 Firebase(내 계정 영역)로 바뀌어요.
const LIKES_KEY = 'daytrip:likes';

function createLocalLikes() {
  const read = () => { try { return JSON.parse(localStorage.getItem(LIKES_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const write = (m) => { try { localStorage.setItem(LIKES_KEY, JSON.stringify(m)); } catch (e) { /* 저장 공간이 없으면 건너뛰어요 */ } };
  const subs = new Set();
  const emit = () => { const m = read(); subs.forEach((fn) => fn(m)); };
  // 다른 탭에서 찜하면 이 탭도 바로 바뀌어요
  window.addEventListener('storage', (e) => { if (e.key === LIKES_KEY) emit(); });
  return {
    watch(cb) { subs.add(cb); cb(read()); return () => subs.delete(cb); },
    async set(place) { const m = read(); m[place.id] = place; write(m); emit(); },
    async remove(id) { const m = read(); delete m[id]; write(m); emit(); },
    snapshot: read,
    clear() { write({}); emit(); },
  };
}

// 저장할 장소 정보 — 필요한 항목만 정해진 형태로 담아요 (Firebase 규칙과 같은 항목이에요)
function placeSummary(p) {
  return {
    id: String(p.id),
    title: String(p.title || ''),
    addr: String(p.addr || ''),
    image: String(p.image || ''),
    typeId: String(p.typeId || ''),
    typeLabel: String(p.typeLabel || ''),
    lat: Number(p.lat) || 0,
    lng: Number(p.lng) || 0,
    savedAt: Date.now(),
  };
}

const Likes = (function () {
  let items = {};
  let mode = 'local';
  let backend = null;
  let unwatch = null;
  const listeners = new Set();
  const local = createLocalLikes();

  function attach(b, m) {
    if (unwatch) unwatch();
    backend = b;
    mode = m;
    unwatch = b.watch((map) => { items = map || {}; listeners.forEach((fn) => fn(items)); });
  }
  attach(local, 'local');

  return {
    get mode() { return mode; },
    all: () => items,
    has: (id) => !!items[id],
    count: () => Object.keys(items).length,
    onChange(fn) { listeners.add(fn); fn(items); },
    // 찜하면 true, 찜을 취소하면 false를 돌려줘요
    async toggle(place) {
      if (items[place.id]) { await backend.remove(place.id); return false; }
      await backend.set(placeSummary(place));
      return true;
    },
    remove: (id) => backend.remove(id),
    setBackend: attach,
    localBackend: local,
  };
})();

// 화면 아래에 잠깐 떴다 사라지는 안내
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.className = 'pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-toss-text px-5 py-3 text-sm font-semibold text-white shadow-lg transition-opacity duration-300 lg:bottom-8';
    el.style.opacity = '0';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}
