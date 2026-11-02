type Props = { unavailable?: boolean };

export function AccessNotice({ unavailable = false }: Props) {
  return (
    <section
      className="account-panel access-notice"
      role={unavailable ? "alert" : undefined}
    >
      <a className="account-brand" href="/profil">
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <path d="M8 20 6 5l13 9h7L38 5l-2 17c5 15-27 22-28-2Z" />
          <path d="m14 25 4 1m10-1-4 1m-5 6q3 3 6 0" />
        </svg>
        miaou club
      </a>
      <h1>{unavailable ? "Le club fait une pause." : "Accès réservé."}</h1>
      <p className="account-lead">
        {unavailable
          ? "Il est temporairement indisponible."
          : "Le club est réservé aux membres admis."}
      </p>
      <a className="button" href="/profil">
        Se connecter
      </a>
    </section>
  );
}
