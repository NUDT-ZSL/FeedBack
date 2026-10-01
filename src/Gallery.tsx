import React, { useState, useEffect } from 'react'
import type { Artwork } from './types'
import { getAllArtworks, getComments } from './db'

interface GalleryProps {
  onArtworkClick: (artwork: Artwork) => void
  refreshTrigger: number
}

const Gallery: React.FC<GalleryProps> = ({ onArtworkClick, refreshTrigger }) => {
  const [artworks, setArtworks] = useState<Artwork[]>([])
  const [commentCounts, setCommentCounts] = useState<Record<number, number>>({})
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  useEffect(() => {
    loadArtworks()
  }, [refreshTrigger])

  const loadArtworks = async () => {
    const items = await getAllArtworks()
    setArtworks(items)
    for (const item of items) {
      const comments = await getComments(item.id)
      setCommentCounts((prev) => ({ ...prev, [item.id]: comments.length }))
    }
  }

  const renderWaterfall = () => {
    const columns = 3
    const columnHeights = Array(columns).fill(0)
    const columnItems: React.ReactNode[][] = Array.from({ length: columns }, () => [])

    artworks.forEach((artwork, index) => {
      const minHeight = Math.min(...columnHeights)
      const columnIndex = columnHeights.indexOf(minHeight)
      const itemHeight = 200 + (index % 3) * 60
      columnHeights[columnIndex] += itemHeight + 20
      columnItems[columnIndex].push(
        <div
          key={artwork.id}
          style={{
            position: 'relative',
            marginBottom: 20,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            transform: hoveredId === artwork.id ? 'scale(1.05)' : 'scale(1)',
          }}
          onMouseEnter={() => setHoveredId(artwork.id)}
          onMouseLeave={() => setHoveredId(null)}
          onClick={() => onArtworkClick(artwork)}
        >
          <div
            style={{
              width: 200,
              height: itemHeight,
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              backgroundColor: '#fff',
            }}
          >
            <img
              src={artwork.data}
              alt={artwork.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                imageRendering: 'pixelated',
              }}
            />
          </div>
          {hoveredId === artwork.id && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                display: 'flex',
                gap: 8,
                pointerEvents: 'none',
              }}
            >
              <div style={styles.bubble}>
                <span style={{ fontSize: 14, color: '#fff' }}>❤ {artwork.likes}</span>
              </div>
              <div style={styles.bubble}>
                <span style={{ fontSize: 14, color: '#fff' }}>💬 {commentCounts[artwork.id] || 0}</span>
              </div>
            </div>
          )}
          <div style={{ marginTop: 8, padding: '0 4px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a', margin: 0 }}>
              {artwork.name}
            </p>
            <p style={{ fontSize: 11, color: '#8b7355', margin: '4px 0 0 0' }}>
              by {artwork.author}
            </p>
          </div>
        </div>
      )
    })

    return columnItems.map((items, colIndex) => (
      <div key={colIndex} style={{ display: 'flex', flexDirection: 'column' }}>
        {items}
      </div>
    ))
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>公共画廊</h2>
      {artworks.length === 0 ? (
        <div style={styles.empty}>
          <p style={{ color: '#8b7355', fontSize: 16 }}>暂无作品，快去创作第一幅吧！</p>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            gap: 20,
            justifyContent: 'center',
            flexWrap: 'wrap',
            maxWidth: 700,
            margin: '0 auto',
          }}
        >
          {renderWaterfall()}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#5a4a3a',
    textAlign: 'center',
    marginBottom: 32,
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 300,
  },
  bubble: {
    backgroundColor: 'rgba(90, 74, 58, 0.85)',
    backdropFilter: 'blur(4px)',
    padding: '6px 12px',
    borderRadius: 16,
  },
}

export default Gallery
