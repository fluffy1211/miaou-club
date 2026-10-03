import { z } from "astro/zod";
import { decodeHTML } from "entities";
import { fetchApi } from "./api-client.ts";
import { coatLabels, type Coat } from "./coats.ts";
import localizations from "../data/breed-localizations.json" with { type: "json" };

export const catApiSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      origin: z.string().min(1).nullable(),
      life_span: z.string().min(1),
      temperament: z.string().min(1),
      breed_group: z.string().min(1).nullable(),
      weight: z.object({ metric: z.string().min(1) }).optional(),
      image: z
        .object({
          url: z.url(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .nullish(),
    }),
  )
  .min(1);
const metadata = z.object({ value: z.string() });
const commonsSchema = z.object({
  query: z.object({
    normalized: z
      .array(z.object({ from: z.string(), to: z.string() }))
      .optional(),
    redirects: z
      .array(z.object({ from: z.string(), to: z.string() }))
      .optional(),
    pages: z.record(
      z.string(),
      z.object({
        title: z.string(),
        imageinfo: z
          .array(
            z.object({
              url: z.url(),
              descriptionurl: z.url(),
              width: z.number().positive(),
              height: z.number().positive(),
              extmetadata: z.object({
                Artist: metadata.optional(),
                LicenseShortName: metadata,
                LicenseUrl: metadata,
              }),
            }),
          )
          .optional(),
      }),
    ),
  }),
});
export interface EditorialBreed {
  id: string;
  catApiId: string;
  name: string;
  aliases: string[];
  image: string;
  order: number;
  commonsFile: string;
  caption: string;
  intro: string;
  look: string;
  fact: string;
  source: string;
  remark: string;
}
export const apiCoat = (value: string): Coat => {
  if (value === "Short-haired") return "short";
  if (value === "Long-haired") return "long";
  if (["Medium-hair", "Semi-longhair", "Semi-long-haired"].includes(value))
    return "medium";
  if (value === "Rex") return "curly";
  if (
    ["Hairless", "Partially hairless", "Hairless/Short-legged"].includes(value)
  )
    return "hairless";
  if (
    [
      "Short/Medium-hair",
      "Short/Long-hair",
      "Short/Semi-long",
      "Short/Semi-longhair",
      "Varies",
    ].includes(value)
  )
    return "mixed";
  if (value === "Hybrid") return "unknown";
  throw new Error(`Pelage API non pris en charge : ${value}`);
};
export const plainText = (html: string) =>
  decodeHTML(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const countries: Record<string, string> = {
  "United States": "États-Unis",
  "United Kingdom": "Royaume-Uni",
  Thailand: "Thaïlande",
  "Iran (Persia)": "Iran (Perse)",
  Egypt: "Égypte",
  Greece: "Grèce",
  Cyprus: "Chypre",
  "United Arab Emirates": "Émirats arabes unis",
  Australia: "Australie",
  France: "France",
  Brazil: "Brésil",
  "Myanmar (Burma)": "Myanmar (Birmanie)",
  "Egypt/United States": "Égypte / États-Unis",
  "Isle of Man/Canada": "Île de Man / Canada",
  Russia: "Russie",
  China: "Chine",
  "Sweden / Italy / Europe": "Suède / Italie / Europe",
  Canada: "Canada",
  Germany: "Allemagne",
  Japan: "Japon",
  Israel: "Israël",
  "Isle of Man": "Île de Man",
  Norway: "Norvège",
  Indonesia: "Indonésie",
  Scotland: "Écosse",
  Singapore: "Singapour",
  Kenya: "Kenya",
  "Canada/United States": "Canada / États-Unis",
  Turkey: "Turquie",
  Ukraine: "Ukraine",
};
const temperaments: Record<string, string> = {
  Adaptable: "Adaptable",
  Intelligent: "Intelligent",
  Loving: "Affectueux",
  Gentle: "Doux",
  Independent: "Indépendant",
  Playful: "Joueur",
  Friendly: "Amical",
  Active: "Actif",
  Agile: "Agile",
  Clever: "Malin",
  Sociable: "Sociable",
  Energetic: "Énergique",
  Affectionate: "Affectueux",
  Alert: "Vigilant",
  Demanding: "Exigeant",
  Curious: "Curieux",
  "Easy Going": "Facile à vivre",
  Loyal: "Loyal",
  Patient: "Patient",
  Calm: "Calme",
  Sedate: "Posé",
  Quiet: "Discret",
  Sweet: "Doux",
  Adventurous: "Aventureux",
  Athletic: "Athlétique",
  Charming: "Charmant",
  Cheerful: "Enjoué",
  Confident: "Assuré",
  Dependent: "Attaché à ses proches",
  Devoted: "Dévoué",
  Docile: "Docile",
  "Easily leash-trained": "Réceptif à l’apprentissage de la marche en laisse",
  Easygoing: "Facile à vivre",
  Expressive: "Expressif",
  "Extremely affectionate": "Très affectueux",
  "Fun-loving": "Joueur",
  "Highly intelligent": "Très intelligent",
  "Highly interactive": "Très interactif",
  Inquisitive: "Curieux",
  Interactive: "Interactif",
  Lively: "Vif",
  Mischievous: "Espiègle",
  Observant: "Observateur",
  Outgoing: "Sociable",
  Peaceful: "Paisible",
  "People-oriented": "Tourné vers les humains",
  Personable: "Sociable",
  Relaxed: "Détendu",
  Reserved: "Réservé",
  Sensible: "Pondéré",
  Sensitive: "Sensible",
  Shy: "Timide",
  Silly: "Espiègle",
  Social: "Sociable",
  "Sweet-tempered": "Doux",
  Talkative: "Bavard",
  Tenacious: "Tenace",
  Tolerant: "Tolérant",
  Trainable: "Réceptif à l’apprentissage",
  Vocal: "Vocal",
  Warm: "Chaleureux",
  "Varies by individual - typically Affectionate":
    "Variable selon le chat, souvent affectueux",
  "Varies widely - typically Friendly":
    "Variable selon le chat, souvent amical",
};
export function frenchTemperament(value: string) {
  const labels = value.split(",").map((term) => {
    const label = temperaments[term.trim()];
    if (!label)
      throw new Error(`Libellé de caractère API à traduire : ${term.trim()}`);
    return label;
  });
  return [...new Set(labels)].join(", ") + ".";
}
const fileTitle = (title: string) =>
  `File:${title.replace(/^File:/, "").replaceAll("_", " ")}`;

type ApiBreed = z.infer<typeof catApiSchema>[number];
// The provider also lists mixed-breed coat types and polydactyly, which are not breeds.
const nonBreedIds = new Set(["doml", "domm", "doms", "poly", "kell"]);
export function catalogRecords(records: ApiBreed[]) {
  const names = new Set<string>();
  return records.filter((record) => {
    const name = record.name.trim().toLowerCase();
    if (
      nonBreedIds.has(record.id) ||
      names.has(name) ||
      !record.origin ||
      !record.breed_group ||
      !/^\d{1,2}(?:\s*-\s*\d{1,2})?$/.test(record.life_span) ||
      (record.weight &&
        !/^\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?$/.test(record.weight.metric))
    )
      return false;
    names.add(name);
    return true;
  });
}

export async function loadApiBreeds(editorial: EditorialBreed[]) {
  const key = process.env.CAT_API_KEY?.trim();
  if (!key)
    throw new Error(
      "[Miaou Club] CAT_API_KEY manquante. Copie .env.example vers .env et renseigne ta clé TheCatAPI.",
    );
  const commonsUrl = new URL("https://commons.wikimedia.org/w/api.php");
  commonsUrl.search = new URLSearchParams({
    action: "query",
    format: "json",
    redirects: "1",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
    titles: editorial.map((b) => `File:${b.commonsFile}`).join("|"),
  }).toString();
  const [catalog, commons] = await Promise.all([
    fetchApi({
      name: "thecatapi-breeds-full",
      url: "https://api.thecatapi.com/v1/breeds",
      headers: { "x-api-key": key },
      parse: (value) => catApiSchema.parse(value),
    }),
    fetchApi({
      name: "wikimedia-images",
      url: commonsUrl.href,
      parse: (value) => commonsSchema.parse(value),
    }),
  ]);
  const query = commons.payload.query;
  const curated = editorial.map((item) => {
    const matches = catalog.payload.filter(
      (record) => record.id === item.catApiId,
    );
    if (matches.length !== 1)
      throw new Error(`Race TheCatAPI absente ou ambiguë : ${item.catApiId}`);
    const record = matches[0];
    if (!record.origin || !record.breed_group)
      throw new Error(`Données TheCatAPI incomplètes pour ${item.catApiId}.`);
    let title = fileTitle(item.commonsFile);
    for (const alias of [
      ...(query.normalized || []),
      ...(query.redirects || []),
    ])
      if (fileTitle(alias.from) === title) title = fileTitle(alias.to);
    const page = Object.values(query.pages).find(
      (p) => fileTitle(p.title) === title,
    );
    const image = page?.imageinfo?.[0];
    if (!image)
      throw new Error(`Photo Wikimedia introuvable : ${item.commonsFile}`);
    if (new URL(image.url).hostname !== "upload.wikimedia.org")
      throw new Error("Hôte de photo Wikimedia inattendu.");
    const { catApiId, commonsFile, ...content } = item;
    return {
      ...content,
      sourceLabel: "Cat Fanciers’ Association",
      aliases: [...new Set([...item.aliases, record.name])],
      coat: apiCoat(record.breed_group),
      country: countries[record.origin] || record.origin,
      lifeSpan: record.life_span.replace(/\s*-\s*/g, "–"),
      weight: record.weight?.metric.replace(/\s*-\s*/g, "–"),
      temperament: frenchTemperament(record.temperament),
      api: {
        name: "TheCatAPI",
        url: "https://docs.thecatapi.com/docs/examples/breeds",
        breedId: catApiId,
        retrievedAt: catalog.fetchedAt,
      },
      credit: {
        file: item.image,
        slug: item.id,
        title: page!.title.replace(/^File:/, ""),
        source: image.descriptionurl,
        imageUrl: image.url,
        width: image.width,
        height: image.height,
        author: plainText(image.extmetadata.Artist?.value || ""),
        license: plainText(image.extmetadata.LicenseShortName.value),
        licenseUrl: image.extmetadata.LicenseUrl.value,
        retrievedAt: commons.fetchedAt,
        provider: "Wikimedia Commons",
      },
    };
  });
  const curatedIds = new Set(editorial.map((item) => item.catApiId));
  const translations: Record<
    string,
    { name: string; caption: string; intro: string }
  > = localizations;
  const additional = catalogRecords(catalog.payload)
    .filter((record) => !curatedIds.has(record.id))
    .map((record, index) => {
      const translated = translations[record.id];
      const coat = apiCoat(record.breed_group!);
      const country = countries[record.origin!] || record.origin!;
      const id = record.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const image = record.image;
      if (
        image &&
        !["cdn2.thecatapi.com", "cdn.thecatapi.com"].includes(
          new URL(image.url).hostname,
        )
      )
        throw new Error(`Hôte de photo TheCatAPI inattendu pour ${record.id}.`);
      return {
        id,
        name: translated?.name || record.name,
        aliases: [record.name],
        order: editorial.length + index,
        image: `${record.id}.jpg`,
        coat,
        caption: translated?.caption || `${coatLabels[coat]} · ${country}`,
        intro:
          translated?.intro ||
          `${record.name} : ${coatLabels[coat].toLowerCase()}. Origine indiquée : ${country}.`,
        country,
        lifeSpan: record.life_span.replace(/\s*-\s*/g, "–"),
        weight: record.weight?.metric.replace(/\s*-\s*/g, "–"),
        temperament: frenchTemperament(record.temperament),
      source: "https://docs.thecatapi.com/docs/examples/breeds",
        sourceLabel: "TheCatAPI",
        api: {
          name: "TheCatAPI",
          url: "https://docs.thecatapi.com/docs/examples/breeds",
          breedId: record.id,
          retrievedAt: catalog.fetchedAt,
        },
        credit: image
          ? {
              file: `${record.id}.jpg`,
              slug: id,
              title: translated?.name || record.name,
              source: image.url,
              imageUrl: image.url,
              width: image.width,
              height: image.height,
              author: "",
              license: "",
              retrievedAt: catalog.fetchedAt,
              provider: "TheCatAPI",
            }
          : undefined,
      };
    });
  return [...curated, ...additional];
}
