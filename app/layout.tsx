import type { Metadata } from "next";
import { ChatDock } from "@/components/ChatDock";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATLAXIS",
  description: "Справочный разбор медицинских документов",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Nav />
        <main>{children}</main>
        <ChatDock />
      </body>
    </html>
  );
}
