import type { EncounterDraft } from "@miaou/contracts";
export function EncounterFields({
  value,
  onChange,
}: {
  value: EncounterDraft;
  onChange: (d: EncounterDraft) => void;
}) {
  return (
    <>
      <label>
        Un petit titre
        <input
          name="title"
          required
          maxLength={120}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="Un petit curieux, une sieste au soleil…"
        />
      </label>
      <label>
        Quelques mots
        <textarea
          name="description"
          maxLength={2000}
          rows={4}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
        <small>Facultatif · 2 000 caractères maximum.</small>
      </label>
      <label>
        Date de la rencontre
        <input
          name="encounterDate"
          type="date"
          required
          value={value.encounterDate}
          onChange={(e) =>
            onChange({ ...value, encounterDate: e.target.value })
          }
        />
      </label>
      <label>
        Qui peut voir ce souvenir ?
        <select
          name="visibility"
          value={value.visibility}
          onChange={(e) =>
            onChange({
              ...value,
              visibility: e.target.value as EncounterDraft["visibility"],
            })
          }
        >
          <option value="public">Public · membres du club</option>
          <option value="private">Privé · moi uniquement</option>
        </select>
      </label>
      <p className="encounter-privacy">
        Sans lieu partagé. Vérifie aussi que ta photo et ton texte ne révèlent
        pas d’adresse ou de personne identifiable.
      </p>
    </>
  );
}
