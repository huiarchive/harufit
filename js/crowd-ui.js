// 혼잡도 제보 화면 — store(저장소)는 바깥에서 넣어 줘요 (실제로는 Firebase, 테스트에서는 가짜)
// status: 'ok' | 'unconfigured' | 'error'
function initCrowd({ contentId, store, status, root, getMeta, now = () => Date.now() }) {
  const lastKey = `daytrip:crowd:last:${contentId}`;
  let reports = [];
  let message = '';
  let submitting = false;
  let connectionError = false;

  const readLast = () => { try { return Number(localStorage.getItem(lastKey)) || 0; } catch (e) { return 0; } };
  const writeLast = (ts) => { try { localStorage.setItem(lastKey, String(ts)); } catch (e) { /* 저장이 안 돼도 제보는 가능해요 */ } };

  function notice(text) {
    root.innerHTML = `<div class="rounded-3xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <h2 class="text-lg font-bold">지금 여기 어때요?</h2>
      <p class="mt-2 text-sm text-toss-mute">${text}</p></div>`;
  }

  function render() {
    const t = now();
    const s = summarizeReports(reports, t);
    const remain = cooldownRemainingMs(readLast(), t);
    const locked = submitting || remain > 0;
    const top = CROWD.LEVELS.find((l) => l.key === s.topKey);

    const headline = s.total === 0
      ? `<p class="mt-4 text-xl font-bold text-toss-mute">아직 제보가 없어요</p><p class="mt-1 text-sm text-toss-mute">첫 제보를 남겨 주세요.</p>`
      : `<p class="mt-4 text-2xl font-bold">${top ? `${top.emoji} ${top.label}` : '의견이 나뉘어요'}</p>
         <p class="mt-1 text-sm text-toss-mute">최근 2시간 동안 ${s.total}명이 알려줬어요 · 마지막 제보 ${timeAgo(s.latestTs, t)}</p>`;

    const bars = CROWD.LEVELS.map((l) => `
      <div class="mt-3">
        <div class="flex justify-between text-sm font-medium"><span>${l.emoji} ${l.label}</span><span class="text-toss-sub">${s.percents[l.key]}%</span></div>
        <div class="mt-1 h-2.5 overflow-hidden rounded-full bg-toss-bg"><div class="h-full rounded-full" style="width:${s.percents[l.key]}%;background:${l.color}"></div></div>
      </div>`).join('');

    const buttons = CROWD.LEVELS.map((l) => `
      <button type="button" data-level="${l.key}" ${locked ? 'disabled' : ''} class="h-14 rounded-2xl bg-toss-bg text-sm font-bold transition active:scale-95 hover:bg-toss-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-toss-blue/30">
        <span class="block text-xl" aria-hidden="true">${l.emoji}</span>${l.label}</button>`).join('');

    const hint = message
      || (remain > 0 ? `${Math.ceil(remain / 60000)}분 뒤에 다시 제보할 수 있어요.` : '지금 이곳은 어떤가요? 눌러서 알려 주세요.');

    root.innerHTML = `<div class="rounded-3xl bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <h2 class="text-lg font-bold">지금 여기 어때요?</h2>
      ${connectionError ? '<p class="mt-2 text-sm font-semibold text-[#F76707]">실시간 연결이 불안정해요. 잠시 후 다시 시도해 주세요.</p>' : ''}
      ${headline}${bars}
      <div class="mt-5 grid grid-cols-3 gap-2">${buttons}</div>
      <p id="crowdHint" class="mt-3 text-center text-sm text-toss-mute" aria-live="polite">${hint}</p></div>`;
  }

  if (status === 'unconfigured') return notice('혼잡도 제보를 쓰려면 <code>js/firebase-config.js</code>에 Firebase 설정값을 넣어 주세요.');
  if (status !== 'ok' || !store) return notice('Firebase에 연결하지 못했어요. 설정값과 인터넷 연결을 확인해 주세요.');

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-level]');
    if (!btn || btn.disabled || submitting) return;
    if (cooldownRemainingMs(readLast(), now()) > 0) return;
    submitting = true;
    message = '보내는 중이에요';
    render();
    try {
      await store.submit(contentId, btn.dataset.level, getMeta ? getMeta() : null);
      writeLast(now());
      message = '제보해 주셔서 고마워요!';
    } catch (err) {
      console.error(err);
      const denied = /permission[_ ]denied/i.test(String((err && (err.code || err.message)) || ''));
      message = denied ? '저장 권한이 없어요. Firebase 규칙을 확인해 주세요.' : '제보를 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
    }
    submitting = false;
    render();
    setTimeout(() => { message = ''; render(); }, 4000);
  });

  store.subscribe(
    contentId,
    now() - CROWD.WINDOW_MS,
    (list) => { reports = list; connectionError = false; render(); },
    (err) => { console.error(err); connectionError = true; render(); }
  );
  setInterval(render, 60 * 1000); // 2시간이 지난 제보가 빠지고, 대기 시간이 줄어들도록 매분 다시 그려요
  render();
}
