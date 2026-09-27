import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  users,
  auctions,
  bids,
  orders,
  reviews,
  createUser,
  findUserByUsername,
  findUserById,
  createAuction,
  getAuctions,
  getAuctionById,
  createBid,
  getBidsByAuctionId,
  createOrder,
  getOrdersByUserId,
  getOrderById,
  updateOrderAddress,
  updateOrderStatus,
  createReview,
  getReviewsByAuctionId,
  checkAndCloseExpiredAuctions,
  type User,
  type AuctionItem,
  type Bid,
  type Order,
  type Review,
} from './data.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, '../../dist')))

app.post('/api/users/register', (req: Request, res: Response) => {
  const { username, password, nickname, role } = req.body

  if (!username || !password || !nickname || !role) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数',
    })
  }

  if (role !== 'seller' && role !== 'buyer') {
    return res.status(400).json({
      success: false,
      error: '角色类型无效',
    })
  }

  const existingUser = findUserByUsername(username)
  if (existingUser) {
    return res.status(400).json({
      success: false,
      error: '用户名已存在',
    })
  }

  const user = createUser(username, password, nickname, role)
  const { password: _, ...userWithoutPassword } = user

  res.json({
    success: true,
    user: userWithoutPassword,
  })
})

app.post('/api/users/login', (req: Request, res: Response) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: '缺少用户名或密码',
    })
  }

  const user = findUserByUsername(username)
  if (!user || user.password !== password) {
    return res.status(401).json({
      success: false,
      error: '用户名或密码错误',
    })
  }

  const { password: _, ...userWithoutPassword } = user

  res.json({
    success: true,
    user: userWithoutPassword,
  })
})

app.get('/api/auctions', (req: Request, res: Response) => {
  const auctionList = getAuctions()
  res.json({
    success: true,
    auctions: auctionList,
  })
})

app.post('/api/auctions', (req: Request, res: Response) => {
  const { sellerId, title, description, images, startingPrice, endTime } = req.body

  if (!sellerId || !title || !description || !images || !startingPrice || !endTime) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数',
    })
  }

  const seller = findUserById(sellerId)
  if (!seller || seller.role !== 'seller') {
    return res.status(403).json({
      success: false,
      error: '只有卖家可以发布拍卖',
    })
  }

  const auction = createAuction(sellerId, title, description, images, Number(startingPrice), Number(endTime))

  res.json({
    success: true,
    auction,
  })
})

app.get('/api/auctions/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const auction = getAuctionById(id)

  if (!auction) {
    return res.status(404).json({
      success: false,
      error: '拍卖不存在',
    })
  }

  res.json({
    success: true,
    auction,
  })
})

app.post('/api/auctions/:id/bid', (req: Request, res: Response) => {
  const { id } = req.params
  const { bidderId, amount } = req.body

  if (!bidderId || !amount) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数',
    })
  }

  const auction = getAuctionById(id)
  if (!auction) {
    return res.status(404).json({
      success: false,
      error: '拍卖不存在',
    })
  }

  if (auction.status !== 'active') {
    return res.status(400).json({
      success: false,
      error: '拍卖已结束',
    })
  }

  if (Date.now() >= auction.endTime) {
    return res.status(400).json({
      success: false,
      error: '拍卖已结束',
    })
  }

  if (Number(amount) <= auction.currentPrice) {
    return res.status(400).json({
      success: false,
      error: '出价必须高于当前价格',
    })
  }

  const bid = createBid(id, bidderId, Number(amount))
  if (!bid) {
    return res.status(400).json({
      success: false,
      error: '出价失败',
    })
  }

  res.json({
    success: true,
    newPrice: Number(amount),
    bid,
  })
})

app.get('/api/auctions/:id/bids', (req: Request, res: Response) => {
  const { id } = req.params
  const bidList = getBidsByAuctionId(id)

  res.json({
    success: true,
    bids: bidList,
  })
})

app.get('/api/orders', (req: Request, res: Response) => {
  const { userId } = req.query

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({
      success: false,
      error: '缺少用户ID',
    })
  }

  const orderList = getOrdersByUserId(userId)

  res.json({
    success: true,
    orders: orderList,
  })
})

app.post('/api/orders', (req: Request, res: Response) => {
  const { auctionId } = req.body

  if (!auctionId) {
    return res.status(400).json({
      success: false,
      error: '缺少拍卖ID',
    })
  }

  const auction = getAuctionById(auctionId)
  if (!auction) {
    return res.status(404).json({
      success: false,
      error: '拍卖不存在',
    })
  }

  if (auction.status === 'active') {
    return res.status(400).json({
      success: false,
      error: '拍卖尚未结束',
    })
  }

  const existingOrder = orders.find(o => o.auctionId === auctionId)
  if (existingOrder) {
    return res.status(400).json({
      success: false,
      error: '订单已存在',
    })
  }

  const order = createOrder(auction)
  if (!order) {
    return res.status(400).json({
      success: false,
      error: '创建订单失败',
    })
  }

  res.json({
    success: true,
    order,
  })
})

app.put('/api/orders/:id/address', (req: Request, res: Response) => {
  const { id } = req.params
  const { name, phone, address } = req.body

  if (!name || !phone || !address) {
    return res.status(400).json({
      success: false,
      error: '缺少地址信息',
    })
  }

  const order = updateOrderAddress(id, { name, phone, address })
  if (!order) {
    return res.status(404).json({
      success: false,
      error: '订单不存在',
    })
  }

  res.json({
    success: true,
    order,
  })
})

app.put('/api/orders/:id/status', (req: Request, res: Response) => {
  const { id } = req.params
  const { status, trackingNumber } = req.body

  if (!status) {
    return res.status(400).json({
      success: false,
      error: '缺少状态参数',
    })
  }

  const validStatuses: Order['status'][] = ['pending_payment', 'paid', 'pending_shipping', 'shipped', 'completed']
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: '无效的订单状态',
    })
  }

  const order = updateOrderStatus(id, status)
  if (!order) {
    return res.status(404).json({
      success: false,
      error: '订单不存在',
    })
  }

  if (trackingNumber) {
    order.trackingNumber = trackingNumber
  }

  res.json({
    success: true,
    order,
  })
})

app.post('/api/reviews', (req: Request, res: Response) => {
  const { orderId, auctionId, reviewerId, reviewerRole, targetUserId, rating, content } = req.body

  if (!orderId || !auctionId || !reviewerId || !reviewerRole || !targetUserId || !rating || !content) {
    return res.status(400).json({
      success: false,
      error: '缺少必要参数',
    })
  }

  if (reviewerRole !== 'buyer' && reviewerRole !== 'seller') {
    return res.status(400).json({
      success: false,
      error: '无效的评价者角色',
    })
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({
      success: false,
      error: '评分必须在1-5之间',
    })
  }

  const review = createReview(orderId, auctionId, reviewerId, reviewerRole, targetUserId, Number(rating), content)
  if (!review) {
    return res.status(400).json({
      success: false,
      error: '创建评价失败',
    })
  }

  res.json({
    success: true,
    review,
  })
})

app.get('/api/auctions/:id/reviews', (req: Request, res: Response) => {
  const { id } = req.params
  const reviewList = getReviewsByAuctionId(id)

  res.json({
    success: true,
    reviews: reviewList,
  })
})

app.use('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'ok',
  })
})

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', error)
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

const PORT = 3001

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`)
})

setInterval(() => {
  const newOrders = checkAndCloseExpiredAuctions()
  if (newOrders.length > 0) {
    console.log(`Auto-created ${newOrders.length} orders for expired auctions`)
  }
}, 1000)

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

export default app
