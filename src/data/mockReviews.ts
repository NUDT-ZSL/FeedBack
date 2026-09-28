import type { Review } from '../types';

const reviewContents = [
  '这本书真的太棒了！作者的文笔非常优美，故事情节扣人心弦，让我一读就停不下来。强烈推荐给所有喜欢文学的朋友。',
  '读完这本书，我深受启发。作者对人性的洞察非常深刻，让我对生活有了新的思考。值得反复阅读的经典之作。',
  '非常实用的一本书，书中的方法和建议都很接地气。我已经开始按照书中的方法实践，效果非常明显。',
  '这本书改变了我的世界观。作者的视野非常开阔，让我看到了一个完全不同的世界。强烈推荐给每一个人。',
  '作者的想象力太丰富了！书中描绘的未来世界让人既向往又恐惧。科幻迷绝对不能错过的好书。',
  '这是我今年读过的最好的书。故事情节跌宕起伏，人物形象栩栩如生。读完之后久久不能平静。',
  '非常有深度的一本书，需要静下心来慢慢品读。每读一遍都有新的收获，值得珍藏。',
  '作者的写作风格非常独特，文字简洁有力，却蕴含着深刻的哲理。读来让人回味无穷。',
  '这本书解答了我很多困惑已久的问题。作者的见解非常独到，让人茅塞顿开。',
  '很长的一本书，但是读起来丝毫不觉得枯燥。作者的叙事能力太强了，把复杂的历史讲得生动有趣。',
  '这本书让我重新认识了这个世界。作者的分析非常透彻，让我看到了事物背后的本质。',
  '非常温暖的一本书，读完之后感觉整个人都被治愈了。适合在心情不好的时候阅读。',
  '这本书的信息量非常大，需要慢慢消化。但是每一个知识点都让人受益匪浅。',
  '作者的勇气和智慧让人钦佩。这本书不仅是一本自传，更是一本人生智慧的宝典。',
  '读完这本书，我决定开始改变自己。书中的力量太强大了，给了我很多勇气。',
  '这是一本需要带着思考去读的书。作者提出的问题很有启发性，让人不断反思。',
  '这本书的结构非常精巧，前后呼应，伏笔连连。读到最后才恍然大悟，叹为观止。',
  '非常专业的一本书，但是作者用通俗易懂的语言讲清楚了复杂的概念。入门者必读。',
  '这本书让我对这个领域有了全新的认识。作者的观点非常新颖，让人耳目一新。',
  '读完这本书，我买了作者的所有其他作品。真的太喜欢作者的写作风格了。',
];

function generateMockReviews(count: number, bookCount: number): Review[] {
  const reviews: Review[] = [];
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const isRecent = Math.random() > 0.3;
    const createdAt = isRecent
      ? sevenDaysAgo + Math.floor(Math.random() * (now - sevenDaysAgo))
      : now - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000);

    reviews.push({
      id: `review-${i + 1}`,
      bookId: `book-${Math.floor(Math.random() * bookCount) + 1}`,
      content: reviewContents[i % reviewContents.length],
      rating: 3 + Math.floor(Math.random() * 3),
      likes: isRecent ? Math.floor(Math.random() * 200) : Math.floor(Math.random() * 50),
      createdAt,
    });
  }

  return reviews.sort((a, b) => b.createdAt - a.createdAt);
}

export const mockReviews: Review[] = generateMockReviews(150, 200);
