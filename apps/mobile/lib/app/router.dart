import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';

import '../core/providers.dart';
import '../features/alerts/alerts_page.dart';
import '../features/auth/auth_pages.dart';
import '../features/map/map_page.dart';
import '../features/news/news_detail_page.dart';
import '../features/news/news_monitor_page.dart';
import '../features/occurrences/my_reports_page.dart';
import '../features/occurrences/new_occurrence_page.dart';
import '../features/occurrences/occurrence_detail_page.dart';
import '../features/profile/profile_pages.dart';
import 'shell.dart';

const publicRoutes = {'/welcome', '/login', '/register', '/forgot-password', '/forgot-password/verify'};

/// Regra de redirecionamento (função pura, testada isoladamente).
String? resolveRedirect({required bool restoring, required bool authenticated, required String location}) {
  if (restoring) return location == '/splash' ? null : '/splash';
  final isPublic = publicRoutes.contains(location);
  if (!authenticated) return isPublic ? null : '/welcome';
  if (isPublic || location == '/splash') return '/map';
  return null;
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      return resolveRedirect(
        restoring: session.isLoading && !session.hasValue,
        authenticated: session.value != null,
        location: state.matchedLocation,
      );
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashPage()),
      GoRoute(path: '/welcome', builder: (_, _) => const WelcomePage()),
      GoRoute(path: '/login', builder: (_, _) => const LoginPage()),
      GoRoute(path: '/register', builder: (_, _) => const RegisterPage()),
      GoRoute(path: '/forgot-password', builder: (_, _) => const ForgotPasswordPage()),
      GoRoute(
        path: '/forgot-password/verify',
        builder: (_, state) => ResetPasswordPage(email: state.extra as String? ?? ''),
      ),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/map', builder: (_, _) => const MapPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/alerts', builder: (_, _) => const AlertsPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/my-reports', builder: (_, _) => const MyReportsPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/profile', builder: (_, _) => const ProfilePage())]),
        ],
      ),
      GoRoute(path: '/occurrences/new', builder: (_, _) => const NewOccurrencePage()),
      GoRoute(
        path: '/occurrences/new/location',
        builder: (_, state) => LocationPickerPage(initial: state.extra as LatLng?),
      ),
      GoRoute(path: '/occurrences/:id', builder: (_, state) => OccurrenceDetailPage(id: state.pathParameters['id']!)),
      GoRoute(path: '/news', builder: (_, _) => const NewsMonitorPage()),
      GoRoute(path: '/news/:id', builder: (_, state) => NewsDetailPage(id: state.pathParameters['id']!)),
      GoRoute(path: '/profile/notifications', builder: (_, _) => const NotificationPreferencesPage()),
      GoRoute(path: '/profile/password', builder: (_, _) => const ChangePasswordPage()),
      GoRoute(path: '/profile/delete', builder: (_, _) => const DeleteAccountPage()),
      GoRoute(path: '/profile/about', builder: (_, _) => const AboutPage()),
    ],
  );
});
