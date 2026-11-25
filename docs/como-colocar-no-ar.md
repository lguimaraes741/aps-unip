# Como colocar o AlertaCidade no ar (túnel Cloudflare) e gerar o APK

Guia para deixar o sistema acessível pela internet a partir do **seu PC**, com um endereço HTTPS gratuito do
Cloudflare, e gerar o app para instalar em outros celulares Android.

> **Quando refazer:** sempre que o PC reiniciar, o Claude Code/terminais forem fechados ou o túnel cair.
> O endereço do túnel **muda a cada vez** — então o APK precisa ser **gerado e enviado de novo** (passo 4).

Use o **PowerShell** na pasta do projeto (`C:\Users\pichau\projetos\alertacidade`). No PowerShell, use `npm.cmd`
(o `npm` sozinho é bloqueado pela política de execução).

---

## 1. Banco e Redis

1. Abra o **Docker Desktop** e espere ficar verde.
2. Num terminal:
   ```powershell
   npm.cmd run infra:up
   ```

## 2. Servidor (3 terminais, deixe todos abertos)

| Terminal | Comando | Deve aparecer |
|---|---|---|
| 1 — API em modo produção | `npm.cmd run api:prod` | `Nest application successfully started` |
| 2 — Notificações | `npm.cmd run worker:dev` | `iniciado — push: fcm` |
| 3 — Monitoramento de notícias | `npm.cmd run news:dev` | `"msg":"iniciado"` |

Conferir no navegador: <http://localhost:3000/api/v1/health> → `"status":"ok"` e `"environment":"production"`.

O modo produção fecha o Swagger e não mostra códigos de recuperação de senha no log.

## 3. Túnel (4º terminal, deixe aberto)

```powershell
npm.cmd run tunnel
```

Procure no texto uma linha com o endereço, por exemplo:

```
https://andrea-observation-jan-newton.trycloudflare.com
```

Copie esse endereço e confira no navegador: `<endereço>/api/v1/health` deve responder `"status":"ok"`.

> Se o comando `cloudflared` não for encontrado, feche e abra o terminal (o instalador adicionou ao PATH), ou use
> `& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:3000`.

## 4. Gerar o APK com o endereço do túnel

```powershell
cd apps\mobile
flutter build apk --release --dart-define=API_BASE_URL=https://SEU-ENDERECO.trycloudflare.com --dart-define=APP_ENV=production
Copy-Item build\app\outputs\flutter-apk\app-release.apk $HOME\Downloads\AlertaCidade.apk -Force
cd ..\..
```

- Leva de 4 a 5 minutos. O arquivo fica em `C:\Users\pichau\Downloads\AlertaCidade.apk` (~62 MB).
- Use o endereço **exato** do passo 3, com `https://` e sem barra no final.

## 5. Instalar nos celulares (Android)

- **Outras pessoas:** envie o `AlertaCidade.apk` (WhatsApp, Google Drive). No celular: abrir o arquivo → permitir
  "instalar apps desconhecidos" → Instalar. Se já tinham a versão anterior, instala por cima.
- **Seu celular pelo cabo:** `& "$env:LOCALAPPDATA\Android\sdk\platform-tools\adb.exe" install -r $HOME\Downloads\AlertaCidade.apk`
- Cada pessoa cria a própria conta no app. iPhone não é suportado.

## 6. Manter no ar

- O PC precisa ficar **ligado e sem suspender** (Configurações → Sistema → Energia → suspensão: "Nunca").
- Os **4 terminais** precisam ficar abertos.
- Para desligar tudo: feche os terminais (ou `Ctrl+C` em cada um) e, se quiser, `npm.cmd run infra:down`.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| App diz "Sem conexão com o servidor" | Túnel caiu ou mudou de endereço; API parada | Conferir os terminais 1 e 4; se o endereço mudou, refazer o passo 4 e reenviar o APK |
| `<endereço>/api/v1/health` não abre | Túnel não iniciou ou API não está na porta 3000 | Ver o terminal 4; abrir <http://localhost:3000/api/v1/health> |
| Health mostra `"redis":"down"` ou `"database":"down"` | Docker parado | Abrir o Docker Desktop e `npm.cmd run infra:up` |
| Push não chega | Worker de notificações parado | Ver o terminal 2 |
| `npm.cmd run api:prod` falha ao compilar | Dependências desatualizadas | `npm.cmd ci` e tentar de novo |

## Segurança

- As contas de demonstração usam a senha do `.env` (`DEMO_USER_PASSWORD`), que também está no `.env.example` do
  repositório. Com o sistema na internet, quem conhece essa senha entra como administrador. Para trocar: entrar com a
  conta **no app** → Perfil → Alterar senha (o painel não tem essa tela), e atualizar `DEMO_USER_PASSWORD` no `.env`.
- O painel web não passa pelo túnel: ele continua acessível só no seu PC (`npm.cmd run admin:dev`).
