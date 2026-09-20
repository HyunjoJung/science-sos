const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE);

// Only load the local app shell. Every API response is fulfilled in the browser,
// and all cross-origin traffic is rejected: no Auth, database, model or worker.
const base = new URL(process.env.LEARNING_BROWSER_BASE_URL || 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'A local app server is required');
assert.equal(base.protocol, 'http:');
assert.equal(base.pathname, '/');
assert.equal(base.search + base.hash + base.username + base.password, '');

const courseId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const courses = [{id: courseId, title: '연결 회귀 수업', role: 'teacher'}];
const home = {user_id: userId, courses};
const classroom = {
  ...home, course_id: courseId, role: 'teacher', assignments: [], catalog: [], has_more: false,
  attempts: [{
    id: attemptId, student_id: '44444444-4444-4444-8444-444444444444',
    title: '밀도 설명', stage: 'awaiting_review', version: 1,
    created_at: '2026-09-20T10:00:00.000Z', prompt: '나무와 철을 비교해요.', choices: ['나무'],
    response: {answer: '나무', reason: '물체와 물의 밀도를 비교했어요.'},
    activities: [{id: 'compare', title: '조건 비교', kind: 'comparison', instruction: '같은 물에서 비교해요.'}],
  }],
};
const migration = {code: 'migration_required', error: '학습 데이터베이스 업데이트가 필요해요. 관리자에게 문의해 주세요.'};
const unauthorized = {code: 'unauthorized', error: '로그인해 주세요.'};
const unavailable = {code: 'internal_error', error: '수업 연결을 확인하지 못했어요.'};

(async () => {
  const browser = await chromium.launch({headless: true});
  const pageErrors = [];
  const unexpected = [];

  async function fixture(initial) {
    const state = {authenticated: false, mode: 'migration', reads: 0, rejectWrite: false, ...initial};
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const reply = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
      if (url.origin !== base.origin) {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      if (url.pathname === '/api/learning' && request.method() === 'GET') {
        state.reads++;
        if (state.mode === 'unavailable') return reply(500, unavailable);
        if (!state.authenticated) return reply(401, unauthorized);
        if (state.mode === 'migration') return reply(503, migration);
        return reply(200, url.searchParams.has('course') ? classroom : home);
      }
      if (url.pathname === '/api/lab' && request.method() === 'POST') {
        const {action} = request.postDataJSON();
        if (action === 'login' || action === 'logout') {
          state.authenticated = action === 'login';
          return reply(200, {ok: true});
        }
      }
      if (url.pathname === '/api/learning' && request.method() === 'POST' && state.rejectWrite) {
        state.authenticated = false;
        // A later read cannot be used to clear the expired user's draft: it fails.
        state.mode = 'unavailable';
        return reply(401, unauthorized);
      }
      if (url.pathname.startsWith('/api/')) {
        unexpected.push(`${request.method()} ${url.pathname}`);
        return reply(500, {code: 'unexpected_fixture_request', error: 'Unexpected fixture request'});
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(new URL('/learn', base).href);
    return {page, state, close: () => context.close()};
  }

  async function login(page) {
    await page.getByLabel('이메일', {exact: true}).fill('teacher@test.invalid');
    await page.getByLabel('비밀번호', {exact: true}).fill('fixture-password-only');
    await page.getByRole('button', {name: '로그인', exact: true}).click();
    await page.getByRole('button', {name: '로그아웃', exact: true}).waitFor();
  }

  async function authenticatedRecovery(page) {
    await page.getByRole('heading', {name: '학습 교실을 불러오지 못했어요', exact: true}).waitFor();
    await page.getByText('로그인은 확인됐어요. 학습 교실 연결이 준비되면 수업을 이어갈 수 있어요.', {exact: true}).waitFor();
    assert.equal(await page.getByLabel('비밀번호', {exact: true}).count(), 0);
    assert.equal(await page.getByRole('button', {name: '로그인', exact: true}).count(), 0);
    assert.equal(await page.getByRole('link', {name: '기존 과학 교실로 이동', exact: true}).getAttribute('href'), '/');
    await page.getByRole('button', {name: '연결 다시 확인', exact: true}).waitFor();
    await page.getByRole('button', {name: '로그아웃', exact: true}).waitFor();
  }

  try {
    const missing = await fixture({});
    try {
      await login(missing.page);
      await authenticatedRecovery(missing.page);
      await missing.page.reload();
      await authenticatedRecovery(missing.page);
      await missing.page.getByRole('button', {name: '로그아웃', exact: true}).click();
      await missing.page.getByRole('button', {name: '로그인', exact: true}).waitFor();
      assert.equal(await missing.page.locator('article').count(), 0);
      console.log('PASS login recovery: login and page reload retain verified auth during a missing classroom migration; logout remains available.');
    } finally { await missing.close(); }

    const unknown = await fixture({mode: 'unavailable'});
    try {
      await unknown.page.getByText('연결이 원활하지 않아 로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', {exact: true}).waitFor();
      assert.equal(await unknown.page.getByLabel('비밀번호', {exact: true}).count(), 0);
      assert.equal(await unknown.page.getByRole('button', {name: '로그아웃', exact: true}).count(), 0);
      const readsBeforeRetry = unknown.state.reads;
      unknown.state.mode = 'migration';
      await unknown.page.getByRole('button', {name: '연결 다시 확인', exact: true}).click();
      await unknown.page.getByRole('button', {name: '로그인', exact: true}).waitFor();
      assert.ok(unknown.state.reads > readsBeforeRetry);
      console.log('PASS login recovery: initial server outage stays unresolved until a retry establishes that login is needed.');
    } finally { await unknown.close(); }

    const expired = await fixture({authenticated: true, mode: 'classroom'});
    try {
      const feedback = expired.page.getByLabel('검토 의견 / 학생에게 보낼 질문', {exact: true});
      await feedback.fill('읽기 도중 세션이 만료되면 사라져야 하는 초안');
      expired.state.authenticated = false;
      await expired.page.getByRole('button', {name: '다시 불러오기', exact: true}).click();
      await expired.page.getByRole('button', {name: '로그인', exact: true}).waitFor();
      assert.equal(await expired.page.locator('article').count(), 0);
      assert.equal(await feedback.count(), 0);
      await login(expired.page);
      await feedback.waitFor();
      assert.equal(await feedback.inputValue(), '', 'An expired session cannot restore a former review draft');

      await feedback.fill('저장 도중 세션이 만료되면 사라져야 하는 초안');
      expired.state.rejectWrite = true;
      await expired.page.getByRole('button', {name: '이유 더 묻기', exact: true}).click();
      await expired.page.getByRole('button', {name: '로그인', exact: true}).waitFor();
      assert.equal(await expired.page.locator('article').count(), 0);
      assert.equal(await feedback.count(), 0);
      // Recover the service and return to the same record to check actual draft
      // isolation, not just whether an error banner hid the previous textarea.
      expired.state.mode = 'classroom';
      expired.state.rejectWrite = false;
      await login(expired.page);
      await feedback.waitFor();
      assert.equal(await feedback.inputValue(), '');
      console.log('PASS login recovery: read and write 401s clear classroom data and drafts, including when a later read fails.');
    } finally { await expired.close(); }

    assert.deepEqual(unexpected, [], 'No unhandled API or cross-origin request may reach a real service');
    assert.deepEqual(pageErrors, []);
    console.log('PASS login recovery: all API calls isolated in browser fixtures; no page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
