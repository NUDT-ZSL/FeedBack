export interface KLineData {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  changePercent: number;
}

export interface StockConfig {
  name: string;
  code: string;
  basePrice: number;
  volatility: number;
  trend: number;
}

const STOCK_CONFIGS: StockConfig[] = [
  { name: 'AAPL', code: 'AAPL', basePrice: 185, volatility: 0.018, trend: 0.002 },
  { name: 'TSLA', code: 'TSLA', basePrice: 245, volatility: 0.035, trend: -0.001 },
  { name: 'NVDA', code: 'NVDA', basePrice: 480, volatility: 0.028, trend: 0.004 },
];

function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function generateKLineData(stockIndex: number, days: number = 30): KLineData[] {
  const config = STOCK_CONFIGS[stockIndex];
  const data: KLineData[] = [];
  let price = config.basePrice;

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);

  for (let i = 0; i < days; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + i);

    if (currentDate.getDay() === 0 || currentDate.getDay() === 6) continue;

    const dailyReturn = config.trend + config.volatility * gaussianRandom();
    const open = price;
    const close = open * (1 + dailyReturn);
    const highExtra = Math.abs(gaussianRandom()) * config.volatility * open * 0.5;
    const lowExtra = Math.abs(gaussianRandom()) * config.volatility * open * 0.5;
    const high = Math.max(open, close) + highExtra;
    const low = Math.min(open, close) - lowExtra;
    const volume = Math.floor(5_000_000 + Math.random() * 15_000_000 + (Math.abs(dailyReturn) * 100_000_000));

    data.push({
      date: currentDate.toISOString().split('T')[0],
      open: parseFloat(open.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(Math.max(low, 1).toFixed(2)),
      volume,
      changePercent: parseFloat((dailyReturn * 100).toFixed(2)),
    });

    price = close;
  }

  return data;
}

export function getStockConfig(index: number): StockConfig {
  return STOCK_CONFIGS[index];
}

export function getStockCount(): number {
  return STOCK_CONFIGS.length;
}

export function getTooltipData(data: KLineData): Record<string, string> {
  return {
    date: data.date,
    open: data.open.toFixed(2),
    close: data.close.toFixed(2),
    high: data.high.toFixed(2),
    low: data.low.toFixed(2),
    changePercent: data.changePercent.toFixed(2) + '%',
  };
}

export function computeStatistics(data: KLineData[]) {
  if (!data.length) return null;
  const latest = data[data.length - 1];
  const highest = Math.max(...data.map(d => d.high));
  const lowest = Math.min(...data.map(d => d.low));
  const avgVolume = Math.floor(data.reduce((s, d) => s + d.volume, 0) / data.length);
  return {
    latestClose: latest.close,
    changePercent: latest.changePercent,
    highest,
    lowest,
    avgVolume,
    volumes: data.slice(-15).map(d => d.volume),
  };
}
