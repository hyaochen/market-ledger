import { requireRole } from "@/lib/auth";

export default async function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    await requireRole("admin");
    return children;
}
