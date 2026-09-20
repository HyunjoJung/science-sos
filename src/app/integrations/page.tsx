import '../learn/learning.css';
export default function Integrations(){return <main className="learning-shell">
 <header className="learning-header"><h1>학습SOS · MCP 연결</h1><a href="/learn">학습 교실</a></header>
 <section className="learning-card"><h2>공개 학습자료 도구</h2><p>배포 주소 뒤에 <code>/api/mcp</code>를 붙여 Streamable HTTP MCP 클라이언트에 등록하세요. 서버 운영자가 공개 MCP를 활성화해야 합니다.</p>
 <pre>{JSON.stringify({mcpServers:{'learning-sos':{url:'https://YOUR_DEPLOYMENT/api/mcp'}}},null,2)}</pre>
 <p>인증은 필요하지 않습니다. 계정 쿠키나 API 키를 추가하지 마세요. 이 엔드포인트는 공개 링크 목록만 제공합니다.</p>
 <h3>제공 도구</h3><p><code>list_learning_topics</code>: 지원 주제 조회<br/><code>search_learning_resources</code>: 과목·주제별 후보 조회<br/><code>get_learning_resource</code>: 자료 ID로 공식 링크 정보 조회</p>
 <h3>제공하지 않는 기능</h3><p>학생 답안·학급 정보 조회, 채점, 교사 승인, 임의 URL 접근은 지원하지 않습니다. EBS·Khan Academy·PhET의 공식 MCP가 아니라 학습SOS가 관리하는 링크 디렉터리입니다. 실시간 본문 검색이 아니며, 링크의 확인일을 함께 제공합니다.</p>
 <p>교사가 로그인한 학습 교실에서 자료를 검토·전달해야 학생에게 추천 자료로 표시됩니다. 외부 MCP 호출만으로는 전달할 수 없습니다.</p>
 </section></main>;}
