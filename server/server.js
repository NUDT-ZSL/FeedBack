const express = require('express');
const cors = require('cors');
const { getArtworks, getArtworkById, updateArtworkStock } = require('./artworkModel');
const { getOrders, getOrderById, createOrder, updateOrderStatus } = require('./orderModel');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get('/api/artworks', (_req, res) => {
  const artworks = getArtworks();
  res.json({
    code: 200,
    message: '获取艺术品列表成功',
    data: artworks,
  });
});

app.get('/api/artworks/:id', (req, res) => {
  const artwork = getArtworkById(req.params.id);
  if (!artwork) {
    return res.status(404).json({
      code: 404,
      message: '艺术品不存在',
      data: null,
    });
  }
  res.json({
    code: 200,
    message: '获取艺术品详情成功',
    data: artwork,
  });
});

app.get('/api/orders', (_req, res) => {
  const orders = getOrders();
  res.json({
    code: 200,
    message: '获取订单列表成功',
    data: orders,
  });
});

app.get('/api/orders/:id', (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({
      code: 404,
      message: '订单不存在',
      data: null,
    });
  }
  res.json({
    code: 200,
    message: '获取订单详情成功',
    data: order,
  });
});

app.post('/api/orders', (req, res) => {
  const { artworkId, quantity, buyerName, buyerPhone, buyerAddress } = req.body;

  if (!artworkId || !quantity || !buyerName || !buyerPhone || !buyerAddress) {
    return res.status(400).json({
      code: 400,
      message: '请填写完整的订单信息',
      data: null,
    });
  }

  const artwork = getArtworkById(artworkId);
  if (!artwork) {
    return res.status(404).json({
      code: 404,
      message: '艺术品不存在',
      data: null,
    });
  }

  if (artwork.stock < quantity) {
    return res.status(400).json({
      code: 400,
      message: `库存不足，当前仅剩 ${artwork.stock} 件`,
      data: null,
    });
  }

  const stockUpdated = updateArtworkStock(artworkId, quantity);
  if (!stockUpdated) {
    return res.status(400).json({
      code: 400,
      message: '库存扣减失败，请稍后重试',
      data: null,
    });
  }

  const newOrder = createOrder({
    artworkId,
    artworkTitle: artwork.title,
    artworkPrice: artwork.price,
    quantity,
    totalPrice: artwork.price * quantity,
    buyerName,
    buyerPhone,
    buyerAddress,
  });

  res.status(201).json({
    code: 201,
    message: '订单创建成功',
    data: newOrder,
  });
});

app.put('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'paid', 'shipped', 'completed'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      code: 400,
      message: '无效的订单状态',
      data: null,
    });
  }

  const updatedOrder = updateOrderStatus(req.params.id, status);
  if (!updatedOrder) {
    return res.status(404).json({
      code: 404,
      message: '订单不存在',
      data: null,
    });
  }

  res.json({
    code: 200,
    message: '订单状态更新成功',
    data: updatedOrder,
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
