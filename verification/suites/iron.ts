import type { InspectionLog, IronCertChange, IronCertificate } from '../../src/types';
import {
  assert,
  assertDeepEqual,
  assertEqual,
  type Check,
  type Client,
} from '../framework';

async function firstActive(client: Client, exclude: string[] = []): Promise<IronCertificate> {
  const { body } = await client.get<IronCertificate[]>('/api/iron-certificates');
  const cert = body.find((c) => c.status === 'active' && !exclude.includes(c.id));
  assert(cert, '前置数据应包含有效铁券');
  return cert;
}

async function latestChange(client: Client, certId: string): Promise<IronCertChange> {
  const { body } = await client.get<IronCertChange[]>('/api/iron-cert-changes');
  const change = body.find((c) => c.certificateId === certId);
  assert(change, `铁券变更留痕缺失: ${certId}`);
  return change;
}

async function snapshot(client: Client): Promise<unknown> {
  const [certs, changes, logs] = await Promise.all([
    client.get('/api/iron-certificates'),
    client.get('/api/iron-cert-changes'),
    client.get('/api/inspection-logs'),
  ]);
  return { certs: certs.body, changes: changes.body, logs: logs.body };
}

export const ironChecks: Check[] = [
  {
    id: 'IRON-01',
    name: '铁券吊销后持有状态与变更留痕一致',
    run: async ({ server }) => {
      const cert = await firstActive(server.client);
      const res = await server.client.put<IronCertificate>(`/api/iron-certificates/${cert.id}`, { status: 'revoked' });
      assertEqual(res.status, 200, '吊销应成功');
      assertEqual(res.body.status, 'revoked', '状态应为已吊销');

      const change = await latestChange(server.client, cert.id);
      assertEqual(change.result, '已吊销', '留痕结论');
      assertEqual(change.fromStatus, 'active', '留痕变更前状态');
      assertEqual(change.toStatus, 'revoked', '留痕变更后状态');

      const { body: logs } = await server.client.get<InspectionLog[]>('/api/inspection-logs');
      assert(logs.some((l) => l.certificateId === cert.id && l.certificateType === 'iron' && l.result === '已吊销'),
        '操作日志中应存在吊销记录');
    },
  },
  {
    id: 'IRON-02',
    name: '铁券过期后持有状态与变更留痕一致',
    run: async ({ server }) => {
      const cert = await firstActive(server.client);
      const res = await server.client.put<IronCertificate>(`/api/iron-certificates/${cert.id}`, { status: 'expired' });
      assertEqual(res.status, 200, '过期操作应成功');
      assertEqual(res.body.status, 'expired', '状态应为已过期');

      const change = await latestChange(server.client, cert.id);
      assertEqual(change.result, '已过期', '留痕结论');
      assertEqual(change.fromStatus, 'active', '留痕变更前状态');
      assertEqual(change.toStatus, 'expired', '留痕变更后状态');
    },
  },
  {
    id: 'IRON-03',
    name: '有效铁券续期后到期日与留痕同步更新',
    run: async ({ server }) => {
      const cert = await firstActive(server.client);
      const res = await server.client.put<IronCertificate>(`/api/iron-certificates/${cert.id}`, {
        status: 'active',
        expiryDate: '2028-01-01',
      });
      assertEqual(res.status, 200, '续期应成功');
      assertEqual(res.body.status, 'active', '续期后应保持有效');
      assertEqual(res.body.expiryDate, '2028-01-01', '到期日应更新');

      const change = await latestChange(server.client, cert.id);
      assertEqual(change.result, '已续期', '留痕结论');
      assertEqual(change.fromStatus, 'active', '留痕变更前状态');
      assertEqual(change.toStatus, 'active', '留痕变更后状态');
    },
  },
  {
    id: 'IRON-04',
    name: '已过期铁券可续期恢复有效',
    run: async ({ server }) => {
      const cert = await firstActive(server.client);
      await server.client.put(`/api/iron-certificates/${cert.id}`, { status: 'expired' });
      const res = await server.client.put<IronCertificate>(`/api/iron-certificates/${cert.id}`, {
        status: 'active',
        expiryDate: '2028-06-30',
      });
      assertEqual(res.status, 200, '过期铁券续期应成功');
      assertEqual(res.body.status, 'active', '续期后应恢复有效');
      assertEqual(res.body.expiryDate, '2028-06-30', '到期日应更新');

      const change = await latestChange(server.client, cert.id);
      assertEqual(change.fromStatus, 'expired', '留痕变更前状态');
      assertEqual(change.toStatus, 'active', '留痕变更后状态');
    },
  },
  {
    id: 'IRON-05',
    name: '同一铁券重复变更结果可预期且状态不被改写',
    run: async ({ server }) => {
      const revoked = await firstActive(server.client);
      await server.client.put(`/api/iron-certificates/${revoked.id}`, { status: 'revoked' });
      const beforeRevoked = await snapshot(server.client);

      const again = await server.client.put<{ code: string }>(`/api/iron-certificates/${revoked.id}`, { status: 'revoked' });
      assertEqual(again.status, 409, '已吊销铁券再次变更应返回409');
      assertEqual(again.body.code, 'IRON_CERT_REVOKED', '错误码');
      const renewRevoked = await server.client.put<{ code: string }>(`/api/iron-certificates/${revoked.id}`, {
        status: 'active', expiryDate: '2030-01-01',
      });
      assertEqual(renewRevoked.status, 409, '已吊销铁券续期应返回409');
      assertEqual(renewRevoked.body.code, 'IRON_CERT_REVOKED', '错误码');
      assertDeepEqual(await snapshot(server.client), beforeRevoked, '失败后状态不应变化');

      const expired = await firstActive(server.client, [revoked.id]);
      await server.client.put(`/api/iron-certificates/${expired.id}`, { status: 'expired' });
      const beforeExpired = await snapshot(server.client);

      const expireAgain = await server.client.put<{ code: string }>(`/api/iron-certificates/${expired.id}`, { status: 'expired' });
      assertEqual(expireAgain.status, 409, '重复过期应返回409');
      assertEqual(expireAgain.body.code, 'IRON_CERT_ALREADY_IN_STATE', '错误码');
      const revokeExpired = await server.client.put<{ code: string }>(`/api/iron-certificates/${expired.id}`, { status: 'revoked' });
      assertEqual(revokeExpired.status, 409, '已过期铁券吊销应返回409');
      assertEqual(revokeExpired.body.code, 'IRON_CERT_INVALID_TRANSITION', '错误码');
      assertDeepEqual(await snapshot(server.client), beforeExpired, '失败后状态不应变化');
    },
  },
  {
    id: 'IRON-06',
    name: '续期参数校验返回明确400错误语义',
    run: async ({ server }) => {
      const cert = await firstActive(server.client);
      const before = await snapshot(server.client);

      const pastDate = await server.client.put<{ code: string }>(`/api/iron-certificates/${cert.id}`, {
        status: 'active', expiryDate: '2020-01-01',
      });
      assertEqual(pastDate.status, 400, '续期日期早于当前到期日应返回400');
      assertEqual(pastDate.body.code, 'INVALID_RENEWAL_DATE', '错误码');

      const noDate = await server.client.put<{ code: string }>(`/api/iron-certificates/${cert.id}`, { status: 'active' });
      assertEqual(noDate.status, 400, '续期缺少到期日应返回400');
      assertEqual(noDate.body.code, 'RENEWAL_REQUIRES_EXPIRY_DATE', '错误码');

      const badStatus = await server.client.put<{ code: string }>(`/api/iron-certificates/${cert.id}`, { status: 'unknown' });
      assertEqual(badStatus.status, 400, '非法状态应返回400');
      assertEqual(badStatus.body.code, 'INVALID_IRON_STATUS', '错误码');

      const missing = await server.client.put<{ code: string }>('/api/iron-certificates/铁券0000000000', { status: 'revoked' });
      assertEqual(missing.status, 404, '不存在的铁券应返回404');
      assertEqual(missing.body.code, 'IRON_CERT_NOT_FOUND', '错误码');

      assertDeepEqual(await snapshot(server.client), before, '失败后状态不应变化');
    },
  },
];
