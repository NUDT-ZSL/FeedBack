import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type {
  SaltCertificate,
  IronCertificate,
  InspectionLog,
  IronCertChange,
  DailyStats,
  MonthlyReport,
  ReportAnomaly,
  SaltCertificateStatus,
  IronCertificateType,
  IronCertificateStatus,
} from '../src/types';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let saltCertificates: SaltCertificate[] = [];
let ironCertificates: IronCertificate[] = [];
let inspectionLogs: InspectionLog[] = [];
let ironCertChanges: IronCertChange[] = [];
let dailyStats: DailyStats[] = [];

const regions = ['淮南东路', '两浙路', '河北路', '河东路', '陕西路', '江南西路', '福建路'];
const seals = ['转运司印', '盐铁使印', '榷货务印', '提举盐事司印'];
const secretMarks = ['青龙', '白虎', '朱雀', '玄武'];
const inspectorNames = ['李转运使', '王判官', '张提举', '刘监官', '陈盐铁使'];
const avatarUrls = [
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&h=200&fit=crop&crop=face',
];

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSaltId(): string {
  const year = new Date().getFullYear();
  const prefix = '盐引';
  const num = String(randomInt(1000, 9999)).padStart(4, '0');
  return `${prefix}${year}${num}`;
}

function generateIronId(): string {
  const year = new Date().getFullYear();
  const prefix = '铁券';
  const num = String(randomInt(100, 999));
  return `${prefix}${year}${num}`;
}

function initMockData(): void {
  const today = new Date();
  
  for (let i = 0; i < 10; i++) {
    const issueDate = formatDate(addDays(today, -randomInt(0, 30)));
    const seal = randomItem(seals);
    const isMatch = Math.random() < 0.7;
    const secretMark = isMatch ? seal : randomItem(secretMarks);
    
    const cert: SaltCertificate = {
      id: generateSaltId(),
      saltAmount: randomInt(100, 500) * 10,
      issueDate,
      region: randomItem(regions),
      seal,
      secretMark,
      status: 'pending',
    };
    saltCertificates.push(cert);
  }

  const ironHolders = [
    { name: '范仲淹', title: '参知政事', type: 'exemption' as IronCertificateType },
    { name: '欧阳修', title: '枢密副使', type: 'mitigation' as IronCertificateType },
    { name: '包拯', title: '龙图阁直学士', type: 'corvee' as IronCertificateType },
  ];

  ironHolders.forEach((holder, index) => {
    const issueDate = formatDate(addDays(today, -randomInt(30, 180)));
    const expiryDate = formatDate(addDays(today, randomInt(180, 365)));
    
    const cert: IronCertificate = {
      id: generateIronId(),
      type: holder.type,
      holderName: holder.name,
      holderTitle: holder.title,
      holderAvatar: avatarUrls[index % avatarUrls.length],
      issueDate,
      expiryDate,
      status: 'active',
    };
    ironCertificates.push(cert);
  });

  for (let i = 6; i >= 0; i--) {
    const date = formatDate(addDays(today, -i));
    dailyStats.push({
      date,
      issued: randomInt(3, 10),
      verified: randomInt(2, 8),
      rejected: randomInt(0, 3),
    });
  }
}

initMockData();

app.get('/api/salt-certificates', (req: Request, res: Response) => {
  try {
    const { search, sort } = req.query;
    
    let result = [...saltCertificates];
    
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      result = result.filter(cert => 
        cert.id.toLowerCase().includes(searchLower)
      );
    }
    
    if (sort === 'asc' || sort === 'desc') {
      result.sort((a, b) => {
        const dateA = new Date(a.issueDate).getTime();
        const dateB = new Date(b.issueDate).getTime();
        return sort === 'asc' ? dateA - dateB : dateB - dateA;
      });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取盐引列表失败' });
  }
});

app.post('/api/salt-certificates', (req: Request, res: Response) => {
  try {
    const { saltAmount, region, seal, secretMark } = req.body;
    
    const newCert: SaltCertificate = {
      id: generateSaltId(),
      saltAmount,
      issueDate: formatDate(new Date()),
      region,
      seal,
      secretMark,
      status: 'pending',
    };
    
    saltCertificates.unshift(newCert);
    
    const log: InspectionLog = {
      id: uuidv4(),
      certificateId: newCert.id,
      certificateType: 'salt',
      action: 'issue',
      operator: randomItem(inspectorNames),
      timestamp: new Date().toISOString(),
      result: '已核发',
    };
    inspectionLogs.unshift(log);
    
    const today = formatDate(new Date());
    const todayIndex = dailyStats.findIndex(d => d.date === today);
    if (todayIndex >= 0) {
      dailyStats[todayIndex].issued++;
    } else {
      dailyStats.unshift({
        date: today,
        issued: 1,
        verified: 0,
        rejected: 0,
      });
    }
    
    res.status(201).json(newCert);
  } catch (error) {
    res.status(500).json({ error: '创建盐引失败' });
  }
});

app.put('/api/salt-certificates/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, inspector } = req.body;
    
    const certIndex = saltCertificates.findIndex(c => c.id === id);
    if (certIndex === -1) {
      return res.status(404).json({ error: '盐引不存在' });
    }
    
    const cert = saltCertificates[certIndex];
    cert.status = status as SaltCertificateStatus;
    cert.inspector = inspector || randomItem(inspectorNames);
    cert.inspectionDate = formatDate(new Date());
    
    const resultText = status === 'verified' ? '核验通过' : status === 'rejected' ? '已驳回' : '状态已更新';
    
    const log: InspectionLog = {
      id: uuidv4(),
      certificateId: cert.id,
      certificateType: 'salt',
      action: status === 'verified' ? 'verify' : status === 'rejected' ? 'reject' : 'update',
      operator: cert.inspector || randomItem(inspectorNames),
      timestamp: new Date().toISOString(),
      result: resultText,
    };
    inspectionLogs.unshift(log);
    
    const today = formatDate(new Date());
    const todayIndex = dailyStats.findIndex(d => d.date === today);
    if (todayIndex >= 0) {
      if (status === 'verified') {
        dailyStats[todayIndex].verified++;
      } else if (status === 'rejected') {
        dailyStats[todayIndex].rejected++;
      }
    }
    
    res.json(cert);
  } catch (error) {
    res.status(500).json({ error: '更新盐引失败' });
  }
});

app.get('/api/iron-certificates', (req: Request, res: Response) => {
  try {
    const { search, sort } = req.query;
    
    let result = [...ironCertificates];
    
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      result = result.filter(cert => 
        cert.holderName.toLowerCase().includes(searchLower)
      );
    }
    
    if (sort === 'asc' || sort === 'desc') {
      result.sort((a, b) => {
        const dateA = new Date(a.issueDate).getTime();
        const dateB = new Date(b.issueDate).getTime();
        return sort === 'asc' ? dateA - dateB : dateB - dateA;
      });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取铁券列表失败' });
  }
});

app.post('/api/iron-certificates', (req: Request, res: Response) => {
  try {
    const { type, holderName, holderTitle, holderAvatar } = req.body;
    
    const newCert: IronCertificate = {
      id: generateIronId(),
      type,
      holderName,
      holderTitle,
      holderAvatar,
      issueDate: formatDate(new Date()),
      expiryDate: formatDate(addDays(new Date(), 365)),
      status: 'active',
    };
    
    ironCertificates.unshift(newCert);
    
    const change: IronCertChange = {
      id: uuidv4(),
      certificateId: newCert.id,
      operationTime: new Date().toISOString(),
      operator: randomItem(inspectorNames),
      result: '已铸造',
    };
    ironCertChanges.unshift(change);
    
    res.status(201).json(newCert);
  } catch (error) {
    res.status(500).json({ error: '创建铁券失败' });
  }
});

app.put('/api/iron-certificates/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const certIndex = ironCertificates.findIndex(c => c.id === id);
    if (certIndex === -1) {
      return res.status(404).json({ error: '铁券不存在' });
    }
    
    const cert = ironCertificates[certIndex];
    cert.status = status as IronCertificateStatus;
    
    const resultText = status === 'revoked' ? '已吊销' : status === 'expired' ? '已过期' : '状态已更新';
    
    const change: IronCertChange = {
      id: uuidv4(),
      certificateId: cert.id,
      operationTime: new Date().toISOString(),
      operator: randomItem(inspectorNames),
      result: resultText,
    };
    ironCertChanges.unshift(change);
    
    const log: InspectionLog = {
      id: uuidv4(),
      certificateId: cert.id,
      certificateType: 'iron',
      action: 'update',
      operator: randomItem(inspectorNames),
      timestamp: new Date().toISOString(),
      result: resultText,
    };
    inspectionLogs.unshift(log);
    
    res.json(cert);
  } catch (error) {
    res.status(500).json({ error: '更新铁券失败' });
  }
});

app.get('/api/report', (req: Request, res: Response) => {
  try {
    const { month } = req.query;
    
    if (!month || typeof month !== 'string') {
      return res.status(400).json({ error: '请指定月份参数，格式为YYYY-MM' });
    }
    
    const [year, monthNum] = month.split('-').map(Number);
    if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: '月份格式错误，应为YYYY-MM' });
    }
    
    const monthStart = new Date(year, monthNum - 1, 1);
    const monthEnd = new Date(year, monthNum, 0);
    
    const monthData = dailyStats.filter(d => {
      const date = new Date(d.date);
      return date >= monthStart && date <= monthEnd;
    });
    
    const totalIssued = monthData.reduce((sum, d) => sum + d.issued, 0);
    const totalVerified = monthData.reduce((sum, d) => sum + d.verified, 0);
    const totalRejected = monthData.reduce((sum, d) => sum + d.rejected, 0);
    
    const matchRate = totalVerified + totalRejected > 0 
      ? Math.round((totalVerified / (totalVerified + totalRejected)) * 100) : 0;
    
    const anomalyTypes = [
      { type: '核发数量异常', desc: '本月核发数量与上月相比波动超过30%', severity: 'medium' as const },
      { type: '驳回率过高', desc: '盐引驳回率超过20%', severity: 'high' as const },
      { type: '铁券变更频繁', desc: '某铁券本月变更超过3次', severity: 'low' as const },
      { type: '日期异常', desc: '发现核发日期晚于核验日期', severity: 'high' as const },
      { type: '数量不符', desc: '核发总量与账册记录不一致', severity: 'medium' as const },
    ];
    
    const anomalyCount = randomInt(2, 3);
    const shuffled = [...anomalyTypes].sort(() => Math.random() - 0.5);
    const anomalies: ReportAnomaly[] = shuffled.slice(0, anomalyCount).map(a => ({
      id: uuidv4(),
      type: a.type,
      description: a.desc,
      severity: a.severity,
    }));
    
    const report: MonthlyReport = {
      month,
      totalIssued,
      totalVerified,
      totalRejected,
      matchRate,
      anomalies,
      dailyStats: monthData,
    };
    
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: '生成报告失败' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
