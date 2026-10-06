import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccountPanel } from "./AccountPanel";
import "../styles/accounts.css";
const meta = {
  title: "Comptes/AccountPanel",
  component: AccountPanel,
  args: { preview: true },
} satisfies Meta<typeof AccountPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Login: Story = { args: { mode: "login" } };
export const ForgottenPassword: Story = { args: { mode: "forgot" } };
