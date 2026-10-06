import { useEffect, useRef, useState } from "react";
import type { EncounterView, LocationCell } from "@miaou/contracts";
import {
  fromPosition,
  polygon,
  inverse,
} from "../../server/src/encounters/location";
import { mainland } from "../../server/src/encounters/mainland";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { tileURL } from "../lib/map-provider";
const noEntries: EncounterView[] = [];
export function ZoneMap({
  entries = noEntries,
  selected,
  onSelect,
  focus,
  selectionSize = 1000,
  providerKey,
  navigationCenter,
}: {
  entries?: EncounterView[];
  selected?: LocationCell | null;
  onSelect?: (c: LocationCell) => void;
  focus?: LocationCell | null;
  selectionSize?: LocationCell["size"];
  providerKey?: string;
  navigationCenter?: [number, number];
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<import("maplibre-gl").Map | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    if (host.current) delete host.current.dataset.ready;
    let map: import("maplibre-gl").Map | undefined;
    void import("maplibre-gl")
      .then(({ Map, NavigationControl, Marker, setWorkerUrl }) => {
        if (!alive || !host.current) return;
        setWorkerUrl(workerUrl);
        const center =
          focus ?? selected ?? entries.find((e) => e.location)?.location;
        map = new Map({
          container: host.current,
          center:
            navigationCenter ??
            (center
              ? (inverse(
                  (center.x + 0.5) * center.size,
                  (center.y + 0.5) * center.size,
                ) as [number, number])
              : [2.3, 46.7]),
          zoom: navigationCenter
            ? 12
            : center
              ? center.size === 500
                ? 13
                : center.size === 1000
                  ? 12
                  : 11
              : 4.5,
          style: {
            version: 8,
            sources: {
              ...(providerKey
                ? {
                    basemap: {
                      type: "raster" as const,
                      tiles: [tileURL(providerKey)],
                      tileSize: 512,
                      attribution:
                        '<a href="https://www.maptiler.com/copyright/">MapTiler</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
                    },
                  }
                : {}),
              mainland: {
                type: "geojson",
                data: {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "MultiPolygon", coordinates: mainland },
                },
                attribution:
                  '<a href="https://www.data.gouv.fr/datasets/contours-administratifs">Contours Etalab / IGN 2026</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a> · <a href="/api/v1/map/contours">Données adaptées</a>',
              },
            },
            layers: [
              ...(providerKey
                ? [
                    {
                      id: "basemap",
                      type: "raster" as const,
                      source: "basemap",
                    },
                  ]
                : [
                    {
                      id: "paper",
                      type: "background" as const,
                      paint: { "background-color": "#e2d8f0" },
                    },
                    {
                      id: "land",
                      type: "fill" as const,
                      source: "mainland",
                      paint: {
                        "fill-color": "#fff8ed",
                        "fill-outline-color": "#49366d",
                      },
                    },
                  ]),
            ],
          },
        });
        map.addControl(new NavigationControl({ showCompass: false }));
        instance.current = map;
        map.on("idle", () => {
          if (alive && host.current) host.current.dataset.ready = "true";
        });
        map.on("load", () => {
          const cells = [
            ...entries
              .map((e) => e.location)
              .filter((c): c is LocationCell => !!c),
            ...(selected ? [selected] : []),
          ];
          map!.addSource("zones", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: cells.map((c) => ({
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [polygon(c)] },
              })),
            },
          });
          map!.addLayer({
            id: "zones",
            type: "fill",
            source: "zones",
            paint: { "fill-color": "#eb806d", "fill-opacity": 0.35 },
          });
          map!.addLayer({
            id: "zone-outlines",
            type: "line",
            source: "zones",
            paint: { "line-color": "#49366d", "line-width": 2 },
          });
          const groups = new globalThis.Map<string, EncounterView[]>();
          for (const e of entries) {
            if (!e.location) continue;
            const c = e.location,
              key = `${c.size}/${c.x}/${c.y}`;
            groups.set(key, [...(groups.get(key) ?? []), e]);
          }
          for (const group of groups.values()) {
            const c = group[0].location!;
            const link = document.createElement("a");
            link.href = "#zone-" + group[0].id;
            link.className = "zone-marker";
            link.textContent = String(group.length);
            link.setAttribute(
              "aria-label",
              `${group.length} rencontre(s) dans cette zone`,
            );
            new Marker({ element: link })
              .setLngLat(
                inverse((c.x + 0.5) * c.size, (c.y + 0.5) * c.size) as [
                  number,
                  number,
                ],
              )
              .addTo(map!);
          }
        });
        if (onSelect)
          map.on("click", (e) => {
            try {
              onSelect(fromPosition(e.lngLat.lng, e.lngLat.lat, selectionSize));
            } catch {
              setError("Choisis une zone en France continentale.");
            }
          });
        map.on("error", () => {
          if (alive)
            setError(
              "La carte est indisponible. La liste reste accessible ci-dessous.",
            );
        });
      })
      .catch(() => {
        if (alive) setError("La carte est indisponible. Utilise la liste.");
      });
    return () => {
      alive = false;
      instance.current = null;
      map?.remove();
    };
  }, [
    entries,
    selected,
    onSelect,
    focus,
    selectionSize,
    providerKey,
    navigationCenter,
  ]);
  return (
    <>
      <p>
        Zones approximatives ·{" "}
        {providerKey
          ? "les repères représentent des zones, jamais des positions exactes."
          : "fond local simplifié, sans rues. Le fond détaillé et la recherche de ville sont indisponibles pour le moment."}
      </p>
      <div className="zone-map-wrap">
        <div
          ref={host}
          className="zone-map"
          aria-label="Carte des zones approximatives"
        />
        {providerKey && (
          <a
            className="map-provider-credit"
            href="https://www.maptiler.com/copyright/"
          >
            <img
              src="https://api.maptiler.com/resources/logo.svg"
              referrerPolicy="no-referrer"
              alt="MapTiler"
            />
          </a>
        )}
      </div>
      <p role="status">{error}</p>
      {onSelect && (
        <button
          type="button"
          className="encounter-button secondary"
          onClick={() => {
            const p = instance.current?.getCenter();
            if (!p) return;
            try {
              onSelect(fromPosition(p.lng, p.lat, selectionSize));
            } catch {
              setError("Choisis une zone en France continentale.");
            }
          }}
        >
          Choisir la zone au centre
        </button>
      )}
    </>
  );
}
