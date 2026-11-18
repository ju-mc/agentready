import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AgentScore — Is your website ready for AI agents?",
  description: "Free scan: see whether ChatGPT, Claude and other AI agents can reach, read and use your website. Get a full fix-it report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Ship or Die hackathon traffic verification */}
        <script defer src="https://www.ship-or-die.com/hackathon/verify.js" data-site="c7511ab34effb989f295fc0ae4a45c720f4fb074"></script>
      </head>
      <body>
        {children}
        <footer className="noprint" style={{ textAlign: "center", padding: "24px 20px 40px", fontSize: 13, color: "var(--muted)" }}>
          © {new Date().getFullYear()} AgentScore · <a href="/privacy" style={{ color: "inherit" }}>Privacy</a>
        </footer>
      </body>
    </html>
  );
}
