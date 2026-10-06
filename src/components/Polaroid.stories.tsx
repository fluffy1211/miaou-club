import type { Meta, StoryObj } from "@storybook/react-vite";
import { Polaroid } from "./Polaroid";
import "../styles/global.css";
import "../styles/encounters.css";
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="#bcdccb"/><path d="M120 260L100 60L210 140L300 140L390 60L370 260Q360 390 240 390Q120 390 120 260" fill="#49366d"/><circle cx="180" cy="240" r="25" fill="#f4d978"/><circle cx="300" cy="240" r="25" fill="#f4d978"/></svg>',
  );
const meta = {
  title: "Rencontres/Polaroid",
  component: Polaroid,
  args: { image, title: "Un petit curieux" },
  parameters: { layout: "padded" },
} satisfies Meta<typeof Polaroid>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Souvenir: Story = {};
export const TitreLong: Story = {
  args: {
    title:
      "Un petit curieux croisé pendant une très longue promenade dans le quartier",
    small: true,
  },
};
