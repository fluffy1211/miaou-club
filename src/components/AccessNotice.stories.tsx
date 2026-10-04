import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccessNotice } from "./AccessNotice";
const meta = { title: "Accès/Notice", component: AccessNotice } satisfies Meta<
  typeof AccessNotice
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Closed: Story = {};
export const Unavailable: Story = { args: { unavailable: true } };
