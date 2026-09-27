import { v4 as uuidv4 } from 'uuid'

export interface User {
  id: string
  username: string
  password: string
  nickname: string
  role: 'seller' | 'buyer'
  avatar?: string
  createdAt: number
}

export interface AuctionItem {
  id: string
  sellerId: string
  sellerName: string
  title: string
  description: string
  images: string[]
  startingPrice: number
  currentPrice: number
  highestBidderId?: string
  highestBidderName?: string
  endTime: number
  status: 'active' | 'ended' | 'sold'
  createdAt: number
}

export interface Bid {
  id: string
  auctionId: string
  bidderId: string
  bidderName: string
  amount: number
  timestamp: number
}

export interface Order {
  id: string
  auctionId: string
  auctionTitle: string
  auctionImage: string
  buyerId: string
  buyerName: string
  sellerId: string
  sellerName: string
  amount: number
  status: 'pending_payment' | 'paid' | 'pending_shipping' | 'shipped' | 'completed'
  address?: {
    name: string
    phone: string
    address: string
  }
  trackingNumber?: string
  createdAt: number
  paidAt?: number
  shippedAt?: number
  completedAt?: number
}

export interface Review {
  id: string
  orderId: string
  auctionId: string
  reviewerId: string
  reviewerName: string
  reviewerRole: 'buyer' | 'seller'
  targetUserId: string
  rating: number
  content: string
  createdAt: number
}

export let users: User[] = []
export let auctions: AuctionItem[] = []
export let bids: Bid[] = []
export let orders: Order[] = []
export let reviews: Review[] = []

export function initializeData(): void {
  const now = Date.now()

  users = [
    {
      id: uuidv4(),
      username: 'seller1',
      password: '123456',
      nickname: '工匠老张',
      role: 'seller',
      createdAt: now - 86400000 * 7,
    },
    {
      id: uuidv4(),
      username: 'buyer1',
      password: '123456',
      nickname: '收藏家小李',
      role: 'buyer',
      createdAt: now - 86400000 * 5,
    },
    {
      id: uuidv4(),
      username: 'buyer2',
      password: '123456',
      nickname: '文艺青年小王',
      role: 'buyer',
      createdAt: now - 86400000 * 3,
    },
  ]

  const seller = users[0]
  const buyer1 = users[1]
  const buyer2 = users[2]

  auctions = [
    {
      id: uuidv4(),
      sellerId: seller.id,
      sellerName: seller.nickname,
      title: '宜兴紫砂茶壶',
      description: '传统工艺制作，选用宜兴原矿紫砂泥，全手工打造，造型古朴典雅，泡茶香气纯正，是收藏与实用兼备的佳品。',
      images: [
        'https://images.unsplash.com/photo-1594631252845-29fc4cc8cde9?w=600',
        'https://images.unsplash.com/photo-1578474846511-04ba529f0b88?w=600',
      ],
      startingPrice: 200,
      currentPrice: 350,
      highestBidderId: buyer1.id,
      highestBidderName: buyer1.nickname,
      endTime: now + 3600000 * 2,
      status: 'active',
      createdAt: now - 3600000,
    },
    {
      id: uuidv4(),
      sellerId: seller.id,
      sellerName: seller.nickname,
      title: '黄杨木雕摆件',
      description: '精选百年黄杨木，大师级雕刻工艺，刀法细腻流畅，人物神态栩栩如生，寓意吉祥如意。',
      images: [
        'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=600',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600',
      ],
      startingPrice: 500,
      currentPrice: 500,
      endTime: now + 3600000 * 24,
      status: 'active',
      createdAt: now - 7200000,
    },
    {
      id: uuidv4(),
      sellerId: seller.id,
      sellerName: seller.nickname,
      title: '手绘山水折扇',
      description: '采用优质宣纸扇面，名师手绘水墨山水，骨扇精选老竹，开合自如，文雅之士必备。',
      images: [
        'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=600',
        'https://images.unsplash.com/photo-1603197651519-612d553e2d02?w=600',
      ],
      startingPrice: 150,
      currentPrice: 280,
      highestBidderId: buyer2.id,
      highestBidderName: buyer2.nickname,
      endTime: now + 3600000 * 5,
      status: 'active',
      createdAt: now - 1800000,
    },
    {
      id: uuidv4(),
      sellerId: seller.id,
      sellerName: seller.nickname,
      title: '手工青花瓷花瓶',
      description: '传承景德镇千年制瓷工艺，纯手工拉坯绘画，青花发色纯正，釉色温润如玉，极具收藏价值。',
      images: [
        'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600',
        'https://images.unsplash.com/photo-1594736797933-d0501ba2fe65?w=600',
      ],
      startingPrice: 800,
      currentPrice: 1200,
      highestBidderId: buyer1.id,
      highestBidderName: buyer1.nickname,
      endTime: now - 3600000,
      status: 'ended',
      createdAt: now - 86400000,
    },
    {
      id: uuidv4(),
      sellerId: seller.id,
      sellerName: seller.nickname,
      title: '苏绣双面绣屏风',
      description: '非遗苏绣工艺，大师纯手工刺绣，双面异色异样绣法，针脚细腻如发，画面精美绝伦。',
      images: [
        'https://images.unsplash.com/photo-1606761568499-6d2451b23c66?w=600',
        'https://images.unsplash.com/photo-1582562124811-c09040d0a901?w=600',
      ],
      startingPrice: 2000,
      currentPrice: 2000,
      endTime: now + 3600000 * 48,
      status: 'active',
      createdAt: now - 3600000 * 12,
    },
  ]

  bids = [
    {
      id: uuidv4(),
      auctionId: auctions[0].id,
      bidderId: buyer1.id,
      bidderName: buyer1.nickname,
      amount: 250,
      timestamp: now - 3000000,
    },
    {
      id: uuidv4(),
      auctionId: auctions[0].id,
      bidderId: buyer2.id,
      bidderName: buyer2.nickname,
      amount: 300,
      timestamp: now - 2400000,
    },
    {
      id: uuidv4(),
      auctionId: auctions[0].id,
      bidderId: buyer1.id,
      bidderName: buyer1.nickname,
      amount: 350,
      timestamp: now - 1800000,
    },
    {
      id: uuidv4(),
      auctionId: auctions[2].id,
      bidderId: buyer2.id,
      bidderName: buyer2.nickname,
      amount: 180,
      timestamp: now - 1200000,
    },
    {
      id: uuidv4(),
      auctionId: auctions[2].id,
      bidderId: buyer1.id,
      bidderName: buyer1.nickname,
      amount: 220,
      timestamp: now - 900000,
    },
    {
      id: uuidv4(),
      auctionId: auctions[2].id,
      bidderId: buyer2.id,
      bidderName: buyer2.nickname,
      amount: 280,
      timestamp: now - 600000,
    },
    {
      id: uuidv4(),
      auctionId: auctions[3].id,
      bidderId: buyer1.id,
      bidderName: buyer1.nickname,
      amount: 900,
      timestamp: now - 7200000,
    },
    {
      id: uuidv4(),
      auctionId: auctions[3].id,
      bidderId: buyer2.id,
      bidderName: buyer2.nickname,
      amount: 1000,
      timestamp: now - 5400000,
    },
    {
      id: uuidv4(),
      auctionId: auctions[3].id,
      bidderId: buyer1.id,
      bidderName: buyer1.nickname,
      amount: 1200,
      timestamp: now - 3600000,
    },
  ]

  orders = [
    {
      id: uuidv4(),
      auctionId: auctions[3].id,
      auctionTitle: auctions[3].title,
      auctionImage: auctions[3].images[0],
      buyerId: buyer1.id,
      buyerName: buyer1.nickname,
      sellerId: seller.id,
      sellerName: seller.nickname,
      amount: 1200,
      status: 'pending_payment',
      createdAt: now - 3500000,
    },
  ]

  reviews = []

  checkAndCloseExpiredAuctions()
}

export function checkAndCloseExpiredAuctions(): Order[] {
  const now = Date.now()
  const newOrders: Order[] = []

  auctions.forEach((auction) => {
    if (auction.status === 'active' && auction.endTime <= now) {
      auction.status = 'ended'
      if (auction.highestBidderId && auction.highestBidderName) {
        auction.status = 'sold'
        const existingOrder = orders.find((o) => o.auctionId === auction.id)
        if (!existingOrder) {
          const buyer = users.find((u) => u.id === auction.highestBidderId)
          const seller = users.find((u) => u.id === auction.sellerId)
          if (buyer && seller) {
            const order: Order = {
              id: uuidv4(),
              auctionId: auction.id,
              auctionTitle: auction.title,
              auctionImage: auction.images[0],
              buyerId: auction.highestBidderId,
              buyerName: auction.highestBidderName,
              sellerId: auction.sellerId,
              sellerName: seller.nickname,
              amount: auction.currentPrice,
              status: 'pending_payment',
              createdAt: now,
            }
            orders.push(order)
            newOrders.push(order)
          }
        }
      }
    }
  })

  return newOrders
}

export function createUser(
  username: string,
  password: string,
  nickname: string,
  role: 'seller' | 'buyer',
  avatar?: string
): User {
  const user: User = {
    id: uuidv4(),
    username,
    password,
    nickname,
    role,
    avatar,
    createdAt: Date.now(),
  }
  users.push(user)
  return user
}

export function getUserById(id: string): User | undefined {
  return users.find((u) => u.id === id)
}

export function findUserById(id: string): User | undefined {
  return getUserById(id)
}

export function getUserByUsername(username: string): User | undefined {
  return users.find((u) => u.username === username)
}

export function findUserByUsername(username: string): User | undefined {
  return getUserByUsername(username)
}

export function updateUser(id: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): User | undefined {
  const index = users.findIndex((u) => u.id === id)
  if (index === -1) return undefined
  users[index] = { ...users[index], ...data }
  return users[index]
}

export function deleteUser(id: string): boolean {
  const index = users.findIndex((u) => u.id === id)
  if (index === -1) return false
  users.splice(index, 1)
  return true
}

export function createAuction(
  sellerId: string,
  title: string,
  description: string,
  images: string[],
  startingPrice: number,
  endTime: number
): AuctionItem {
  const seller = findUserById(sellerId)
  const auction: AuctionItem = {
    id: uuidv4(),
    sellerId,
    sellerName: seller?.nickname || '',
    title,
    description,
    images,
    startingPrice,
    currentPrice: startingPrice,
    endTime,
    status: 'active',
    createdAt: Date.now(),
  }
  auctions.push(auction)
  return auction
}

export function getAuctions(): AuctionItem[] {
  checkAndCloseExpiredAuctions()
  return [...auctions].sort((a, b) => b.createdAt - a.createdAt)
}

export function getAllAuctions(): AuctionItem[] {
  return getAuctions()
}

export function getAuctionById(id: string): AuctionItem | undefined {
  checkAndCloseExpiredAuctions()
  return auctions.find((a) => a.id === id)
}

export function getAuctionsBySeller(sellerId: string): AuctionItem[] {
  checkAndCloseExpiredAuctions()
  return auctions.filter((a) => a.sellerId === sellerId)
}

export function updateAuction(id: string, data: Partial<Omit<AuctionItem, 'id' | 'createdAt'>>): AuctionItem | undefined {
  const index = auctions.findIndex((a) => a.id === id)
  if (index === -1) return undefined
  auctions[index] = { ...auctions[index], ...data }
  return auctions[index]
}

export function deleteAuction(id: string): boolean {
  const index = auctions.findIndex((a) => a.id === id)
  if (index === -1) return false
  auctions.splice(index, 1)
  return true
}

export function createBid(auctionId: string, bidderId: string, amount: number): Bid | null {
  const auction = getAuctionById(auctionId)
  const bidder = findUserById(bidderId)

  if (!auction || !bidder) return null
  if (auction.status !== 'active') return null
  if (amount <= auction.currentPrice) return null
  if (Date.now() >= auction.endTime) return null

  const bid: Bid = {
    id: uuidv4(),
    auctionId,
    bidderId,
    bidderName: bidder.nickname,
    amount,
    timestamp: Date.now(),
  }
  bids.push(bid)

  auction.currentPrice = amount
  auction.highestBidderId = bidderId
  auction.highestBidderName = bidder.nickname

  return bid
}

export function getBidsByAuctionId(auctionId: string): Bid[] {
  return bids.filter((b) => b.auctionId === auctionId).sort((a, b) => b.timestamp - a.timestamp)
}

export function getBidsByAuction(auctionId: string): Bid[] {
  return getBidsByAuctionId(auctionId)
}

export function getBidsByBidder(bidderId: string): Bid[] {
  return bids.filter((b) => b.bidderId === bidderId).sort((a, b) => b.timestamp - a.timestamp)
}

export function getHighestBid(auctionId: string): Bid | undefined {
  const auctionBids = bids.filter((b) => b.auctionId === auctionId)
  if (auctionBids.length === 0) return undefined
  return auctionBids.reduce((max, bid) => (bid.amount > max.amount ? bid : max))
}

export function createOrder(auction: AuctionItem): Order | null {
  if (!auction.highestBidderId || !auction.highestBidderName) return null

  const buyer = findUserById(auction.highestBidderId)
  const seller = findUserById(auction.sellerId)

  if (!buyer || !seller) return null

  const existingOrder = orders.find((o) => o.auctionId === auction.id)
  if (existingOrder) return existingOrder

  const order: Order = {
    id: uuidv4(),
    auctionId: auction.id,
    auctionTitle: auction.title,
    auctionImage: auction.images[0] || '',
    buyerId: buyer.id,
    buyerName: buyer.nickname,
    sellerId: seller.id,
    sellerName: seller.nickname,
    amount: auction.currentPrice,
    status: 'pending_payment',
    createdAt: Date.now(),
  }
  orders.push(order)
  return order
}

export function getOrderById(id: string): Order | undefined {
  return orders.find((o) => o.id === id)
}

export function getOrdersByUserId(userId: string): Order[] {
  return orders
    .filter((o) => o.buyerId === userId || o.sellerId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function getOrdersByBuyer(buyerId: string): Order[] {
  return orders.filter((o) => o.buyerId === buyerId).sort((a, b) => b.createdAt - a.createdAt)
}

export function getOrdersBySeller(sellerId: string): Order[] {
  return orders.filter((o) => o.sellerId === sellerId).sort((a, b) => b.createdAt - a.createdAt)
}

export function updateOrderAddress(
  id: string,
  address: { name: string; phone: string; address: string }
): Order | undefined {
  const order = getOrderById(id)
  if (!order) return undefined
  order.address = address
  return order
}

export function updateOrderStatus(
  id: string,
  status: Order['status']
): Order | undefined {
  const order = getOrderById(id)
  if (!order) return undefined
  order.status = status
  const now = Date.now()
  if (status === 'paid') order.paidAt = now
  if (status === 'shipped') order.shippedAt = now
  if (status === 'completed') order.completedAt = now
  return order
}

export function updateOrder(id: string, data: Partial<Omit<Order, 'id' | 'createdAt'>>): Order | undefined {
  const index = orders.findIndex((o) => o.id === id)
  if (index === -1) return undefined
  orders[index] = { ...orders[index], ...data }
  return orders[index]
}

export function createReview(
  orderId: string,
  auctionId: string,
  reviewerId: string,
  reviewerRole: 'buyer' | 'seller',
  targetUserId: string,
  rating: number,
  content: string
): Review | null {
  const reviewer = findUserById(reviewerId)
  if (!reviewer) return null

  const review: Review = {
    id: uuidv4(),
    orderId,
    auctionId,
    reviewerId,
    reviewerName: reviewer.nickname,
    reviewerRole,
    targetUserId,
    rating,
    content,
    createdAt: Date.now(),
  }
  reviews.push(review)
  return review
}

export function getReviewsByAuctionId(auctionId: string): Review[] {
  return reviews.filter((r) => r.auctionId === auctionId).sort((a, b) => b.createdAt - a.createdAt)
}

export function getReviewsByAuction(auctionId: string): Review[] {
  return getReviewsByAuctionId(auctionId)
}

export function getReviewsByUser(userId: string): Review[] {
  return reviews.filter((r) => r.targetUserId === userId).sort((a, b) => b.createdAt - a.createdAt)
}

export function getReviewByOrder(orderId: string): Review | undefined {
  return reviews.find((r) => r.orderId === orderId)
}

let checkInterval: NodeJS.Timeout | null = null

export function startAuctionChecker(): void {
  if (checkInterval) return
  checkInterval = setInterval(() => {
    const newOrders = checkAndCloseExpiredAuctions()
    if (newOrders.length > 0) {
      console.log(`Auto-created ${newOrders.length} orders for expired auctions`)
    }
  }, 1000)
}

export function stopAuctionChecker(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

initializeData()
