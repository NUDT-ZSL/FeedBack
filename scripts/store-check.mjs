import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, received ${actual})`);
}

const tempDir = mkdtempSync(join(tmpdir(), 'book-store-check-'));
const bundlePath = join(tempDir, 'store.mjs');

try {
  await build({
    entryPoints: ['src/store/useBookStore.ts'],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });

  const { useBookStore } = await import(pathToFileURL(bundlePath).href);
  const store = useBookStore.getState();
  const now = Date.now();

  const reviews = [
    { id: 'review-like', bookId: 'book-1', content: '需要被两个视图共享的短评内容', rating: 5, likes: 10, createdAt: now - 1000 },
    { id: 'review-tie-a', bookId: 'book-2', content: '并列排序短评甲', rating: 4, likes: 5, createdAt: now - 2000 },
    { id: 'review-tie-b', bookId: 'book-3', content: '并列排序短评乙', rating: 4, likes: 5, createdAt: now - 2000 },
    { id: 'review-tie-c', bookId: 'book-4', content: '并列排序短评丙', rating: 4, likes: 5, createdAt: now - 2000 },
    { id: 'review-order-a', bookId: 'book-cache', content: '同书较早短评', rating: 4, likes: 0, createdAt: now - 3000 },
    { id: 'review-order-b', bookId: 'book-cache', content: '同书较新短评', rating: 5, likes: 0, createdAt: now - 2500 },
    { id: 'review-old', bookId: 'book-5', content: '超出热门窗口的短评', rating: 5, likes: 100, createdAt: now - 8 * 24 * 60 * 60 * 1000 },
  ];

  useBookStore.setState({
    userBooks: [
      { id: 'user-progress', bookId: 'book-1', status: 'reading', progress: 100, addedAt: now },
      { id: 'user-unread', bookId: 'book-2', status: 'unread', progress: 0, addedAt: now },
    ],
    reviews,
  });

  store.likeReview('review-like');
  store.likeReview('review-like');
  const likedAfterRepeat = useBookStore.getState().reviews.find((review) => review.id === 'review-like');
  assertEqual(likedAfterRepeat.likes, 11, '重复点赞不能累加计数');
  assert(store.isReviewLiked('review-like'), '点赞归属必须由 store 记录');

  const shelfReview = store.getReviewsByBookId('book-1')[0];
  const topReview = store.getTopReviews().find((review) => review.id === 'review-like');
  assertEqual(shelfReview.likes, 11, '书架侧查询必须立即读到新计数');
  assertEqual(topReview.likes, 11, '社区侧热门查询必须立即读到新计数');
  assert(store.isReviewLiked(shelfReview.id), '书架侧必须读到已点赞状态');
  assert(store.isReviewLiked(topReview.id), '社区侧必须读到已点赞状态');

  const bookReviewsFirst = store.getReviewsByBookId('book-cache');
  const bookReviewsSecond = store.getReviewsByBookId('book-cache');
  assert(bookReviewsFirst === bookReviewsSecond, '同一渲染周期必须复用同书短评缓存');
  assertEqual(bookReviewsFirst[0].id, 'review-order-b', '同书短评必须按创建时间倒序');

  const topFirst = store.getTopReviews();
  await wait(10);
  const topSecond = store.getTopReviews();
  assert(topFirst === topSecond, '热门列表不能因重复读取和当前时间变化而重建');
  assertEqual(topSecond[0].id, 'review-like', '最高赞短评必须排在首位');
  assertEqual(topSecond[1].id, 'review-tie-c', '并列第一名的首个次序必须稳定');
  assertEqual(topSecond[2].id, 'review-tie-b', '并列第二名的次序必须稳定');
  assertEqual(topSecond[3].id, 'review-tie-a', '并列第三名的次序必须稳定');
  assert(!topSecond.some((review) => review.id === 'review-old'), '热门窗口外的短评不能进入榜单');

  store.updateBookStatus('user-progress', 'finished');
  let progressBook = useBookStore.getState().userBooks[0];
  assertEqual(progressBook.status, 'finished', '在读进度 100 可切换为已读');
  assertEqual(progressBook.progress, 100, '已读状态进度必须为 100');
  store.updateBookStatus('user-progress', 'reading');
  progressBook = useBookStore.getState().userBooks[0];
  assertEqual(progressBook.status, 'reading', '必须能从已读切回在读');
  assert(progressBook.progress < 100, '切回在读后不能保留 100% 进度');

  store.updateBookProgress('user-progress', 45);
  store.updateBookStatus('user-progress', 'finished');
  store.updateBookStatus('user-progress', 'reading');
  progressBook = useBookStore.getState().userBooks[0];
  assertEqual(progressBook.progress, 45, '再次切回在读应恢复标记已读之前的进度');

  store.updateBookProgress('user-unread', 30);
  let unreadBook = useBookStore.getState().userBooks[1];
  assertEqual(unreadBook.status, 'reading', '未读书籍设置正进度后应自动成为在读');
  assertEqual(unreadBook.progress, 30, '新进度必须生效');

  store.updateBookProgress('user-unread', 120);
  unreadBook = useBookStore.getState().userBooks[1];
  assertEqual(unreadBook.status, 'finished', '进度达到 100 后应自动成为已读');
  assertEqual(unreadBook.progress, 100, '进度必须被限制在 100');

  const searchResult = store.searchBooks('苏东坡传');
  assert(searchResult.length > 0, '既有搜索路径必须保留');
  const beforeAdd = useBookStore.getState().userBooks.length;
  store.addToShelf(searchResult[0].id);
  store.addToShelf(searchResult[0].id);
  assertEqual(useBookStore.getState().userBooks.length, beforeAdd + 1, '重复加入书架必须幂等');

  const beforeReviews = useBookStore.getState().reviews.length;
  store.addReview(searchResult[0].id, '这是一条用于验证既有发布路径的全新短评，长度满足页面要求。', 5);
  const afterReviews = useBookStore.getState().reviews;
  assertEqual(afterReviews.length, beforeReviews + 1, '发布短评后必须新增一条记录');
  assertEqual(store.getReviewsByBookId(searchResult[0].id)[0].rating, 5, '新短评必须能按书查询到');

  store.setSearchKeyword('苏东坡传');
  assertEqual(useBookStore.getState().searchKeyword, '苏东坡传', '搜索关键字动作必须保留');
  store.setCurrentPage('community');
  assertEqual(useBookStore.getState().pageTransition, true, '切页过渡状态必须保留');
  await wait(350);
  assertEqual(useBookStore.getState().currentPage, 'community', '既有切页路径必须保留');
  assertEqual(useBookStore.getState().pageTransition, false, '切页完成后必须清除过渡状态');

  console.log(`store checks passed: ${passed}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
