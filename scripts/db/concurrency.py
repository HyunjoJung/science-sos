"""Real PostgreSQL concurrency checks. Disposable localhost database only."""
from __future__ import annotations
import concurrent.futures,json,os,subprocess,time,unittest,uuid
from urllib.parse import urlparse
URL=os.environ.get('DATABASE_URL','')
def check_target():
 u=urlparse(URL)
 if u.hostname not in ('localhost','127.0.0.1','::1') or u.query or u.path not in ('/science_sos_test','/science_sos_restore_test') or os.environ.get('ALLOW_DISPOSABLE_DATABASE')!='yes':
  raise RuntimeError('Refusing a non-disposable database')
def sql(query,actor=None,service=False,accept_error=False):
 prefix=(f"set role authenticated; set request.jwt.claim.sub='{actor}';" if actor else 'set role service_role;' if service else '')
 result=subprocess.run(['psql',URL,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',prefix+query],capture_output=True,text=True,timeout=30)
 if result.returncode and not accept_error:raise AssertionError(result.stderr)
 return result.returncode,result.stdout.strip(),result.stderr
class Concurrency(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  check_target();cls.course=str(uuid.uuid4());cls.teacher=str(uuid.uuid4());cls.student=str(uuid.uuid4())
  sql(f"insert into auth.users(id) values('{cls.teacher}'),('{cls.student}'); insert into learning_courses(id,tenant_id,title) values('{cls.course}',gen_random_uuid(),'병렬 시험'); insert into learning_members values('{cls.course}','{cls.teacher}','teacher','교사',true),('{cls.course}','{cls.student}','student','학생',true);")
  _,cls.assignment,_=sql(f"select learning_command('publish_assignment','{cls.course}',null,null,'{{\"pack_id\":\"math-fractions\",\"pack_version\":\"1.0.0\",\"reviewed\":true,\"review_note\":\"격리된 시험 콘텐츠 검토\"}}',gen_random_uuid());",cls.teacher)
 @classmethod
 def tearDownClass(cls):
  sql(f"update private.learning_jobs set status='cancelled',completed_at=now() where course_id='{cls.course}' and status not in ('succeeded','failed','cancelled'); update learning_courses set archived=true where id='{cls.course}';")
 def test_01_same_request_twenty_times(self):
  request=str(uuid.uuid4());q=f"select learning_command('submit','{self.course}','{self.assignment}',null,'{{\"choice\":\"1/3이 더 커요\",\"reason\":\"같은 전체를 나누기 때문입니다.\"}}','{request}');"
  start=time.monotonic()
  with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:results=list(pool.map(lambda _:sql(q,self.student),range(20)))
  ids={r[1] for r in results};self.assertEqual(len(ids),1);self.__class__.attempt=ids.pop()
  _,count,_=sql(f"select count(*) from private.learning_jobs where target_id='{self.attempt}';");self.assertEqual(count,'1')
  print(f'20 concurrent duplicate requests: one result, elapsed {time.monotonic()-start:.3f}s')
 def test_02_parallel_claims(self):
  students=[str(uuid.uuid4()) for _ in range(12)]
  for student in students:
   sql(f"insert into auth.users(id) values('{student}'); insert into learning_members values('{self.course}','{student}','student','동시 시험',true);")
   sql(f"select learning_command('submit','{self.course}','{self.assignment}',null,'{{\"choice\":\"1/3이 더 커요\",\"reason\":\"같은 전체에서 비교해요.\"}}',gen_random_uuid());",student)
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(lambda _:sql('select learning_job_claim();',service=True),range(13)))
  jobs=[json.loads(r[1]) for r in results if r[1]];self.assertEqual(len(jobs),13);self.assertEqual(len({j['id'] for j in jobs}),13)
  _,claimed,_=sql(f"select row_to_json(x) from (select id,lease from private.learning_jobs where target_id='{self.attempt}') x;");self.__class__.job=json.loads(claimed)
 def test_03_review_and_finish(self):
  q1=f"select learning_command('confirm_understanding','{self.course}','{self.attempt}',1,'{{\"note\":\"정상 이해 확인 후 전이문항으로 진행합니다.\"}}',gen_random_uuid());"
  q2=f"select learning_job_finish('{self.job['id']}','{self.job['lease']}','{{\"interpretation\":\"understood\",\"evidence\":\"같은 전체\",\"note\":\"비교 범위를 확인했습니다.\",\"recommendation\":\"transfer_check\"}}','mock-concurrency');"
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   a=pool.submit(sql,q1,self.teacher);b=pool.submit(sql,q2,None,True);a.result();b.result()
  _,state,_=sql(f"select stage||':'||version from learning_attempts where id='{self.attempt}';");self.assertEqual(state,'awaiting_transfer:2')
  _,status,_=sql(f"select status from private.learning_jobs where id='{self.job['id']}';");self.assertIn(status,('succeeded','cancelled'))
 def test_04_conflicting_updates(self):
  _,_,err=sql(f"select learning_command('request_clarification','{self.course}','{self.attempt}',1,'{{\"note\":\"오래된 수정\"}}',gen_random_uuid());",self.teacher,accept_error=True)
  self.assertIn('version_conflict',err)
  sql(f"select learning_command('remove_student','{self.course}','{self.student}',null,'{{}}',gen_random_uuid());",self.teacher)
  code,_,err=sql(f"select learning_snapshot('{self.course}');",self.student,accept_error=True);self.assertNotEqual(code,0);self.assertIn('forbidden',err)
if __name__=='__main__':unittest.main(verbosity=2)
