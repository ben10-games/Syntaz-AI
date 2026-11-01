import type { Metadata, Viewport } from "next";
import "highlight.js/styles/github-dark.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Syntaz AI",
  description: "Syntaz AI — a fast, private AI chat assistant.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050807",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        {/* Liquid glass: draws the lens of every .glass panel (public/liquid.js, the same file as the extension's). */}
        <script src="/liquid.js" data-glass=".glass" defer />
      </body>
    </html>
  );
}
