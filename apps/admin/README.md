# Painel administrativo (React + Vite) — Fase 5

Moderação, dashboard, mapa, relatórios com CSV, usuários, auditoria e saúde do ambiente.
Acesso só para MODERATOR e ADMIN (a API recusa as rotas para os demais).

```
npm run admin:dev     # na raiz → http://localhost:5173 (precisa de npm run api:dev)
npm run admin:test    # Vitest
npm run build -w @alertacidade/admin
```

- API: `VITE_API_URL` (padrão `http://localhost:3000`). A origem do painel precisa estar em `CORS_ORIGINS` da API.
- Contas de demonstração do seed: `moderacao@alertacidade.demo` e `admin@alertacidade.demo` (senha em `DEMO_USER_PASSWORD` no `.env`).
- Estilos só com os tokens `--ac-*` de `@alertacidade/design-tokens`; componentes em `src/components`.
- Instalação: o `vitest` 5.1.0 dispara um bug do npm (`Cannot read properties of null (reading 'edgesOut')`) ao ser
  adicionado num workspace; foi instalado com `--legacy-peer-deps`. Um `npm install` comum a partir do lockfile funciona.
