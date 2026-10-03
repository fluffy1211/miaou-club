import { getCollection, type CollectionEntry } from "astro:content";
import { coatLabels } from "./coats";
export type Breed = CollectionEntry<"breeds">["data"];
export async function getBreeds(): Promise<Breed[]> {
  return (await getCollection("breeds"))
    .map((entry) => entry.data)
    .sort((a, b) => a.order - b.order);
}
export const coatLabel = (breed: Breed) => coatLabels[breed.coat];
