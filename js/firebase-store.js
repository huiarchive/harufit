// Firebase Realtime Database 연결 (ES 모듈) — 혼잡도 제보를 저장하고 실시간으로 받아와요
import { voteUpdates, rankingFromData } from './ranking-logic.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getDatabase, ref, push, query, orderByChild, startAt, onValue, serverTimestamp,
  set as dbSet, remove as dbRemove, update, limitToLast,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js';

// 여러 곳에서 불러와도 앱은 한 번만 만들어요
const appOf = (config) => (getApps().length ? getApp() : initializeApp(config));

export function createFirebaseStore(config) {
  const db = getDatabase(appOf(config));
  return {
    // sinceMs 이후의 제보를 실시간으로 받아요. 반환값은 구독 해제 함수예요.
    subscribe(contentId, sinceMs, onData, onError) {
      const q = query(ref(db, `reports/${contentId}`), orderByChild('ts'), startAt(sinceMs));
      return onValue(q, (snap) => {
        const list = [];
        snap.forEach((child) => {
          const v = child.val();
          list.push({ level: v.level, ts: v.ts });
        });
        onData(list);
      }, onError);
    },
    // 제보 한 건 저장 (시각은 서버 시각을 써서 기기 시계 오차를 막아요)
    // 장소 이름(meta.title)이 있으면 인기 랭킹용 피드에도 함께, 한 번에(원자적으로) 저장해요
    submit(contentId, level, meta) {
      if (!meta || !meta.title) return push(ref(db, `reports/${contentId}`), { level, ts: serverTimestamp() });
      const key = push(ref(db, 'feed')).key;
      return update(ref(db), {
        [`reports/${contentId}/${key}`]: { level, ts: serverTimestamp() },
        [`feed/${key}`]: { id: contentId, title: String(meta.title).slice(0, 150), level, ts: serverTimestamp() },
      });
    },
  };
}

// 찜하기 저장소 — 익명 로그인한 내 계정 영역(users/내uid/likes)에만 저장해요
export async function createFirebaseLikes(config) {
  const app = appOf(config);
  const db = getDatabase(app);
  const { user } = await signInAnonymously(getAuth(app));
  const base = ref(db, `users/${user.uid}/likes`);
  return {
    watch(cb) {
      let healed = false;
      return onValue(base, (snap) => {
        const map = snap.val() || {};
        cb(map);
        if (!healed) { // 처음 한 번, 내가 찜한 곳이 랭킹에도 들어 있는지 맞춰 둬요 (여러 번 해도 결과는 같아요)
          healed = true;
          Object.values(map).forEach((p) => vote(db, user.uid, p, true));
        }
      }, (err) => console.error(err));
    },
    async set(place) {
      if (!/^[\w-]+$/.test(place.id)) throw new Error('BAD_ID');
      await dbSet(ref(db, `users/${user.uid}/likes/${place.id}`), place);
      await vote(db, user.uid, place, true);
    },
    async remove(id) {
      await dbRemove(ref(db, `users/${user.uid}/likes/${id}`));
      await vote(db, user.uid, { id }, false);
    },
  };
}

// 인기 랭킹의 '찜한 계정 목록'에 나를 넣거나 빼요. 몇 번 눌러도 결과가 같아서(멱등) 숫자가 틀어지지 않아요.
async function vote(db, uid, place, on) {
  try {
    if (on) await update(ref(db), voteUpdates(place, uid));
    else await dbRemove(ref(db, `ranking/${place.id}/voters/${uid}`));
  } catch (e) {
    console.warn('랭킹에 반영하지 못했어요(찜 저장에는 영향 없어요)', e);
  }
}

// 인기 랭킹 화면용 실시간 구독
export function createRankingStore(config) {
  const db = getDatabase(appOf(config));
  return {
    // 찜이 많은 순 (최대 30곳) → [{ id, title, addr, image, typeLabel, likes }]  (likes = 찜한 계정 수)
    watchLikes(cb, onError) {
      return onValue(ref(db, 'ranking'), (snap) => cb(rankingFromData(snap.val())), onError);
    },
    // sinceMs 이후의 혼잡도 제보 피드 (최대 200건) → [{ id, title, level, ts }]
    watchFeed(sinceMs, cb, onError) {
      const q = query(ref(db, 'feed'), orderByChild('ts'), startAt(sinceMs), limitToLast(200));
      return onValue(q, (snap) => {
        const list = [];
        snap.forEach((child) => { list.push(child.val()); });
        cb(list);
      }, onError);
    },
  };
}
