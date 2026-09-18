import { items, lessons, type Hypothesis, type RecordRow } from "./content";
import type { Space, Post } from "../components/ClassroomPanels";

/** Fictional, authored presentation fixtures. Never used by the production API. */
export const demoStudents = Array.from({ length: 24 }, (_, i) => ({
  id: `demo-student-${String(i + 1).padStart(2, "0")}`,
  alias: `탐구자 ${String(i + 1).padStart(2, "0")}`,
}));
export const DEMO_TEACHER_ID = "demo-teacher";
export type DemoExperiment = {
  id: string;
  left: string;
  right: string;
  leftFloats: boolean;
  rightFloats: boolean;
  detail: string;
  result: string;
};
export const demoExperiments: Record<string, DemoExperiment> = {
  wood80_iron20: {
    id: "wood80_iron20",
    left: "나무 80g",
    right: "철 20g",
    leftFloats: true,
    rightFloats: false,
    detail: "물 1.0 · 나무 0.8 · 철 약 7.8 g/cm³",
    result:
      "80g 나무는 뜨고 20g 철은 가라앉았어요. 질량이 더 큰 나무가 떴어요.",
  },
  split_wood: {
    id: "split_wood",
    left: "원래 나무 80g",
    right: "절반 나무 40g",
    leftFloats: true,
    rightFloats: true,
    detail: "부피 100 → 50cm³ · 두 나무의 밀도 0.8g/cm³",
    result:
      "같은 나무를 반으로 나누어도 모두 떠요. 질량과 부피가 같은 비율로 줄었어요.",
  },
  change_liquid: {
    id: "change_liquid",
    left: "액체 A · 1.00",
    right: "액체 B · 1.10",
    leftFloats: false,
    rightFloats: true,
    detail: "같은 물체 105g · 100cm³ · 밀도 1.05g/cm³",
    result:
      "같은 물체가 액체 A에서는 가라앉고 액체 B에서는 떠요. 물체와 액체의 밀도 관계가 달라졌어요.",
  },
  guided: {
    id: "guided",
    left: "",
    right: "",
    leftFloats: false,
    rightFloats: false,
    detail: "선생님과 조건을 비교한 뒤 관찰 내용을 직접 기록해요.",
    result: "",
  },
};
type LessonFixture = {
  id: string;
  answer: string;
  reasons: [string, string, string];
  predictions: [string, string, string];
  observation: string;
  revision: string;
  transferReason: string;
  note: string;
  concept: string;
  activity: string;
  question: string;
  discussion: string;
  discussionReply: string;
};
export const demoLessonFixtures: LessonFixture[] = [
  {
    id: "D01",
    answer: "나무는 뜨고 철은 가라앉아요",
    predictions: [
      "나무는 가라앉고 철은 떠요",
      "나무는 가라앉고 철은 떠요",
      "나무는 뜨고 철은 가라앉아요",
    ],
    reasons: [
      "나무는 80g이고 철은 20g이라서 더 무거운 나무가 가라앉을 것 같아요.",
      "큰 물체는 물에 잘 뜨지 못하니까 부피가 큰 나무가 가라앉을 것 같아요.",
      "나무는 뜨는 재료이고 철은 가라앉는 재료라서 어떤 액체에서도 똑같을 것 같아요.",
    ],
    observation:
      "80g 나무는 뜨고 20g 철은 가라앉았어요. 무게만으로 예상했던 결과와 반대였어요.",
    revision:
      "물체의 질량만이 아니라 질량을 부피로 나눈 밀도를 액체의 밀도와 비교해야 해요. 나무의 밀도는 물보다 작고 철의 밀도는 물보다 커서 결과가 달라요.",
    transferReason:
      "A의 밀도는 0.6g/cm³라 물보다 작고 B는 3g/cm³라 물보다 커요. 그래서 더 무거운 A는 뜨고 B는 가라앉아요.",
    note: "물체의 무게만 봤고 부피와 액체를 함께 비교하지 않았어요.",
    concept:
      "밀도는 질량을 부피로 나눈 값입니다. 물체의 평균 밀도가 액체의 밀도보다 작으면 뜨고, 크면 가라앉습니다. 속이 비지 않은 나무 80g의 부피가 100cm³라면 밀도는 0.8g/cm³입니다. 철 20g의 부피가 약 2.56cm³라면 밀도는 약 7.8g/cm³입니다. 물의 밀도를 1.0g/cm³로 두면 나무는 뜨고 철은 가라앉습니다. 같은 재료를 나누면 질량과 부피가 함께 줄어 밀도는 유지됩니다.",
    activity:
      "10분 비교 활동: ① 나무 80g과 철 20g의 예측과 이유를 씁니다. ② 물에 넣는 가상 실험을 관찰합니다. ③ 질량과 부피를 함께 비교합니다. ④ 같은 나무를 반으로 나누거나 액체 밀도를 바꾸어 다른 조건을 살펴봅니다. ⑤ ‘무거우면’이라는 말을 어떤 조건으로 바꿀지 설명합니다. 가상 실험은 표면장력과 물 흡수를 제외한 이상화된 조건입니다.",
    question: "철보다 무거운 나무가 왜 뜨나요?",
    discussion:
      "80g 나무가 20g 철보다 무거운데 떠서 놀랐어요. 같은 무게로 맞춰도 재료가 다르면 결과가 다를까요?",
    discussionReply:
      "같은 질량이어도 부피가 다르면 밀도가 달라요. 물체마다 질량과 부피를 같이 적어 보면 비교할 수 있을 것 같아요.",
  },
  {
    id: "D07",
    answer: "110g",
    predictions: ["100g", "10g", "110g"],
    reasons: [
      "소금이 눈에 안 보이게 사라지니까 물의 무게인 100g만 남을 것 같아요.",
      "소금물의 맛은 소금 때문에 나니까 소금 무게 10g이 답인 것 같아요.",
      "물이 밖으로 나가지 않으면 넣은 소금도 용기 안에 있으니 두 질량을 더해야 해요.",
    ],
    observation:
      "밀폐 용기의 내용물 질량은 소금을 녹이기 전과 후에 모두 110g이었어요. 소금 알갱이는 보이지 않아도 질량이 남았어요.",
    revision:
      "소금이 물에 녹아 보이지 않게 되어도 물질이 없어진 것은 아니에요. 밖으로 물질이 나가지 않는 밀폐 조건에서는 전체 질량이 보존되어 110g이에요.",
    transferReason:
      "밀폐 용기에서는 물과 설탕이 모두 안에 남아 있어서 50g과 5g을 더한 55g이에요.",
    note: "눈에 보이는지와 물질이 남아 있는지를 같은 뜻으로 생각했어요.",
    concept:
      "소금이 물에 녹으면 작은 입자들이 물속에 고르게 퍼져 눈으로 알갱이를 보기 어려워집니다. 녹는 것은 물질이 없어지는 일이 아닙니다. 물질의 출입이 없는 밀폐 용기에서는 녹이기 전후 전체 질량이 같습니다. 물 100g과 소금 10g의 전체 질량은 110g입니다. 용기 질량은 이 계산에서 제외합니다.",
    activity:
      "10분 비교 활동: 뚜껑을 닫은 용기에서 물과 소금의 질량을 따로 기록하고 전체 질량을 예측합니다. 흔들어 녹인 뒤 같은 저울로 다시 잽니다. 보이는 알갱이의 유무와 저울 값을 나란히 기록합니다. 용기를 열어 증발시키는 경우에는 물질 출입 조건이 달라짐을 구별합니다. 저울 눈금 차이는 측정 오차일 수도 있으므로 반복 측정합니다.",
    question: "소금이 안 보이는데 무게는 왜 남아 있나요?",
    discussion:
      "소금이 안 보이는 것과 소금이 없어진 것은 다르다는 걸 저울로 알 수 있었어요. 설탕도 같은 방법으로 확인할 수 있을까요?",
    discussionReply:
      "같은 밀폐 조건으로 설탕을 녹여 재 보면 좋겠어요. 물이 밖으로 새지 않았는지도 함께 확인해야 해요.",
  },
  {
    id: "D08",
    answer: "꺼진다",
    predictions: ["더 밝아진다", "그대로 켜진다", "꺼진다"],
    reasons: [
      "전구가 하나 줄었으니 남은 전구가 전기를 더 많이 받아 밝아질 것 같아요.",
      "남은 전구는 건전지에 연결되어 있으니 다른 전구를 빼도 켜질 것 같아요.",
      "전류가 흐를 길이 한 군데라도 끊어지면 한 바퀴 돌 수 없어서 꺼져요.",
    ],
    observation:
      "직렬 회로에서 전구 하나를 소켓에서 빼자 다른 전구도 꺼졌어요. 빈 소켓을 포함한 고리가 끊어졌어요.",
    revision:
      "직렬 회로에서 전구를 빼면 하나뿐인 전류의 경로가 끊어져 다른 전구도 꺼져요. 전구 수만 보지 않고 닫힌 회로가 유지되는지를 확인해야 해요.",
    transferReason:
      "병렬 회로에서는 다른 갈래의 닫힌 경로가 남아 있어요. 한 갈래의 전구만 빼면 다른 갈래 전구는 계속 켜질 수 있어요.",
    note: "전구 개수만 생각했고 전류가 되돌아갈 길을 살피지 않았어요.",
    concept:
      "전구에 전류가 지속해서 흐르려면 건전지와 전구를 잇는 닫힌 회로가 필요합니다. 직렬 연결은 전류의 경로가 하나입니다. 전구 하나를 소켓에서 빼 그 경로를 끊으면 다른 전구에도 전류가 흐르지 않습니다. 병렬 연결에서는 갈래마다 경로가 있어 한 갈래가 끊어져도 다른 닫힌 갈래로 전류가 흐를 수 있습니다.",
    activity:
      "10분 비교 활동: 건전지와 두 전구를 직렬로 연결한 회로 그림에서 전류가 흐를 닫힌 길을 손가락으로 따라갑니다. 한 전구를 뺀 위치를 표시하고 길이 이어지는지 확인합니다. 병렬 그림에서도 같은 조건을 적용합니다. 밝기 비교와 회로 단절을 구분해 설명합니다. 실제 활동은 교사 지도 아래 저전압 건전지로만 진행하고 전원 콘센트를 사용하지 않습니다.",
    question: "전구가 줄면 더 밝아지는 거 아닌가요?",
    discussion:
      "전구를 빼는 것과 전선으로 우회시켜 전구 수만 줄이는 것은 다른 조건 같아요. 그림에서 끊어진 길을 표시하니 구분됐어요.",
    discussionReply:
      "맞아요. 이번 문제는 소켓을 비워 회로가 끊겼어요. 먼저 닫힌 길이 남는지를 확인하는 게 필요해요.",
  },
  {
    id: "D09",
    answer: "금속이 손의 열을 더 빠르게 전달한다",
    predictions: [
      "금속의 온도가 항상 더 낮다",
      "나무가 열을 만든다",
      "금속이 손의 열을 더 빠르게 전달한다",
    ],
    reasons: [
      "손으로 만졌을 때 차가운 쪽은 온도도 더 낮다고 생각했어요.",
      "나무가 따뜻하게 느껴지는 건 나무 안에서 열이 나오기 때문인 것 같아요.",
      "둘의 온도는 같아도 금속으로 손의 열이 더 빠르게 이동해서 차갑게 느껴져요.",
    ],
    observation:
      "같은 방에 오래 둔 금속과 나무를 온도계로 재니 같은 온도였어요. 손으로 만졌을 때는 금속이 더 차갑게 느껴졌어요.",
    revision:
      "손이 차갑다고 느끼는 정도가 물체 온도만을 뜻하지는 않아요. 같은 온도라도 금속이 나무보다 손의 열을 더 빠르게 전달받아 더 차갑게 느껴져요.",
    transferReason:
      "같은 방에서 충분히 오래 두어 열평형에 도달한 금속과 나무는 온도계로 측정하면 같은 온도예요.",
    note: "느낌과 온도계로 측정한 값을 구분하지 않았어요.",
    concept:
      "온도는 물체의 뜨겁고 차가운 정도를 나타내는 물리량입니다. 손으로 느끼는 감각은 손과 물체 사이의 열 이동 속도에도 영향을 받습니다. 실내 온도가 손보다 낮을 때 금속은 나무보다 열을 잘 전달해 손의 열을 빠르게 빼앗으므로 더 차갑게 느껴질 수 있습니다. 같은 방에 충분히 오래 둔 두 물체의 온도는 같을 수 있습니다.",
    activity:
      "10분 비교 활동: 같은 방에 충분히 오래 둔 금속과 나무를 준비합니다. 손의 느낌을 먼저 예측하고 두 물체를 온도계로 측정합니다. 온도계의 접촉 조건과 기다린 시간을 같게 합니다. ‘느껴지는 차가움’과 ‘측정한 온도’를 두 열에 나누어 적습니다. 뜨겁거나 차가운 극단적 온도의 물체를 손으로 직접 만지지 않습니다.",
    question: "차갑게 느껴지는데 온도는 같을 수 있나요?",
    discussion:
      "온도계는 같은데 금속만 차갑게 느껴졌어요. 눈을 감고 만지는 것만으로 정확한 온도를 알기는 어렵겠어요.",
    discussionReply:
      "느낌은 열이 이동하는 속도에도 영향을 받으니까 측정 도구와 함께 확인해야 할 것 같아요.",
  },
  {
    id: "D10",
    answer: "이산화 탄소",
    predictions: ["산소", "질소", "이산화 탄소"],
    reasons: [
      "식물도 살아 있으니 사람이 숨 쉴 때 필요한 산소를 광합성에도 쓸 것 같아요.",
      "공기 중에 질소가 가장 많다고 배워서 식물도 많이 쓸 것 같아요.",
      "광합성은 빛을 이용해 이산화 탄소와 물로 양분을 만드는 과정이에요.",
    ],
    observation:
      "광합성과 호흡을 비교한 자료에서 광합성은 이산화 탄소를 사용하고, 호흡은 산소를 사용하는 과정으로 구별했어요.",
    revision:
      "식물도 호흡하지만 광합성과 호흡은 서로 다른 과정이에요. 광합성으로 양분을 만들 때는 빛과 물, 이산화 탄소가 필요해요.",
    transferReason:
      "빛을 받는 녹색 식물에서는 광합성과 호흡이 함께 일어날 수 있어요. 빛을 받는다고 호흡이 멈추는 것은 아니에요.",
    note: "식물의 모든 생명 활동을 호흡 하나로 설명했어요.",
    concept:
      "녹색 식물의 광합성은 빛에너지를 이용해 물과 이산화 탄소로 양분을 만들고 산소를 내놓는 과정입니다. 호흡은 양분에 저장된 에너지를 사용하는 과정이며 식물도 호흡합니다. 빛이 있을 때 광합성과 호흡이 함께 일어날 수 있습니다. 따라서 ‘식물도 산소가 필요하다’는 사실만으로 광합성에 필요한 기체를 정할 수 없습니다.",
    activity:
      "10분 비교 활동: 광합성과 호흡 카드를 나란히 놓습니다. 각 과정이 사용하는 물질, 내놓는 물질, 빛의 조건을 표시합니다. ‘식물도 숨 쉰다’라는 설명이 어떤 과정에 해당하는지 찾습니다. 낮과 밤 조건을 바꾸어 설명하되, 빛이 있다고 호흡이 멈춘다고 단정하지 않습니다. 식물의 생장에는 물과 기체 외에도 무기 양분 등 여러 조건이 필요합니다.",
    question: "식물도 산소가 필요한데 왜 광합성 답은 이산화 탄소예요?",
    discussion:
      "식물도 호흡한다는 말은 맞지만 광합성 질문과는 과정이 다르다는 것을 놓쳤어요. 낮에도 두 과정이 함께 일어날 수 있대요.",
    discussionReply:
      "사용하는 기체와 내놓는 기체를 표로 나누니 헷갈리지 않았어요. 먼저 어떤 과정을 묻는지 읽어야겠어요.",
  },
  {
    id: "D11",
    answer: "햇빛을 받는 부분 중 지구에서 보이는 범위가 달라진다",
    predictions: [
      "지구 그림자가 매일 달을 가린다",
      "달 자체의 모양이 바뀐다",
      "햇빛을 받는 부분 중 지구에서 보이는 범위가 달라진다",
    ],
    reasons: [
      "달의 어두운 부분은 지구 그림자라서 지구가 가리는 크기가 매일 달라질 것 같아요.",
      "초승달과 보름달의 모양이 다르니까 달의 실제 모양도 바뀌는 줄 알았어요.",
      "달의 밝은 반쪽은 그대로인데 지구에서 보는 방향이 달라져 보여요.",
    ],
    observation:
      "손전등으로 비춘 공의 절반은 밝았고 보는 위치를 바꾸자 밝은 부분의 보이는 모양이 달라졌어요. 공의 실제 모양은 변하지 않았어요.",
    revision:
      "평소 달의 위상은 지구 그림자 때문이 아니라 햇빛을 받는 부분 중 지구에서 보이는 범위가 변해서 생겨요. 달의 실제 모양은 계속 둥글어요.",
    transferReason:
      "월식은 달이 지구 그림자에 들어가는 현상이고, 평소 위상은 햇빛을 받는 부분을 보는 방향이 달라지는 현상이에요.",
    note: "월식 설명을 평소 달 모양 변화에도 똑같이 적용했어요.",
    concept:
      "달은 스스로 빛을 내지 않고 태양빛을 반사합니다. 태양이 비추는 달의 절반 중 지구에서 보이는 범위가 달의 공전에 따라 달라져 위상이 변합니다. 초승달이 되어도 달 자체의 구형 모양이 변하지는 않습니다. 월식은 달이 지구 그림자에 들어가는 특별한 배열에서 일어나며, 평소의 위상 변화와 원인이 다릅니다.",
    activity:
      "10분 비교 활동: 손전등은 태양, 흰 공은 달, 관찰자의 눈은 지구 역할을 합니다. 공에 빛이 닿는 부분과 눈에 보이는 부분을 구별해 스케치합니다. 눈의 위치 또는 공의 위치를 바꾸되 손전등 방향은 유지합니다. 관찰자의 몸이 공에 그림자를 만들면 월식 조건과 섞이므로 위치를 조절합니다. 실제 태양을 맨눈이나 광학 기기로 직접 보지 않습니다.",
    question: "초승달의 어두운 부분은 지구 그림자 아닌가요?",
    discussion:
      "공의 밝은 반쪽이 어느 방향에서 보이는지에 따라 초승달처럼 보였어요. 그림자를 만들지 않아도 모양이 달라졌어요.",
    discussionReply:
      "월식 모형에서는 몸의 그림자가 공에 닿지만 위상 모형에서는 그렇지 않다는 차이를 표시하면 좋겠어요.",
  },
  {
    id: "D12",
    answer: "커진다",
    predictions: ["작아진다", "변하지 않는다", "커진다"],
    reasons: [
      "기체가 작아지면 안에 들어 있는 공기도 적어져서 압력이 줄 것 같아요.",
      "입구를 막아 공기 양이 같으니까 압력도 같을 것 같아요.",
      "온도와 양이 같을 때 공간을 줄이면 입자들이 벽에 더 자주 충돌해서 압력이 커져요.",
    ],
    observation:
      "입구를 막은 주사기의 피스톤을 천천히 누를수록 더 밀기 어려웠어요. 기체의 양은 같고 차지하는 부피가 줄었어요.",
    revision:
      "온도와 기체의 양이 일정하면 부피가 줄 때 압력이 커져요. 입자 수가 줄어든 게 아니라 더 좁은 공간에서 벽에 더 자주 충돌하는 것이에요.",
    transferReason:
      "온도와 기체 양이 일정한 상태에서 부피를 늘리면 벽과의 충돌 빈도가 줄어 압력이 작아져요.",
    note: "공간이 작아지는 것과 기체 입자 수가 적어지는 것을 혼동했어요.",
    concept:
      "기체 압력은 기체 입자들이 용기 벽에 충돌하면서 나타납니다. 온도와 기체 양이 일정한 경우 부피가 줄면 압력이 커지고, 부피가 늘면 압력이 작아집니다. 밀폐한 주사기를 누른다고 기체 입자들이 없어지거나 작아지는 것은 아닙니다. 빠르게 압축하면 온도가 변할 수 있으므로 일정한 온도라는 조건을 구별해야 합니다.",
    activity:
      "10분 비교 활동: 바늘이 없는 주사기 입구를 막고 피스톤을 천천히 눌러 부피와 손에 느껴지는 저항을 비교합니다. 공기가 새지 않는지 확인합니다. 같은 입자 수를 서로 다른 크기의 상자 그림에 그려 벽 충돌을 설명합니다. 정확한 압력값은 손의 느낌만으로 측정할 수 없음을 표시합니다. 피스톤을 무리하게 누르거나 사람을 향하게 하지 않습니다.",
    question: "공기 양은 같은데 왜 누르기가 더 어려워지나요?",
    discussion:
      "입자를 작게 그리는 대신 같은 크기와 개수로 좁은 상자에 그리니 이해됐어요. 부피가 줄어도 입자는 남아 있어요.",
    discussionReply:
      "온도와 양이 같다는 조건을 꼭 적고 압력 변화를 설명하면 더 정확할 것 같아요.",
  },
  {
    id: "D13",
    answer: "수증기가 되어 공기 중으로 이동한다",
    predictions: [
      "물질 자체가 없어진다",
      "옷 속에서 고체로 변한다",
      "수증기가 되어 공기 중으로 이동한다",
    ],
    reasons: [
      "젖은 부분이 눈에 안 보이니 물이 없어졌다고 생각했어요.",
      "옷이 마르면 만졌을 때 단단해져서 물이 고체가 된 것 같아요.",
      "물은 끓지 않아도 표면에서 증발해 기체 상태로 공기 중에 이동할 수 있어요.",
    ],
    observation:
      "물 일부가 증발한 밀폐 용기를 통째로 재니 전체 질량은 같았어요. 열린 젖은 천에서는 물이 공기 중으로 이동하며 천의 질량이 줄었어요.",
    revision:
      "옷의 물은 물질 자체가 사라진 것이 아니라 증발해 공기 중으로 이동해요. 증발은 끓는점보다 낮은 온도에서도 표면에서 일어날 수 있어요.",
    transferReason:
      "밀폐 용기에서는 증발한 수증기도 용기 안에 남아 있어요. 따라서 용기 전체 질량은 변하지 않아요.",
    note: "눈에 보이지 않으면 물질이 없어졌다고 생각했어요.",
    concept:
      "증발은 액체 표면의 물 분자 일부가 기체 상태로 공기 중으로 이동하는 현상이며 끓는점보다 낮은 온도에서도 일어납니다. 옷이 마를 때 물이 없어지는 것이 아니라 공기 중으로 이동합니다. 수증기는 보이지 않는 기체입니다. 밀폐 용기에서는 수증기가 밖으로 나가지 않으므로 일부 물이 증발해도 용기 전체 질량은 같습니다.",
    activity:
      "10분 비교 활동: 열린 용기와 밀폐 용기 그림에서 물이 이동할 수 있는 경계를 표시합니다. 물 표면과 수증기 입자를 서로 다른 기호로 표현합니다. 바람이 있는 조건과 없는 조건에서 표면 주변 공기가 바뀌는 정도를 비교합니다. 마르는 속도를 실제로 측정하려면 천의 종류, 물의 양, 온도, 습도도 같게 해야 합니다. 흰 김은 작은 물방울이며 보이지 않는 수증기와 구분합니다.",
    question: "물이 끓지 않았는데 옷은 어떻게 마르나요?",
    discussion:
      "옷만 재면 가벼워지지만 공기까지 포함한 밀폐 공간 전체를 재면 같다는 점이 흥미로워요. 무엇의 질량을 재는지 정해야겠어요.",
    discussionReply:
      "맞아요. 경계를 어디로 잡았는지와 물이 그 경계를 넘어갔는지를 표시해 보면 좋겠어요.",
  },
];
export type DemoPost = Post & { author_id: string; liked_by: string[] };
export type DemoState = {
  schema: number;
  records: RecordRow[];
  space: Omit<Space, "posts"> & { posts: DemoPost[] };
};
export const DEMO_SCHEMA = 1;
const sampleTime = (lesson: number, student: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 10 + lesson, 0, student + minute)).toISOString();

export function createDemoSeed(): DemoState {
  const records: RecordRow[] = [];
  const space: DemoState["space"] = {
    materials: [],
    feedback: [],
    chats: [],
    topics: [],
    posts: [],
    members: demoStudents.map((s) => ({ ...s })),
    answers: {},
  };
  const stageCycle = [
    "awaiting_review",
    "awaiting_review",
    "experiment_assigned",
    "observed",
    "revised",
    "reassessed",
    "completed",
    "completed",
    "needs_more_reason",
    "awaiting_review",
    "completed",
    "reassessed",
  ];
  demoLessonFixtures.forEach((f, lessonIndex) => {
    const lesson = lessons.find((l) => l.id === f.id)!;
    space.answers[f.id] = f.answer;
    const materials = [
      {
        id: `demo-material-${f.id}-concept`,
        title: `${lesson.tag} · ${f.id} 개념 읽기`,
        section: `${f.id} / 직접 작성한 발표용 개념 자료`,
        content: f.concept,
        enabled: true,
      },
      {
        id: `demo-material-${f.id}-activity`,
        title: `${lesson.tag} · ${f.id} 10분 탐구 안내`,
        section: `${f.id} / 비교 조건 · 관찰 방법`,
        content: f.activity,
        enabled: true,
      },
    ];
    space.materials.push(...materials);
    demoStudents.forEach((student, studentIndex) => {
      const variant = studentIndex < 10 ? 0 : studentIndex < 17 ? 1 : 2;
      const state =
        studentIndex === 0 && lessonIndex === 0
          ? "awaiting_review"
          : stageCycle[(studentIndex + lessonIndex * 2) % stageCycle.length];
      const hypothesis: Hypothesis =
        state === "needs_more_reason"
          ? "hold"
          : f.id === "D01"
            ? (["mass_only", "size_only", "liquid_missed"] as const)[variant]
            : "other";
      const active = !["awaiting_review", "needs_more_reason"].includes(state);
      const experiment =
        f.id === "D01"
          ? ["wood80_iron20", "split_wood", "change_liquid"][variant]
          : "guided";
      const seen = ["observed", "revised", "reassessed", "completed"].includes(
        state,
      );
      const rewritten = ["revised", "reassessed", "completed"].includes(state);
      const transferred = ["reassessed", "completed"].includes(state);
      const observation =
        f.id === "D01" ? demoExperiments[experiment].result : f.observation;
      const revision =
        f.id === "D01" && variant === 1
          ? "같은 재료를 반으로 나누면 질량과 부피가 함께 줄어 밀도는 같아요. 크기만으로 판단하지 않고 나무와 물의 밀도를 비교해야 해요."
          : f.id === "D01" && variant === 2
            ? "같은 물체라도 액체의 밀도가 달라지면 뜨고 가라앉는 결과가 달라져요. 물체만 보지 않고 물체와 액체의 밀도를 비교해야 해요."
            : f.revision;
      const secondVariantNotes: Record<string, string> = {
        D01: "물체 크기만 봤어요. 같은 재료를 나누어도 질량과 부피의 비율은 같다는 점을 새로 확인했어요.",
        D07: "소금의 질량만 답으로 썼어요. 물과 소금을 모두 포함한 전체 질량을 구해야 해요.",
        D08: "전구가 건전지에 닿는 것만 생각했어요. 돌아오는 길까지 닫혀 있는지 확인해야 해요.",
        D09: "나무가 열을 만든다고 생각했어요. 손의 열이 전달되는 속도와 물체가 열을 만드는 일은 달라요.",
        D10: "공기 중에 많은 기체라서 답이라고 생각했어요. 광합성 과정이 실제로 어떤 기체를 사용하는지 봐야 해요.",
        D11: "보이는 모양과 달의 실제 모양을 혼동했어요. 공의 모양은 그대로이고 보이는 밝은 부분이 변했어요.",
        D12: "기체 양이 같다는 조건만 봤어요. 같은 양이어도 부피가 바뀌면 압력이 달라져요.",
        D13: "옷의 느낌만 보고 물이 고체가 되었다고 생각했어요. 물은 수증기가 되어 공기 중으로 이동했어요.",
      };
      const reflection =
        variant === 0
          ? f.note
          : variant === 1
            ? secondVariantNotes[f.id]
            : f.id === "D01"
              ? "나무와 철의 재료만 생각했어요. 같은 물체도 액체의 밀도를 바꾸면 결과가 달라져요."
              : "처음 설명을 관찰 결과로 확인했어요. 새 사례에서도 그대로 둔 조건과 바뀐 조건을 더 분명하게 적었어요.";
      const reason =
        state === "needs_more_reason"
          ? "예전에 비슷한 것을 본 것 같은데, 이유를 말로 설명하기는 어려워요."
          : f.reasons[variant];
      const id = `demo-record-${f.id}-${String(studentIndex + 1).padStart(2, "0")}`;
      const row: RecordRow = {
        id,
        student_id: student.id,
        student_alias: student.alias,
        item_id: f.id,
        prediction: f.predictions[variant],
        reason,
        version: 1,
        state,
        hypothesis,
        analysis_mode: "sample",
        analysis_note:
          state === "needs_more_reason"
            ? "준비된 예시 · 한 문장만으로 생각의 근거를 정하기 어려워 추가 설명을 묻는 상황입니다."
            : `준비된 예시 · ‘${f.reasons[variant]}’에서 비교한 조건을 확인하고, ${f.id === "D01" ? ["질량 외에 부피도 보았는지", "크기와 밀도를 구분했는지", "액체 조건을 고려했는지"][variant] : "관찰한 사실과 개념이 어떻게 이어지는지"} 교사가 다시 살펴봅니다. 실제 AI 분석 결과가 아닙니다.`,
        experiment_id: active ? experiment : null,
        observation: seen ? observation : null,
        revised_text: rewritten ? revision : null,
        self_note: rewritten ? reflection : null,
        stuck_at: rewritten
          ? ["observe", "rewrite", "predict"][studentIndex % 3]
          : null,
        re_prediction: transferred
          ? items.find((i) => i.id === lesson.pair)!.choices[0]
          : null,
        re_reason: transferred ? f.transferReason : null,
        scores:
          state === "completed"
            ? studentIndex % 3 === 0
              ? [2, 1, 2]
              : [2, 2, 2]
            : null,
        created_at: sampleTime(lessonIndex, studentIndex),
        updated_at: sampleTime(lessonIndex, studentIndex, 20),
        teacher_question:
          state === "needs_more_reason"
            ? `‘${f.predictions[variant]}’라고 생각할 때 무엇을 보고 판단했나요? 비교한 조건을 한 가지 더 적어 줄래요?`
            : undefined,
        review_note: active
          ? "예시 교사 기록 · 학생의 이유와 맞는 조건 비교 활동을 확인했습니다."
          : undefined,
        initial_stuck: ["결과 예상", "이유 설명", "문제 이해", "어려움 없음"][
          studentIndex % 4
        ],
        initial_note:
          studentIndex % 3 === 0
            ? lesson.followup
            : "다른 조건에서도 같은 설명이 되는지 확인하고 싶어요.",
        difficult: state === "needs_more_reason",
      };
      records.push(row);
      if (studentIndex < 6 || state === "completed")
        space.feedback.push({
          id: `demo-feedback-${f.id}-${studentIndex}`,
          student_id: student.id,
          record_id: id,
          body: `【발표용 예시 피드백】 ${rewritten ? "처음 생각과 비교한 설명을 잘 남겼어요. ‘" + reflection + "’라고 돌아본 점이 좋아요. 이제 새 사례에서도 같은 조건을 비교해 보세요." : "네가 어떤 조건을 보고 예상했는지 읽어 보았어요. " + lesson.followup + " 관찰한 사실과 예상이 만나는 부분을 한 문장으로 남겨 주세요."}`,
          read_at:
            studentIndex % 3 === 0
              ? null
              : sampleTime(lessonIndex, studentIndex, 30),
          created_at: sampleTime(lessonIndex, studentIndex, 25),
        });
      if (studentIndex < 4 || studentIndex % 5 === lessonIndex % 5)
        space.chats.push({
          id: `demo-chat-${f.id}-${studentIndex}`,
          student_id: student.id,
          room: "course",
          question: f.question,
          answer: `【준비된 예시 답변 · 실시간 AI 아님】 ${f.revision} ${lesson.followup}`,
          status: "sample",
          created_at: sampleTime(lessonIndex, studentIndex, 15),
          sources: [
            {
              title: materials[0].title,
              section: materials[0].section,
              quote: f.concept.split(". ")[0] + ".",
            },
          ],
        });
    });
    const topicId = `demo-topic-${f.id}`;
    space.topics.push({
      id: topicId,
      title: lesson.followup,
      unit: lesson.tag,
      created_at: sampleTime(lessonIndex, 0),
    });
    [
      f.discussion,
      f.discussionReply,
      `처음에는 ‘${f.predictions[0]}’라고 생각했어요. ${f.note} 다음에는 바꾼 조건과 그대로 둔 조건을 나누어 적어 볼래요.`,
    ].forEach((body, j) => {
      const student = demoStudents[(lessonIndex * 2 + j) % 24];
      space.posts.push({
        id: `demo-post-${f.id}-${j}`,
        topic_id: topicId,
        parent_id: null,
        author: student.alias,
        author_id: student.id,
        mine: false,
        is_teacher: false,
        body,
        likes: 0,
        liked: false,
        liked_by: demoStudents.slice(10, 13 + j).map((s) => s.id),
        created_at: sampleTime(lessonIndex, j, 35),
      });
    });
    space.posts.push({
      id: `demo-reply-${f.id}-teacher`,
      topic_id: topicId,
      parent_id: `demo-post-${f.id}-0`,
      author: "과학 선생님",
      author_id: DEMO_TEACHER_ID,
      mine: false,
      is_teacher: true,
      body: `좋은 비교 질문이에요. ${lesson.followup} 답을 고르기 전에 어떤 조건을 바꿀지 친구들과 하나씩 정해 보세요.`,
      likes: 0,
      liked: false,
      liked_by: [],
      created_at: sampleTime(lessonIndex, 2, 40),
    });
    space.posts.push({
      id: `demo-reply-${f.id}-student`,
      topic_id: topicId,
      parent_id: `demo-post-${f.id}-0`,
      author: demoStudents[0].alias,
      author_id: demoStudents[0].id,
      mine: false,
      is_teacher: false,
      body: f.discussionReply,
      likes: 0,
      liked: false,
      liked_by: [demoStudents[3].id, demoStudents[4].id],
      created_at: sampleTime(lessonIndex, 3, 42),
    });
  });
  // External links verified against official pages on 2026-09-18. Excerpts above are our own lesson notes.
  for (const student of demoStudents.slice(0, 4))
    space.chats.push({
      id: `demo-chat-external-${student.id}`,
      student_id: student.id,
      room: "external",
      question: "다른 물체의 밀도도 직접 바꿔 볼 수 있나요?",
      answer:
        "【준비된 예시 안내 · 실시간 검색 아님】 PhET의 Density 활동에서 질량과 부피를 비교하며 물체가 뜨는 조건을 탐색할 수 있어요. 아래 공식 교육 자료에서 바꾼 조건과 관찰한 결과를 각각 기록해 보세요.",
      status: "sample",
      created_at: sampleTime(0, 0, 45),
      sources: [
        {
          title: "PhET · Density (공식 시뮬레이션)",
          url: "https://phet.colorado.edu/en/simulations/density",
        },
      ],
    });
  space.chats.push({
    id: "demo-chat-external-moon",
    student_id: demoStudents[0].id,
    room: "external",
    question: "달의 위상을 그림으로 더 보고 싶어요.",
    answer:
      "【준비된 예시 안내 · 실시간 검색 아님】 NASA의 Moon Phases 자료에는 태양빛을 받는 달의 부분과 지구에서 보이는 모양을 설명하는 그림이 있어요. 평소 위상 변화와 월식의 조건을 구별해 보세요.",
    status: "sample",
    created_at: sampleTime(5, 0, 45),
    sources: [
      {
        title: "NASA Science · Moon Phases",
        url: "https://science.nasa.gov/moon/moon-phases/",
      },
    ],
  });
  return { schema: DEMO_SCHEMA, records, space };
}
