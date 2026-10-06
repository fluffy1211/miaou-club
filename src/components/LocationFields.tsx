import { useState, useRef, useEffect } from "react";
import type { LocationCell } from "@miaou/contracts";
import { ZoneMap } from "./ZoneMap";
import { fromPosition, enlarge } from "../../server/src/encounters/location";
export const locationLabel = (c?: LocationCell | null) =>
  c
    ? `Zone de ${c.size === 500 ? "500 m" : c.size === 1000 ? "1 km" : "2 km"} de côté · cellule ${c.x}/${c.y}`
    : "Sans lieu partagé.";
export function LocationFields({
  value,
  onChange,
  original,
}: {
  value?: LocationCell | null;
  onChange: (c: LocationCell | null, method?: "position" | "map") => void;
  original?: LocationCell | null;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<LocationCell["size"]>(1000);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const editing = original !== undefined;
  function locate() {
    if (!navigator.geolocation) {
      setMessage(
        "La localisation est indisponible. Tu peux publier sans lieu.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    const attempt = ++generation.current;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (attempt !== generation.current) return;
        try {
          onChange(
            fromPosition(
              p.coords.longitude,
              p.coords.latitude,
              size,
              p.coords.accuracy,
            ),
            "position",
          );
          setMessage(
            "Zone proposée. Vérifie qu’elle correspond à cette rencontre.",
          );
        } catch {
          setMessage(
            "Position hors périmètre ou trop imprécise. Tu peux publier sans lieu.",
          );
        } finally {
          setBusy(false);
        }
      },
      () => {
        if (attempt !== generation.current) return;
        setBusy(false);
        setMessage(
          "Position refusée ou indisponible. Tu peux publier sans lieu.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }
  return (
    <section className="location-fields">
      <h2>Un lieu ? C’est facultatif.</h2>
      {!editing && (
        <>
          <label>
            Taille proposée
            <select
              value={size}
              onChange={(e) =>
                setSize(Number(e.target.value) as LocationCell["size"])
              }
            >
              {[500, 1000, 2000].map((s) => (
                <option key={s} value={s}>
                  {s} m
                </option>
              ))}
            </select>
          </label>
          <p>
            Ta position actuelle sert uniquement à proposer une zone
            approximative, sans suivi. Elle reste sur ton téléphone ; seule la
            cellule sera partagée. Pour une photo ancienne, vérifie le lieu. La
            zone ne garantit pas l’anonymat.
          </p>
          <button
            type="button"
            className="encounter-button secondary"
            disabled={busy}
            onClick={locate}
          >
            Utiliser ma position actuelle
          </button>
          <p>
            <a href="/carte?choisir=1">Choisir une zone sur la carte</a> puis
            revenir à ce formulaire.
          </p>
        </>
      )}
      <p>{locationLabel(value)}</p>
      {value && <ZoneMap selected={value} />}
      {value && (
        <>
          <label>
            Taille de la zone
            <select
              value={value.size}
              onChange={(e) => {
                try {
                  onChange(
                    enlarge(
                      value,
                      Number(e.target.value) as LocationCell["size"],
                    ),
                  );
                } catch {
                  setMessage(
                    "Cette zone frontalière ne peut pas être agrandie ici. Tu peux retirer le lieu.",
                  );
                }
              }}
            >
              {[500, 1000, 2000]
                .filter((s) => s >= value.size)
                .map((s) => (
                  <option key={s} value={s}>
                    {s} m
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className="encounter-link"
            onClick={() => {
              generation.current++;
              setBusy(false);
              onChange(null);
            }}
          >
            Retirer le lieu
          </button>
        </>
      )}
      {editing && (
        <p>Après publication, tu peux seulement agrandir ou retirer la zone.</p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
