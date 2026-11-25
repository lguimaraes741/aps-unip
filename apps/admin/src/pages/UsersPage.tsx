import type { UserRole } from '@alertacidade/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { http, type AdminUser } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog, EmptyState, ErrorState, LoadingSkeleton, Pagination, useToast } from '../components/ui';
import { formatDateTime, ROLE_LABEL } from '../lib/format';

type Change = { user: AdminUser; role?: UserRole; status?: 'ACTIVE' | 'SUSPENDED' };

export function UsersPage() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Change | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => (setQ(search.trim()), setPage(1)), 300);
    return () => clearTimeout(t);
  }, [search]);

  const users = useQuery({ queryKey: ['users', q, role, page], queryFn: () => http.users({ q: q || undefined, role: role || undefined, page }), placeholderData: keepPreviousData });
  const update = useMutation({
    mutationFn: (c: Change) => http.updateUser(c.user.id, { role: c.role, status: c.status }),
    onSuccess: (u) => {
      toast(`${u.name}: ${ROLE_LABEL[u.role]}, ${u.status === 'SUSPENDED' ? 'suspenso' : 'ativo'}.`, 'success');
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Não foi possível alterar o usuário.', 'error'),
  });

  const describe = (c: Change) =>
    c.status === 'SUSPENDED'
      ? `Suspender ${c.user.name}? As sessões dele serão encerradas e ele não conseguirá entrar até ser reativado.`
      : c.status === 'ACTIVE'
        ? `Reativar a conta de ${c.user.name}?`
        : `Alterar o perfil de ${c.user.name} para ${ROLE_LABEL[c.role!]}? Vale a partir do próximo login dele.`;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Usuários</h1>
      </header>
      <section className="card">
        <div className="filters">
          <input type="search" placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuários" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Perfil" value={role} onChange={(e) => (setRole(e.target.value as UserRole | ''), setPage(1))}>
            <option value="">Todos os perfis</option>
            {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        {users.isPending ? (
          <LoadingSkeleton rows={5} />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : users.data.items.length === 0 ? (
          <EmptyState title="Nenhum usuário encontrado" />
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Situação</th>
                  <th>Último acesso</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((u) => {
                  const self = u.id === me?.id;
                  const deleted = u.status === 'DELETED';
                  return (
                    <tr key={u.id}>
                      <td>
                        {u.name} {self && <span className="caption muted">(você)</span>}
                      </td>
                      <td>{u.email}</td>
                      <td>
                        <select
                          aria-label={`Perfil de ${u.name}`}
                          value={u.role}
                          disabled={self || deleted || update.isPending}
                          onChange={(e) => setPending({ user: u, role: e.target.value as UserRole })}
                        >
                          {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{deleted ? 'Excluída' : u.status === 'SUSPENDED' ? <strong className="danger-text">Suspensa</strong> : 'Ativa'}</td>
                      <td>{formatDateTime(u.lastLoginAt)}</td>
                      <td>
                        {!self && !deleted && (
                          <button
                            className={`btn ${u.status === 'SUSPENDED' ? 'secondary' : 'ghost danger-text'}`}
                            disabled={update.isPending}
                            onClick={() => setPending({ user: u, status: u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' })}
                          >
                            {u.status === 'SUSPENDED' ? 'Reativar' : 'Suspender'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} limit={20} total={users.data.total} onPage={setPage} />
          </>
        )}
      </section>
      <ConfirmDialog
        open={pending !== null}
        title="Confirmar alteração"
        message={pending ? describe(pending) : ''}
        confirmLabel="Confirmar"
        destructive={pending?.status === 'SUSPENDED'}
        busy={update.isPending}
        onConfirm={() => pending && update.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
