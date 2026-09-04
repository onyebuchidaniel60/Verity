import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VERITY — Private Bounty & Truth Marketplace",
  description:
    "A private bounty & truth marketplace on Starknet, powered by genuine STRK20 privacy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}