const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE);

// UI regression fixtures only. Every trial API call is intercepted; all other
// APIs and external traffic are blocked. This does not exercise a live AI model.
const base = new URL(process.env.LEARNING_BROWSER_BASE_URL || 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
assert.equal(base.protocol, 'http:');
assert.equal(base.pathname, '/');
assert.equal(base.search + base.hash + base.username + base.password, '');
const prediction = '나무는 가라앉고 철은 떠요';
const initialReason = '나무가 철보다 더 무거우니까 가라앉을 것 같아요.';
const makeJob = (reason = initialReason) => ({
  id: randomUUID(), status: 'queued', prediction, reason, result: null,
  created_at: new Date().toISOString(), finished_at: null,
});
function ready(job, hypothesis = 'mass_only') {
  return {...job, status: 'ready', finished_at: new Date().toISOString(), result: {
    hypothesis, reason_status: hypothesis === 'hold' ? 'insufficient' : 'supported',
    evidence: hypothesis === 'hold' ? '' : job.reason,
    note: '브라우저 회귀용 응답입니다. 원문의 조건을 확인해 주세요.',
  }};
}

(async () => {
  const browser = await chromium.launch({headless: true});
  const unexpected = [], pageErrors = [];
  async function fixture(initial = {}) {
    const state = {online: true, remaining: 3, job: null, failReads: false, reads: 0, posts: [], ...initial};
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const reply = (status, json) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(json)});
      if (url.origin !== base.origin) {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      if (url.pathname === '/api/trial' && request.method() === 'GET') {
        state.reads++;
        if (state.failReads) return reply(503, {code: 'UNAVAILABLE', error: 'fixture read failure'});
        return reply(200, {online: state.online, remaining: state.remaining, job: state.job});
      }
      if (url.pathname === '/api/trial' && request.method() === 'POST') {
        const input = request.postDataJSON();
        state.posts.push(input);
        state.job = {...makeJob(input.reason), prediction: input.prediction};
        state.remaining--;
        return reply(202, {job: state.job});
      }
      if (url.pathname.startsWith('/api/')) {
        unexpected.push(`${request.method()} ${url.pathname}`);
        return reply(500, {code: 'UNEXPECTED_API'});
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(new URL('/try', base).href);
    return {page, state, close: () => context.close()};
  }
  const heading = (page, name) => page.getByRole('heading', {name, exact: true});
  const button = (page, name) => page.getByRole('button', {name, exact: true});
  const reasonInput = page => page.getByLabel(/^그렇게 생각한 이유/);
  const observationInput = page => page.getByLabel(/^무엇을 봤나/);
  async function noActivity(page) {
    assert.equal(await button(page, '실험 시작').count(), 0);
    assert.equal(await button(page, '실험 처음으로').count(), 0);
    assert.equal(await observationInput(page).count(), 0);
    assert.equal(await page.getByRole('img').count(), 0, 'No experiment tanks before the human gate');
  }
  async function submit(page, reason) {
    await page.getByRole('radio', {name: prediction, exact: true}).check();
    await reasonInput(page).fill(reason);
    await button(page, '내 이유를 AI로 분석하기').click();
    await heading(page, '분석 순서를 기다리고 있어요.').waitFor();
    assert.equal(await reasonInput(page).inputValue(), reason);
    await noActivity(page);
  }
  async function finishAnalysis(page, state, hypothesis = 'mass_only') {
    state.job = ready(state.job, hypothesis);
    await heading(page, 'AI의 가설을 직접 살펴봐요.').waitFor();
    await noActivity(page);
  }

  try {
    const journey = await fixture();
    try {
      const {page, state} = journey;
      await submit(page, initialReason);
      assert.equal(state.posts.length, 1);
      assert.deepEqual(Object.keys(state.posts[0]).sort(), ['prediction', 'reason', 'request']);
      await finishAnalysis(page, state);
      assert.equal(await page.getByLabel('확인할 가설', {exact: true}).inputValue(), 'mass_only');
      await button(page, '확인하고 반례 활동 열기').click();
      await heading(page, '예측과 다른 장면을 찾아요.').waitFor();
      assert.equal(await observationInput(page).count(), 0, 'Observation waits for the experiment');
      await button(page, '실험 시작').click();
      await page.getByRole('img', {name: '나무 80g: 뜸', exact: true}).waitFor();
      await page.getByRole('img', {name: '철 20g: 가라앉음', exact: true}).waitFor();
      assert.equal(await button(page, '관찰을 남기고 설명 다시 쓰기').isDisabled(), true);
      const observation = '더 무거운 나무가 뜨고 더 가벼운 철은 가라앉았어요.';
      await observationInput(page).fill(observation);
      await button(page, '관찰을 남기고 설명 다시 쓰기').click();
      await heading(page, '처음의 설명이 어떻게 달라졌나요?').waitFor();
      assert.equal(await button(page, '새 사례에 적용하기').isDisabled(), true);
      const revised = '질량만 보지 않고 물체와 물의 밀도를 비교해야 해요.';
      await page.getByLabel('둘 다 설명하려면', {exact: true}).fill(revised);
      await page.getByLabel(/^내가 놓친 것 \/ 새로 발견한 것/).fill('부피와 액체 조건을 함께 비교했어요.');
      await button(page, '새 사례에 적용하기').click();
      await heading(page, '새로운 물체도 설명할 수 있나요?').waitFor();
      assert.equal(await button(page, '내 탐구 기록 마무리').isDisabled(), true);
      await page.getByRole('radio', {name: 'A는 뜨고 B는 가라앉아요', exact: true}).check();
      await page.getByLabel('같은 원리로 이유를 설명해요', {exact: true}).fill('A의 밀도는 물보다 작고 B는 물보다 커요.');
      await button(page, '내 탐구 기록 마무리').click();
      await heading(page, '생각의 변화를 남겼어요.').waitFor();
      assert.ok((await page.locator('main').innerText()).includes(observation));
      assert.ok((await page.locator('main').innerText()).includes(revised));
      assert.equal(state.posts.length, 1, 'Activity and reflection remain local; they do not send new AI requests');

      await button(page, '이유를 바꿔 다시 탐구하기').click();
      await submit(page, '어떤 조건을 비교해야 할지 아직 모르겠어요.');
      assert.equal(await page.getByLabel('둘 다 설명하려면', {exact: true}).count(), 0);
      await finishAnalysis(page, state, 'hold');
      assert.equal(await button(page, '확인하고 반례 활동 열기').isDisabled(), true);
      await button(page, '보류 · 이유 다시 묻기').click();
      await heading(page, '왜 그렇게 생각했나요?').waitFor();
      await page.getByText('보류했어요 · 이유를 한 번 더 물어요.', {exact: true}).waitFor();
      assert.equal(await reasonInput(page).inputValue(), '어떤 조건을 비교해야 할지 아직 모르겠어요.');
      await noActivity(page);

      await submit(page, '물체의 크기만 보고 뜨고 가라앉는다고 생각했어요.');
      await finishAnalysis(page, state, 'size_only');
      assert.equal(await page.getByLabel('함께 볼 반례 활동', {exact: true}).inputValue(), 'split_wood');
      await page.getByLabel('확인할 가설', {exact: true}).selectOption('liquid_missed');
      assert.equal(await page.getByLabel('함께 볼 반례 활동', {exact: true}).inputValue(), 'change_liquid');
      await page.getByLabel('함께 볼 반례 활동', {exact: true}).selectOption('split_wood');
      assert.equal(await page.getByLabel('함께 볼 반례 활동', {exact: true}).inputValue(), 'split_wood');
      await page.getByLabel('함께 볼 반례 활동', {exact: true}).selectOption('change_liquid');
      await button(page, '수정하고 반례 활동 열기').click();
      await page.getByText('교사 역할로 수정함', {exact: true}).waitFor();
      await button(page, '실험 시작').click();
      assert.equal(await observationInput(page).inputValue(), '', 'A new analysis must not inherit the previous observation');
      await page.getByText('같은 물체가 액체 A에서는 가라앉고, 액체 B에서는 떠요.', {exact: true}).waitFor();
      assert.equal(state.posts.length, 3);
      assert.equal(new Set(state.posts.map(post => post.request)).size, 3);
      console.log('PASS trial UI fixtures: queued/ready states, human confirm/edit/hold gates, observation/rewrite/transfer and fresh-flow reset');
    } finally { await journey.close(); }

    const restored = await fixture({job: ready(makeJob())});
    try {
      const {page, state} = restored;
      await heading(page, 'AI의 가설을 직접 살펴봐요.').waitFor();
      await noActivity(page);
      assert.equal(await page.locator('blockquote').innerText(), initialReason);
      await button(page, '확인하고 반례 활동 열기').click();
      await button(page, '실험 시작').click();
      const savedObservation = '새로고침해도 남아 있어야 하는 관찰이에요.';
      await observationInput(page).fill(savedObservation);
      const reads = state.reads;
      await page.reload();
      await heading(page, '예측과 다른 장면을 찾아요.').waitFor();
      assert.equal(await observationInput(page).inputValue(), savedObservation);
      assert.ok(state.reads > reads, 'Reload must retrieve the job from the status endpoint');
      assert.equal(state.posts.length, 0, 'Restoring a persisted job must not enqueue another request');
      console.log('PASS trial UI fixtures: GET restores a job and reload retains this tab’s observation without resubmission');
    } finally { await restored.close(); }

    const unsent = await fixture({job: ready(makeJob())});
    try {
      const {page, state} = unsent;
      await heading(page, 'AI의 가설을 직접 살펴봐요.').waitFor();
      await button(page, '보류 · 이유 다시 묻기').click();
      const updatedReason = '지난 설명을 고쳐 물체와 액체의 밀도를 함께 비교해요.';
      await reasonInput(page).fill(updatedReason);
      await page.reload();
      await page.getByText('분석 요청 가능', {exact: true}).waitFor();
      await heading(page, '왜 그렇게 생각했나요?').waitFor();
      assert.equal(await reasonInput(page).inputValue(), updatedReason, 'Reload must retain a new unsent explanation instead of restoring the earlier job text');
      await noActivity(page);
      assert.equal(state.posts.length, 0);
      console.log('PASS trial UI fixtures: a revised unsent explanation and prediction phase survive reload after an earlier ready job');
    } finally { await unsent.close(); }

    const finishedDuringReload = await fixture({job: makeJob()});
    try {
      const {page, state} = finishedDuringReload;
      await heading(page, '분석 순서를 기다리고 있어요.').waitFor();
      state.job = ready(state.job);
      await page.reload();
      await heading(page, 'AI의 가설을 직접 살펴봐요.').waitFor();
      assert.equal(await page.locator('blockquote').innerText(), initialReason);
      await noActivity(page);
      assert.equal(state.posts.length, 0);
      console.log('PASS trial UI fixtures: a job completed during reload enters review instead of restoring its old waiting phase');
    } finally { await finishedDuringReload.close(); }

    const recovery = await fixture();
    try {
      const {page, state} = recovery;
      await submit(page, initialReason);
      const failedPoll = page.waitForResponse(response => new URL(response.url()).pathname === '/api/trial' && response.request().method() === 'GET' && response.status() === 503);
      state.failReads = true;
      await failedPoll;
      // Next's route announcer also has role=alert. Only the application alert
      // proves the failed poll was handled and exposes the recovery control.
      const alert = page.getByRole('main').getByRole('alert');
      await alert.waitFor();
      await alert.getByRole('button', {name: '상태 다시 확인', exact: true}).waitFor();
      assert.equal(await reasonInput(page).inputValue(), initialReason);
      assert.equal(await page.getByRole('radio', {name: prediction, exact: true}).isChecked(), true);
      await noActivity(page);
      state.failReads = false;
      state.job = ready(state.job);
      await button(page, '상태 다시 확인').click();
      await heading(page, 'AI의 가설을 직접 살펴봐요.').waitFor();
      assert.equal(await alert.count(), 0);
      assert.equal(await page.locator('blockquote').innerText(), initialReason);
      assert.equal(state.posts.length, 1, 'Retrying status after polling fails must not duplicate submission');
      console.log('PASS trial UI fixtures: polling failure retains input and status retry recovers the same job');
    } finally { await recovery.close(); }

    assert.deepEqual(unexpected, [], 'No API or external request may escape the browser fixtures');
    assert.deepEqual(pageErrors, []);
    console.log('PASS trial UI fixture suite: no external service, live model call or page error');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
