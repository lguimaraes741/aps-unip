import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' hide Path;
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/utils/share.dart';
import '../../core/widgets/badges.dart';
import '../../core/widgets/buttons.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/severity_widgets.dart';
import '../../core/widgets/states.dart';
import '../../core/widgets/tones.dart';
import '../../domain/models.dart';
import '../map/map_state.dart';
import 'my_reports_page.dart';

/// Estado da tela de detalhes. Ações (confirmar, salvar) atualizam o estado local
/// com a resposta da API, que é a fonte da verdade dos contadores.
class OccurrenceDetailNotifier extends AsyncNotifier<OccurrenceDetail> {
  OccurrenceDetailNotifier(this.id);

  final String id;

  @override
  Future<OccurrenceDetail> build() {
    final position = ref.read(userLocationProvider)?.position;
    return ref.read(occurrencesRepositoryProvider).detail(id, lat: position?.latitude, lng: position?.longitude);
  }

  Future<void> setConfirmation(ConfirmationType? type) async {
    final current = state.requireValue;
    final result = await ref.read(occurrencesRepositoryProvider).setConfirmation(id, type);
    state = AsyncData(
      current.copyWith(
        confirmCount: result.confirmCount,
        contestCount: result.contestCount,
        myConfirmation: () => result.myConfirmation,
      ),
    );
  }

  Future<void> toggleSaved() async {
    final current = state.requireValue;
    await ref.read(occurrencesRepositoryProvider).setSaved(id, !current.isSaved);
    state = AsyncData(current.copyWith(isSaved: !current.isSaved));
  }
}

final occurrenceDetailProvider = AsyncNotifierProvider.autoDispose
    .family<OccurrenceDetailNotifier, OccurrenceDetail, String>(OccurrenceDetailNotifier.new);

class OccurrenceDetailPage extends ConsumerWidget {
  const OccurrenceDetailPage({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(occurrenceDetailProvider(id));
    return detail.when(
      data: (o) => _DetailView(o: o),
      loading: () => Scaffold(appBar: AppBar(), body: const LoadingSkeleton(items: 4, itemHeight: 120)),
      error: (e, _) => Scaffold(
        appBar: AppBar(),
        body: ErrorState(error: e, onRetry: () => ref.invalidate(occurrenceDetailProvider(id))),
      ),
    );
  }
}

class _DetailView extends ConsumerStatefulWidget {
  const _DetailView({required this.o});

  final OccurrenceDetail o;

  @override
  ConsumerState<_DetailView> createState() => _DetailViewState();
}

class _DetailViewState extends ConsumerState<_DetailView> {
  bool _busy = false;

  OccurrenceDetail get o => widget.o;
  OccurrenceDetailNotifier get _notifier => ref.read(occurrenceDetailProvider(o.id).notifier);

  Future<void> _run(Future<void> Function() action, {String? success}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      if (mounted && success != null) showAppSnackbar(context, success, kind: SnackKind.success);
    } on ApiException catch (e) {
      if (mounted) showAppSnackbar(context, e.message, kind: SnackKind.error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _vote(ConfirmationType type) {
    // Tocar de novo na mesma opção retira a manifestação.
    final next = o.myConfirmation == type ? null : type;
    _run(() => _notifier.setConfirmation(next));
  }

  Future<void> _share() => shareOccurrence(
        code: o.code,
        title: o.title,
        severity: o.severity,
        status: o.status,
        address: o.address,
        neighborhood: o.neighborhood,
        createdAt: o.createdAt,
        latitude: o.latitude,
        longitude: o.longitude,
      );

  Future<void> _openInMaps() async {
    final geo = Uri.parse(
      'geo:${o.latitude},${o.longitude}?q=${o.latitude},${o.longitude}(${Uri.encodeComponent(o.title)})',
    );
    final web = Uri.parse(
      'https://www.openstreetmap.org/?mlat=${o.latitude}&mlon=${o.longitude}#map=17/${o.latitude}/${o.longitude}',
    );
    if (!await launchUrl(geo) && !await launchUrl(web, mode: LaunchMode.externalApplication) && mounted) {
      showAppSnackbar(context, 'Nenhum aplicativo de mapas disponível.', kind: SnackKind.error);
    }
  }

  Future<void> _report() async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Denunciar conteúdo', style: AcTypeScale.title),
            const SizedBox(height: AcSpacing.sm),
            for (final (value, label) in const [
              ('FALSE_INFORMATION', 'Informação falsa'),
              ('OFFENSIVE', 'Conteúdo ofensivo'),
              ('PERSONAL_DATA', 'Expõe dados pessoais'),
              ('SPAM', 'Spam'),
              ('OTHER', 'Outro motivo'),
            ])
              ListTile(title: Text(label), onTap: () => Navigator.pop(context, value)),
          ],
        ),
      ),
    );
    if (reason == null) return;
    await _run(
      () => ref.read(occurrencesRepositoryProvider).report(o.id, reason),
      success: 'Denúncia enviada para a moderação.',
    );
  }

  Future<void> _delete() async {
    final ok = await showConfirmationDialog(
      context,
      title: 'Remover ocorrência?',
      message: 'O registro deixará de aparecer para todos. Esta ação não pode ser desfeita.',
      confirmLabel: 'Remover',
      destructive: true,
    );
    if (!ok) return;
    await _run(() async {
      await ref.read(occurrencesRepositoryProvider).remove(o.id);
      // A remoção afeta o mapa e também "Meus registros" (lista e totais).
      ref.invalidate(nearbyOccurrencesProvider);
      ref.invalidate(myReportsProvider);
      ref.invalidate(mySummaryProvider);
      if (mounted) context.pop();
    }, success: 'Ocorrência removida.');
  }

  @override
  Widget build(BuildContext context) {
    final headerColor = o.severity.headerColor;
    final updated = o.history.isEmpty ? o.createdAt : o.history.last.createdAt;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: AcColors.background,
        body: CustomScrollView(
          slivers: [
            SliverAppBar(
              pinned: true,
              expandedHeight: 196,
              backgroundColor: headerColor,
              foregroundColor: AcColors.onPrimary,
              surfaceTintColor: Colors.transparent,
              title: Text('Ocorrência #${o.code}', style: AcTypeScale.subtitle.copyWith(color: AcColors.onPrimary)),
              actions: [
                // Ações raras e sensíveis ficam no menu; as frequentes (salvar, compartilhar) estão visíveis abaixo.
                if (!o.isMine || o.status == OccurrenceStatus.pending)
                  PopupMenuButton<String>(
                    tooltip: 'Mais ações',
                    onSelected: (v) => v == 'report' ? _report() : _delete(),
                    itemBuilder: (_) => [
                      if (!o.isMine) const PopupMenuItem(value: 'report', child: Text('Denunciar conteúdo')),
                      if (o.isMine && o.status == OccurrenceStatus.pending) const PopupMenuItem(value: 'delete', child: Text('Remover ocorrência')),
                    ],
                  ),
              ],
              flexibleSpace: FlexibleSpaceBar(
                collapseMode: CollapseMode.pin,
                background: _SeverityHeader(o: o, color: headerColor, updated: updated),
              ),
              // Painel arredondado que "sobe" sobre o cabeçalho (como no protótipo).
              bottom: PreferredSize(
                preferredSize: const Size.fromHeight(AcRadius.xl),
                child: Container(
                  height: AcRadius.xl + 1,
                  transform: Matrix4.translationValues(0, 1, 0),
                  decoration: const BoxDecoration(
                    color: AcColors.background,
                    borderRadius: BorderRadius.vertical(top: Radius.circular(AcRadius.xl)),
                  ),
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(AcSpacing.lg, 0, AcSpacing.lg, AcSpacing.xxl),
              sliver: SliverList.list(
                children: [
                  _SummaryCard(o: o),
                  const SizedBox(height: AcSpacing.md),
                  SectionCard(
                    title: 'Esta ocorrência ainda acontece?',
                    child: _Participation(o: o, busy: _busy, onVote: _vote),
                  ),
                  const SizedBox(height: AcSpacing.md),
                  Wrap(
                    spacing: AcSpacing.sm,
                    runSpacing: AcSpacing.sm,
                    children: [
                      PillButton(
                        label: o.isSaved ? 'Salva' : 'Salvar',
                        icon: o.isSaved ? Icons.bookmark : Icons.bookmark_border,
                        selected: o.isSaved,
                        semanticLabel: o.isSaved ? 'Remover dos salvos' : 'Salvar ocorrência',
                        onPressed: _busy ? null : () => _run(_notifier.toggleSaved, success: o.isSaved ? 'Removida dos salvos.' : 'Ocorrência salva.'),
                      ),
                      PillButton(label: 'Compartilhar', icon: Icons.share_outlined, onPressed: _share),
                    ],
                  ),
                  if (o.photos.isNotEmpty) ...[
                    const SizedBox(height: AcSpacing.lg),
                    _PhotoStrip(photos: o.photos),
                  ],
                  const SizedBox(height: AcSpacing.lg),
                  SectionCard(
                    title: 'Relato',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(o.description, style: AcTypeScale.body.copyWith(height: 1.55)),
                        const SizedBox(height: AcSpacing.md),
                        _SourceNotice(status: o.status),
                      ],
                    ),
                  ),
                  if (o.moderationNote != null) ...[
                    const SizedBox(height: AcSpacing.md),
                    SectionCard(title: 'Observação da moderação', child: Text(o.moderationNote!, style: AcTypeScale.body)),
                  ],
                  const SizedBox(height: AcSpacing.md),
                  SectionCard(
                    title: 'Localização',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ClipRRect(
                      borderRadius: BorderRadius.circular(AcRadius.md),
                      child: SizedBox(
                        height: 170,
                        child: IgnorePointer(
                          child: FlutterMap(
                            options: MapOptions(initialCenter: LatLng(o.latitude, o.longitude), initialZoom: 16),
                            children: [
                              TileLayer(urlTemplate: AppConfig.tileUrlTemplate, userAgentPackageName: AppConfig.userAgentPackageName),
                              MarkerLayer(markers: [
                                Marker(
                                  point: LatLng(o.latitude, o.longitude),
                                  width: SeverityMarker.size,
                                  height: SeverityMarker.size,
                                  child: SeverityMarker(severity: o.severity, status: o.status),
                                ),
                              ]),
                            ],
                          ),
                        ),
                      ),
                    ),
                        const SizedBox(height: AcSpacing.sm),
                        TextButton.icon(onPressed: _openInMaps, icon: const Icon(Icons.map_outlined), label: const Text('Abrir no aplicativo de mapas')),
                      ],
                    ),
                  ),
                  const SizedBox(height: AcSpacing.md),
                  SectionCard(title: 'Histórico', child: StatusTimeline(entries: o.history, confirmCount: o.confirmCount)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cabeçalho na cor (escura) da gravidade, com formas curvas decorativas.
class _SeverityHeader extends StatelessWidget {
  const _SeverityHeader({required this.o, required this.color, required this.updated});

  final OccurrenceDetail o;
  final Color color;
  final DateTime updated;

  @override
  Widget build(BuildContext context) {
    final on = AcColors.onPrimary;
    return ColoredBox(
      color: color,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const CustomPaint(painter: _WavesPainter()),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(AcSpacing.lg, kToolbarHeight, AcSpacing.lg, AcSpacing.xl + AcSpacing.md),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(o.title, style: AcTypeScale.title.copyWith(color: on, height: 1.25), maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: AcSpacing.xs),
                  Row(
                    children: [
                      Icon(Icons.schedule, size: 16, color: on.withValues(alpha: 0.9)),
                      const SizedBox(width: AcSpacing.xs),
                      Text('Atualizada ${Formatters.relative(updated)}', style: AcTypeScale.label.copyWith(color: on.withValues(alpha: 0.9))),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WavesPainter extends CustomPainter {
  const _WavesPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Colors.white.withValues(alpha: 0.08);
    canvas.drawCircle(Offset(size.width * 0.95, size.height * 0.05), size.width * 0.42, paint);
    canvas.drawCircle(Offset(size.width * 0.70, size.height * 1.05), size.width * 0.30, paint);
    final wave = Path()
      ..moveTo(0, size.height * 0.62)
      ..quadraticBezierTo(size.width * 0.25, size.height * 0.48, size.width * 0.5, size.height * 0.62)
      ..quadraticBezierTo(size.width * 0.75, size.height * 0.76, size.width, size.height * 0.6)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(wave, Paint()..color = Colors.white.withValues(alpha: 0.06));
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Card principal: onde/quando, selos e o medidor de gravidade com orientação.
class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.o});

  final OccurrenceDetail o;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AcColors.surface,
        borderRadius: BorderRadius.circular(AcRadius.lg),
        border: Border.all(color: AcColors.border),
        boxShadow: AcElevation.card,
      ),
      child: Padding(
        padding: const EdgeInsets.all(AcSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _InfoRow(icon: Icons.place_outlined, text: Formatters.place(o.address, o.neighborhood)),
            _InfoRow(icon: Icons.schedule, text: 'Observado em ${Formatters.dateTime(o.occurredAt)}'),
            if (o.distanceMeters != null) _InfoRow(icon: Icons.near_me_outlined, text: '${Formatters.distance(o.distanceMeters!)} de você'),
            _InfoRow(icon: Icons.person_outline, text: o.isMine ? 'Registrado por você' : 'Relatado por ${o.reporterFirstName ?? 'usuário removido'}'),
            const SizedBox(height: AcSpacing.xs),
            Wrap(
              spacing: AcSpacing.sm,
              runSpacing: AcSpacing.sm,
              children: [SeverityBadge(o.severity), StatusBadge(o.status), if (o.isDemo) const DemoBadge()],
            ),
            const Divider(height: AcSpacing.xxl),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Nível de gravidade', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                      const SizedBox(height: AcSpacing.xxs),
                      Text(o.severity.label, style: AcTypeScale.title),
                      const SizedBox(height: AcSpacing.xs),
                      Text(o.severity.guidance, style: AcTypeScale.label.copyWith(color: AcColors.textSecondary)),
                    ],
                  ),
                ),
                const SizedBox(width: AcSpacing.md),
                SeverityGauge(severity: o.severity, width: 112),
              ],
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => showSeverityLevels(context),
                style: TextButton.styleFrom(padding: EdgeInsets.zero),
                icon: const Icon(Icons.info_outline, size: 18),
                label: const Text('Entenda os níveis'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Fotos em carrossel horizontal; toque amplia (com zoom por pinça).
class _PhotoStrip extends StatelessWidget {
  const _PhotoStrip({required this.photos});

  final List<OccurrencePhoto> photos;

  @override
  Widget build(BuildContext context) {
    void open(int i) => Navigator.of(context).push(
          MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => _PhotoViewer(photos: photos, initial: i)),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Semantics(header: true, child: Text('Fotos (${photos.length})', style: AcTypeScale.subtitle))),
            if (photos.length > 1) TextButton(onPressed: () => open(0), child: const Text('Ver todas')),
          ],
        ),
        const SizedBox(height: AcSpacing.sm),
        SizedBox(
          height: 120,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: photos.length,
            separatorBuilder: (_, _) => const SizedBox(width: AcSpacing.sm),
            itemBuilder: (_, i) => Semantics(
              button: true,
              label: 'Foto ${i + 1} de ${photos.length}. Toque para ampliar.',
              child: GestureDetector(
                onTap: () => open(i),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AcRadius.md),
                  child: Image.network(
                    AppConfig.absoluteUrl(photos[i].url),
                    width: 160,
                    height: 120,
                    fit: BoxFit.cover,
                    cacheWidth: 480,
                    errorBuilder: (_, _, _) => Container(
                      width: 160,
                      color: AcColors.surfaceMuted,
                      child: const Icon(Icons.broken_image_outlined, color: AcColors.textSecondary),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AcSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AcColors.textSecondary),
          const SizedBox(width: AcSpacing.sm),
          Expanded(child: Text(text, style: AcTypeScale.body)),
        ],
      ),
    );
  }
}

/// Distingue relato de cidadão de informação moderada (especificação, seção 12).
class _SourceNotice extends StatelessWidget {
  const _SourceNotice({required this.status});

  final OccurrenceStatus status;

  @override
  Widget build(BuildContext context) {
    final moderated = status == OccurrenceStatus.validated || status == OccurrenceStatus.resolved;
    return Container(
      padding: const EdgeInsets.all(AcSpacing.md),
      decoration: BoxDecoration(color: AcColors.surfaceMuted, borderRadius: BorderRadius.circular(AcRadius.sm)),
      child: Row(
        children: [
          Icon(moderated ? Icons.verified_outlined : Icons.campaign_outlined, size: 18, color: AcColors.textSecondary),
          const SizedBox(width: AcSpacing.sm),
          Expanded(
            child: Text(
              moderated
                  ? 'Relato de cidadão verificado pela moderação da plataforma. Não é um comunicado oficial.'
                  : 'Relato de cidadão ainda não verificado. Não é um comunicado oficial.',
              style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}

class _Participation extends StatelessWidget {
  const _Participation({required this.o, required this.busy, required this.onVote});

  final OccurrenceDetail o;
  final bool busy;
  final ValueChanged<ConfirmationType> onVote;

  @override
  Widget build(BuildContext context) {
    Widget option(ConfirmationType type, IconData icon, String label, int count) {
      final selected = o.myConfirmation == type;
      final enabled = o.acceptsConfirmation && !busy;
      return Expanded(
        child: Semantics(
          selected: selected,
          button: true,
          label: '$label, $count',
          excludeSemantics: true,
          child: OutlinedButton(
            onPressed: enabled ? () => onVote(type) : null,
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(64),
              backgroundColor: selected ? AcColors.primaryLight : null,
              side: BorderSide(color: selected ? AcColors.primary : AcColors.borderStrong, width: selected ? 2 : 1),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(icon, size: 18),
                    const SizedBox(width: AcSpacing.xs),
                    Text(label),
                  ],
                ),
                Text('$count', style: AcTypeScale.subtitle),
              ],
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            option(ConfirmationType.confirm, Icons.thumb_up_alt_outlined, 'Confirmar', o.confirmCount),
            const SizedBox(width: AcSpacing.md),
            option(ConfirmationType.contest, Icons.thumb_down_alt_outlined, 'Contestar', o.contestCount),
          ],
        ),
        const SizedBox(height: AcSpacing.sm),
        Text(
          o.isMine
              ? 'Você não pode confirmar a própria ocorrência.'
              : !o.acceptsConfirmation
              ? 'Esta ocorrência não recebe mais confirmações.'
              : 'Confirmações de cidadãos ajudam a moderação, mas não equivalem a validação oficial.',
          style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
        ),
      ],
    );
  }
}

class _PhotoViewer extends StatelessWidget {
  const _PhotoViewer({required this.photos, required this.initial});

  final List<OccurrencePhoto> photos;
  final int initial;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white),
      body: PageView.builder(
        controller: PageController(initialPage: initial),
        itemCount: photos.length,
        itemBuilder: (_, i) => InteractiveViewer(
          maxScale: 5,
          child: Center(child: Image.network(AppConfig.absoluteUrl(photos[i].url), fit: BoxFit.contain)),
        ),
      ),
    );
  }
}
