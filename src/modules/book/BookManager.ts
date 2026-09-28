export type BookCategory = '小说' | '非小说' | '儿童' | '科技';

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string;
  price: number;
  category: BookCategory;
  stock: number;
  createdAt: number;
}

const STORAGE_KEY = 'bookstore_books';

const seedBooks: Book[] = [
  {
    id: 'b1',
    title: '百年孤独',
    author: '加西亚·马尔克斯',
    isbn: '9787544253994',
    price: 55.0,
    category: '小说',
    stock: 20,
    createdAt: Date.now() - 86400000 * 30,
  },
  {
    id: 'b2',
    title: '人类简史',
    author: '尤瓦尔·赫拉利',
    isbn: '9787508647357',
    price: 68.0,
    category: '非小说',
    stock: 15,
    createdAt: Date.now() - 86400000 * 25,
  },
  {
    id: 'b3',
    title: '小王子',
    author: '圣埃克苏佩里',
    isbn: '9787020042494',
    price: 32.0,
    category: '儿童',
    stock: 30,
    createdAt: Date.now() - 86400000 * 20,
  },
  {
    id: 'b4',
    title: '深入理解计算机系统',
    author: 'Randal E. Bryant',
    isbn: '9787111544937',
    price: 139.0,
    category: '科技',
    stock: 8,
    createdAt: Date.now() - 86400000 * 15,
  },
  {
    id: 'b5',
    title: '活着',
    author: '余华',
    isbn: '9787506365437',
    price: 39.0,
    category: '小说',
    stock: 25,
    createdAt: Date.now() - 86400000 * 10,
  },
  {
    id: 'b6',
    title: '思考，快与慢',
    author: '丹尼尔·卡尼曼',
    isbn: '9787508633558',
    price: 69.0,
    category: '非小说',
    stock: 12,
    createdAt: Date.now() - 86400000 * 8,
  },
  {
    id: 'b7',
    title: '安徒生童话',
    author: '安徒生',
    isbn: '9787020042516',
    price: 45.0,
    category: '儿童',
    stock: 3,
    createdAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'b8',
    title: '算法导论',
    author: 'Thomas H. Cormen',
    isbn: '9787111407010',
    price: 128.0,
    category: '科技',
    stock: 6,
    createdAt: Date.now() - 86400000 * 3,
  },
  {
    id: 'b9',
    title: '三体',
    author: '刘慈欣',
    isbn: '9787536692930',
    price: 23.0,
    category: '小说',
    stock: 50,
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'b10',
    title: '时间简史',
    author: '史蒂芬·霍金',
    isbn: '9787535732309',
    price: 45.0,
    category: '科技',
    stock: 4,
    createdAt: Date.now() - 86400000 * 1,
  },
];

export class BookManager {
  private books: Book[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        this.books = JSON.parse(saved);
      } catch {
        this.books = [...seedBooks];
        this.saveToStorage();
      }
    } else {
      this.books = [...seedBooks];
      this.saveToStorage();
    }
  }

  private saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.books));
  }

  private generateId(): string {
    return 'b_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  addBook(book: Omit<Book, 'id' | 'createdAt'>): Book {
    const newBook: Book = {
      ...book,
      id: this.generateId(),
      createdAt: Date.now(),
    };
    this.books.push(newBook);
    this.saveToStorage();
    return newBook;
  }

  getBookById(id: string): Book | undefined {
    return this.books.find((b) => b.id === id);
  }

  getAllBooks(): Book[] {
    return [...this.books];
  }

  updateBook(id: string, updates: Partial<Omit<Book, 'id' | 'createdAt'>>): Book | undefined {
    const index = this.books.findIndex((b) => b.id === id);
    if (index === -1) return undefined;
    this.books[index] = { ...this.books[index], ...updates };
    this.saveToStorage();
    return { ...this.books[index] };
  }

  deleteBook(id: string): boolean {
    const index = this.books.findIndex((b) => b.id === id);
    if (index === -1) return false;
    this.books.splice(index, 1);
    this.saveToStorage();
    return true;
  }

  updateStock(id: string, delta: number): Book | undefined {
    const book = this.getBookById(id);
    if (!book) return undefined;
    const newStock = book.stock + delta;
    if (newStock < 0) return undefined;
    return this.updateBook(id, { stock: newStock });
  }

  filterByCategory(category: BookCategory): Book[] {
    return this.books.filter((b) => b.category === category);
  }

  searchByKeyword(keyword: string): Book[] {
    const lowerKeyword = keyword.toLowerCase().trim();
    if (!lowerKeyword) return this.getAllBooks();
    return this.books.filter(
      (b) =>
        b.title.toLowerCase().includes(lowerKeyword) ||
        b.isbn.toLowerCase().includes(lowerKeyword) ||
        b.author.toLowerCase().includes(lowerKeyword)
    );
  }

  getLowStockBooks(threshold: number = 5): Book[] {
    return this.books.filter((b) => b.stock < threshold);
  }
}
