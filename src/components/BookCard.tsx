import { motion } from 'framer-motion';
import { Book } from '../types';
import { useIsBookBorrowed } from '../store/useStore';
import '../styles/BookCard.css';

interface BookCardProps {
  book: Book;
  isFiltered?: boolean;
  onClick: () => void;
}

export const BookCard = ({ book, isFiltered, onClick }: BookCardProps) => {
  const isBorrowed = useIsBookBorrowed(book._id);

  return (
    <motion.div
      className={`book-card ${isFiltered ? 'filtered' : ''} ${isBorrowed ? 'borrowed' : ''}`}
      onClick={isFiltered ? undefined : onClick}
      style={{ backgroundColor: book.coverColor }}
      whileHover={isFiltered ? {} : { rotateY: 15, rotateX: -5, scale: 1.05 }}
      whileTap={isFiltered ? {} : { scale: 0.95 }}
      transition={{ duration: 0.3 }}
    >
      <div className="book-spine"></div>
      <div className="book-content">
        <h3 className="book-title">{book.title}</h3>
        <p className="book-author">{book.author}</p>
      </div>
      {isBorrowed && (
        <div className="borrowed-seal">
          <span>已借阅</span>
        </div>
      )}
      <div className="book-pages">
        <span>{book.totalPages}页</span>
      </div>
    </motion.div>
  );
};
