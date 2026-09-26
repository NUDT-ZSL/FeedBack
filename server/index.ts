import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { Event, QuizQuestion } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());

const events = new Map<string, Event>();

const seedEvents: Event[] = [
  {
    id: uuidv4(),
    title: "古埃及金字塔建造",
    date: "-2560-01-01",
    description:
      "古埃及人在吉萨高原建造了举世闻名的大金字塔，这是古代世界七大奇迹中唯一留存至今的建筑。胡夫金字塔高达146米，由约230万块石灰岩堆砌而成，展现了古埃及卓越的工程技术和组织能力。",
    imageUrl:
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Great%20Pyramid%20of%20Giza%20ancient%20Egypt%20desert%20sunset&image_size=landscape_16_9",
    questions: [
      {
        id: uuidv4(),
        question: "吉萨大金字塔是为哪位法老建造的？",
        options: ["胡夫", "哈夫拉", "图坦卡蒙", "拉美西斯二世"],
        correctAnswer: 0,
      },
      {
        id: uuidv4(),
        question: "大金字塔约由多少块石灰岩构成？",
        options: ["50万块", "100万块", "230万块", "500万块"],
        correctAnswer: 2,
      },
    ],
  },
  {
    id: uuidv4(),
    title: "古希腊雅典民主制",
    date: "-0508-01-01",
    description:
      "雅典的克利斯提尼改革确立了民主制度，开创了人类政治文明的先河。公民通过公民大会直接参与城邦决策，五百人议事会负责日常行政事务，这一制度深刻影响了后世的民主理念与实践。",
    imageUrl:
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Ancient%20Greek%20Athenian%20democracy%20Acropolis%20Parthenon&image_size=landscape_16_9",
    questions: [
      {
        id: uuidv4(),
        question: "雅典民主制是由谁改革确立的？",
        options: ["伯里克利", "梭伦", "克利斯提尼", "亚里士多德"],
        correctAnswer: 2,
      },
      {
        id: uuidv4(),
        question: "雅典民主制中负责日常行政的机构是什么？",
        options: ["公民大会", "五百人议事会", "元老院", "陪审法庭"],
        correctAnswer: 1,
      },
    ],
  },
  {
    id: uuidv4(),
    title: "秦始皇统一中国",
    date: "-0221-01-01",
    description:
      "秦始皇嬴政灭六国，建立了中国历史上第一个大一统的中央集权王朝——秦朝。他统一文字、度量衡和货币，修建万里长城，奠定了中华文明统一格局的基础，对后世影响深远。",
    imageUrl:
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Qin%20Dynasty%20Great%20Wall%20China%20ancient%20emperor&image_size=landscape_16_9",
    questions: [
      {
        id: uuidv4(),
        question: "秦始皇统一中国是在哪一年？",
        options: ["公元前256年", "公元前221年", "公元前206年", "公元前202年"],
        correctAnswer: 1,
      },
      {
        id: uuidv4(),
        question: "以下哪项不是秦始皇推行的统一措施？",
        options: ["统一文字", "统一度量衡", "统一货币", "统一服饰"],
        correctAnswer: 3,
      },
      {
        id: uuidv4(),
        question: "秦朝是中国历史上什么性质的王朝？",
        options: [
          "第一个分封制王朝",
          "第一个大一统中央集权王朝",
          "最后一个奴隶制王朝",
          "第一个封建割据王朝",
        ],
        correctAnswer: 1,
      },
    ],
  },
  {
    id: uuidv4(),
    title: "文艺复兴",
    date: "1400-01-01",
    description:
      "文艺复兴运动发源于意大利，标志着欧洲从中世纪向近代的转型。达芬奇、米开朗基罗等大师在艺术与科学领域创造了不朽杰作，人文主义思想深入人心，推动了对古典文化的重新发现与创造。",
    imageUrl:
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Italian%20Renaissance%20Florence%20art%20painting%20classical&image_size=landscape_16_9",
    questions: [
      {
        id: uuidv4(),
        question: "文艺复兴运动发源于哪个国家？",
        options: ["法国", "英国", "意大利", "德国"],
        correctAnswer: 2,
      },
      {
        id: uuidv4(),
        question: "文艺复兴的核心思想是什么？",
        options: ["神权主义", "人文主义", "禁欲主义", "经院哲学"],
        correctAnswer: 1,
      },
    ],
  },
  {
    id: uuidv4(),
    title: "工业革命",
    date: "1760-01-01",
    description:
      "工业革命率先在英国兴起，蒸汽机的发明与应用彻底改变了生产方式。工厂制度取代手工作坊，铁路与蒸汽船缩短了时空距离，人类社会从农业时代迈入工业时代，生产力实现了前所未有的飞跃。",
    imageUrl:
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Industrial%20Revolution%20steam%20engine%20factory%20Victorian&image_size=landscape_16_9",
    questions: [
      {
        id: uuidv4(),
        question: "工业革命率先在哪个国家兴起？",
        options: ["法国", "德国", "美国", "英国"],
        correctAnswer: 3,
      },
      {
        id: uuidv4(),
        question: "工业革命中最具标志性的发明是什么？",
        options: ["电灯", "蒸汽机", "电话", "内燃机"],
        correctAnswer: 1,
      },
    ],
  },
  {
    id: uuidv4(),
    title: "法国大革命",
    date: "1789-01-01",
    description:
      "1789年巴黎民众攻占巴士底狱，法国大革命爆发。革命推翻了波旁王朝的专制统治，发表了《人权宣言》，确立了自由、平等、博爱的原则，深刻影响了世界政治格局和现代民主制度的发展。",
    imageUrl:
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=French%20Revolution%20Bastille%20Paris%201789%20painting&image_size=landscape_16_9",
    questions: [
      {
        id: uuidv4(),
        question: "法国大革命爆发的标志性事件是什么？",
        options: [
          "网球场宣誓",
          "攻占巴士底狱",
          "处决路易十六",
          "拿破仑政变",
        ],
        correctAnswer: 1,
      },
      {
        id: uuidv4(),
        question: "法国大革命的核心原则是什么？",
        options: [
          "自由、平等、博爱",
          "秩序、权威、传统",
          "和平、发展、合作",
          "独立、自主、富强",
        ],
        correctAnswer: 0,
      },
      {
        id: uuidv4(),
        question: "法国大革命推翻了哪个王朝的统治？",
        options: ["都铎王朝", "哈布斯堡王朝", "波旁王朝", "罗曼诺夫王朝"],
        correctAnswer: 2,
      },
    ],
  },
  {
    id: uuidv4(),
    title: "第二次世界大战结束",
    date: "1945-01-01",
    description:
      "1945年，盟军在欧洲和太平洋战场取得全面胜利，第二次世界大战终结。这场人类历史上规模最大的战争造成了巨大伤亡，也催生了联合国等国际组织，世界格局由此进入冷战时代。",
    imageUrl:
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=World%20War%20II%20victory%201945%20peace%20celebration&image_size=landscape_16_9",
    questions: [
      {
        id: uuidv4(),
        question: "第二次世界大战结束后成立了哪个国际组织？",
        options: ["国际联盟", "联合国", "欧洲联盟", "北约"],
        correctAnswer: 1,
      },
      {
        id: uuidv4(),
        question: "二战结束后世界进入了什么时代？",
        options: ["殖民时代", "冷战时代", "工业化时代", "帝国时代"],
        correctAnswer: 1,
      },
    ],
  },
  {
    id: uuidv4(),
    title: "互联网时代",
    date: "1990-01-01",
    description:
      "万维网的发明与普及开启了互联网时代，信息传播方式发生了革命性变化。电子邮件、社交媒体和电子商务重塑了人们的生活与工作方式，全球化进程加速推进，世界真正成为了地球村。",
    imageUrl:
      "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Internet%20age%20digital%20network%20global%20connection%20technology&image_size=landscape_16_9",
    questions: [
      {
        id: uuidv4(),
        question: "万维网是由谁发明的？",
        options: [
          "比尔·盖茨",
          "蒂姆·伯纳斯-李",
          "史蒂夫·乔布斯",
          "文顿·瑟夫",
        ],
        correctAnswer: 1,
      },
      {
        id: uuidv4(),
        question: "互联网时代最显著的社会变化是什么？",
        options: [
          "农业机械化",
          "信息传播方式革命",
          "手工业复兴",
          "城市化减缓",
        ],
        correctAnswer: 1,
      },
      {
        id: uuidv4(),
        question: "互联网时代将世界比作什么？",
        options: ["大熔炉", "地球村", "角斗场", "百花园"],
        correctAnswer: 1,
      },
    ],
  },
];

for (const event of seedEvents) {
  events.set(event.id, event);
}

app.get("/api/events", (_req, res) => {
  const sorted = Array.from(events.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  res.json(sorted);
});

app.post("/api/events", (req, res) => {
  const { title, date, description, imageUrl, questions } = req.body as Omit<
    Event,
    "id"
  >;
  const newEvent: Event = {
    id: uuidv4(),
    title,
    date,
    description,
    imageUrl,
    questions: (questions as QuizQuestion[]).map((q) => ({
      ...q,
      id: q.id || uuidv4(),
    })),
  };
  events.set(newEvent.id, newEvent);
  res.status(201).json(newEvent);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
