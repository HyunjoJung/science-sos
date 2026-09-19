const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const teacher=await browser.newPage();const student=await browser.newPage();
 const browserErrors=[];for(const p of [teacher,student])p.on('pageerror',e=>browserErrors.push(e.message));
 async function login(page,who){await page.goto('http://localhost:3000/learn');await page.getByLabel('이메일',{exact:true}).fill(who+'@test.invalid');await page.getByLabel('비밀번호',{exact:true}).fill('ci-password-123');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();}
 async function stage(page,name){await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByRole('heading',{name,exact:false}).last().waitFor({timeout:20000});}
 try{
  await login(teacher,'teacher');await login(student,'student');
  for(const [subject,answer,transfer] of [['과학 · 질량과 밀도','나무만 떠요','A만 떠요'],['수학 · 단위분수의 크기','1/3','1/4']]){
   const pack=teacher.locator('details').filter({has:teacher.locator('summary').filter({hasText:subject})}).first();
   await pack.locator('summary').click();await pack.getByRole('checkbox').check();await pack.getByRole('button',{name:'이 반에 배정',exact:true}).click();
   await student.getByRole('button',{name:'다시 불러오기',exact:true}).click();
   const task=student.locator('details').filter({has:student.locator('summary').filter({hasText:subject})}).first();
   await task.locator('summary').click();await task.getByLabel('내 답',{exact:true}).selectOption(answer);await task.getByLabel('그렇게 생각한 이유',{exact:true}).fill('같은 전체와 조건을 비교해서 설명했어요.');await task.getByRole('button',{name:'내 생각 보내기',exact:true}).click();
   // Prove the connected worker consumed and persisted the queued job before
   // human review cancels outstanding work. Auth/model are CI fixtures only.
   await teacher.waitForFunction(async title=>{
    const home=await(await fetch('/api/learning')).json();
    const view=await(await fetch('/api/learning?course='+home.courses[0].id)).json();
    const attempt=view.attempts.find(a=>a.title===title);
    return attempt?.job?.status==='succeeded' && attempt.analysis?.model==='ci-fixture';
   },subject,{timeout:30000,polling:500});
   await stage(teacher,subject+' · 교사 확인 대기');
   await teacher.getByLabel('검토 의견 / 학생에게 보낼 질문',{exact:true}).fill('조건을 활동으로 다시 비교해 주세요.');await teacher.getByRole('button',{name:'활동 배정',exact:true}).click();
   await stage(student,subject+' · 확인 활동');await student.getByLabel('활동에서 확인한 내용',{exact:true}).fill('바뀐 조건과 같게 둔 조건을 비교했습니다.');await student.getByLabel('다시 설명한 내 생각',{exact:true}).fill('조건에 따라 결과가 달라지는 이유를 설명했어요.');await student.getByRole('button',{name:'활동 기록 저장',exact:true}).click();
   const article=student.locator('article');await article.getByLabel('내 답',{exact:true}).selectOption(transfer);await article.getByLabel('그렇게 생각한 이유',{exact:true}).fill('새 조건에서도 같은 기준으로 비교했습니다.');await article.getByRole('button',{name:'새 문항 답안 보내기',exact:true}).click();
   await stage(teacher,subject+' · 최종 교사 확인');await teacher.getByLabel('재확인 의견',{exact:true}).fill('새 문항에서의 근거까지 확인했습니다.');await teacher.getByRole('button',{name:'검토 완료',exact:true}).click();
   await stage(student,subject+' · 완료');console.log('PASS browser -> Next API -> SQL -> worker flow:',subject);
  }
  // JSON-level confidentiality check through the real Next endpoint and cookie session.
  const studentData=await student.evaluate(async()=>{const h=await(await fetch('/api/learning')).json();return(await fetch('/api/learning?course='+h.courses[0].id)).json();});
  assert.equal(studentData.attempts.length,2);assert.deepEqual(studentData.catalog,[]);assert.ok(studentData.attempts.every(a=>!('analysis' in a)));
  await student.screenshot({path:'learning-student.png',fullPage:true});await teacher.screenshot({path:'learning-teacher.png',fullPage:true});
  await student.getByRole('button',{name:'로그아웃',exact:true}).click();await student.getByRole('button',{name:'로그인',exact:true}).waitFor();assert.equal(await student.locator('article').count(),0);
  assert.deepEqual(browserErrors,[]);console.log('PASS browser: role-filtered response, logout data clearing, no page errors.');
 }catch(error){
  // Isolated CI accounts contain synthetic data; never enable this capture on live students.
  await fs.mkdir('.test-results',{recursive:true});
  for(const [name,page] of [['teacher',teacher],['student',student]]){
   await page.screenshot({path:`.test-results/${name}-failure.png`,fullPage:true}).catch(()=>{});
   await fs.writeFile(`.test-results/${name}-failure.html`,await page.content()).catch(()=>{});
   console.error('CI fixture DOM',name,await page.locator('body').innerText());
  }
  console.error('Browser page errors:',browserErrors);
  throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
