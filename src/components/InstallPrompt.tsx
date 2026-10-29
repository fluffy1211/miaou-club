import { useEffect, useState } from "react";

const storageKey = "miaou-install-prompt-dismissed";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

const read = () => {
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
};

export function InstallPrompt() {
  const [open, setOpen] = useState(false),
    [event, setEvent] = useState<InstallEvent | null>(null),
    [ios, setIos] = useState(false);
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // Les navigateurs pilotés (E2E) ne voient pas la fenêtre, qui bloquerait leurs clics.
    if (standalone || read() || navigator.webdriver) return;
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setOpen(true);
    const capture = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  if (!open) return null;
  const close = () => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Sans stockage, la fenêtre revient à la prochaine visite.
    }
    setOpen(false);
  };
  return (
    <div className="install-backdrop" role="presentation">
      <div
        className="install-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
      >
        <h2 id="install-title">Installe Miaou Club</h2>
        <p>
          Ajoute l’appli à ton écran d’accueil pour l’ouvrir en plein écran.
        </p>
        {event ? (
          <button
            className="encounter-button"
            onClick={() => {
              void event.prompt();
              close();
            }}
          >
            Installer
          </button>
        ) : ios ? (
          <ol>
            <li>
              Touche le bouton Partager de Safari (le carré avec une flèche).
            </li>
            <li>Choisis « Sur l’écran d’accueil ».</li>
            <li>Touche « Ajouter ».</li>
          </ol>
        ) : (
          <ol>
            <li>Ouvre le menu de ton navigateur (les trois points).</li>
            <li>
              Choisis « Installer l’application » ou « Ajouter à l’écran
              d’accueil ».
            </li>
          </ol>
        )}
        <button className="encounter-button secondary" onClick={close}>
          Plus tard
        </button>
      </div>
    </div>
  );
}
