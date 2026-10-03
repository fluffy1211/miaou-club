import "dotenv/config";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import editorial from "./data/breed-editorial.json";
import { loadApiBreeds, type EditorialBreed } from "./lib/breed-api";
const breeds = defineCollection({
  loader: () => loadApiBreeds(editorial as EditorialBreed[]),
  schema: z.object({
    id: z.string(),
    name: z.string(),
    aliases: z.array(z.string()),
    order: z.number(),
    image: z.string(),
    coat: z.enum([
      "long",
      "short",
      "medium",
      "curly",
      "hairless",
      "mixed",
      "unknown",
    ]),
    caption: z.string(),
    intro: z.string(),
    look: z.string().optional(),
    temperament: z.string(),
    fact: z.string().optional(),
    remark: z.string().optional(),
    source: z.url(),
    sourceLabel: z.string(),
    country: z.string(),
    lifeSpan: z.string(),
    weight: z.string().optional(),
    api: z.object({
      name: z.string(),
      url: z.url(),
      breedId: z.string(),
      retrievedAt: z.iso.datetime(),
    }),
    credit: z
      .object({
        file: z.string(),
        slug: z.string(),
        title: z.string(),
        source: z.url(),
        imageUrl: z.url(),
        author: z.string(),
        license: z.string(),
        licenseUrl: z.url().optional(),
        provider: z.string(),
        width: z.number().positive(),
        height: z.number().positive(),
        retrievedAt: z.iso.datetime(),
      })
      .optional(),
  }),
});
export const collections = { breeds };
