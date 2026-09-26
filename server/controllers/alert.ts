import type { Request, Response } from 'express';
import { store } from '../store';
import type { AlertEvent, ApiResponse } from '../types';

export async function getAlerts(req: Request, res: Response<ApiResponse<AlertEvent[]>>) {
  try {
    const alerts = store.getAlerts();

    return res.json({
      success: true,
      data: alerts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '获取预警列表失败',
    });
  }
}

export async function checkAlerts(req: Request, res: Response<ApiResponse<AlertEvent[]>>) {
  try {
    const triggeredAlerts = store.checkThresholds();

    return res.json({
      success: true,
      data: triggeredAlerts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '检查预警失败',
    });
  }
}
