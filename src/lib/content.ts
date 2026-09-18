export const hypotheses = {
  mass_only: "질량만 고려",
  size_only: "크기만 고려",
  liquid_missed: "액체 조건 누락",
  hold: "추가 설명 필요",
} as const;
export type Hypothesis = keyof typeof hypotheses;
export const states: Record<string, string> = {
  awaiting_review: "교사 확인 대기",
  needs_more_reason: "이유 보완",
  experiment_assigned: "실험 준비 완료",
  observed: "관찰 완료",
  revised: "새 사례 확인",
  reassessed: "마지막 교사 확인",
  completed: "탐구 완료",
};
export const experiments = [
  {
    id: "wood80_iron20",
    title: "무거우면 가라앉을까?",
    subtitle: "나무와 철 · 질량을 비교해요",
    kind: "mass_only",
  },
  {
    id: "split_wood",
    title: "반으로 나누면 달라질까?",
    subtitle: "같은 재료 · 크기를 바꿔요",
    kind: "size_only",
  },
  {
    id: "change_liquid",
    title: "물이 달라지면 어떨까?",
    subtitle: "같은 물체 · 액체를 바꿔요",
    kind: "liquid_missed",
  },
];
export const items = [
  {
    id: "D01",
    title: "무거우면 가라앉을까?",
    tag: "질량과 밀도",
    description: "물에 나무 80g과 철 20g을 넣어요. 어떤 일이 일어날까요?",
    objects: [
      { name: "나무", mass: "80g", detail: "부피 100cm³", color: "wood" },
      { name: "철", mass: "20g", detail: "부피 약 2.56cm³", color: "iron" },
    ],
    choices: [
      "나무는 가라앉고 철은 떠요",
      "나무는 뜨고 철은 가라앉아요",
      "둘 다 떠요",
      "둘 다 가라앉아요",
    ],
    pair: "D04",
  },
  {
    id: "D02",
    title: "반으로 나누면 달라질까?",
    tag: "부피와 밀도",
    description:
      "물 위에 뜨는 같은 나무를 반으로 나눴어요. 작은 나무는 어떻게 될까요?",
    objects: [
      { name: "원래 나무", mass: "80g", detail: "부피 100cm³", color: "wood" },
      { name: "절반 나무", mass: "40g", detail: "부피 50cm³", color: "wood" },
    ],
    choices: [
      "나눈 나무는 가라앉아요",
      "나누기 전후 모두 떠요",
      "크기만으로 알 수 있어요",
    ],
    pair: "D05",
  },
  {
    id: "D03",
    title: "액체를 바꾸면 어떨까?",
    tag: "액체의 조건",
    description:
      "같은 물체(105g, 100cm³)를 서로 다른 액체에 넣어요. 결과는 같을까요?",
    objects: [
      { name: "액체 A", mass: "1.00", detail: "밀도 g/cm³", color: "water" },
      { name: "액체 B", mass: "1.10", detail: "밀도 g/cm³", color: "water" },
    ],
    choices: [
      "두 액체에서 모두 가라앉아요",
      "A에서는 가라앉고 B에서는 떠요",
      "두 액체에서 모두 떠요",
    ],
    pair: "D06",
  },
  {
    id: "D04",
    title: "새로운 물체도 설명할 수 있나요?",
    tag: "새 사례",
    description:
      "물에 A(60g, 100cm³)와 B(30g, 10cm³)를 넣어요. 결과와 이유를 설명해요.",
    objects: [],
    choices: ["A는 뜨고 B는 가라앉아요", "A는 가라앉고 B는 떠요", "둘 다 떠요"],
    pair: "",
  },
  {
    id: "D05",
    title: "이번에는 다른 재료예요",
    tag: "새 사례",
    description:
      "균질한 물체 120g·100cm³를 반으로 나눠 60g·50cm³로 만들었어요. 물에 넣으면?",
    objects: [],
    choices: [
      "나누기 전후 모두 가라앉아요",
      "반으로 나누면 떠요",
      "나누기 전후 모두 떠요",
    ],
    pair: "",
  },
  {
    id: "D06",
    title: "새 액체에서도 설명해요",
    tag: "새 사례",
    description:
      "밀도 0.95g/cm³인 물체를 밀도 0.90과 1.00g/cm³ 액체에 각각 넣어요.",
    objects: [],
    choices: [
      "0.90에서는 가라앉고 1.00에서는 떠요",
      "두 액체에서 모두 떠요",
      "두 액체에서 모두 가라앉아요",
    ],
    pair: "",
  },
];
export type RecordRow = {
  id: string;
  student_id: string;
  student_alias: string;
  item_id: string;
  prediction: string;
  reason: string;
  version: number;
  state: string;
  hypothesis: Hypothesis;
  analysis_mode: string;
  analysis_note: string;
  experiment_id: string | null;
  observation: string | null;
  revised_text: string | null;
  self_note: string | null;
  stuck_at: string | null;
  re_prediction: string | null;
  re_reason: string | null;
  scores: number[] | null;
  created_at: string;
  updated_at: string;
};
