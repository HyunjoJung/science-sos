"use client";
import { useRef, useState } from "react";
import { hypotheses, RecordRow, lessons } from "@/lib/content";
export type Action = (
  action: string,
  data: Record<string, unknown>,
  id?: string,
) => Promise<boolean>;
export type Material = {
  id: string;
  title: string;
  section: string;
  content: string;
  enabled: boolean;
};
export type Feedback = {
  id: string;
  student_id: string;
  record_id: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
};
export type ChatRow = {
  id: string;
  student_id: string;
  room: string;
  question: string;
  answer: string | null;
  status: string;
  created_at: string;
  sources: { title: string; quote?: string; section?: string; url?: string }[];
};
export type Topic = {
  id: string;
  title: string;
  unit: string;
  created_at: string;
};
export type Post = {
  id: string;
  topic_id: string;
  parent_id: string | null;
  author: string;
  mine: boolean;
  is_teacher: boolean;
  body: string;
  likes: number;
  liked: boolean;
  created_at: string;
};
export type Space = {
  materials: Material[];
  feedback: Feedback[];
  chats: ChatRow[];
  topics: Topic[];
  posts: Post[];
  members: { id: string; alias: string }[];
  answers: Record<string, string>;
};
export const emptySpace: Space = {
  materials: [],
  feedback: [],
  chats: [],
  topics: [],
  posts: [],
  members: [],
  answers: {},
};
function displayDate(value: string, includeTime = true) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    ...(includeTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(new Date(value));
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="ss-empty">{children}</div>;
}
export function Intro({
  tag,
  title,
  description,
}: {
  tag: string;
  title: string;
  description: string;
}) {
  return (
    <div className="ss-intro">
      <div>
        <div className="ss-eyebrow">{tag}</div>
        <h1>{title}</h1>
        <p className="ss-desc">{description}</p>
      </div>
    </div>
  );
}
export function FeedbackForm({
  studentId,
  recordId,
  act,
  busy,
}: {
  studentId: string;
  recordId?: string;
  act: Action;
  busy: boolean;
}) {
  const [body, setBody] = useState(""),
    [sent, setSent] = useState(false);
  return (
    <form
      className="ss-feedback"
      onSubmit={async (e) => {
        e.preventDefault();
        setSent(false);
        if (
          await act(
            "feedback_send",
            { student_id: studentId, body: body.trim() },
            recordId,
          )
        ) {
          setBody("");
          setSent(true);
        }
      }}
    >
      <h3>학생에게 피드백 보내기</h3>
      <p className="ss-note">
        학생의 이유를 바탕으로 다음에 확인할 질문을 남겨 주세요.
      </p>
      <label className="ss-label" htmlFor={"feedback-" + studentId}>
        선생님의 피드백
      </label>
      <textarea
        id={"feedback-" + studentId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        maxLength={1500}
        placeholder="네가 비교한 조건이 흥미로워. 만약…"
      />
      <button className="ss-button primary" disabled={busy || !body.trim()}>
        {busy ? "피드백 전달 중…" : "학생에게 전달하기 →"}
      </button>
      {sent && (
        <p className="ss-note" role="status">
          피드백을 전달했어요. 학생의 ‘선생님 피드백’에서 확인할 수 있어요.
        </p>
      )}
    </form>
  );
}
export function FeedbackInbox({
  entries,
  act,
  busy,
}: {
  entries: Feedback[];
  act: Action;
  busy: boolean;
}) {
  return (
    <>
      <Intro
        tag="FROM YOUR TEACHER"
        title="선생님의 이야기가 도착했어요."
        description="내 생각에서 발견한 점과 다음 질문을 읽어 보세요."
      />
      {entries.length === 0 ? (
        <Empty>
          아직 도착한 피드백이 없어요. 선생님이 보내면 이곳에 표시돼요.
        </Empty>
      ) : (
        entries.map((f) => (
          <article className="ss-feedback-card" key={f.id}>
            <div className="ss-person-top">
              <strong>과학 선생님</strong>
              <span className={"ss-pill " + (!f.read_at ? "teal" : "")}>
                {f.read_at ? "읽음" : "새 피드백"}
              </span>
            </div>
            <p className="ss-feedback-text">{f.body}</p>
            <div className="ss-person-top">
              <span className="ss-note">
                <time dateTime={f.created_at}>{displayDate(f.created_at)}</time>
              </span>
              {!f.read_at && (
                <button
                  className="ss-button"
                  disabled={busy}
                  onClick={() => act("feedback_read", {}, f.id)}
                >
                  읽었어요 ✓
                </button>
              )}
            </div>
          </article>
        ))
      )}
    </>
  );
}
export function Materials({
  materials,
  unit,
  act,
  busy,
}: {
  materials: Material[];
  unit: string;
  act: Action;
  busy: boolean;
}) {
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]),
    [title, setTitle] = useState(""),
    [section, setSection] = useState(""),
    [content, setContent] = useState(""),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false),
    [added, setAdded] = useState(0);
  return (
    <>
      <Intro
        tag="TEACHER LIBRARY / 과학"
        title="학생의 질문에 답할 자료실"
        description="수업 자료를 등록하면, 학생 채팅에서 근거 문장과 출처를 함께 안내합니다."
      />
      <div className="ss-material-grid">
        <section className="ss-panel">
          <h2>자료 추가</h2>
          <p className="ss-note">과학 · {unit}</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setAdded(0);
              const queue = files.length ? files : [{ name: title, content }];
              for (const f of queue) {
                if (!f.name.trim() || !f.content.trim()) {
                  setError("자료 이름과 본문을 모두 입력해 주세요.");
                  return;
                }
              }
              setUploading(true);
              try {
                for (let index = 0; index < queue.length; index++) {
                  const f = queue[index];
                  if (
                    !(await act("material_add", {
                      title: f.name.trim(),
                      section,
                      content: f.content,
                    }))
                  ) {
                    if (files.length) setFiles(queue.slice(index));
                    return;
                  }
                  setAdded((count) => count + 1);
                }
                setFiles([]);
                setTitle("");
                setContent("");
              } finally {
                setUploading(false);
              }
            }}
          >
            <div className="ss-upload">
              <label className="ss-label" htmlFor="material-files">
                01 · 파일 추가하기 (다중 선택)
              </label>
              <input
                id="material-files"
                type="file"
                multiple
                disabled={busy || uploading}
                accept=".txt,.md"
                onChange={async (e) => {
                  setError("");
                  const picked = Array.from(e.target.files ?? []);
                  const loaded: { name: string; content: string }[] = [];
                  for (const f of picked) {
                    if (!/\.(txt|md)$/i.test(f.name) || f.size > 100000) {
                      setError(
                        "TXT·MD 파일만, 파일당 100KB까지 등록할 수 있어요.",
                      );
                      continue;
                    }
                    const body = await f.text();
                    if (body.length > 30000) {
                      setError("본문은 자료당 30,000자까지 사용할 수 있어요.");
                      continue;
                    }
                    loaded.push({ name: f.name, content: body });
                  }
                  setFiles((prev) => [
                    ...prev,
                    ...loaded.filter(
                      (f) => !prev.some((p) => p.name === f.name),
                    ),
                  ]);
                  e.target.value = "";
                }}
              />
              <p className="ss-note">
                TXT·MD 본문을 읽어 등록합니다. PDF·문서·슬라이드는 사용할 설명
                부분을 아래 본문에 붙여 넣어 주세요.
              </p>
              {files.map((f, i) => (
                <div className="ss-file-item" key={f.name}>
                  <div className="ss-person-top">
                    <strong>{f.name}</strong>
                    <button
                      className="ss-button"
                      type="button"
                      disabled={busy || uploading}
                      onClick={() => setFiles(files.filter((_, n) => n !== i))}
                    >
                      제외
                    </button>
                  </div>
                  <textarea
                    aria-label={f.name + " 본문"}
                    value={f.content}
                    maxLength={30000}
                    onChange={(e) =>
                      setFiles(
                        files.map((x, n) =>
                          n === i ? { ...x, content: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            {!files.length && (
              <label className="ss-field ss-label">
                자료 이름
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="예: 과학 교과서 · 물질의 특성"
                />
              </label>
            )}
            <label className="ss-field ss-label">
              단원 · 위치
              <input
                value={section}
                onChange={(e) => setSection(e.target.value)}
                maxLength={100}
                placeholder="예: 밀도 / 교사가 확인한 42쪽"
              />
            </label>
            {!files.length && (
              <label className="ss-field ss-label">
                답변에 사용할 자료 본문
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  required
                  maxLength={30000}
                  placeholder="학생에게 제공할 설명 부분을 붙여 넣어 주세요."
                />
              </label>
            )}
            {error && (
              <p className="ss-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="ss-button primary ss-wide"
              disabled={busy || uploading}
            >
              {uploading
                ? "자료 등록 중…"
                : files.length
                  ? `자료 ${files.length}개 등록하기`
                  : "자료 등록하기"}
            </button>
            {!!added && (
              <p className="ss-note" role="status">
                자료 {added}개를 등록했어요. 오른쪽에서 본문과 사용 설정을
                확인하세요.
              </p>
            )}
            <p className="ss-note">
              등록한 본문과 사용 설정은 우리 반 자료실에 저장됩니다. 학생
              채팅에는 사용 중인 자료만 제공돼요.
            </p>
          </form>
        </section>
        <section className="ss-panel">
          <div className="ss-panelhead">
            <h2>답변에 사용하는 자료</h2>
            <span className="ss-pill teal">
              {materials.filter((m) => m.enabled).length}개 사용 중
            </span>
          </div>
          {materials.length === 0 ? (
            <Empty>등록된 수업 자료가 없어요. 첫 자료를 추가해 주세요.</Empty>
          ) : (
            materials.map((m) => (
              <MaterialCard key={m.id} material={m} act={act} busy={busy} />
            ))
          )}
        </section>
      </div>
    </>
  );
}
function MaterialCard({
  material: m,
  act,
  busy,
}: {
  material: Material;
  act: Action;
  busy: boolean;
}) {
  const [body, setBody] = useState(m.content);
  return (
    <div className="ss-material-row">
      <strong>{m.title}</strong>
      <p>{m.section}</p>
      <label className="ss-check">
        <input
          type="checkbox"
          checked={m.enabled}
          disabled={busy}
          onChange={(e) =>
            act("material_edit", { enabled: e.target.checked }, m.id)
          }
        />
        학생 채팅에 사용
      </label>
      <span className={"ss-pill " + (m.enabled ? "teal" : "")}>
        {m.enabled ? "답변 근거로 사용 중" : "답변 사용 중지"}
      </span>
      <details>
        <summary className="ss-note">본문 확인 · 수정</summary>
        <textarea
          aria-label={m.title + " 본문 수정"}
          value={body}
          maxLength={30000}
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          className="ss-button"
          disabled={busy || !body.trim() || body === m.content}
          onClick={() => act("material_edit", { content: body }, m.id)}
        >
          본문 저장
        </button>
      </details>
    </div>
  );
}
export function Chats({
  space,
  teacher,
  act,
  busy,
}: {
  space: Space;
  teacher: boolean;
  act: Action;
  busy: boolean;
}) {
  const [room, setRoom] = useState("course"),
    [student, setStudent] = useState(""),
    [question, setQuestion] = useState("");
  const who = space.members.some((m) => m.id === student)
    ? student
    : space.members[0]?.id;
  const rows = space.chats
    .filter((c) => c.room === room && (!teacher || c.student_id === who))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const starters =
    room === "course"
      ? [
          "무거운 나무는 왜 물에 뜰 수 있나요?",
          "밀도를 비교할 때 어떤 조건을 봐야 하나요?",
        ]
      : [
          "실생활에서 밀도를 활용하는 예를 알려 주세요.",
          "더 알아볼 수 있는 교육 자료가 궁금해요.",
        ];
  return (
    <>
      <Intro
        tag={teacher ? "TEACHER / 질문 기록" : "ASK & EXPLORE"}
        title={
          teacher ? "질문에서 배움의 흐름을 읽어요." : "궁금함이 시작되는 곳."
        }
        description={
          teacher
            ? "담당 수업의 질문과 답변, 참고 자료를 확인합니다."
            : "수업에서 생긴 질문도, 그다음 호기심도 편하게 물어봐요."
        }
      />
      {teacher && (
        <label className="ss-field ss-label">
          질문을 살펴볼 학생
          <select
            value={who || ""}
            onChange={(e) => setStudent(e.target.value)}
            disabled={!space.members.length}
          >
            {!space.members.length && (
              <option value="">배정된 학생이 없어요</option>
            )}
            {space.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.alias} ·{" "}
                {space.chats.filter((c) => c.student_id === m.id).length}개 질문
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ss-chat-layout">
        <div className="ss-rooms">
          {[
            ["course", "수업 자료로 질문", "교과서 · 선생님 자료"],
            ["external", "더 넓게 탐색", "확인한 외부 교육 사이트"],
          ].map(([id, label, desc]) => (
            <button
              key={id}
              className="ss-room"
              aria-pressed={room === id}
              onClick={() => setRoom(id)}
            >
              <strong>{label}</strong>
              <span>{desc}</span>
            </button>
          ))}
        </div>
        <section className="ss-chat">
          <div className="ss-chat-head">
            <h3>{room === "course" ? "수업 자료로 질문" : "더 넓게 탐색"}</h3>
            <p>
              {room === "course"
                ? `사용 중인 수업 자료 ${space.materials.filter((m) => m.enabled).length}개 · 근거를 펼쳐 확인하세요.`
                : "확인한 교육 사이트를 안내합니다. 실시간 웹 검색은 하지 않아요."}
            </p>
            <p className="ss-note">
              질문은 나와 담당 선생님만 볼 수 있어요. 이름 등 개인정보는 적지
              마세요.
            </p>
          </div>
          <div className="ss-messages" aria-live="polite">
            {rows.length === 0 ? (
              <Empty>
                {teacher
                  ? "아직 질문 기록이 없어요."
                  : "어떤 부분이 궁금한가요? 질문을 남기면 자료와 함께 살펴볼게요."}
              </Empty>
            ) : (
              rows.map((c) => (
                <div className="ss-chat-pair" key={c.id}>
                  <div className="ss-message user">{c.question}</div>
                  <div className="ss-message assistant">
                    <div className="ss-message-label">
                      과학SOS ·{" "}
                      {c.status === "sample"
                        ? "자료 답변"
                        : c.status === "ready"
                          ? "AI 답변"
                          : c.status === "error"
                            ? "답변 확인 필요"
                            : "답변 준비 중"}
                    </div>
                    <p>
                      {c.answer ||
                        (c.status === "error"
                          ? "답변을 완성하지 못했어요. 질문을 조금 더 구체적으로 남기거나 선생님께 함께 확인해 주세요."
                          : "등록 자료를 확인하며 답변을 준비하고 있어요. 완료되면 자동으로 표시돼요.")}
                    </p>
                    {c.sources.map((s, i) =>
                      s.url ? (
                        <a
                          key={i}
                          className="ss-source"
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <strong>{s.title} ↗</strong>
                        </a>
                      ) : (
                        <details className="ss-source" key={i}>
                          <summary>근거 보기 · {s.title}</summary>
                          <p>{s.section}</p>
                          <p>“{s.quote}”</p>
                        </details>
                      ),
                    )}
                    <time className="ss-note" dateTime={c.created_at}>
                      {displayDate(c.created_at)}
                    </time>
                  </div>
                </div>
              ))
            )}
          </div>
          {!teacher && (
            <form
              className="ss-chat-compose"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act("chat_send", { room, question })) setQuestion("");
              }}
            >
              <label className="ss-label" htmlFor="chat-question">
                {room === "course"
                  ? "수업에서 궁금한 질문"
                  : "더 알아보고 싶은 질문"}
              </label>
              <div className="ss-question-starters">
                {starters.map((starter) => (
                  <button
                    className="ss-button"
                    key={starter}
                    type="button"
                    disabled={busy}
                    onClick={() => setQuestion(starter)}
                  >
                    {starter}
                  </button>
                ))}
              </div>
              <textarea
                id="chat-question"
                required
                maxLength={500}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="궁금한 점을 적어 주세요."
              />
              <div className="ss-chat-compose-row">
                <span>
                  {question.length} / 500 · 답변의 근거를 함께 확인해 주세요.
                </span>
                <button
                  className="ss-button primary"
                  disabled={busy || !question.trim()}
                >
                  {busy ? "질문 보내는 중…" : "보내기 ↑"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
      {teacher && who && (
        <FeedbackForm key={who} studentId={who} act={act} busy={busy} />
      )}
    </>
  );
}
export function Discussion({
  space,
  act,
  busy,
  unit,
}: {
  space: Space;
  act: Action;
  busy: boolean;
  unit: string;
}) {
  const [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [unitFilter, setUnitFilter] = useState("all"),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [newUnit, setNewUnit] = useState(unit),
    [body, setBody] = useState(""),
    [reply, setReply] = useState<string | null>(null),
    [filter, setFilter] = useState("all");
  const composer = useRef<HTMLTextAreaElement>(null);
  const topic = space.topics.find((t) => t.id === selected),
    topics = space.topics.filter(
      (t) =>
        (unitFilter === "all" || t.unit === unitFilter) &&
        t.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );
  const posts = space.posts.filter((p) => p.topic_id === selected);
  const topPosts = posts.filter(
    (p) =>
      !p.parent_id &&
      (filter === "all" ||
        (filter === "mine" &&
          (p.mine || posts.some((r) => r.parent_id === p.id && r.mine))) ||
        (filter === "teacher" &&
          (p.is_teacher ||
            posts.some((r) => r.parent_id === p.id && r.is_teacher)))),
  );
  return topic ? (
    <>
      <button
        className="ss-button"
        onClick={() => {
          setSelected("");
          setReply(null);
        }}
      >
        ← 주제 목록
      </button>
      <section className="ss-panel ss-topic-detail">
        <span className="ss-pill teal">{topic.unit}</span>
        <h1>{topic.title}</h1>
        <p className="ss-desc">
          다른 생각의 이유를 묻고, 내 생각을 연결해 보세요.
        </p>
        <div className="ss-work-tabs">
          {[
            ["all", "전체 대화"],
            ["mine", "내가 참여한 대화"],
            ["teacher", "선생님과의 대화"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {!topPosts.length && (
          <Empty>
            {filter === "all"
              ? "첫 번째 생각을 남겨 주세요."
              : "이 조건에 맞는 대화가 없어요. ‘전체 대화’에서 다른 생각을 살펴보세요."}
          </Empty>
        )}
        {topPosts.map((p) => (
          <article className="ss-board-answer" key={p.id}>
            <div className="ss-person-top">
              <strong>{p.author}</strong>
              <span className="ss-pill">
                {p.is_teacher ? "선생님" : "학생의 생각"}
              </span>
            </div>
            <p className="ss-board-answer-text">{p.body}</p>
            <time className="ss-note" dateTime={p.created_at}>
              {displayDate(p.created_at)}
            </time>
            <div className="ss-thread-actions">
              <button
                aria-pressed={p.liked}
                disabled={busy}
                onClick={() => act("like_toggle", {}, p.id)}
              >
                생각이 넓어졌어요 {p.likes || ""}
              </button>
              <button
                onClick={() => {
                  setReply(p.id);
                  composer.current?.focus();
                }}
              >
                답글 쓰기
              </button>
            </div>
            {posts.some((r) => r.parent_id === p.id) && (
              <details className="ss-board-replies">
                <summary>
                  답글 {posts.filter((r) => r.parent_id === p.id).length}개 보기
                </summary>
                {posts
                  .filter((r) => r.parent_id === p.id)
                  .map((r) => (
                    <div className="ss-thread-reply" key={r.id}>
                      <strong>{r.author}</strong>
                      <p>{r.body}</p>
                      <time className="ss-note" dateTime={r.created_at}>
                        {displayDate(r.created_at)}
                      </time>
                    </div>
                  ))}
              </details>
            )}
          </article>
        ))}
        <form
          className="ss-board-composer"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("post_add", { body, parent_id: reply }, topic.id)) {
              setBody("");
              setReply(null);
            }
          }}
        >
          <label className="ss-label" htmlFor="post-body">
            {reply
              ? "선택한 답변에 생각 이어 쓰기"
              : "이 주제에 내 생각 남기기"}
          </label>
          {reply && (
            <div className="ss-reply-context">
              {posts.find((p) => p.id === reply)?.body}
              <button
                className="ss-button"
                type="button"
                onClick={() => setReply(null)}
              >
                답글 취소
              </button>
            </div>
          )}
          <textarea
            ref={composer}
            id="post-body"
            required
            maxLength={1500}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="나는 이렇게 생각해요. 그 이유는…"
          />
          <div className="ss-composer-bottom">
            <span>우리 반 친구들과 선생님에게 보여요.</span>
            <button
              className="ss-button primary"
              disabled={busy || !body.trim()}
            >
              {reply ? "답글 보내기" : "답변 남기기"} →
            </button>
          </div>
        </form>
      </section>
    </>
  ) : (
    <>
      <Intro
        tag="THINK TOGETHER / 과학"
        title="함께 생각하면, 질문이 자라요."
        description="정답을 겨루기보다 서로의 이유를 듣고 생각을 넓혀 보세요."
      />
      <div className="ss-board-toolbar">
        <label className="ss-label">
          주제 검색
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="궁금한 과학 주제를 검색하세요"
          />
        </label>
        <label className="ss-label">
          단원
          <select
            value={unitFilter}
            onChange={(e) => {
              setUnitFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">전체 단원</option>
            {Array.from(
              new Set([
                ...lessons.map((l) => l.tag),
                ...space.topics.map((t) => t.unit),
              ]),
            ).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <button
          className="ss-button primary"
          onClick={() => setCreating(!creating)}
        >
          {creating ? "새 주제 작성 닫기" : "새 주제 열기 +"}
        </button>
      </div>
      {creating && (
        <form
          className="ss-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("topic_add", { title, unit: newUnit })) {
              setTitle("");
              setCreating(false);
            }
          }}
        >
          <label className="ss-label">
            새 주제
            <input
              required
              maxLength={180}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="함께 생각하고 싶은 질문"
            />
          </label>
          <label className="ss-label">
            단원
            <input
              required
              maxLength={80}
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
            />
          </label>
          <button
            className="ss-button primary"
            disabled={busy || !title.trim()}
          >
            주제 등록하기
          </button>
        </form>
      )}
      <section className="ss-panel">
        {topics.length === 0 ? (
          <Empty>
            {query.trim() || unitFilter !== "all"
              ? "검색 조건에 맞는 주제가 없어요. 검색어나 단원을 바꿔 보세요."
              : "등록된 주제가 없어요. 함께 생각할 질문을 열어 주세요."}
          </Empty>
        ) : (
          topics.slice((page - 1) * 8, page * 8).map((t) => (
            <button
              className="ss-topic ss-topic-list-row"
              key={t.id}
              onClick={() => {
                setSelected(t.id);
                setFilter("all");
                setBody("");
                setReply(null);
              }}
            >
              <span className="ss-pill teal">{t.unit}</span>
              <strong>{t.title}</strong>
              <small>
                대화 {space.posts.filter((p) => p.topic_id === t.id).length}개 ·{" "}
                {displayDate(t.created_at, false)}
              </small>
            </button>
          ))
        )}
        {topics.length > 8 && (
          <div className="ss-work-tabs">
            {Array.from({ length: Math.ceil(topics.length / 8) }, (_, i) => (
              <button
                key={i}
                aria-pressed={page === i + 1}
                onClick={() => setPage(i + 1)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
export function Analytics({
  records,
  answer,
  title,
  totalMembers,
}: {
  records: RecordRow[];
  answer: string;
  title: string;
  totalMembers: number;
}) {
  const [filter, setFilter] = useState("all");
  const latest = Array.from(
    new Map(
      [...records]
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map((r) => [r.student_id, r]),
    ).values(),
  );
  const result = (r: RecordRow) =>
    r.prediction === "아직 모르겠다"
      ? "unknown"
      : r.prediction === answer
        ? "correct"
        : "incorrect";
  const correct = latest.filter((r) => result(r) === "correct").length,
    unknown = latest.filter((r) => result(r) === "unknown").length;
  const choices = Array.from(new Set(latest.map((r) => r.prediction)));
  const filtered = latest.filter(
    (r) => filter === "all" || result(r) === filter || r.prediction === filter,
  );
  const groups = Object.entries(hypotheses)
    .map(([k, label]) => ({
      label,
      count: latest.filter(
        (r) => result(r) === "incorrect" && r.hypothesis === k,
      ).length,
    }))
    .filter((g) => g.count);
  return (
    <>
      <Intro
        tag="LEARNING OVERVIEW / 우리 반"
        title="답은 어떻게 갈렸을까요?"
        description="답의 분포를 보고, 다른 이유를 읽고, 다음 질문을 준비하세요."
      />
      <div className="ss-lesson">
        <div>
          <h3>{title}</h3>
          <p>정답: {answer || "교사 검토 필요"} · 학생별 최신 제출 기준</p>
        </div>
      </div>
      <div className="ss-stats-summary">
        {[
          ["응답한 학생", latest.length, `배정된 학생 ${totalMembers}명`],
          ["정답 선택", correct, "선택 결과 기준"],
          [
            "오답 선택",
            latest.length - correct - unknown,
            "이유를 확인할 응답",
          ],
          ["아직 모르겠다", unknown, "오답과 별도 표시"],
        ].map(([label, count, note]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>
              {count}
              <small>명</small>
            </strong>
            <p>{note}</p>
          </div>
        ))}
      </div>
      <div className="ss-stats-grid">
        <section className="ss-panel">
          <h2>학생들은 어떤 답을 골랐나요?</h2>
          <p className="ss-note">
            막대를 누르면 해당 답변을 모아 볼 수 있어요.
          </p>
          <div className="ss-distribution">
            {!latest.length ? (
              <Empty>이 질문에 제출된 답안이 없어요.</Empty>
            ) : (
              choices.map((c) => {
                const n = latest.filter((r) => r.prediction === c).length;
                return (
                  <button
                    className="ss-distribution-row"
                    key={c}
                    onClick={() => setFilter(c)}
                    aria-pressed={filter === c}
                  >
                    <span className="ss-distribution-title">
                      {c}
                      {c === answer && <small> 정답</small>}
                    </span>
                    <span className="ss-distribution-track">
                      <span
                        style={{
                          width: `${(n / latest.length) * 100}%`,
                          background:
                            c === answer ? "var(--ss-mint)" : "var(--ss-teal)",
                        }}
                      />
                    </span>
                    <span className="ss-distribution-value">
                      {n}명{" "}
                      <small>{Math.round((n / latest.length) * 100)}%</small>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <p className="ss-note">
            정답 선택만으로 개념 이해를 확정하지 않습니다.
          </p>
        </section>
        <section className="ss-panel">
          <h2>오답 안에는 어떤 생각이 있나요?</h2>
          <div className="ss-reason-groups">
            {groups.length ? (
              groups.map((g) => (
                <div key={g.label}>
                  <strong>{g.label}</strong>
                  <span>{g.count}명</span>
                </div>
              ))
            ) : (
              <Empty>분류할 오답 기록이 없어요.</Empty>
            )}
          </div>
          <p className="ss-note">
            AI 가설과 교사 검토 기록입니다. 원문을 함께 읽어 주세요.
          </p>
        </section>
      </div>
      <section className="ss-panel ss-spaced">
        <div className="ss-panelhead">
          <h2>답변을 한눈에</h2>
          <span className="ss-pill">{filtered.length}명 표시</span>
        </div>
        <div className="ss-filter">
          {[
            ["all", "전체"],
            ["incorrect", "오답만"],
            ["correct", "정답만"],
            ["unknown", "모르겠음"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {!["all", "incorrect", "correct", "unknown"].includes(filter) && (
          <div className="ss-person-top">
            <p className="ss-note">선택한 답 · {filter}</p>
            <button className="ss-button" onClick={() => setFilter("all")}>
              전체 답변 보기
            </button>
          </div>
        )}
        <div className="ss-stats-table">
          <table aria-label="학생별 예측과 이유">
            <thead>
              <tr>
                <th scope="col">학생</th>
                <th scope="col">선택한 답</th>
                <th scope="col">학생이 남긴 이유</th>
                <th scope="col">구분</th>
              </tr>
            </thead>
            <tbody>
              {!filtered.length && (
                <tr>
                  <td colSpan={4}>
                    <Empty>이 조건에 해당하는 학생 응답이 없어요.</Empty>
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.student_alias}</td>
                  <td>{r.prediction}</td>
                  <td>{r.reason}</td>
                  <td>
                    <span className="ss-pill">
                      {result(r) === "correct"
                        ? "정답"
                        : result(r) === "incorrect"
                          ? "오답"
                          : "모르겠음"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
