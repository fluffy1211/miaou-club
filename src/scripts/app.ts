import {
  matching,
  normalize,
  parseFavorites,
  type SearchableBreed,
} from "../lib/catalog";
import { coatLabels, coatTypes, type Coat } from "../lib/coats";
import { dailyDiscoveryIds } from "../lib/daily-discovery";
interface Entry extends SearchableBreed {
  image?: string;
}
const breeds: Entry[] = JSON.parse(
  document.querySelector("#breed-index")!.textContent!,
);
const storageKey = "miaou-club-favorites";
const ids = breeds.map((b) => b.id);
let saved = new Set<string>();
try {
  saved = parseFavorites(localStorage.getItem(storageKey), ids);
} catch {
  /* Session-only when storage is disabled. */
}
const nav = document.querySelector<HTMLElement>("#navigation")!;
const menu = document.querySelector<HTMLButtonElement>(".menu-toggle")!;
const dialog = document.querySelector<HTMLDialogElement>("#photo-dialog")!;
const input = document.querySelector<HTMLInputElement>(".search input");
const catalogGrid = document.querySelector<HTMLElement>("#catalog-grid");
const catalogCards = Array.from(
  catalogGrid?.querySelectorAll<HTMLElement>("[data-breed]") || [],
);
const dailyDiscoveries =
  document.querySelector<HTMLElement>("#daily-discoveries");
if (dailyDiscoveries) {
  const date = new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format();
  const selected = new Set(dailyDiscoveryIds(ids, date));
  dailyDiscoveries
    .querySelectorAll<HTMLElement>("[data-breed]")
    .forEach((card) => (card.hidden = !selected.has(card.dataset.breed!)));
}
let coat = "all",
  sort = "az",
  toastTimer: ReturnType<typeof setTimeout>;
function notify(message: string) {
  const toast = document.querySelector<HTMLElement>(".toast")!;
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
}
function updateFavorites() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-favorite]")
    .forEach((button) => {
      const active = saved.has(button.dataset.favorite!);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute(
        "aria-label",
        `${active ? "Retirer" : "Ajouter"} ${button.dataset.name} ${active ? "des" : "aux"} favoris`,
      );
      if (!button.classList.contains("favorite-toggle")) {
        button.textContent = active
          ? "♥ Dans mes favoris"
          : "♡ Ajouter aux favoris";
      }
    });
  const filled = document.querySelector<HTMLElement>("#favorites-filled");
  if (filled) {
    filled.hidden = !saved.size;
    document.querySelector<HTMLElement>("#favorites-empty")!.hidden = Boolean(
      saved.size,
    );
    const meta = document.querySelector<HTMLElement>("#favorites-meta")!;
    meta.hidden = !saved.size;
    meta.textContent = `${saved.size} race${saved.size > 1 ? "s" : ""} dans ton carnet 😺`;
    filled
      .querySelectorAll<HTMLElement>("[data-breed]")
      .forEach((card) => (card.hidden = !saved.has(card.dataset.breed!)));
  }
}
function closeSuggestions() {
  if (!catalogGrid) clearTimeout(searchTimer);
  document
    .querySelectorAll<HTMLElement>(".suggestions")
    .forEach((el) => (el.hidden = true));
  input?.setAttribute("aria-expanded", "false");
}
function updateCatalog(updateUrl = true) {
  if (!catalogGrid || !input) return;
  const isFigue = normalize(input.value) === "figue";
  const hits = matching(breeds, input.value, coat, sort);
  const visibleIds = new Set(hits.map((b) => b.id));
  catalogCards.forEach(
    (card) => (card.hidden = isFigue || !visibleIds.has(card.dataset.breed!)),
  );
  for (const breed of hits)
    catalogGrid.append(
      catalogCards.find((card) => card.dataset.breed === breed.id)!,
    );
  catalogGrid.hidden = isFigue || !hits.length;
  document.querySelector<HTMLElement>("#catalog-empty")!.hidden =
    isFigue || Boolean(hits.length);
  document.querySelector<HTMLElement>("#secret-result")!.hidden = !isFigue;
  const meta = document.querySelector<HTMLElement>(".results-meta")!;
  meta.hidden = isFigue || !hits.length;
  meta.textContent = `${hits.length} race${hits.length > 1 ? "s" : ""}${input.value.trim() ? ` pour « ${input.value.trim()} »` : ""}`;
  document.querySelector<HTMLElement>("#catalog-status")!.textContent = isFigue
    ? "Tu as trouvé Figue. Ouvre son carnet."
    : hits.length
      ? meta.textContent
      : "Aucun museau trouvé. Essaie un autre nom ou retire les filtres.";
  document
    .querySelectorAll<HTMLElement>("[data-coat]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.coat === coat)),
    );
  const filter = document.querySelector<HTMLElement>("[data-filter-panel]")!;
  filter.textContent = coat === "all" ? "Filtres" : "Filtres (1)";
  if (updateUrl) {
    const url = new URL(location.href);
    for (const [key, value] of [
      ["q", input.value.trim()],
      ["pelage", coat === "all" ? "" : coat],
      ["tri", sort === "az" ? "" : sort],
    ]) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    history.replaceState(null, "", url);
  }
}
function suggestions() {
  if (!input || catalogGrid) return;
  const panel = document.querySelector<HTMLElement>(".suggestions")!;
  panel.replaceChildren();
  if (!input.value.trim()) {
    closeSuggestions();
    return;
  }
  const isFigue = normalize(input.value) === "figue";
  const hits = matching(breeds, input.value).slice(0, 4);
  const results = isFigue
    ? [
        {
          id: "figue",
          name: "Tu as trouvé Figue !",
          coat: "secret",
          image:
            document.querySelector<HTMLElement>("#breed-index")!.dataset
              .figuePhoto!,
        },
      ]
    : hits;
  for (const breed of results) {
    const link = document.createElement("a");
    link.className = "suggestion";
    link.href = breed.id === "figue" ? "/figue/" : `/race/${breed.id}/`;
    if (breed.image) {
      const photo = document.createElement("img");
      photo.src = breed.image;
      photo.alt = "";
      link.append(photo);
    }
    const text = document.createElement("span");
    text.textContent = breed.name;
    const small = document.createElement("small");
    if (breed.coat !== "secret") small.dataset.coatType = breed.coat;
    small.textContent =
      breed.coat === "secret"
        ? "Ouvrir son carnet secret"
        : coatLabels[breed.coat as Coat];
    text.append(small);
    link.append(text);
    panel.append(link);
  }
  if (!results.length) {
    const p = document.createElement("p");
    p.textContent = "Aucun résultat. Essaie un autre nom.";
    panel.append(p);
  }
  panel.hidden = false;
  input.setAttribute("aria-expanded", "true");
}
let searchTimer: ReturnType<typeof setTimeout>;
input?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (catalogGrid) updateCatalog();
    else if (document.activeElement === input) suggestions();
  }, 250);
});
input?.addEventListener("focus", () => {
  if (!catalogGrid) suggestions();
});
input?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    const suggestion = document.querySelector<HTMLAnchorElement>(
      ".suggestions:not([hidden]) a",
    );
    if (suggestion) {
      event.preventDefault();
      suggestion.focus();
    }
  }
});
document.querySelector(".search")?.addEventListener("submit", (event) => {
  clearTimeout(searchTimer);
  if (catalogGrid) {
    event.preventDefault();
    updateCatalog();
    closeSuggestions();
  }
});
document
  .querySelector<HTMLSelectElement>("#sort")
  ?.addEventListener("change", (event) => {
    sort = (event.target as HTMLSelectElement).value;
    updateCatalog();
  });
function closeMenu() {
  nav.classList.remove("open");
  menu.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-label", "Ouvrir le menu");
}
menu.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menu.setAttribute("aria-expanded", String(open));
  menu.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
});
document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const button = target.closest<HTMLButtonElement>("button");
  if (button?.hasAttribute("data-random"))
    location.assign(
      `/race/${breeds[Math.floor(Math.random() * breeds.length)].id}/`,
    );
  if (button?.hasAttribute("data-favorite")) {
    const id = button.dataset.favorite!;
    const previous = saved.has(id);
    if (previous) saved.delete(id);
    else saved.add(id);
    let persisted = true;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...saved]));
    } catch {
      persisted = false;
    }
    updateFavorites();
    if (button.closest("[hidden]"))
      (
        document.querySelector<HTMLElement>(
          "#favorites-grid [data-breed]:not([hidden]) button",
        ) || document.querySelector<HTMLElement>("#favorites-empty a")
      )?.focus();
    notify(
      persisted
        ? previous
          ? "Retiré de ton carnet."
          : "Ajouté à ton carnet."
        : "Favori modifié pour cette session. Ce navigateur ne peut pas l’enregistrer.",
    );
  }
  if (button?.hasAttribute("data-coat")) {
    coat = button.dataset.coat!;
    updateCatalog();
  }
  if (button?.hasAttribute("data-filter-panel")) {
    const open = document
      .querySelector("#mobile-filters")!
      .classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
  }
  if (button?.hasAttribute("data-reset-search")) {
    coat = "all";
    sort = "az";
    input!.value = "";
    document.querySelector<HTMLSelectElement>("#sort")!.value = sort;
    updateCatalog();
    input!.focus();
  }
  if (button?.hasAttribute("data-photo")) {
    const photo = dialog.querySelector("img")!;
    photo.src = button.dataset.photo!;
    photo.alt =
      button.querySelector("img")?.alt || button.dataset.caption || "";
    dialog.querySelector("p")!.textContent = button.dataset.caption || "";
    dialog.showModal();
  }
  if (!target.closest(".search-wrap")) closeSuggestions();
  if (!target.closest(".site-header")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSuggestions();
    if (nav.classList.contains("open")) {
      closeMenu();
      menu.focus();
    }
  }
});
document
  .querySelector(".search-wrap")
  ?.addEventListener("focusout", (event) => {
    const wrap = event.currentTarget as Element;
    if (!wrap.contains((event as FocusEvent).relatedTarget as Node))
      closeSuggestions();
  });
dialog.querySelector("button")!.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    dialog.close();
});
window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) {
    try {
      saved = parseFavorites(localStorage.getItem(storageKey), ids);
    } catch {
      saved = new Set();
    }
    updateFavorites();
  }
});
window.addEventListener("popstate", () => {
  loadCatalogState();
});
function loadCatalogState() {
  if (!catalogGrid || !input) return;
  const params = new URLSearchParams(location.search);
  input.value = params.get("q") || "";
  coat = coatTypes.includes(params.get("pelage") as Coat)
    ? params.get("pelage")!
    : "all";
  sort = params.get("tri") === "za" ? "za" : "az";
  document.querySelector<HTMLSelectElement>("#sort")!.value = sort;
  updateCatalog(false);
}
updateFavorites();
loadCatalogState();

window.addEventListener("pageshow", () => {
  try {
    saved = parseFavorites(localStorage.getItem(storageKey), ids);
  } catch {
    /* Keep session favorites. */
  }
  updateFavorites();
});
