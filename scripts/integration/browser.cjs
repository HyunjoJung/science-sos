const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
 const database=new URL(process.env.TEST_DATABASE_URL||'postgres://invalid/');
 assert.ok(['localhost','127.0.0.1'].includes(database.hostname)&&database.pathname==='/learning_test','Disposable learning_test database required');
 const {sql,literal}=await import('./fixtures.mjs');
 const browser=await chromium.launch({headless:true});
 const teacher=await browser.newPage();const student=await browser.newPage();
 const browserErrors=[];for(const p of [teacher,student])p.on('pageerror',e=>browserErrors.push(e.message));
 async function login(page,who){await page.goto('http://localhost:3000/learn');await page.getByLabel('이메일',{exact:true}).fill(who+'@test.invalid');await page.getByLabel('비밀번호',{exact:true}).fill('ci-password-123');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();}
 async function stage(page,name){
  await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
  const picker=page.getByLabel('기록 선택',{exact:true});
  const option=picker.locator('option').filter({hasText:name}).first();
  await option.waitFor({state:'attached',timeout:20000});
  await picker.selectOption(await option.getAttribute('value'));
  await page.getByRole('heading',{name,exact:false}).last().waitFor({timeout:20000});
 }
 async function awaitSavedAnalysis(title){
  let observed=null;
  // Poll on the Node side and inspect a resolved value, not a Promise truthiness.
  // No teacher action can cancel the job until its persisted result is verified.
  for(let n=0;n<60;n++){
   observed=await teacher.evaluate(async title=>{
    const homeResponse=await fetch('/api/learning');if(!homeResponse.ok)throw Error('home_read_failed');
    const home=await homeResponse.json();
    const response=await fetch('/api/learning?course='+home.courses[0].id);if(!response.ok)throw Error('course_read_failed');
    const view=await response.json();const a=view.attempts.find(a=>a.title===title);
    return a?{id:a.id,status:a.job?.status,model:a.analysis?.model,error:a.job?.error_code,attempts:a.job?.attempts}:null;
   },title);
   if(observed?.status==='succeeded'&&observed?.model==='ci-fixture'){
    assert.ok(observed.attempts>=1);console.log('PASS persisted worker result:',title,JSON.stringify(observed));return;
   }
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('Worker did not persist analysis: '+JSON.stringify(observed));
 }
 try{
  await login(teacher,'teacher');await login(student,'student');
  for(const [subject,answer,transfer] of [['과학 · 질량과 밀도','나무만 떠요','A만 떠요'],['수학 · 단위분수의 크기','1/3','1/4']]){
   const pack=teacher.locator('details').filter({has:teacher.locator('summary').filter({hasText:subject})}).first();
   await pack.locator('summary').click();await pack.getByRole('checkbox').check();await pack.getByRole('button',{name:'이 반에 배정',exact:true}).click();
   await student.getByRole('button',{name:'다시 불러오기',exact:true}).click();
   const task=student.locator('details').filter({has:student.locator('summary').filter({hasText:subject})}).first();
   await task.locator('summary').click();await task.getByLabel('내 답',{exact:true}).selectOption(answer);await task.getByLabel('그렇게 생각한 이유',{exact:true}).fill('같은 전체와 조건을 비교해서 설명했어요.');
   const picker=student.getByLabel('기록 선택',{exact:true});
   const previousSelection=await picker.count()?await picker.inputValue():null;
   if(previousSelection)await picker.selectOption(previousSelection);
   const courseId=await teacher.evaluate(async()=>{const h=await(await fetch('/api/learning')).json();return h.courses[0].id;});
   const dailyCalls=Number(sql(`select daily_calls from private.learning_courses where id=${literal(courseId)}`));
   assert.ok(Number.isInteger(dailyCalls)&&dailyCalls>0);
   const teacherDraft='조건을 활동으로 다시 비교해 주세요.';
   // Hold the actual disposable queue through its normal quota mechanism so the
   // teacher can write before the worker result arrives. Restore even on failure.
   sql(`update private.learning_courses set daily_calls=0 where id=${literal(courseId)}`);
   try{
    const submitted=student.waitForResponse(response=>response.url().endsWith('/api/learning')&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='submit');
    await task.getByRole('button',{name:'내 생각 보내기',exact:true}).click();
    const result=await(await submitted).json();assert.ok(result.id);
    await student.getByRole('heading',{name:subject+' · 교사 확인 대기',exact:true}).waitFor({timeout:20000});
    assert.equal(await picker.inputValue(),result.id,'A new submission must replace the previously selected record');
    if(previousSelection)assert.notEqual(result.id,previousSelection);
    await stage(teacher,subject+' · 교사 확인 대기');
    assert.equal(await teacher.getByRole('heading',{name:'AI 제안 ·',exact:false}).count(),0,'Worker must still be held before drafting');
    await teacher.getByLabel('검토 의견 / 학생에게 보낼 질문',{exact:true}).fill(teacherDraft);
   }finally{
    sql(`begin;update private.learning_courses set daily_calls=${dailyCalls} where id=${literal(courseId)};update private.learning_jobs set available_at=now() where course_id=${literal(courseId)} and status in ('queued','retry_wait');commit;`);
   }
   await awaitSavedAnalysis(subject);
   // Let ordinary polling update the panel; a manual refresh cannot mask a lost draft.
   await teacher.getByRole('heading',{name:'AI 제안 ·',exact:false}).waitFor({timeout:20000});
   assert.equal(await teacher.getByLabel('검토 의견 / 학생에게 보낼 질문',{exact:true}).inputValue(),teacherDraft,'Persisted AI refresh must preserve the teacher draft');
   console.log('PASS browser: new submission selected and teacher draft survives persisted AI refresh:',subject);
   // Optional public MCP lookup MUST have actually completed before human delivery.
   const beforeShare=await student.evaluate(async()=>{const h=await(await fetch('/api/learning')).json();return(await fetch('/api/learning?course='+h.courses[0].id)).json();});
   const rowBefore=beforeShare.attempts.find(a=>a.title===subject);
   assert.deepEqual(rowBefore.shared_resources,[]);assert.equal('resource_candidates' in rowBefore,false);
   const resourceId=subject.startsWith('과학')?'phet-buoyancy':'phet-fractions';
   const resourceCard=teacher.getByTestId('resource-'+resourceId);
   await resourceCard.getByRole('checkbox').check();
   await resourceCard.getByRole('button',{name:'학생에게 자료 전달',exact:true}).click();
   await resourceCard.getByRole('button',{name:'자료 전달 철회',exact:true}).waitFor();
   assert.equal(await teacher.getByLabel('검토 의견 / 학생에게 보낼 질문',{exact:true}).inputValue(),teacherDraft,'Resource sharing must preserve the teacher draft');
   await student.getByRole('button',{name:'다시 불러오기',exact:true}).click();
   await student.getByRole('region',{name:'교사 확인 학습자료'}).getByRole('link').waitFor();
   // Revoke, verify disappearance, then explicitly re-approve for persistent evidence.
   await resourceCard.getByRole('button',{name:'자료 전달 철회',exact:true}).click();
   await resourceCard.getByRole('button',{name:'학생에게 자료 전달',exact:true}).waitFor();
   assert.equal(await resourceCard.getByRole('checkbox').isChecked(),false,'Revocation must require a new explicit review');
   assert.equal(await resourceCard.getByRole('button',{name:'학생에게 자료 전달',exact:true}).isDisabled(),true);
   assert.equal(await teacher.getByLabel('검토 의견 / 학생에게 보낼 질문',{exact:true}).inputValue(),teacherDraft,'Resource revocation must preserve the teacher draft');
   await student.getByRole('button',{name:'다시 불러오기',exact:true}).click();
   await student.getByText('아직 선생님이 전달한 자료가 없어요.').waitFor();
   await resourceCard.getByRole('checkbox').check();
   await resourceCard.getByRole('button',{name:'학생에게 자료 전달',exact:true}).click();
   await resourceCard.getByRole('button',{name:'자료 전달 철회',exact:true}).waitFor();

   await teacher.getByRole('button',{name:'활동 배정',exact:true}).click();
   await stage(student,subject+' · 확인 활동');await student.getByLabel('활동에서 확인한 내용',{exact:true}).fill('바뀐 조건과 같게 둔 조건을 비교했습니다.');await student.getByLabel('다시 설명한 내 생각',{exact:true}).fill('조건에 따라 결과가 달라지는 이유를 설명했어요.');await student.getByRole('button',{name:'활동 기록 저장',exact:true}).click();
   const article=student.locator('article');await article.getByLabel('내 답',{exact:true}).selectOption(transfer);await article.getByLabel('그렇게 생각한 이유',{exact:true}).fill('새 조건에서도 같은 기준으로 비교했습니다.');await article.getByRole('button',{name:'새 문항 답안 보내기',exact:true}).click();
   await stage(teacher,subject+' · 최종 교사 확인');await teacher.getByLabel('재확인 의견',{exact:true}).fill('새 문항에서의 근거까지 확인했습니다.');await teacher.getByRole('button',{name:'검토 완료',exact:true}).click();
   await stage(student,subject+' · 완료');console.log('PASS browser -> Next API -> SQL -> worker flow:',subject);
  }
  const studentData=await student.evaluate(async()=>{const h=await(await fetch('/api/learning')).json();return(await fetch('/api/learning?course='+h.courses[0].id)).json();});
  assert.equal(studentData.attempts.length,2);assert.deepEqual(studentData.catalog,[]);assert.ok(studentData.attempts.every(a=>!('analysis' in a)));
  await student.screenshot({path:'learning-student.png',fullPage:true});await teacher.screenshot({path:'learning-teacher.png',fullPage:true});
  await student.getByRole('button',{name:'로그아웃',exact:true}).click();await student.getByRole('button',{name:'로그인',exact:true}).waitFor();assert.equal(await student.locator('article').count(),0);
  assert.deepEqual(browserErrors,[]);console.log('PASS browser: role-filtered response, logout data clearing, no page errors.');
 }catch(error){
  // These accounts contain only synthetic data. Never capture live student data here.
  await fs.mkdir('.test-results',{recursive:true});
  for(const [name,page] of [['teacher',teacher],['student',student]]){
   await page.screenshot({path:`.test-results/${name}-failure.png`,fullPage:true}).catch(()=>{});
   await fs.writeFile(`.test-results/${name}-failure.html`,await page.content()).catch(()=>{});
   console.error('CI fixture DOM',name,await page.locator('body').innerText());
  }
  console.error('Browser page errors:',browserErrors);throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
