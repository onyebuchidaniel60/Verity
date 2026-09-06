import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import ConnectWallet from "@/components/ConnectWallet";

export const metadata: Metadata = {
  title: "VERITY — Private Bounty Marketplace",
  description: "Private, transparent bounty payments on Starknet. Fund bounties and reward truth — privately.",
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="verity-nav-link">
      {children}
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="verity-app">
          <nav className="verity-nav">
            <div className="verity-nav-inner">
              <Link href="/" className="verity-logo">
                <span className="verity-logo-mark">V</span>
                VERITY
              </Link>
              <div className="verity-nav-links">
                <NavLink href="/">Home</NavLink>
                <NavLink href="/bounties">Bounties</NavLink>
                <NavLink href="/create">Create Bounty</NavLink>
              </div>
              <div className="verity-nav-actions">
                <ConnectWallet />
              </div>
            </div>
          </nav>
          <main className="verity-main">{children}</main>
          <footer style={{ borderTop: "1px solid var(--border)", padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            VERITY — Private bounty & truth marketplace on Starknet • <Link href="/phase1-proof" className="opacity-50 hover:opacity-100">Developer</Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
