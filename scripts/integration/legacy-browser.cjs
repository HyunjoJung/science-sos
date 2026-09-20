// UI-only regression fixtures: every legacy API request is intercepted here.
// Run with a local Next server and PLAYWRIGHT_MODULE pointing to Playwright.
// No login, production database, worker, or model is contacted by this test.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);

const origin = new URL(process.env.LEGACY_TEST_ORIGIN || 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'Local Next server required');
assert.equal(origin.protocol, 'http:', 'Local HTTP fixture server required');
const initialRecord = {
  id: 'legacy-browser-record', student_id: 'fixture-student', student_alias: '탐구자',
  item_id: 'D01', prediction: '나무는 가라앉고 철은 떠요', reason: '나무가 더 무거워요.',
  version: 1, state: 'awaiting_review', hypothesis: 'hold', analysis_mode: 'pending',
  analysis_note: '', experiment_id: null, observation: null, revised_text: null,
  self_note: null, stuck_at: null, re_prediction: null, re_reason: null, scores: null,
  created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z',
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  async function fixture(role, overrides = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const state = {
      row: { ...initialRecord, ...overrides }, reads: 0, writes: [], releaseWrite: null,
    };
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin.origin) return route.abort('blockedbyclient');
      const json = data => route.fulfill({ json: data });
      if (url.pathname === '/api/lab' && request.method() === 'GET') {
        if (url.searchParams.has('experiment')) {
          assert.equal(url.searchParams.get('experiment'), initialRecord.id);
          return json({ id: 'wood80_iron20', left: '나무 80g', right: '철 20g',
            leftFloats: true, rightFloats: false, detail: 'UI fixture', result: '나무는 뜨고 철은 가라앉아요.' });
        }
        assert.equal(url.search, '', 'Unexpected legacy API query');
        state.reads++;
        return json({
          member: {
            user_id: role === 'teacher' ? 'fixture-teacher' : 'fixture-student',
            role, alias: role === 'teacher' ? '과학 선생님' : '탐구자', class_id: 'fixture-class',
          },
          records: [state.row],
        });
      }
      if (url.pathname === '/api/space' && request.method() === 'GET') {
        return json({ materials: [], feedback: [], chats: [], topics: [], posts: [],
          members: [{ id: 'fixture-student', alias: '탐구자' }], answers: {} });
      }
      if (['/api/lab', '/api/space'].includes(url.pathname) && request.method() === 'POST') {
        state.writes.push(request.postDataJSON());
        await new Promise(resolve => { state.releaseWrite = resolve; });
        return json({ ok: true });
      }
      if (url.pathname.startsWith('/api/')) return route.abort('blockedbyclient');
      return route.continue();
    });
    await page.goto(origin.href);
    await page.getByRole('button', { name: '로그아웃', exact: true }).waitFor();
    return { page, state, close: () => context.close() };
  }
  async function nextRead(page, state, update) {
    const response = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/lab' &&
      new URL(response.url()).search === '' && response.request().method() === 'GET');
    Object.assign(state.row, update);
    await response;
    // The network response resolves before React commits the polled snapshot.
    await page.waitForTimeout(100);
  }
  try {
    const teacher = await fixture('teacher');
    const { page, state } = teacher;
    const feedback = page.getByLabel('선생님의 피드백', { exact: true });
    const feedbackDraft = '두 물체의 질량과 부피를 함께 비교해 보세요.';
    await feedback.fill(feedbackDraft);
    await page.getByRole('button', { name: '수정', exact: true }).click();
    await page.getByLabel('확인할 설명 유형', { exact: false }).selectOption('size_only');
    await page.getByLabel('수정 이유', { exact: false }).fill('크기를 근거로 말한 부분을 확인했어요.');
    await nextRead(page, state, {
      version: 2, hypothesis: 'liquid_missed', analysis_mode: 'live', analysis_note: '첫 AI 분석 도착',
    });
    await page.getByText('첫 AI 분석 도착', { exact: true }).waitFor();
    assert.equal(await feedback.inputValue(), feedbackDraft);
    assert.equal(await page.getByLabel('수정 이유', { exact: false }).inputValue(), '크기를 근거로 말한 부분을 확인했어요.');
    assert.equal(await page.getByLabel('확인할 설명 유형', { exact: false }).inputValue(), 'size_only');
    assert.equal(await page.getByLabel('교사가 선택하는 다음 활동', { exact: false }).inputValue(), 'split_wood');
    console.log('PASS fixture UI: AI polling preserves teacher choices, explanation, and feedback.');

    await page.getByRole('button', { name: '보류', exact: true }).click();
    const question = page.getByLabel('학생에게 보낼 추가 질문', { exact: false });
    await question.fill('액체가 바뀌어도 결과가 같을까요?');
    await nextRead(page, state, { version: 3, analysis_note: '추가 AI 정보 도착' });
    await page.getByText('추가 AI 정보 도착', { exact: true }).waitFor();
    assert.equal(await question.inputValue(), '액체가 바뀌어도 결과가 같을까요?');
    await nextRead(page, state, { version: 4, state: 'experiment_assigned', experiment_id: 'wood80_iron20' });
    await page.getByRole('button', { name: '확인', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '확인', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await feedback.inputValue(), feedbackDraft, 'A changed learning stage must not discard separate feedback');
    console.log('PASS fixture UI: additional question survives polling; a real stage change resets only its review form.');

    // Dispatch twice before React can render busy=true, exercising the synchronous lock.
    await page.locator('form.ss-feedback').evaluate(form => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.waitForFunction(() => document.querySelector('form.ss-feedback textarea').disabled);
    for (let n = 0; n < 100 && !state.releaseWrite; n++) await page.waitForTimeout(10);
    assert.equal(state.writes.length, 1, 'One pending mutation must produce one request');
    assert.equal(state.writes[0].action, 'feedback_send');
    assert.equal(state.writes[0].data.body, feedbackDraft);
    state.releaseWrite();
    await page.getByText('피드백을 전달했어요. 학생의 ‘선생님 피드백’에서 확인할 수 있어요.', { exact: true }).waitFor();
    assert.equal(await feedback.inputValue(), '');
    await feedback.fill('다음 피드백');
    assert.equal(await page.getByText('피드백을 전달했어요. 학생의 ‘선생님 피드백’에서 확인할 수 있어요.', { exact: true }).count(), 0);
    console.log('PASS fixture UI: duplicate submission blocked; pending feedback is locked; success state clears on editing.');
    await teacher.close();

    const untouched = await fixture('teacher');
    await nextRead(untouched.page, untouched.state, {
      version: 2, hypothesis: 'mass_only', analysis_mode: 'live', analysis_note: '기본 가설 도착',
    });
    await untouched.page.getByText('기본 가설 도착', { exact: true }).waitFor();
    assert.equal(await untouched.page.getByLabel('확인할 설명 유형', { exact: false }).inputValue(), 'mass_only');
    assert.equal(await untouched.page.getByLabel('교사가 선택하는 다음 활동', { exact: false }).inputValue(), 'wood80_iron20');
    console.log('PASS fixture UI: untouched review follows a newly arrived AI suggestion.');
    await untouched.close();

    const student = await fixture('student', {
      state: 'observed', hypothesis: 'mass_only', analysis_mode: 'live',
      observation: '나무는 뜨고 철은 가라앉았어요.',
    });
    await student.page.getByRole('button', { name: '다음 활동', exact: true }).click();
    const explanation = student.page.getByLabel('둘 다 설명하려면', { exact: false });
    await explanation.fill('물체와 액체의 밀도를 비교해야 해요.');
    await student.page.getByLabel('내가 놓친 것 / 새로 발견한 것', { exact: false }).fill('질량만 봤어요.');
    await student.page.getByLabel('언제 생각이 막혔나요?', { exact: false }).selectOption('observe');
    await nextRead(student.page, student.state, { version: 2, analysis_note: '정보 갱신' });
    assert.equal(await explanation.inputValue(), '물체와 액체의 밀도를 비교해야 해요.');
    assert.equal(await student.page.getByLabel('내가 놓친 것 / 새로 발견한 것', { exact: false }).inputValue(), '질량만 봤어요.');
    assert.equal(await student.page.getByLabel('언제 생각이 막혔나요?', { exact: false }).inputValue(), 'observe');
    assert.ok(student.state.reads >= 2);
    assert.equal(student.state.writes.length, 0);
    console.log('PASS fixture UI: student explanation and reflection survive a metadata version update.');
    await student.close();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
