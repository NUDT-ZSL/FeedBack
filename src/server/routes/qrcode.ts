// 二维码路由 - 生成签到二维码和核销签到
// 数据流向：
//   POST /api/qrcode -> jwt.sign(bookingId, userId) -> qrcode.toDataURL -> 返回Base64图片
//   POST /api/checkin -> jwt.verify(qrToken) -> 校验合法性 -> 更新预约状态
// 调用关系：index.ts -> qrcode.ts -> store.ts -> jsonwebtoken -> qrcode库
// 性能约束：二维码生成应在200ms内返回

import express from 'express';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { AuthRequest, authMiddleware, QR_JWT_CONFIG } from '../middleware/auth';
import { findBookingById, updateBooking } from '../data/store';

// jwt类型断言工具函数
const jwtSign = (payload: any, secret: string, options: any): string => {
  return (jwt as any).sign(payload, secret, options);
};
const jwtVerify = (token: string, secret: string): any => {
  return (jwt as any).verify(token, secret);
};

const router = express.Router();

// 生成签到二维码
// 性能约束：必须在200ms内返回
// 数据流向：POST /api/qrcode -> 校验预约 -> jwt.sign签名 -> qrcode生成Base64 -> 返回
router.post('/qrcode', authMiddleware, async (req: AuthRequest, res) => {
  const startTime = Date.now();

  try {
    const { bookingId } = req.body;
    const userId = req.user!.id;

    if (!bookingId) {
      return res.status(400).json({ message: '缺少预约ID' });
    }

    // 1. 验证预约存在且属于当前用户
    const booking = findBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: '预约不存在' });
    }

    if (booking.userId !== userId) {
      return res.status(403).json({ message: '无权访问此预约' });
    }

    if (booking.status !== 'booked') {
      return res.status(400).json({ message: '该预约已签到或已取消' });
    }

    // 2. 检查时间：只能在课程开始前30分钟内生成
    const courseTime = new Date(booking.startTime).getTime();
    const now = Date.now();
    const diffMinutes = (courseTime - now) / (1000 * 60);

    if (diffMinutes > 30) {
      return res.status(400).json({
        message: '只能在课程开始前30分钟内生成签到二维码',
      });
    }

    if (diffMinutes < -30) {
      return res.status(400).json({ message: '课程已结束，无法签到' });
    }

    // 3. 生成JWT签名的二维码内容（防篡改）
    // 包含bookingId和userId，5分钟有效期
    const qrPayload = {
      bookingId,
      userId,
      courseName: booking.courseName,
      userName: booking.userName,
      coachName: booking.coachName,
      generatedAt: now,
    };

    // 使用独立的密钥和短有效期签名
    // 数据流向：qrPayload -> jwtSign(独立密钥) -> 5分钟有效期的签到token
    const qrToken = jwtSign(qrPayload, QR_JWT_CONFIG.secret, {
      expiresIn: QR_JWT_CONFIG.expiresIn,
    });

    // 4. 生成二维码Base64图片（性能关键点）
    // qrcode.toDataURL是异步操作，正常应在50-100ms完成
    const qrCodeDataURL = await QRCode.toDataURL(qrToken, {
      width: 220,
      margin: 2,
      color: {
        dark: '#1a1a2e',
        light: '#ffffff',
      },
    });

    // 性能日志：检查是否在200ms内完成
    const elapsed = Date.now() - startTime;
    if (elapsed > 200) {
      console.warn(`二维码生成耗时过长: ${elapsed}ms`);
    } else {
      console.log(`二维码生成耗时: ${elapsed}ms`);
    }

    // 5. 返回Base64图片和token
    res.json({
      qrCode: qrCodeDataURL,
      qrToken,
      bookingInfo: qrPayload,
      expiresIn: '5分钟',
    });
  } catch (_err) {
    res.status(500).json({ message: '二维码生成失败' });
  }
});

// 核销签到（校验二维码）
// 数据流向：POST /api/checkin -> jwt.verify(qrToken) -> 校验有效性 -> 更新预约状态
router.post('/checkin', authMiddleware, async (req, res) => {
  try {
    const { qrToken } = req.body;

    if (!qrToken) {
      return res.status(400).json({ message: '请输入二维码内容' });
    }

    // 1. 验证JWT签名（防篡改）
    // 数据流向：前端传入的qrToken -> jwtVerify -> 校验5分钟有效期 -> 解码出预约信息
    let decoded;
    try {
      decoded = jwtVerify(qrToken, QR_JWT_CONFIG.secret) as {
        bookingId: string;
        userId: string;
        courseName: string;
        userName: string;
        coachName: string;
        generatedAt: number;
      };
    } catch (jwtErr: any) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(400).json({ message: '二维码已过期，请重新生成' });
      }
      return res.status(400).json({ message: '无效的二维码' });
    }

    // 2. 验证预约存在
    const booking = findBookingById(decoded.bookingId);
    if (!booking) {
      return res.status(404).json({ message: '预约不存在' });
    }

    // 3. 验证预约状态
    if (booking.status === 'checked-in') {
      return res.status(400).json({ message: '该会员已签到' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: '该预约已取消' });
    }

    // 4. 验证预约所属用户匹配
    if (booking.userId !== decoded.userId) {
      return res.status(400).json({ message: '二维码与预约不匹配' });
    }

    // 5. 验证课程时间（再次确认）
    const courseTime = new Date(booking.startTime).getTime();
    const now = Date.now();
    const diffMinutes = (courseTime - now) / (1000 * 60);

    if (diffMinutes > 30) {
      return res.status(400).json({ message: '签到时间未到，请提前30分钟内签到' });
    }

    if (diffMinutes < -30) {
      return res.status(400).json({ message: '课程已结束，无法签到' });
    }

    // 6. 更新预约状态为已签到
    const updatedBooking = updateBooking(decoded.bookingId, {
      status: 'checked-in',
    });

    // 7. 返回签到成功信息
    res.json({
      success: true,
      message: '签到成功！',
      booking: {
        id: updatedBooking!.id,
        courseName: decoded.courseName,
        userName: decoded.userName,
        coachName: decoded.coachName,
        userId: decoded.userId,
        status: 'checked-in',
        checkedInAt: new Date().toISOString(),
      },
    });
  } catch (_err) {
    res.status(500).json({ message: '签到失败，请重试' });
  }
});

export default router;
