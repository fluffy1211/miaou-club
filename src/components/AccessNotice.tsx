type Props = { unavailable?: boolean };
export function AccessNotice({ unavailable = false }: Props) {
  return (
    <section className="access-notice" role={unavailable ? "alert" : undefined}>
      <svg className="access-logo" viewBox="0 0 44 44" aria-hidden="true">
        <path d="M8 20 6 5l13 9h7L38 5l-2 17c5 15-27 22-28-2Z" />
        <path d="m14 25 4 1m10-1-4 1m-5 6q3 3 6 0" />
      </svg>
      <h1>Miaou Club</h1>
      <p>
        {unavailable
          ? "Le club est temporairement indisponible."
          : "L’accès au club est réservé aux membres admis."}
      </p>
      <p>Les inscriptions ne sont pas encore ouvertes.</p>
      <a className="button" href="/profil">
        Se connecter
      </a>
    </section>
  );
}
