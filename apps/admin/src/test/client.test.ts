import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../api/client';
import { diff } from '../pages/AuditPage';
import { periodToRange } from '../pages/ReportsPage';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiClient', () => {
  it('requisições simultâneas com token expirado renovam a sessão UMA vez (evita detecção de reuso)', async () => {
    let refreshes = 0;
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 'novo', refreshToken: 'r2', user: { id: '1', name: 'A', email: 'a@a', role: 'ADMIN' } });
      }
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === 'Bearer novo' ? json(200, { ok: true }) : json(401, { message: 'Token inválido' });
    });
    const client = new ApiClient('http://api/api/v1', memoryStorage(), fetcher as typeof fetch);
    client.setSession({ accessToken: 'velho', refreshToken: 'r1' });

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => client.request<{ ok: boolean }>('/admin/dashboard')));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(refreshes).toBe(1);
  });

  it('renovação recusada encerra a sessão e avisa a interface', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => (String(url).endsWith('/auth/refresh') ? json(401, {}) : json(401, {})));
    const client = new ApiClient('http://api/api/v1', memoryStorage(), fetcher as typeof fetch);
    client.setSession({ accessToken: 'a', refreshToken: 'r' });
    const expired = vi.fn();
    client.onSessionExpired(expired);
    await expect(client.request('/admin/dashboard')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalled();
    expect(client.hasStoredSession).toBe(false);
  });

  it('erros viram ApiError com a mensagem da API (ou uma padrão em português)', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(409, { message: 'Esta ocorrência foi alterada por outra pessoa' }))
      .mockResolvedValueOnce(json(422, { message: ['Informe o motivo', 'Outro erro'] }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = new ApiClient('http://api/api/v1', memoryStorage(), fetcher as typeof fetch);
    client.setSession({ accessToken: 'a', refreshToken: 'r' });
    const err = (await client.request('/x').catch((e) => e)) as ApiError;
    expect(err.isConflict).toBe(true);
    expect(err.message).toMatch(/outra pessoa/);
    expect(((await client.request('/x').catch((e) => e)) as ApiError).message).toBe('Informe o motivo Outro erro');
    expect(((await client.request('/x').catch((e) => e)) as ApiError).message).toMatch(/indisponível/);
    expect(((await client.request('/x').catch((e) => e)) as ApiError).status).toBe(0);
  });
});

describe('funções de apoio', () => {
  it('período do relatório: fim inclusivo para o usuário vira intervalo [from, to)', () => {
    const { from, to } = periodToRange('2026-11-01', '2026-11-30');
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(30 * 24 * 3600_000);
  });

  it('auditoria mostra só o que mudou', () => {
    expect(diff({ status: 'PENDING', version: 1, note: null }, { status: 'VALIDATED', version: 2, note: null })).toEqual([
      { key: 'status', before: 'PENDING', after: 'VALIDATED' },
      { key: 'version', before: 1, after: 2 },
    ]);
    expect(diff(null, { role: 'MODERATOR' })).toEqual([{ key: 'role', before: undefined, after: 'MODERATOR' }]);
  });
});
