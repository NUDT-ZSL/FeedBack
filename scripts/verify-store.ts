/**
 * 统一批量验证入口：npm run verify
 * 覆盖验收点：
 *  1. 点赞归属跨视图一致且幂等（重复触发不累加）
 *  2. 进度与状态联动（已读 100% 切回在读不再矛盾）
 *  3. 热门排序稳定（相同输入多次读取一致，并列名次不跳变）
 *  4. getReviewsByBookId 派生结果引用稳定
 *  5. 既有路径回归（搜索、加书架、写短评、切页）
 */
import { useBookStore } from '../src/store/useBookStore';
import type { Review } from '../src/types';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name} ${detail}`);
  }
}

const store = useBookStore;
const get = () => store.getState();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[1] 点赞归属：跨视图一致且幂等');
  const top = get().getTopReviews();
  check('热门列表非空', top.length > 0);
  const target = top[0];
  const before = target.likes;
  get().likeReview(target.id);
  const afterOnce = get().reviews.find(r => r.id === target.id)!;
  check('点赞一次计数 +1', afterOnce.likes === before + 1, `before=${before} after=${afterOnce.likes}`);
  check('isReviewLiked 为 true', get().isReviewLiked(target.id));
  get().likeReview(target.id);
  get().likeReview(target.id);
  const afterRepeat = get().reviews.find(r => r.id === target.id)!;
  check('重复触发不再累加', afterRepeat.likes === before + 1);
  const shelfView = get().getReviewsByBookId(target.bookId).find(r => r.id === target.id)!;
  check('书架视图计数一致', shelfView.likes === before + 1);
  check('书架视图已点赞状态一致', get().isReviewLiked(target.id));

  console.log('[2] 进度与状态联动');
  const reading = get().userBooks.find(ub => ub.status === 'reading')!;
  const ub = () => get().userBooks.find(u => u.id === reading.id)!;
  get().updateBookProgress(reading.id, 100);
  check('进度写满 100 自动置已读', ub().status === 'finished' && ub().progress === 100);
  get().updateBookStatus(reading.id, 'reading');
  check('已读切回在读进度不再矛盾', ub().status === 'reading' && ub().progress < 100, JSON.stringify(ub()));
  get().updateBookStatus(reading.id, 'finished');
  check('切已读进度置 100', ub().progress === 100);
  get().updateBookProgress(reading.id, 40);
  check('已读改回 100 以下自动回在读', ub().status === 'reading' && ub().progress === 40);
  get().updateBookStatus(reading.id, 'unread');
  check('切未读进度归零', ub().progress === 0);
  get().updateBookProgress(reading.id, 150);
  check('进度钳制到 100 并置已读', ub().progress === 100 && ub().status === 'finished');

  console.log('[3] 热门排序稳定性与并列名次');
  const originalReviews = get().reviews;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const mk = (id: string, likes: number, createdAt: number): Review => ({
    id, bookId: 'book-1', content: 'x'.repeat(60), rating: 5, likes, createdAt,
  });
  const controlled: Review[] = [
    mk('r-old', 999, now - 10 * day),
    mk('r-c', 50, now - 2 * day),
    mk('r-a', 50, now - 1 * day),
    mk('r-b', 50, now - 2 * day),
    mk('r-d', 80, now - 3 * day),
  ];
  store.setState({ reviews: controlled, likedReviewIds: [] });
  const t1 = get().getTopReviews();
  const t2 = get().getTopReviews();
  check('相同输入多次读取返回同一引用', t1 === t2);
  check('超过 7 天的评论被过滤', !t1.some(r => r.id === 'r-old'));
  const ids = t1.map(r => r.id);
  check('名次确定且并列不跳变', JSON.stringify(ids) === JSON.stringify(['r-d', 'r-a', 'r-b', 'r-c']), ids.join(','));
  store.setState({ reviews: controlled.map(r => ({ ...r })) });
  const t3 = get().getTopReviews();
  check('缓存失效重算后顺序仍稳定', JSON.stringify(t3.map(r => r.id)) === JSON.stringify(ids));
  check('重算后返回新引用', t3 !== t1);
  store.setState({ reviews: originalReviews });
  console.log('[4] getReviewsByBookId 引用稳定');
  const bookId = get().reviews[0].bookId;
  const l1 = get().getReviewsByBookId(bookId);
  check('同一批数据返回同一引用', get().getReviewsByBookId(bookId) === l1);
  get().setSearchKeyword('测试');
  check('无关状态变化后引用仍稳定', get().getReviewsByBookId(bookId) === l1);
  get().setSearchKeyword('');
  const likeTarget = l1[0];
  get().likeReview(likeTarget.id);
  const l3 = get().getReviewsByBookId(bookId);
  check('reviews 变化后返回新引用', l3 !== l1);
  check('新引用内容已同步', l3.find(r => r.id === likeTarget.id)!.likes === likeTarget.likes + 1);

  console.log('[5] 既有路径回归');
  check('空关键字搜索返回空', get().searchBooks('   ').length === 0);
  const firstBook = get().allBooks[0];
  check('按书名搜索命中', get().searchBooks(firstBook.title).some(b => b.id === firstBook.id));
  const ubCount = get().userBooks.length;
  const notInShelf = get().allBooks.find(b => !get().userBooks.some(u => u.bookId === b.id));
  if (notInShelf) {
    get().addToShelf(notInShelf.id);
    const added = get().userBooks.find(u => u.bookId === notInShelf.id)!;
    check('加书架成功且初始 unread/0', !!added && added.status === 'unread' && added.progress === 0);
    get().addToShelf(notInShelf.id);
    check('重复加书架不产生重复', get().userBooks.length === ubCount + 1);
  } else {
    check('存在未上架书籍用于验证', false, '所有书都已在书架');
  }
  const reviewCount = get().reviews.length;
  get().addReview(firstBook.id, '验'.repeat(60), 4);
  check('写短评后总数 +1', get().reviews.length === reviewCount + 1);
  check('新短评出现在该书评论首位', get().getReviewsByBookId(firstBook.id)[0].rating === 4);
  get().setCurrentPage('community');
  check('切页中 pageTransition 为 true', get().pageTransition === true);
  await sleep(400);
  check('切页完成', get().currentPage === 'community' && get().pageTransition === false);
  get().setCurrentPage('shelf');
  await sleep(400);

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main();
