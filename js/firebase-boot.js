// 모든 페이지에서 불러오는 Firebase 연결 (ES 모듈)
// 찜하기 저장소를 Firebase로 바꿔요. 연결이 안 돼도 이 기기(localStorage)에 저장하며 계속 동작해요.
if (isFirebaseConfigured(window.FIREBASE_CONFIG)) {
  try {
    const m = await import('./firebase-store.js');
    const fb = await m.createFirebaseLikes(window.FIREBASE_CONFIG); // 익명 로그인 후 내 영역에 연결
    const local = Likes.localBackend.snapshot();
    await Promise.all(Object.values(local).map((p) => fb.set(p))); // 이 기기에 있던 찜을 옮겨요
    Likes.setBackend(fb, 'firebase');
    Likes.localBackend.clear();
    window.crowdStore = m.createFirebaseStore(window.FIREBASE_CONFIG);
    window.rankingStore = m.createRankingStore(window.FIREBASE_CONFIG);
  } catch (e) {
    console.error('Firebase에 연결하지 못해 이 기기에만 저장해요', e);
  }
}
window.__firebaseReady = true;
window.dispatchEvent(new Event('firebase-ready'));
