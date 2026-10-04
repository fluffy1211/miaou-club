type Props = { unavailable?: boolean };
export function AccessNotice({ unavailable = false }: Props) {
  return (
    <section className="access-notice" role={unavailable ? "alert" : undefined}>
      <h1>Miaou Club</h1>
      <p>
        {unavailable
          ? "Le club est temporairement indisponible."
          : "L’accès au club est réservé aux membres admis."}
      </p>
      <p>Les inscriptions ne sont pas encore ouvertes.</p>
    </section>
  );
}
