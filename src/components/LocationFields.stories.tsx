import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { LocationCell } from "@miaou/contracts";
import { LocationFields } from "./LocationFields";
import "../styles/global.css";
import "../styles/encounters.css";
function Demo({
  original,
  value,
}: {
  original?: LocationCell | null;
  value?: LocationCell | null;
}) {
  const [c, setCell] = useState(value);
  return (
    <div className="encounter-main">
      <LocationFields value={c} original={original} onChange={setCell} />
    </div>
  );
}
const meta = {
  title: "Rencontres/Localisation",
  component: Demo,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Facultative: Story = { args: { value: null } };
export const ApresPublication: Story = {
  args: {
    value: { size: 1000, x: 648, y: 6855 },
    original: { size: 1000, x: 648, y: 6855 },
  },
};
export const Retiree: Story = { args: { value: null, original: null } };
