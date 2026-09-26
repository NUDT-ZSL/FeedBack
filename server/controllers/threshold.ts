import type { Request, Response } from 'express';
import { store } from '../store';
import type { ThresholdConfig, ApiResponse, MoodType } from '../types';

export async function getThresholds(req: Request, res: Response<ApiResponse<ThresholdConfig[]>>) {
  try {
    const configs = store.getThresholds();

    return res.json({
      success: true,
      data: configs,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取阈值配置失败',
    });
  }
}

export async function setThreshold(req: Request, res: Response<ApiResponse<ThresholdConfig>>) {
  try {
    const config = req.body as ThresholdConfig;

    if (!config.mood) {
      return res.status(400).json({
        success: false,
        error: '情绪类型不能为空',
      });
    }

    const validMoods: MoodType[] = ['happy', 'calm', 'anxious', 'tired', 'angry'];
    if (!validMoods.includes(config.mood)) {
      return res.status(400).json({
        success: false,
        error: '无效的情绪类型',
      });
    }

    if (config.threshold === undefined || config.threshold === null) {
      return res.status(400).json({
        success: false,
        error: '阈值不能为空',
      });
    }

    if (config.threshold < 0 || config.threshold > 100) {
      return res.status(400).json({
        success: false,
        error: '阈值必须在 0-100 之间',
      });
    }

    if (config.enabled === undefined || config.enabled === null) {
      return res.status(400).json({
        success: false,
        error: '启用状态不能为空',
      });
    }

    const updatedConfig = store.setThreshold(config);

    return res.json({
      success: true,
      data: updatedConfig,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '设置阈值配置失败',
    });
  }
}
