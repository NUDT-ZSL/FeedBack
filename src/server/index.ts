import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { Book, Note } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;

app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const BOOKS_FILE = path.join(DATA_DIR, 'books.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.json');

function readJSON<T>(filePath: string): T[] {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeJSON<T>(filePath: string, data: T[]): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BOOKS_FILE)) writeJSON(BOOKS_FILE, []);
if (!fs.existsSync(NOTES_FILE)) writeJSON(NOTES_FILE, []);

app.get('/api/books/search', async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.json([]);
  try {
    const response = await axios.get(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10`
    );
    const results = response.data.docs.map((doc: any) => ({
      title: doc.title || '',
      author: doc.author_name ? doc.author_name[0] : '',
      coverUrl: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : '',
      publishYear: doc.first_publish_year ? String(doc.first_publish_year) : '',
      olid: doc.key ? doc.key.replace('/works/', '') : '',
    }));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search books' });
  }
});

app.get('/api/books', (_req, res) => {
  const books = readJSON<Book>(BOOKS_FILE);
  res.json(books);
});

app.post('/api/books', (req, res) => {
  const books = readJSON<Book>(BOOKS_FILE);
  const newBook: Book = {
    id: uuidv4(),
    title: req.body.title,
    author: req.body.author,
    coverUrl: req.body.coverUrl,
    publishYear: req.body.publishYear,
    olid: req.body.olid,
    progress: 0,
    addedAt: new Date().toISOString(),
  };
  books.push(newBook);
  writeJSON(BOOKS_FILE, books);
  res.json(newBook);
});

app.patch('/api/books/:id', (req, res) => {
  const books = readJSON<Book>(BOOKS_FILE);
  const index = books.findIndex((b) => b.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Book not found' });
  books[index] = { ...books[index], ...req.body, id: books[index].id, addedAt: books[index].addedAt };
  writeJSON(BOOKS_FILE, books);
  res.json(books[index]);
});

app.delete('/api/books/:id', (req, res) => {
  let books = readJSON<Book>(BOOKS_FILE);
  books = books.filter((b) => b.id !== req.params.id);
  writeJSON(BOOKS_FILE, books);
  let notes = readJSON<Note>(NOTES_FILE);
  notes = notes.filter((n) => n.bookId !== req.params.id);
  writeJSON(NOTES_FILE, notes);
  res.json({ success: true });
});

app.get('/api/notes', (req, res) => {
  const notes = readJSON<Note>(NOTES_FILE);
  const bookId = req.query.bookId as string;
  if (bookId) {
    res.json(notes.filter((n) => n.bookId === bookId));
  } else {
    res.json(notes);
  }
});

app.post('/api/notes', (req, res) => {
  const notes = readJSON<Note>(NOTES_FILE);
  const newNote: Note = {
    id: uuidv4(),
    bookId: req.body.bookId,
    highlightText: req.body.highlightText || '',
    thought: req.body.thought || '',
    tags: req.body.tags || [],
    pageNumber: req.body.pageNumber || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  notes.push(newNote);
  writeJSON(NOTES_FILE, notes);
  res.json(newNote);
});

app.put('/api/notes/:id', (req, res) => {
  const notes = readJSON<Note>(NOTES_FILE);
  const index = notes.findIndex((n) => n.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Note not found' });
  notes[index] = {
    ...notes[index],
    ...req.body,
    id: notes[index].id,
    bookId: notes[index].bookId,
    createdAt: notes[index].createdAt,
    updatedAt: new Date().toISOString(),
  };
  writeJSON(NOTES_FILE, notes);
  res.json(notes[index]);
});

app.delete('/api/notes/:id', (req, res) => {
  let notes = readJSON<Note>(NOTES_FILE);
  notes = notes.filter((n) => n.id !== req.params.id);
  writeJSON(NOTES_FILE, notes);
  res.json({ success: true });
});

app.get('/api/export', (_req, res) => {
  const books = readJSON<Book>(BOOKS_FILE);
  const notes = readJSON<Note>(NOTES_FILE);
  const grouped: Record<string, Note[]> = {};
  notes.forEach((n) => {
    if (!grouped[n.bookId]) grouped[n.bookId] = [];
    grouped[n.bookId].push(n);
  });

  const parts: string[] = [];
  books.forEach((book) => {
    const bookNotes = grouped[book.id] || [];
    if (bookNotes.length === 0) return;
    parts.push(`# ${book.title} - ${book.author}\n`);
    bookNotes.forEach((note) => {
      parts.push(`## 第 ${note.pageNumber} 页\n`);
      if (note.highlightText) {
        parts.push(`> ${note.highlightText}\n`);
      }
      if (note.thought) {
        parts.push(`${note.thought}\n`);
      }
      if (note.tags.length) {
        parts.push(`标签: ${note.tags.join(', ')}\n`);
      }
      parts.push('---\n');
    });
  });

  const markdown = parts.join('\n');
  const files: { filename: string; content: string }[] = [];
  books.forEach((book) => {
    const bookNotes = (grouped[book.id] || []).sort(
      (a, b) => a.pageNumber - b.pageNumber
    );
    if (bookNotes.length === 0) return;
    const fileParts: string[] = [];
    fileParts.push(`# ${book.title}\n`);
    fileParts.push(`**作者**: ${book.author}\n`);
    fileParts.push(`**出版年份**: ${book.publishYear}\n\n`);
    fileParts.push('---\n\n');
    bookNotes.forEach((note) => {
      fileParts.push(`## 第 ${note.pageNumber} 页\n\n`);
      if (note.highlightText) {
        fileParts.push(`> ${note.highlightText}\n\n`);
      }
      if (note.thought) {
        fileParts.push(`${note.thought}\n\n`);
      }
      if (note.tags.length) {
        fileParts.push(`*标签: ${note.tags.join(', ')}*\n\n`);
      }
      fileParts.push('---\n\n');
    });
    const safeName = `${book.title}_${book.author}`.replace(
      /[\\/:*?"<>|]/g,
      '_'
    );
    files.push({ filename: `${safeName}.md`, content: fileParts.join('') });
  });

  res.json({ markdown, files });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
