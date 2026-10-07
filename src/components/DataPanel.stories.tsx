import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataPanel } from "./DataPanel";
import "../styles/accounts.css";
const meta = {
  title: "Comptes/DataPanel",
  component: DataPanel,
  args: { preview: true },
} satisfies Meta<typeof DataPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Preparing: Story = {
  args: {
    initialExports: [
      {
        id: "synthetic",
        state: "pending",
        created_at: "2026-10-07T07:00:00Z",
        expires_at: null,
        error: null,
      },
    ],
  },
};
export const Ready: Story = {
  args: {
    initialExports: [
      {
        id: "synthetic",
        state: "ready",
        created_at: "2026-10-07T07:00:00Z",
        expires_at: "2026-10-08T07:00:00Z",
        error: null,
      },
    ],
  },
};
export const Failed: Story = {
  args: {
    initialExports: [
      {
        id: "synthetic",
        state: "failed",
        created_at: "2026-10-07T07:00:00Z",
        expires_at: null,
        error: "export_unavailable",
      },
    ],
  },
};
