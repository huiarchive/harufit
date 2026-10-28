// 혼잡도 제보 — 계산 로직 (Firebase·화면과 분리해서 따로 테스트할 수 있어요)
const CROWD = {
  WINDOW_MS: 2 * 60 * 60 * 1000, // 최근 2시간 제보만 집계해요
  COOLDOWN_MS: 30 * 60 * 1000,   // 같은 장소는 30분에 한 번만 제보할 수 있어요
  LEVELS: [
    { key: 'quiet', label: '한산해요', emoji: '😌', color: '#3182F6' },
    { key: 'normal', label: '보통이에요', emoji: '🙂', color: '#8B95A1' },
    { key: 'crowded', label: '붐벼요', emoji: '😵', color: '#F76707' },
  ],
};

// 제보 목록 → 최근 2시간 집계 (건수, 백분율, 가장 많은 의견, 마지막 제보 시각)
function summarizeReports(reports, now = Date.now()) {
  const counts = { quiet: 0, normal: 0, crowded: 0 };
  let total = 0;
  let latestTs = 0;
  (reports || []).forEach((r) => {
    if (!r || !(r.level in counts) || typeof r.ts !== 'number') return;
    if (r.ts < now - CROWD.WINDOW_MS) return; // 2시간 지난 제보는 빼요
    counts[r.level]++;
    total++;
    if (r.ts > latestTs) latestTs = r.ts;
  });

  // 백분율의 합이 정확히 100이 되도록 나눠요 (큰 나머지 방식)
  const percents = { quiet: 0, normal: 0, crowded: 0 };
  if (total > 0) {
    const raw = Object.keys(counts).map((k) => ({ k, v: (counts[k] * 100) / total }));
    raw.forEach((x) => { percents[x.k] = Math.floor(x.v); });
    let left = 100 - raw.reduce((sum, x) => sum + percents[x.k], 0);
    raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
    for (let i = 0; i < left; i++) percents[raw[i].k]++;
  }

  // 가장 많은 의견 (동률이면 null → '의견이 나뉘어요')
  const max = Math.max(counts.quiet, counts.normal, counts.crowded);
  const tops = Object.keys(counts).filter((k) => counts[k] === max);
  return { total, counts, percents, topKey: total > 0 && tops.length === 1 ? tops[0] : null, latestTs };
}

function cooldownRemainingMs(lastTs, now = Date.now()) {
  return lastTs ? Math.max(0, lastTs + CROWD.COOLDOWN_MS - now) : 0;
}

function timeAgo(ts, now = Date.now()) {
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return '방금 전';
  return m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
}

function isFirebaseConfigured(cfg) {
  const ok = (v) => !!v && !String(v).includes('여기에');
  return !!cfg && ok(cfg.apiKey) && ok(cfg.databaseURL);
}

// 제보 피드 → 장소별 집계 (최근 2시간, 제보가 많은 순)
// feed: [{ id, title, level, ts }] → [{ id, title, counts, total, topKey, latestTs }]
function aggregateFeed(feed, now = Date.now()) {
  const byId = {};
  (feed || []).forEach((r) => {
    if (!r || !r.id || !(r.level in { quiet: 1, normal: 1, crowded: 1 }) || typeof r.ts !== 'number') return;
    if (r.ts < now - CROWD.WINDOW_MS) return;
    const g = byId[r.id] || (byId[r.id] = { id: r.id, title: r.title || '', counts: { quiet: 0, normal: 0, crowded: 0 }, total: 0, latestTs: 0 });
    g.counts[r.level]++;
    g.total++;
    if (r.ts >= g.latestTs) { g.latestTs = r.ts; if (r.title) g.title = r.title; }
  });
  return Object.values(byId).map((g) => {
    const max = Math.max(g.counts.quiet, g.counts.normal, g.counts.crowded);
    const tops = Object.keys(g.counts).filter((k) => g.counts[k] === max);
    return { ...g, topKey: tops.length === 1 ? tops[0] : null };
  }).sort((a, b) => b.total - a.total || b.latestTs - a.latestTs);
}
