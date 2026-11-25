import type { OccurrenceStatus } from '@alertacidade/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import { Link } from 'react-router';
import { http } from '../api/endpoints';
import { ErrorState, SeverityBadge, StatusBadge } from '../components/ui';
import { SEVERITIES, SEVERITY_LABEL, STATUS_LABEL, STATUSES } from '../lib/format';
import { SEVERITY_MARKER } from '../lib/severity';


const SAO_PAULO: [number, number] = [-23.5505, -46.6333];

export function MapPage() {
  const [statuses, setStatuses] = useState<OccurrenceStatus[]>(['PENDING', 'UNDER_REVIEW', 'VALIDATED']);
  const data = useQuery({
    queryKey: ['occurrences', 'map', statuses],
    queryFn: () => http.occurrences({ status: statuses, limit: 100 }),
  });
  const toggle = (s: OccurrenceStatus) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="page full">
      <header className="page-header">
        <h1>Mapa</h1>
        <div className="filters" role="group" aria-label="Status exibidos">
          {STATUSES.map((s) => (
            <label key={s} className="check">
              <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggle(s)} /> {STATUS_LABEL[s]}
            </label>
          ))}
        </div>
      </header>
      {data.isError && <ErrorState error={data.error} onRetry={() => void data.refetch()} />}
      {data.data && data.data.total > data.data.items.length && (
        <p className="notice">
          Exibindo as {data.data.items.length} mais recentes de {data.data.total}. Use os filtros para refinar.
        </p>
      )}
      <div className="map-full">
        <MapContainer center={SAO_PAULO} zoom={12} style={{ height: '100%' }}>
          <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
          {data.data?.items.map((o) => (
            <CircleMarker
              key={o.id}
              center={[o.latitude, o.longitude]}
              radius={o.severity === 'CRITICAL' ? 11 : 8}
              pathOptions={{
                color: '#fff',
                weight: 2,
                fillColor: SEVERITY_MARKER[o.severity],
                // Resolvida: marcador com opacidade reduzida (design system).
                fillOpacity: o.status === 'RESOLVED' || o.status === 'REJECTED' ? 0.4 : 1,
              }}
            >
              <Popup>
                <strong>
                  #{o.code} {o.title}
                </strong>
                <div>
                  <SeverityBadge severity={o.severity} /> <StatusBadge status={o.status} />
                </div>
                <Link to={`/occurrences/${o.id}`}>Analisar</Link>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <p className="legend">
        {SEVERITIES.map((s) => (
          <span key={s}>
            <i style={{ background: SEVERITY_MARKER[s] }} aria-hidden="true" /> {SEVERITY_LABEL[s]}
          </span>
        ))}
      </p>
    </div>
  );
}
