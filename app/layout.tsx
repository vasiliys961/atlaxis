import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Literata } from "next/font/google";
import { ChatDock } from "@/components/ChatDock";
import { Nav } from "@/components/Nav";
import { Scene } from "@/components/Scene";
import "./globals.css";

const sans = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-sans" });
const serif = Literata({ subsets: ["latin", "cyrillic"], variable: "--font-serif" });
const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "ATLAXIS",
  description: "Справочный разбор медицинских документов",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
        <Scene />
        <Nav />
        <main>{children}</main>
        <footer className="site-footer">
          <span><b>ATLAXIS</b> · справочный разбор медицинских документов</span>
          <span>Курс — на ясность</span>
        </footer>
        <ChatDock />
      </body>
    </html>
  );
}
