export type SaltCertificateStatus = 'pending' | 'verified' | 'rejected';
export type IronCertificateType = 'exemption' | 'mitigation' | 'corvee';
export type IronCertificateStatus = 'active' | 'expired' | 'revoked';

export interface SaltCertificate {
  id: string;
  saltAmount: number;
  issueDate: string;
  region: string;
  seal: string;
  secretMark: string;
  status: SaltCertificateStatus;
  inspector?: string;
  inspectionDate?: string;
}

export interface IronCertificate {
  id: string;
  type: IronCertificateType;
  holderName: string;
  holderTitle: string;
  holderAvatar: string;
  issueDate: string;
  expiryDate: string;
  status: IronCertificateStatus;
}

export interface InspectionLog {
  id: string;
  certificateId: string;
  certificateType: 'salt' | 'iron';
  action: 'issue' | 'verify' | 'reject' | 'update';
  operator: string;
  timestamp: string;
  result: string;
}

export interface IronCertChange {
  id: string;
  certificateId: string;
  operationTime: string;
  operator: string;
  result: string;
}

export interface DailyStats {
  date: string;
  issued: number;
  verified: number;
  rejected: number;
}

export interface MonthlyReport {
  month: string;
  totalIssued: number;
  totalVerified: number;
  totalRejected: number;
  matchRate: number;
  anomalies: ReportAnomaly[];
  dailyStats: DailyStats[];
}

export interface ReportAnomaly {
  id: string;
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}
 'medium' | 'high';
}
