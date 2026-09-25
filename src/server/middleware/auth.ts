// JWT认证中间件
// 数据流向：前端请求 -> 中间件校验Authorization头 -> 解码JWT -> 挂载user到req -> 路由处理
// 调用关系：index.ts -> authMiddleware -> routes/*

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'gym-secret-key-2024';

// jwt类型断言工具函数 - 避免@types/jsonwebtoken重载匹配问题
const jwtVerify = (token: string, secret: string): any => {
  return (jwt as any).verify(token, secret);
};

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    level: 'normal' | 'vip';
  };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未提供认证令牌' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 数据流向：Bearer token -> jwtVerify -> 解码出{id,email,level} -> 挂载到req.user
    const decoded = jwtVerify(token, JWT_SECRET) as {
      id: string;
      email: string;
      level: 'normal' | 'vip';
    };
    req.user = decoded;
    next();
  } catch (_err) {
    return res.status(401).json({ message: '无效的认证令牌' });
  }
};

export const JWT_CONFIG = {
  secret: JWT_SECRET,
  expiresIn: '7d',
};

export const QR_JWT_CONFIG = {
  secret: JWT_SECRET + '-qr',
  expiresIn: '5m', // 二维码5分钟有效期
};
