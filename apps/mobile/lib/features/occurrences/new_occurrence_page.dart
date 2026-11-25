import 'dart:async';
import 'dart:io';

import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/config/app_config.dart';
import '../../core/location/address_lookup.dart';
import '../../core/location/location_service.dart';
import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/buttons.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/tones.dart';
import '../../data/occurrences_repository.dart';
import '../../domain/models.dart';
import '../auth/validators.dart';
import '../map/map_state.dart';
import 'my_reports_page.dart';
import 'occurrence_draft.dart';

const maxPhotos = 5;

enum _SubmitPhase { idle, creating, uploading }

class NewOccurrencePage extends ConsumerStatefulWidget {
  const NewOccurrencePage({super.key});

  @override
  ConsumerState<NewOccurrencePage> createState() => _NewOccurrencePageState();
}

class _NewOccurrencePageState extends ConsumerState<NewOccurrencePage> {
  final _form = GlobalKey<FormState>();
  final _store = DraftStore();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _address = TextEditingController();
  final _neighborhood = TextEditingController();
  OccurrenceDraft _draft = OccurrenceDraft();
  bool _loaded = false;
  bool _locating = false;
  // Endereço preenchido a partir da localização (o usuário pode editar; o que ele digitar prevalece).
  bool _resolvingAddress = false;
  bool _addressLookupFailed = false;
  String? _autoAddress;
  String? _autoNeighborhood;
  bool _showLocationError = false;
  bool _showSeverityError = false;
  _SubmitPhase _phase = _SubmitPhase.idle;
  int _uploaded = 0;
  double _photoProgress = 0;
  ApiException? _error;
  Timer? _saveDebounce;

  @override
  void initState() {
    super.initState();
    _restore();
    for (final c in [_title, _description, _address, _neighborhood]) {
      c.addListener(_onChanged);
    }
  }

  @override
  void dispose() {
    _saveDebounce?.cancel();
    for (final c in [_title, _description, _address, _neighborhood]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _restore() async {
    final draft = await _store.load();
    if (!mounted) return;
    if (draft != null) {
      _draft = draft;
      _title.text = draft.title;
      _description.text = draft.description;
      _address.text = draft.address;
      _neighborhood.text = draft.neighborhood;
      if (draft.hasUserContent) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) showAppSnackbar(context, 'Rascunho restaurado.');
        });
      }
    }
    setState(() => _loaded = true);
    // Registro novo sem local: já usa a localização atual (o usuário pode trocar por "Escolher no mapa").
    if (!_draft.hasLocation && _draft.createdOccurrenceId == null) unawaited(_useGps(silent: true));
  }

  void _onChanged() {
    _draft
      ..title = _title.text
      ..description = _description.text
      ..address = _address.text
      ..neighborhood = _neighborhood.text;
    _scheduleSave();
  }

  void _scheduleSave() {
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(milliseconds: 500), () => _store.save(_draft));
  }

  void _update(void Function(OccurrenceDraft d) change) {
    setState(() => change(_draft));
    _scheduleSave();
  }

  // ---------------- Localização ----------------

  Future<void> _useGps({bool silent = false}) async {
    setState(() => _locating = true);
    final result = await ref.read(userLocationProvider.notifier).locate();
    if (!mounted) return;
    setState(() => _locating = false);
    if (result.ok) {
      _update((d) {
        d.latitude = result.position!.latitude;
        d.longitude = result.position!.longitude;
      });
      _showLocationError = false;
      unawaited(_fillAddress(result.position!.latitude, result.position!.longitude));
    } else if (!silent) {
      showAppSnackbar(context, result.message, kind: SnackKind.error);
    }
  }

  /// Preenche endereço e bairro a partir das coordenadas, sem apagar o que o usuário digitou.
  Future<void> _fillAddress(double lat, double lng) async {
    if (_draft.createdOccurrenceId != null) return;
    bool replaceable(TextEditingController c, String? auto) => c.text.trim().isEmpty || c.text == auto;
    final canAddress = replaceable(_address, _autoAddress);
    final canNeighborhood = replaceable(_neighborhood, _autoNeighborhood);
    if (!canAddress && !canNeighborhood) return;
    setState(() {
      _resolvingAddress = true;
      _addressLookupFailed = false;
    });
    final found = await ref.read(addressLookupProvider).fromCoordinates(lat, lng);
    if (!mounted) return;
    // Ignora respostas atrasadas de um local que já foi trocado.
    if (_draft.latitude != lat || _draft.longitude != lng) return;
    setState(() {
      _resolvingAddress = false;
      _addressLookupFailed = found == null;
      if (found == null) return;
      if (canAddress && replaceable(_address, _autoAddress)) {
        _autoAddress = found.address;
        _address.text = found.address;
      }
      if (canNeighborhood && found.neighborhood != null && replaceable(_neighborhood, _autoNeighborhood)) {
        _autoNeighborhood = found.neighborhood;
        _neighborhood.text = found.neighborhood!;
      }
    });
  }

  Future<void> _pickOnMap() async {
    final current = _draft.hasLocation
        ? LatLng(_draft.latitude!, _draft.longitude!)
        : ref.read(userLocationProvider)?.position ?? ref.read(searchAreaProvider).center;
    final picked = await context.push<LatLng>('/occurrences/new/location', extra: current);
    if (picked == null) return;
    _update((d) {
      d.latitude = picked.latitude;
      d.longitude = picked.longitude;
    });
    _showLocationError = false;
    unawaited(_fillAddress(picked.latitude, picked.longitude));
  }

  // ---------------- Data e hora ----------------

  Future<void> _pickDateTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: _draft.occurredAt,
      firstDate: now.subtract(const Duration(days: 7)),
      lastDate: now,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_draft.occurredAt));
    if (time == null) return;
    var picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    if (picked.isAfter(now)) picked = now;
    _update((d) => d.occurredAt = picked);
  }

  // ---------------- Fotos ----------------

  Future<void> _addPhoto(ImageSource source) async {
    try {
      final file = await ImagePicker().pickImage(source: source, maxWidth: 2560, imageQuality: 85);
      if (file == null) return;
      _update((d) => d.photoPaths = [...d.photoPaths, file.path]);
    } catch (_) {
      if (mounted) showAppSnackbar(context, 'Não foi possível acessar a câmera ou a galeria.', kind: SnackKind.error);
    }
  }

  void _removePhoto(String path) => _update((d) => d.photoPaths = d.photoPaths.where((p) => p != path).toList());

  // ---------------- Envio ----------------

  bool get _submitting => _phase != _SubmitPhase.idle;

  Future<void> _submit() async {
    if (_submitting) return; // impede envio duplicado
    final validForm = _form.currentState!.validate();
    setState(() {
      _showLocationError = !_draft.hasLocation;
      _showSeverityError = _draft.severity == null;
      _error = null;
    });
    if (!validForm || !_draft.hasLocation || _draft.severity == null) {
      showAppSnackbar(context, 'Revise os campos destacados.', kind: SnackKind.error);
      return;
    }

    final repo = ref.read(occurrencesRepositoryProvider);
    try {
      if (_draft.createdOccurrenceId == null) {
        setState(() => _phase = _SubmitPhase.creating);
        final created = await repo.create(NewOccurrence(
          clientRequestId: _draft.clientRequestId,
          title: _draft.title.trim(),
          description: _draft.description.trim(),
          address: _draft.address.trim(),
          neighborhood: _draft.neighborhood.trim(),
          latitude: _draft.latitude!,
          longitude: _draft.longitude!,
          severity: _draft.severity!,
          occurredAt: _draft.occurredAt,
        ));
        _draft.createdOccurrenceId = created.id;
        await _store.save(_draft);
      }

      setState(() => _phase = _SubmitPhase.uploading);
      for (final path in _draft.pendingPhotos) {
        setState(() => _photoProgress = 0);
        await repo.uploadPhoto(_draft.createdOccurrenceId!, path, onProgress: (p) => setState(() => _photoProgress = p));
        _draft.uploadedPhotoPaths = [..._draft.uploadedPhotoPaths, path];
        setState(() => _uploaded = _draft.uploadedPhotoPaths.length);
        await _store.save(_draft);
      }

      final id = _draft.createdOccurrenceId!;
      await _store.clear();
      ref.invalidate(nearbyOccurrencesProvider);
      ref.invalidate(myReportsProvider);
      ref.invalidate(mySummaryProvider);
      if (!mounted) return;
      showAppSnackbar(context, 'Ocorrência enviada! Ela aparecerá como pendente até a moderação.', kind: SnackKind.success);
      context.pushReplacement('/occurrences/$id');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
      final partial = _draft.createdOccurrenceId != null;
      showAppSnackbar(
        context,
        partial ? 'A ocorrência foi registrada, mas uma foto falhou. Toque em enviar para tentar de novo.' : e.message,
        kind: SnackKind.error,
      );
    } finally {
      if (mounted) setState(() => _phase = _SubmitPhase.idle);
    }
  }

  Future<void> _discard() async {
    final ok = await showConfirmationDialog(
      context,
      title: 'Descartar rascunho?',
      message: 'Os dados preenchidos e as fotos selecionadas serão apagados deste aparelho.',
      confirmLabel: 'Descartar',
      destructive: true,
    );
    if (!ok) return;
    await _store.clear();
    if (mounted) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final alreadyCreated = _draft.createdOccurrenceId != null;

    return PopScope(
      canPop: !_submitting,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop && _draft.hasUserContent && !alreadyCreated) {
          // Depois do quadro: a saída pode acontecer durante uma reconstrução (ex.: navegação por notificação).
          final messenger = ScaffoldMessenger.of(context);
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => messenger.showSnackBar(const SnackBar(content: Text('Rascunho salvo. Você pode continuar depois.'))),
          );
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Nova ocorrência'),
          actions: [
            if (_draft.hasUserContent && !alreadyCreated)
              TextButton(onPressed: _submitting ? null : _discard, child: const Text('Descartar')),
          ],
        ),
        body: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(AcSpacing.lg),
            children: [
              if (alreadyCreated)
                Padding(
                  padding: const EdgeInsets.only(bottom: AcSpacing.md),
                  child: Text(
                    'Esta ocorrência já foi registrada. Falta enviar ${_draft.pendingPhotos.length} foto(s).',
                    style: AcTypeScale.body.copyWith(color: AcColors.warning),
                  ),
                ),
              SectionCard(step: 1, title: 'Localização', child: _locationSection()),
              const SizedBox(height: AcSpacing.md),
              SectionCard(step: 2, title: 'Informações da ocorrência', child: _infoSection(alreadyCreated)),
              const SizedBox(height: AcSpacing.md),
              SectionCard(step: 3, title: 'Gravidade', child: _severitySection(alreadyCreated)),
              const SizedBox(height: AcSpacing.md),
              SectionCard(step: 4, title: 'Evidências fotográficas', trailing: Text('${_draft.photoPaths.length}/$maxPhotos', style: AcTypeScale.caption), child: _photosSection()),
              const SizedBox(height: AcSpacing.md),
              SectionCard(step: 5, title: 'Revisão e envio', child: _reviewSection()),
              const SizedBox(height: AcSpacing.xxl),
            ],
          ),
        ),
      ),
    );
  }

  Widget _locationSection() {
    final point = _draft.hasLocation ? LatLng(_draft.latitude!, _draft.longitude!) : null;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(AcRadius.sm),
        child: SizedBox(
          height: 160,
          child: point == null
              ? Container(
                  color: AcColors.surfaceMuted,
                  alignment: Alignment.center,
                  child: Text('Nenhum local selecionado', style: AcTypeScale.body.copyWith(color: AcColors.textSecondary)),
                )
              : IgnorePointer(
                  child: FlutterMap(
                    key: ValueKey(point),
                    options: MapOptions(initialCenter: point, initialZoom: 16),
                    children: [
                      TileLayer(urlTemplate: AppConfig.tileUrlTemplate, userAgentPackageName: AppConfig.userAgentPackageName),
                      MarkerLayer(markers: [
                        Marker(point: point, width: 44, height: 44, alignment: Alignment.topCenter,
                            child: const Icon(Icons.location_on, size: 44, color: AcColors.primary)),
                      ]),
                    ],
                  ),
                ),
        ),
      ),
      if (point != null)
        Padding(
          padding: const EdgeInsets.only(top: AcSpacing.sm),
          child: Text('Lat ${point.latitude.toStringAsFixed(5)} · Lng ${point.longitude.toStringAsFixed(5)}',
              style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
        ),
      if (_showLocationError)
        Padding(
          padding: const EdgeInsets.only(top: AcSpacing.sm),
          child: Text('Informe o local da ocorrência', style: AcTypeScale.caption.copyWith(color: AcColors.error)),
        ),
      const SizedBox(height: AcSpacing.md),
      Row(children: [
        Expanded(
          child: SecondaryButton(
            label: _locating ? 'Localizando…' : 'Usar GPS',
            icon: Icons.my_location,
            onPressed: _locating || _draft.createdOccurrenceId != null ? null : _useGps,
          ),
        ),
        const SizedBox(width: AcSpacing.sm),
        Expanded(
          child: SecondaryButton(
            label: 'Escolher no mapa',
            icon: Icons.map_outlined,
            onPressed: _draft.createdOccurrenceId != null ? null : _pickOnMap,
          ),
        ),
      ]),
      const SizedBox(height: AcSpacing.lg),
      TextFormField(
        controller: _address,
        enabled: _draft.createdOccurrenceId == null,
        validator: Validators.length('o endereço ou referência', 3, 255),
        textCapitalization: TextCapitalization.sentences,
        decoration: InputDecoration(
          labelText: 'Endereço ou ponto de referência',
          prefixIcon: const Icon(Icons.signpost_outlined),
          errorText: _error?.fieldError('address'),
          helperText: _resolvingAddress
              ? 'Buscando o endereço da localização…'
              : _addressLookupFailed
                  ? 'Não encontramos o endereço automaticamente. Digite a rua ou uma referência.'
                  : _autoAddress != null
                      ? 'Preenchido pela localização. Confira e ajuste se precisar.'
                      : null,
          helperMaxLines: 2,
          suffixIcon: _resolvingAddress
              ? const Padding(
                  padding: EdgeInsets.all(AcSpacing.md),
                  child: SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                )
              : null,
        ),
      ),
      const SizedBox(height: AcSpacing.md),
      TextFormField(
        controller: _neighborhood,
        enabled: _draft.createdOccurrenceId == null,
        textCapitalization: TextCapitalization.words,
        validator: (v) => (v?.length ?? 0) > 120 ? 'Máximo de 120 caracteres' : null,
        decoration: const InputDecoration(labelText: 'Bairro (opcional)', prefixIcon: Icon(Icons.location_city_outlined)),
      ),
    ]);
  }

  Widget _infoSection(bool locked) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextFormField(
        controller: _title,
        enabled: !locked,
        maxLength: 120,
        textCapitalization: TextCapitalization.sentences,
        validator: Validators.length('o título', 3, 120),
        decoration: InputDecoration(labelText: 'Título', hintText: 'Ex.: Alagamento na Av. do Estado', errorText: _error?.fieldError('title')),
      ),
      const SizedBox(height: AcSpacing.sm),
      TextFormField(
        controller: _description,
        enabled: !locked,
        maxLength: 2000,
        minLines: 3,
        maxLines: 6,
        textCapitalization: TextCapitalization.sentences,
        validator: Validators.length('a descrição', 10, 2000),
        decoration: InputDecoration(
          labelText: 'Descrição',
          hintText: 'Altura da água, vias afetadas, riscos observados…',
          alignLabelWithHint: true,
          errorText: _error?.fieldError('description'),
        ),
      ),
      const SizedBox(height: AcSpacing.sm),
      Semantics(
        button: true,
        label: 'Data e horário: ${Formatters.dateTime(_draft.occurredAt.toUtc())}. Toque para alterar.',
        excludeSemantics: true,
        child: InkWell(
          onTap: locked ? null : _pickDateTime,
          borderRadius: BorderRadius.circular(AcRadius.md),
          child: InputDecorator(
            decoration: InputDecoration(labelText: 'Data e horário', prefixIcon: const Icon(Icons.event), errorText: _error?.fieldError('occurredAt')),
            child: Text(Formatters.dateTime(_draft.occurredAt.toUtc()), style: AcTypeScale.body),
          ),
        ),
      ),
    ]);
  }

  Widget _severitySection(bool locked) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Como você avalia a situação?', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
      const SizedBox(height: AcSpacing.sm),
      for (final s in Severity.values)
        Padding(
          padding: const EdgeInsets.only(bottom: AcSpacing.sm),
          child: Semantics(
            selected: _draft.severity == s,
            inMutuallyExclusiveGroup: true,
            button: true,
            label: 'Gravidade ${s.label}: ${s.hint}',
            excludeSemantics: true,
            child: InkWell(
              onTap: locked
                  ? null
                  : () {
                      _update((d) => d.severity = s);
                      _showSeverityError = false;
                    },
              borderRadius: BorderRadius.circular(AcRadius.md),
              child: AnimatedContainer(
                duration: AcMotion.fast,
                padding: const EdgeInsets.all(AcSpacing.md),
                decoration: BoxDecoration(
                  color: _draft.severity == s ? s.palette.bg : AcColors.surface,
                  borderRadius: BorderRadius.circular(AcRadius.md),
                  border: Border.all(color: _draft.severity == s ? s.palette.marker : AcColors.border, width: _draft.severity == s ? 2 : 1),
                ),
                child: Row(children: [
                  Icon(Icons.water_drop, color: s.palette.marker),
                  const SizedBox(width: AcSpacing.md),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(s.label, style: AcTypeScale.bodyStrong),
                      Text(s.hint, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                    ]),
                  ),
                  if (_draft.severity == s) Icon(Icons.check_circle, color: s.palette.marker),
                ]),
              ),
            ),
          ),
        ),
      if (_showSeverityError) Text('Selecione a gravidade', style: AcTypeScale.caption.copyWith(color: AcColors.error)),
    ]);
  }

  Widget _photosSection() {
    final canAdd = _draft.photoPaths.length < maxPhotos && !_submitting;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (_draft.photoPaths.isNotEmpty)
        SizedBox(
          height: 96,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _draft.photoPaths.length,
            separatorBuilder: (_, _) => const SizedBox(width: AcSpacing.sm),
            itemBuilder: (_, i) {
              final path = _draft.photoPaths[i];
              final uploaded = _draft.uploadedPhotoPaths.contains(path);
              return Stack(children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(AcRadius.sm),
                  child: Image.file(File(path), width: 96, height: 96, fit: BoxFit.cover, cacheWidth: 288,
                      errorBuilder: (_, _, _) => Container(width: 96, height: 96, color: AcColors.surfaceMuted, child: const Icon(Icons.broken_image_outlined))),
                ),
                if (uploaded)
                  const Positioned(left: 4, bottom: 4, child: Icon(Icons.cloud_done, color: Colors.white, size: 20))
                else if (!_submitting)
                  Positioned(
                    right: 0,
                    top: 0,
                    child: IconButton(
                      tooltip: 'Remover foto',
                      style: IconButton.styleFrom(backgroundColor: Colors.black54, foregroundColor: Colors.white, minimumSize: const Size(32, 32)),
                      iconSize: 16,
                      icon: const Icon(Icons.close),
                      onPressed: () => _removePhoto(path),
                    ),
                  ),
              ]);
            },
          ),
        ),
      if (_draft.photoPaths.isNotEmpty) const SizedBox(height: AcSpacing.md),
      Row(children: [
        Expanded(child: SecondaryButton(label: 'Câmera', icon: Icons.photo_camera_outlined, onPressed: canAdd ? () => _addPhoto(ImageSource.camera) : null)),
        const SizedBox(width: AcSpacing.sm),
        Expanded(child: SecondaryButton(label: 'Galeria', icon: Icons.photo_library_outlined, onPressed: canAdd ? () => _addPhoto(ImageSource.gallery) : null)),
      ]),
      const SizedBox(height: AcSpacing.sm),
      Text('Opcional. Até 5 fotos. A localização gravada na foto é removida pelo servidor.',
          style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
    ]);
  }

  Widget _reviewSection() {
    final d = _draft;
    String orDash(String v) => v.trim().isEmpty ? '—' : v.trim();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _ReviewLine('Local', d.hasLocation ? orDash(d.address) : 'Não informado'),
      _ReviewLine('Título', orDash(d.title)),
      _ReviewLine('Gravidade', d.severity?.label ?? 'Não informada'),
      _ReviewLine('Quando', Formatters.dateTime(d.occurredAt.toUtc())),
      _ReviewLine('Fotos', '${d.photoPaths.length}'),
      const SizedBox(height: AcSpacing.md),
      if (_phase == _SubmitPhase.creating) ...[
        const LinearProgressIndicator(),
        const SizedBox(height: AcSpacing.xs),
        Text('Registrando ocorrência…', style: AcTypeScale.caption),
      ],
      if (_phase == _SubmitPhase.uploading && d.photoPaths.isNotEmpty) ...[
        LinearProgressIndicator(value: (_uploaded + _photoProgress) / d.photoPaths.length.clamp(1, maxPhotos)),
        const SizedBox(height: AcSpacing.xs),
        Text('Enviando fotos ($_uploaded de ${d.photoPaths.length})…', style: AcTypeScale.caption),
      ],
      const SizedBox(height: AcSpacing.sm),
      PrimaryButton(
        label: d.createdOccurrenceId == null ? 'Enviar ocorrência' : 'Enviar fotos restantes',
        icon: Icons.send,
        loading: _submitting,
        onPressed: _submit,
      ),
      if (d.createdOccurrenceId != null && !_submitting)
        TextButton(
          onPressed: () async {
            final id = d.createdOccurrenceId!;
            await _store.clear();
            if (mounted) context.pushReplacement('/occurrences/$id');
          },
          child: const Text('Concluir sem as fotos restantes'),
        ),
      const SizedBox(height: AcSpacing.sm),
      Text(
        'Seu relato será analisado pela moderação. Em emergência, ligue 199 (Defesa Civil) ou 193 (Bombeiros).',
        style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
        textAlign: TextAlign.center,
      ),
    ]);
  }
}

class _ReviewLine extends StatelessWidget {
  const _ReviewLine(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AcSpacing.xs),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 90, child: Text(label, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary))),
        Expanded(child: Text(value, style: AcTypeScale.body, maxLines: 2, overflow: TextOverflow.ellipsis)),
      ]),
    );
  }
}

/// Seleção manual do local: o usuário arrasta o mapa sob o pino central.
class LocationPickerPage extends StatefulWidget {
  const LocationPickerPage({super.key, this.initial});

  final LatLng? initial;

  @override
  State<LocationPickerPage> createState() => _LocationPickerPageState();
}

class _LocationPickerPageState extends State<LocationPickerPage> {
  late LatLng _center = widget.initial ?? defaultMapCenter;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Escolher local')),
      body: Stack(children: [
        FlutterMap(
          options: MapOptions(
            initialCenter: _center,
            initialZoom: 16,
            onPositionChanged: (camera, _) => _center = camera.center,
          ),
          children: [TileLayer(urlTemplate: AppConfig.tileUrlTemplate, userAgentPackageName: AppConfig.userAgentPackageName)],
        ),
        const IgnorePointer(
          child: Center(
            child: Padding(
              padding: EdgeInsets.only(bottom: 44),
              child: Icon(Icons.location_on, size: 48, color: AcColors.primary, semanticLabel: 'Local selecionado'),
            ),
          ),
        ),
        Positioned(
          left: AcSpacing.lg,
          right: AcSpacing.lg,
          bottom: AcSpacing.xl,
          child: SafeArea(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Container(
                padding: const EdgeInsets.all(AcSpacing.sm),
                decoration: BoxDecoration(color: AcColors.surface, borderRadius: BorderRadius.circular(AcRadius.sm)),
                child: Text('Arraste o mapa para posicionar o pino no local do alagamento.', style: AcTypeScale.caption, textAlign: TextAlign.center),
              ),
              const SizedBox(height: AcSpacing.md),
              PrimaryButton(label: 'Confirmar local', icon: Icons.check, onPressed: () => context.pop(_center)),
            ]),
          ),
        ),
      ]),
    );
  }
}
