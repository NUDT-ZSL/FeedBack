import type { Request, Response } from 'express';
import { store } from '../store';
import type { MoodType, ApiResponse, MoodRecord, MoodStats } from '../types';

export async function createMood(req: Request, res: Response<ApiResponse<MoodRecord>>) {
  try {
    const { mood } = req.body as { mood: MoodType };

    if (!mood) {
      return res.status(400).json({
        success: false,
        error: '情绪类型不能为空',
      });
    }

    const validMoods: MoodType[] = ['happy', 'calm', 'anxious', 'tired', 'angry'];
    if (!validMoods.includes(mood)) {
      return res.status(400).json({
        success: false,
        error: '无效的情绪类型',
      });
    }

    const record = store.addMood(mood);

    return res.json({
      success: true,
      data: record,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '创建情绪记录失败',
    });
  }
}

export async function getTodayStats(req: Request, res: Response<ApiResponse<MoodStats>>) {
  try {
    const stats = store.getTodayStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取今日统计失败',
    });
  }
}

export async function getRangeStats(req: Request, res: Response<ApiResponse<MoodStats[]>>) {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate 和 endDate 参数不能为空',
      });
    }

    const stats = store.getRangeStats(startDate, endDate);

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取区间统计失败',
    });
  }
}
