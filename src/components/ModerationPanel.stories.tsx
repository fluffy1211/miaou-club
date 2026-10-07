import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModerationPanel } from "./ModerationPanel";
import "../styles/accounts.css";
const meta = {
  title: "Comptes/ModerationPanel",
  component: ModerationPanel,
  args: { preview: true },
} satisfies Meta<typeof ModerationPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const OpenReport: Story = {
  args: {
    initialReports: [
      {
        id: "synthetic",
        encounter_id: "synthetic",
        reason: "Motif synthétique à examiner",
        closed_at: null,
        outcome: null,
      },
    ],
  },
};
export const ClosedReport: Story = {
  args: {
    initialReports: [
      {
        id: "synthetic",
        encounter_id: "synthetic",
        reason: "Motif synthétique examiné",
        closed_at: "2026-10-07T07:00:00Z",
        outcome: "Dossier traité",
      },
    ],
  },
};
