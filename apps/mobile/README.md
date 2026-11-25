# AlertaCidade — app Android (Flutter)

Flutter 3.50 · Dart 3.14 · `material_ui` · Riverpod 3 · GoRouter 18 · Dio 5 · flutter_map 8 (OpenStreetMap) · geolocator.

## Executar

```powershell
cd apps/mobile
flutter pub get
flutter emulators --launch Medium_Phone_API_37.0
flutter run                                   # API em http://10.0.2.2:3000 (o seu computador, visto pelo emulador)
```

Em celular físico na mesma rede Wi-Fi, informe o IP do computador:

```powershell
flutter run --dart-define=API_BASE_URL=http://192.168.0.10:3000
```

> Em depuração o app aceita HTTP sem TLS **somente** para `10.0.2.2`, `localhost` e `127.0.0.1`
> (`android/app/src/debug/res/xml/network_security_config_debug.xml`). O build de release exige HTTPS.

| `--dart-define` | Padrão | Uso |
|---|---|---|
| `API_BASE_URL` | `http://10.0.2.2:3000` | Endereço da API |
| `APP_ENV` | `development` | `production` oculta o selo "ambiente de demonstração" |
| `MAP_TILE_URL` | tiles do OpenStreetMap | Provedor de mapas |

## Testes

```powershell
flutter analyze
flutter test
```

## Estrutura

```
lib/
├── main.dart, app/            app, rotas (GoRouter + redirecionamento por sessão), shell com barra inferior
├── core/
│   ├── config/                configuração por --dart-define
│   ├── theme/                 app_tokens.g.dart (GERADO de packages/design-tokens) + tema Material 3
│   ├── network/               cliente HTTP (renovação de token única sob concorrência), erros
│   ├── storage/               sessão no armazenamento seguro (Android Keystore)
│   ├── location/              GPS com consentimento explícito
│   ├── widgets/               componentes do design system (badges, cards, estados, marcador…)
│   └── providers.dart         injeção de dependências e sessão (Riverpod)
├── data/                      repositórios da API (auth, ocorrências, usuários)
├── domain/models.dart         modelos espelhando os contratos da API
└── features/                  auth, map, occurrences (nova, detalhes, meus registros), alerts, profile
```

`lib/core/theme/app_tokens.g.dart` é gerado: altere `packages/design-tokens/tokens.json` e rode `npm run tokens:build` na raiz.
