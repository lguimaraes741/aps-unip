import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_tokens.g.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/occurrence_card.dart';
import '../../core/widgets/states.dart';
import '../../data/occurrences_repository.dart';
import '../../domain/models.dart';

final mySummaryProvider = FutureProvider.autoDispose<MySummary>((ref) => ref.read(occurrencesRepositoryProvider).mySummary());

class MyReportsQuery {
  const MyReportsQuery({this.filter = MineFilter.all, this.search = ''});

  final MineFilter filter;
  final String search;
}

class MyReportsQueryNotifier extends Notifier<MyReportsQuery> {
  @override
  MyReportsQuery build() => const MyReportsQuery();

  void setFilter(MineFilter filter) => state = MyReportsQuery(filter: filter, search: state.search);
  void setSearch(String search) => state = MyReportsQuery(filter: state.filter, search: search);
}

final myReportsQueryProvider = NotifierProvider<MyReportsQueryNotifier, MyReportsQuery>(MyReportsQueryNotifier.new);

/// Lista paginada de registros do próprio usuário (a API só retorna os dele).
class MyReportsNotifier extends AsyncNotifier<Paged<OccurrenceSummary>> {
  bool _loadingMore = false;

  @override
  Future<Paged<OccurrenceSummary>> build() {
    final q = ref.watch(myReportsQueryProvider);
    return ref.read(occurrencesRepositoryProvider).mine(filter: q.filter, query: q.search);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || _loadingMore) return;
    _loadingMore = true;
    try {
      final q = ref.read(myReportsQueryProvider);
      final next = await ref.read(occurrencesRepositoryProvider).mine(filter: q.filter, query: q.search, page: current.page + 1);
      state = AsyncData(Paged(items: [...current.items, ...next.items], total: next.total, page: next.page, limit: next.limit));
    } on ApiException {
      // Mantém a lista atual; o usuário pode rolar de novo para tentar.
    } finally {
      _loadingMore = false;
    }
  }
}

final myReportsProvider = AsyncNotifierProvider<MyReportsNotifier, Paged<OccurrenceSummary>>(MyReportsNotifier.new);

class MyReportsPage extends ConsumerStatefulWidget {
  const MyReportsPage({super.key});

  @override
  ConsumerState<MyReportsPage> createState() => _MyReportsPageState();
}

class _MyReportsPageState extends ConsumerState<MyReportsPage> {
  final _search = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    ref.invalidate(mySummaryProvider);
    ref.invalidate(myReportsProvider);
    await ref.read(myReportsProvider.future).catchError((_) => const Paged<OccurrenceSummary>(items: [], total: 0, page: 1, limit: 20));
  }

  @override
  Widget build(BuildContext context) {
    final summary = ref.watch(mySummaryProvider).value;
    final query = ref.watch(myReportsQueryProvider);
    final list = ref.watch(myReportsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Meus registros')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: NotificationListener<ScrollNotification>(
          onNotification: (n) {
            if (n.metrics.extentAfter < 300) ref.read(myReportsProvider.notifier).loadMore();
            return false;
          },
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.md, AcSpacing.lg, 0),
                sliver: SliverToBoxAdapter(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: AcSpacing.sm,
                      crossAxisSpacing: AcSpacing.sm,
                      childAspectRatio: 1.9,
                      children: [
                        MetricCard(label: 'Total enviados', value: summary?.total, icon: Icons.outbox_outlined),
                        MetricCard(label: 'Ativos', value: summary?.active, icon: Icons.water_drop_outlined, color: AcColors.warning),
                        MetricCard(label: 'Resolvidos', value: summary?.resolved, icon: Icons.task_alt, color: AcColors.success),
                        MetricCard(label: 'Pendentes', value: summary?.pending, icon: Icons.schedule, color: AcStatusColors.pending.fg),
                      ],
                    ),
                    const SizedBox(height: AcSpacing.lg),
                    TextField(
                      controller: _search,
                      textInputAction: TextInputAction.search,
                      onChanged: (v) {
                        _debounce?.cancel();
                        _debounce = Timer(const Duration(milliseconds: 400), () => ref.read(myReportsQueryProvider.notifier).setSearch(v));
                      },
                      decoration: const InputDecoration(hintText: 'Pesquisar meus registros', prefixIcon: Icon(Icons.search), isDense: true),
                    ),
                    const SizedBox(height: AcSpacing.md),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        for (final f in MineFilter.values)
                          Padding(
                            padding: const EdgeInsets.only(right: AcSpacing.sm),
                            child: AcFilterChip(
                              label: f.label,
                              selected: query.filter == f,
                              onSelected: (_) => ref.read(myReportsQueryProvider.notifier).setFilter(f),
                            ),
                          ),
                      ]),
                    ),
                    const SizedBox(height: AcSpacing.md),
                  ]),
                ),
              ),
              ...switch (list) {
                AsyncData(:final value) when value.items.isEmpty => [
                    SliverFillRemaining(
                      hasScrollBody: false,
                      child: EmptyState(
                        icon: Icons.assignment_outlined,
                        title: query.filter == MineFilter.all && query.search.isEmpty ? 'Você ainda não registrou ocorrências' : 'Nenhum registro encontrado',
                        message: 'Ao ver um alagamento, registre-o para alertar outras pessoas.',
                        action: FilledButton.icon(
                          style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                          onPressed: () => context.push('/occurrences/new'),
                          icon: const Icon(Icons.add),
                          label: const Text('Registrar ocorrência'),
                        ),
                      ),
                    ),
                  ],
                AsyncData(:final value) => [
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(AcSpacing.lg, 0, AcSpacing.lg, AcSpacing.xxl),
                      sliver: SliverList.separated(
                        itemCount: value.items.length + (value.hasMore ? 1 : 0),
                        separatorBuilder: (_, _) => const SizedBox(height: AcSpacing.md),
                        itemBuilder: (_, i) => i >= value.items.length
                            ? const Center(child: Padding(padding: EdgeInsets.all(AcSpacing.lg), child: CircularProgressIndicator()))
                            : OccurrenceCard(
                                occurrence: value.items[i],
                                showUpdatedAt: true,
                                onTap: () => context.push('/occurrences/${value.items[i].id}'),
                              ),
                      ),
                    ),
                  ],
                AsyncError(:final error) => [
                    SliverFillRemaining(hasScrollBody: false, child: ErrorState(error: error, onRetry: _refresh)),
                  ],
                _ => [const SliverToBoxAdapter(child: LoadingSkeleton())],
              },
            ],
          ),
        ),
      ),
    );
  }
}
