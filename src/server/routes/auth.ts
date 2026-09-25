// 认证路由 - 处理登录/注册
// 数据流向：前端发送credentials -> bcrypt加密/校验 -> jsonwebtoken签发JWT -> 返回token和user
// 调用关系：index.ts -> auth.ts -> store.ts -> bcrypt -> jsonwebtoken

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { addUser, findUserByEmail } from '../data/store';
import { JWT_CONFIG } from '../middleware/auth';

// jwt类型断言工具 - 解决@types/jsonwebtoken与实际库的重载匹配问题
const jwtSign = (payload: any, secret: string, options: any): string => {
  return (jwt as any).sign(payload, secret, options);
};

const router = express.Router();

// 注册
// 数据流向：POST /api/auth/register -> bcrypt.hash加密密码 -> addUser存储 -> jwt.sign签发token
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // 参数校验
    if (!name || !email || !password) {
      return res.status(400).json({ message: '请填写所有必填项' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: '密码至少需要6位' });
    }

    // 检查邮箱是否已存在
    const existingUser = findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: '该邮箱已被注册' });
    }

    // bcrypt加密密码
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 创建用户，默认等级为普通会员
    const newUser = addUser({
      email: email.toLowerCase(),
      name,
      password: hashedPassword,
      level: 'normal',
      bookingCount: 0,
    });

    // 签发JWT
    // 数据流向：{id,email,level} -> jwtSign(密钥) -> 7天有效期JWT字符串
    const token = jwtSign(
      {
        id: newUser.id,
        email: newUser.email,
        level: newUser.level,
      },
      JWT_CONFIG.secret,
      { expiresIn: JWT_CONFIG.expiresIn }
    );

    // 返回token和用户信息（不返回密码）
    res.json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        level: newUser.level,
        bookingCount: newUser.bookingCount,
      },
      message: '注册成功！',
    });
  } catch (err) {
    console.error('注册错误:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 登录
// 数据流向：POST /api/auth/login -> findUserByEmail -> bcrypt.compare校验 -> jwt.sign签发token
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: '请输入邮箱和密码' });
    }

    // 查找用户
    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    // bcrypt校验密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    // 签发JWT
    // 数据流向：{id,email,level} -> jwtSign(密钥) -> 7天有效期JWT字符串
    const token = jwtSign(
      {
        id: user.id,
        email: user.email,
        level: user.level,
      },
      JWT_CONFIG.secret,
      { expiresIn: JWT_CONFIG.expiresIn }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        level: user.level,
        bookingCount: user.bookingCount,
      },
      message: '登录成功！',
    });
  } catch (err) {
    console.error('登录错误:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

export default router;
