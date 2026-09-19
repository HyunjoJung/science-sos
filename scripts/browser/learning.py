"""Browser regression against the real production Next build and a simulated API.
Database/RPC security is tested separately by scripts/db/learning.sql.
This is not a claim of hosted Supabase or live-model E2E coverage.
"""
from __future__ import annotations
import copy,json,os,shutil,subprocess,time,unittest,urllib.request
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
COURSE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
USER='22222222-2222-4222-8222-222222222222';ASSIGNMENT='55555555-5555-4555-8555-555555555555';ATTEMPT='66666666-6666-4666-8666-666666666666'
SPEC={'prompt':'같은 전체에서 1/3과 1/5을 비교하세요.','choices':['1/3이 더 커요','1/5이 더 커요','아직 모르겠다'],'activities':[{'id':'fraction-line','kind':'number_line','title':'같은 전체 비교','instruction':'나눈 양을 확인하세요.'}],'transfer':{'prompt':'2/3과 2/5을 비교하세요.','choices':['2/3이 더 커요','2/5이 더 커요']},'rubric':['조건','근거','설명']}
RECORD={'id':ATTEMPT,'version':1,'student_id':USER,'assignment_id':ASSIGNMENT,'created_at':'2026-09-20T01:00:00Z','alias':'시험 학생','stage':'awaiting_review','choice':'1/3이 더 커요','reason':'같은 전체를 나누기 때문입니다.','pack':{'title':'분수 비교','subject':'수학','scope':'양의 분수','spec':SPEC},'job':{'id':ASSIGNMENT,'status':'succeeded'},'analysis':{'note':'원문 근거입니다.','evidence':'같은 전체','recommendation':'transfer_check','interpretation':'understood'}}
class BrowserTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  (ROOT/'test-results').mkdir(exist_ok=True)
  cls.log=open(ROOT/'test-results/server.log','w')
  cls.server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','-p','3100'],cwd=ROOT,stdout=cls.log,stderr=subprocess.STDOUT)
  for _ in range(100):
   try:
    with urllib.request.urlopen('http://127.0.0.1:3100/learn',timeout=1):break
   except Exception:time.sleep(.2)
  else:raise RuntimeError('Production server did not start')
  cls.pw=sync_playwright().start()
  exe=os.getenv('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
  cls.browser=cls.pw.chromium.launch(headless=True,**({'executable_path':exe} if exe else {}))
 @classmethod
 def tearDownClass(cls):
  cls.browser.close();cls.pw.stop();cls.server.terminate();cls.server.wait(timeout=10);cls.log.close()
 def setUp(self):
  self.context=self.browser.new_context();self.page=self.context.new_page();self.errors=[]
  self.page.on('pageerror',lambda e:self.errors.append(str(e)))
 def tearDown(self):
  self.assertEqual(self.errors,[],'Unexpected browser exceptions')
  self.context.close()
 def setup_api(self,teacher=False,records=None):
  self.records=copy.deepcopy(records or []);self.posted=[];self.fail=False
  def route_handler(route):
   req=route.request
   if req.method=='POST':
    data=req.post_data_json;self.posted.append(data)
    if self.fail:route.fulfill(status=503,json={'error':'일시적 연결 실패','code':'unavailable'});return
    if data['action']=='submit':self.records=[{**copy.deepcopy(RECORD),'choice':data['data']['choice'],'reason':data['data']['reason']}]
    if data['action']=='confirm_understanding':self.records=[{**r,'version':r['version']+1,'stage':'awaiting_transfer'} for r in self.records]
    route.fulfill(json={'id':ATTEMPT});return
   params=parse_qs(urlparse(req.url).query)
   body={'user_id':USER,'courses':[{'id':COURSE,'title':'분수 교실','role':'teacher' if teacher else 'student','alias':'시험 사용자'},{'id':OTHER,'title':'다른 교실','role':'teacher' if teacher else 'student','alias':'시험 사용자'}]}
   if params.get('course'):body.update(role='teacher' if teacher else 'student',attempts=self.records,assignments=[{'id':ASSIGNMENT,'title':'분수 비교','subject':'수학','scope':'분수','spec':SPEC,'attempt_id':self.records[0]['id'] if self.records else None}],packs=[],materials=[],chats=[],members=[],worker_online=True)
   route.fulfill(json=body)
  self.page.route(lambda u:urlparse(u).path=='/api/learning',route_handler)
  self.page.goto('http://127.0.0.1:3100/learn');self.page.get_by_label('수업 선택').select_option(COURSE)
  expect(self.page.get_by_text('AI 처리 서버 연결됨')).to_be_visible()
 def open_record(self):self.page.get_by_role('button',name='시험 학생 · 수학',exact=False).click()
 def test_student_submission(self):
  self.setup_api();self.page.get_by_label('1/3이 더 커요',exact=True).check();self.page.get_by_label('이유',exact=True).fill('전체를 세 부분으로 나눈 한 조각이 더 큽니다.')
  self.page.get_by_role('button',name='설명 보내기',exact=True).click();expect(self.page.get_by_text('저장했어요.',exact=True)).to_be_visible()
  self.assertEqual(len(self.posted),1);self.assertEqual(self.posted[0]['data']['course_id'],COURSE);self.assertRegex(self.posted[0]['request'],r'^[0-9a-f-]{36}$')
  expect(self.page.get_by_role('heading',name='시험 학생의 설명 · 분수 비교')).to_be_visible()
 def test_teacher_normal_understanding(self):
  self.setup_api(True,[RECORD]);self.open_record();self.page.get_by_label('검토 결과').select_option('confirm_understanding');self.page.get_by_label('학생에게 보낼 메시지').fill('설명이 타당하니 새 사례를 확인해 주세요.')
  self.page.get_by_role('button',name='검토 결과 저장').click();expect(self.page.get_by_text('새 사례 확인',exact=True).first).to_be_visible()
  self.assertEqual(self.posted[0]['action'],'confirm_understanding');self.assertEqual(self.posted[0]['version'],1)
 def test_remote_revision_preserves_draft(self):
  self.setup_api(True,[RECORD]);self.open_record();self.page.get_by_label('학생에게 보낼 메시지').fill('입력 중인 피드백')
  self.records=[{**copy.deepcopy(RECORD),'version':2}]
  expect(self.page.get_by_role('button',name='최신 기록으로 다시 열기')).to_be_visible(timeout=8000)
  expect(self.page.get_by_label('학생에게 보낼 메시지')).to_have_value('입력 중인 피드백');expect(self.page.get_by_role('button',name='검토 결과 저장')).to_be_disabled()
 def test_failed_save_identity(self):
  self.setup_api();self.fail=True;self.page.get_by_label('1/3이 더 커요',exact=True).check();self.page.get_by_label('이유',exact=True).fill('비공개 답안 원문은 저장소에 넣지 않습니다.')
  self.page.get_by_role('button',name='설명 보내기',exact=True).click();expect(self.page.get_by_role('alert')).to_contain_text('일시적 연결 실패')
  self.page.get_by_role('button',name='설명 보내기',exact=True).click();self.page.wait_for_timeout(100)
  self.assertEqual(len(self.posted),2);self.assertEqual(self.posted[0]['request'],self.posted[1]['request'])
  expect(self.page.get_by_label('이유',exact=True)).to_have_value('비공개 답안 원문은 저장소에 넣지 않습니다.')
  self.assertNotIn('비공개 답안',self.page.evaluate('JSON.stringify(sessionStorage)'))
 def test_interactive_fraction(self):
  self.setup_api(False,[{**copy.deepcopy(RECORD),'stage':'activity_assigned','activity_id':'fraction-line'}]);self.open_record()
  expect(self.page.get_by_role('slider')).to_have_count(2);self.page.get_by_role('slider').first.fill('7');expect(self.page.get_by_text('1/7',exact=True)).to_be_visible();expect(self.page.get_by_label('직접 확인한 내용')).to_be_visible()
 def test_mobile(self):
  self.page.set_viewport_size({'width':390,'height':844});self.setup_api(False,[RECORD]);self.open_record()
  self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))
  self.page.screenshot(path=str(ROOT/'test-results/learning-mobile.png'),full_page=True)
if __name__=='__main__':unittest.main(verbosity=2)
