import type { Meta, StoryObj } from "@storybook/react-vite";
import { FriendsPanel } from "./FriendsPanel";
import "../styles/global.css";
import "../styles/encounters.css";
const meta = {
  title: "Comptes/FriendsPanel",
  component: FriendsPanel,
  args: { preview: true },
  decorators: [
    (Story) => (
      <main className="encounter-main">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof FriendsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
const person = {
  id: "synthetic",
  handle: "camille_synthetique",
  displayName: "camille_synthetique",
  color: "violet",
  avatar: "initials",
};
export const Requests: Story = {
  args: {
    initial: {
      received: { people: [person], next: null },
      sent: {
        people: [
          {
            ...person,
            id: "sent",
            handle: "lou_synthetique",
            displayName: "lou_synthetique",
          },
        ],
        next: null,
      },
    },
  },
};
export const WithFriends: Story = {
  args: { initial: { friends: { people: [person], next: null } } },
};
export const Limited: Story = {
  args: {
    initialMessage:
      "La limite de demandes d’amis est atteinte. Réessaie dans 3600 secondes.",
  },
};

export const UnavailablePeer: Story = {
  args: {
    initial: {
      received: {
        people: [
          {
            ...person,
            handle: null,
            displayName: "Membre indisponible",
            available: false,
          },
        ],
        next: null,
      },
    },
  },
};
