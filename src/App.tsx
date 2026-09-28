import { useCallback } from 'react';
import type { FC } from 'react';
import BookShelf from './BookShelf';
import CommunityFeed from './CommunityFeed';
import { useBookStore } from './store/useBookStore';
import './styles/index.css';

const App: FC = () => {
  const { currentPage, pageTransition, searchKeyword, setCurrentPage, setSearchKeyword } = useBookStore();

  const handleNavClick = useCallback(
    (page: 'shelf' | 'community') => {
      if (page !== currentPage) {
        setCurrentPage(page);
      }
    },
    [currentPage, setCurrentPage]
  );

  return (
    <>
      <nav className="navbar">
        <div className="navbar-logo">
          悦<span>读</span>
        </div>
        <ul className="nav-links">
          <li>
            <div
              className={`nav-link ${currentPage === 'shelf' ? 'active' : ''}`}
              onClick={() => handleNavClick('shelf')}
            >
              我的书架
            </div>
          </li>
          <li>
            <div
              className={`nav-link ${currentPage === 'community' ? 'active' : ''}`}
              onClick={() => handleNavClick('community')}
            >
              社区热度
            </div>
          </li>
        </ul>
      </nav>

      <div className={`page-container ${pageTransition ? 'slide-in' : ''}`}>
        <div className="main-content">
          {currentPage === 'shelf' ? (
            <BookShelf searchKeyword={searchKeyword} onSearchChange={setSearchKeyword} />
          ) : (
            <CommunityFeed />
          )}
        </div>
      </div>
    </>
  );
};

export default App;
