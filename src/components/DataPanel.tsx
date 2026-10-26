import { useEffect, useState } from "react";
import { encounterAPI, jsonRequest } from "./encounter-api";
type Export = {
  id: string;
  state: string;
  created_at: string;
  expires_at: string | null;
  error: string | null;
};
export function DataPanel({
  preview = false,
  initialExports = [],
}: {
  preview?: boolean;
  initialExports?: Export[];
}) {
  const [jobs, setJobs] = useState<Export[]>(initialExports),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(preview),
    [confirm, setConfirm] = useState("");
  const load = async () => {
    const data = await encounterAPI<{ exports: Export[] }>(
      "/api/v1/me/exports",
    );
    setJobs(data.exports);
  };
  useEffect(() => {
    if (preview) return;
    void load().catch((e) => setMessage(e.message));
  }, [preview]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="account-panel data-panel">
      <a href="/profil">Retour au profil</a>
      <h1>Tes données</h1>
      <p>
        Ces actions restent accessibles après suspension ou retrait du club.
      </p>
      <p role="status">{message}</p>
      <h2>Copier tes données</h2>
      <p>
        Le fichier ZIP contient tes données en JSON et CSV et les photos encore
        conservées. Il reste disponible pendant 24 heures. Certaines données
        nécessitent un complément auprès de Gabriel.
      </p>
      <p>
        Pour demander ou télécharger une copie, reconnecte-toi depuis moins de
        cinq minutes. L’administrateur doit aussi déverrouiller sa session avec
        son second facteur.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void action(async () => {
            await encounterAPI("/api/v1/me/export", jsonRequest({}));
            await load();
            setMessage("Copie demandée. Actualise son état dans une minute.");
          })
        }
      >
        Demander ma copie
      </button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void action(load)}
      >
        Actualiser mes copies
      </button>
      <ul>
        {jobs.map((job) => (
          <li key={job.id}>
            {job.state === "ready" ? (
              <>
                Copie prête jusqu’au{" "}
                {new Date(job.expires_at!).toLocaleString("fr-FR")}.{" "}
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const r = await fetch(
                        `/api/v1/me/exports/${job.id}/download`,
                      );
                      if (!r.ok) {
                        if (r.status === 403)
                          throw new Error(
                            "Reconnecte-toi avant de télécharger cette copie.",
                          );
                        throw new Error("Cette copie n’est plus disponible.");
                      }
                      const href = URL.createObjectURL(await r.blob());
                      const a = document.createElement("a");
                      a.href = href;
                      a.download = "miaou-donnees.zip";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(href), 1000);
                    })
                  }
                >
                  Télécharger ma copie
                </button>
              </>
            ) : job.state === "failed" ? (
              "La copie a échoué. Contacte Gabriel pour obtenir tes données."
            ) : (
              "Préparation de ta copie…"
            )}
          </li>
        ))}
      </ul>
      <h2>Supprimer mon compte</h2>
      <p>
        Ton profil et tes souvenirs deviennent immédiatement inaccessibles.
        Leurs fichiers sont ensuite purgés. Cette action est définitive.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            await encounterAPI(
              "/api/v1/me/deletion",
              jsonRequest({ confirmation: confirm }),
            );
            window.location.assign("/profil?compte=supprime");
          });
        }}
      >
        <label>
          Écris SUPPRIMER pour confirmer
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <button className="danger" disabled={busy || confirm !== "SUPPRIMER"}>
          Supprimer définitivement mon compte
        </button>
      </form>
    </section>
  );
}
