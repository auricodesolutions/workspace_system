import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aurilink Business Platform",
  description: "Operations command center for Aurilink Digital and Auricode Solutions",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
