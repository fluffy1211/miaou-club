import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import type { ZoneMap } from "./ZoneMap";

export function LazyZoneMap(props: ComponentProps<typeof ZoneMap>) {
  const [loaded, setLoaded] = useState<typeof import("./ZoneMap") | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void import("./ZoneMap").then(
      (module) => {
        if (alive) setLoaded(module);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  if (loaded) return <loaded.ZoneMap {...props} />;
  return (
    <p role="status">
      {failed
        ? "La carte est indisponible. La zone choisie reste conservée."
        : "Chargement de la carte…"}
    </p>
  );
}
