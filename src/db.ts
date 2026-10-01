import { openDB, IDBPDatabase } from 'idb'
import type { Artwork, Comment } from './types'

const DB_NAME = 'pixel-gallery-db'
const DB_VERSION = 1

let dbInstance: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('artworks')) {
        const store = db.createObjectStore('artworks', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains('comments')) {
        const store = db.createObjectStore('comments', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('artworkId', 'artworkId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    },
  })
  return dbInstance
}

export async function getAllArtworks(): Promise<Artwork[]> {
  const db = await getDB()
  const artworks = await db.getAllFromIndex('artworks', 'createdAt')
  return (artworks as Artwork[]).reverse()
}

export async function getArtwork(id: number): Promise<Artwork | undefined> {
  const db = await getDB()
  return (await db.get('artworks', id)) as Artwork | undefined
}

export async function addArtwork(artwork: Omit<Artwork, 'id'>): Promise<number> {
  const db = await getDB()
  return (await db.add('artworks', artwork)) as number
}

export async function updateArtwork(artwork: Artwork): Promise<void> {
  const db = await getDB()
  await db.put('artworks', artwork)
}

export async function getComments(artworkId: number): Promise<Comment[]> {
  const db = await getDB()
  const tx = db.transaction('comments', 'readonly')
  const index = tx.store.index('artworkId')
  const comments = (await index.getAll(artworkId)) as Comment[]
  return comments.sort((a, b) => b.createdAt - a.createdAt)
}

export async function addComment(comment: Omit<Comment, 'id'>): Promise<number> {
  const db = await getDB()
  return (await db.add('comments', comment)) as number
}
