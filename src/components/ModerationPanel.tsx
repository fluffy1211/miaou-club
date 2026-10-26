import { useEffect, useState } from "react";
import { encounterAPI, jsonRequest } from "./encounter-api";
type Report = {
  id: string;
  encounter_id: string;
  reason: string;
  closed_at: string | null;
  outcome: string | null;
};
type Member = {
  user_id: string;
  handle: string | null;
  display_name: string;
  status: string;
  reason: string | null;
};
type Audit = {
  id: string;
  actor: string;
  action: string;
  reason: string;
  created_at: string;
  target: string;
};
export function ModerationPanel({
  preview = false,
  initialReports = [],
}: {
  preview?: boolean;
  initialReports?: Report[];
}) {
  const [reports, setReports] = useState<Report[]>(initialReports),
    [next, setNext] = useState<string | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [audit, setAudit] = useState<Audit[]>([]),
    [auditNext, setAuditNext] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(preview);
  const [entry, setEntry] = useState<{
      title: string;
      description: string;
      image: string;
      visibility: string;
    } | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [reason, setReason] = useState("");
  const load = async () => {
    const [r, m, a] = await Promise.all([
      encounterAPI<{ reports: Report[]; next: string | null }>(
        "/api/v1/admin/reports",
      ),
      encounterAPI<{ members: Member[] }>("/api/v1/admin/members"),
      encounterAPI<{ audit: Audit[]; next: string | null }>(
        "/api/v1/admin/audit",
      ),
    ]);
    setReports(r.reports);
    setNext(r.next);
    setMembers(m.members);
    setAudit(a.audit);
    setAuditNext(a.next);
  };
  useEffect(() => {
    if (preview) return;
    void load().catch(() =>
      setMessage(
        "Accès administratif indisponible. Vérifie ton second facteur depuis le profil.",
      ),
    );
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
      <h1>Administration</h1>
      <p role="status">{message}</p>
      <button disabled={busy} onClick={() => void action(load)}>
        Actualiser
      </button>
      <h2>Signalements</h2>
      <ul>
        {reports.map((report) => (
          <li key={report.id}>
            <p>{report.reason}</p>
            <p>{report.closed_at ? "Clos : " + report.outcome : "À traiter"}</p>
            <button
              disabled={busy}
              onClick={() => {
                setSelected(report.id);
                setReason("");
                setEntry(null);
              }}
            >
              {report.closed_at
                ? "Réviser la décision"
                : "Traiter ce signalement"}
            </button>
          </li>
        ))}
      </ul>
      {next && (
        <button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const r = await encounterAPI<{
                reports: Report[];
                next: string | null;
              }>("/api/v1/admin/reports?after=" + next);
              setReports((v) => [...v, ...r.reports]);
              setNext(r.next);
            })
          }
        >
          Voir les signalements suivants
        </button>
      )}
      {selected && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const r = await encounterAPI<{
                encounter: NonNullable<typeof entry>;
              }>(
                `/api/v1/admin/reports/${selected}/consult`,
                jsonRequest({ reason }),
              );
              setEntry(r.encounter);
            });
          }}
        >
          <h2>Traitement du dossier</h2>
          <label>
            Motif de consultation ou de décision
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              required
            />
          </label>
          {!reports.find((r) => r.id === selected)?.closed_at && (
            <button disabled={busy}>Consulter le contenu signalé</button>
          )}
          {entry && (
            <div>
              <h3>{entry.title}</h3>
              <p>{entry.description}</p>
              <p>
                {entry.visibility === "private"
                  ? "Consultation exceptionnelle d’un souvenir devenu privé."
                  : "Souvenir partagé signalé."}
              </p>
              <img
                src={entry.image}
                alt="Photo du souvenir signalé"
                style={{ maxWidth: "100%" }}
              />
            </div>
          )}
          <div>
            {(["hide", "restore", "close"] as const).map((name, index) => (
              <button
                key={name}
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void action(async () => {
                    await encounterAPI(
                      `/api/v1/admin/reports/${selected}/action`,
                      jsonRequest({ action: name, reason }),
                    );
                    setEntry(null);
                    setSelected(null);
                    await load();
                    setMessage("Décision enregistrée.");
                  })
                }
              >
                {["Masquer", "Rétablir", "Clore le dossier"][index]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setEntry(null);
            }}
          >
            Fermer
          </button>
        </form>
      )}
      <h2>Comptes du club</h2>
      <ul>
        {members.map((member) => (
          <li key={member.user_id}>
            <p>
              {member.handle ?? member.display_name} ·{" "}
              {(
                {
                  active: "Actif",
                  suspended: "Suspendu",
                  withdrawn: "Accès retiré",
                  deleting: "Suppression en cours",
                } as Record<string, string>
              )[member.status] ?? member.status}
            </p>
            <p>{member.reason}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                void action(async () => {
                  await encounterAPI(
                    "/api/v1/admin/members/" + member.user_id,
                    jsonRequest({
                      action:
                        member.status === "suspended"
                          ? "reactivate"
                          : "suspend",
                      reason: values.get("reason"),
                    }),
                  );
                  await load();
                  setMessage("Statut mis à jour.");
                });
              }}
            >
              <label>
                Motif
                <textarea name="reason" required maxLength={1000} />
              </label>
              <button
                disabled={
                  busy || !["active", "suspended"].includes(member.status)
                }
              >
                {member.status === "suspended" ? "Réactiver" : "Suspendre"}
              </button>
            </form>
          </li>
        ))}
      </ul>
      <h2>Historique</h2>
      <ul>
        {audit.map((event) => (
          <li key={event.id}>
            {new Date(event.created_at).toLocaleString("fr-FR")} ·{" "}
            {(
              {
                hide: "Masquage",
                restore: "Rétablissement",
                close: "Clôture du dossier",
                suspend: "Suspension",
                reactivate: "Réactivation",
                report_consulted: "Consultation du dossier",
                report_image_consulted: "Consultation de la photo",
              } as Record<string, string>
            )[event.action] ?? "Action administrative"}{" "}
            · {event.reason}
            <p>
              Administrateur :{" "}
              {members.find((m) => m.user_id === event.actor)?.handle ??
                event.actor}{" "}
              · Cible : {event.target}
            </p>
          </li>
        ))}
      </ul>
      {auditNext && (
        <button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const a = await encounterAPI<{
                audit: Audit[];
                next: string | null;
              }>("/api/v1/admin/audit?after=" + auditNext);
              setAudit((v) => [...v, ...a.audit]);
              setAuditNext(a.next);
            })
          }
        >
          Voir la suite de l’historique
        </button>
      )}
    </section>
  );
}
