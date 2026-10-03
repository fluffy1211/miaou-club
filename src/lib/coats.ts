export const coatLabels = {
  short: "Poils courts",
  long: "Poils longs",
  medium: "Poils mi-longs",
  curly: "Poils bouclés",
  hairless: "Sans poils",
  mixed: "Pelage variable",
  unknown: "Pelage non renseigné",
} as const;
export type Coat = keyof typeof coatLabels;
export const coatTypes = Object.keys(coatLabels) as Coat[];
