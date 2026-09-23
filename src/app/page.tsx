import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { listKits, type KitSummary } from "@/lib/store/kits";
import { Workspace } from "./workspace/Workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const user = await getCurrentUser(new Request("http://local/", { headers: requestHeaders }));
  if (!user) redirect("/login");

  let kits: KitSummary[] = [];
  try {
    kits = await listKits(user.id);
  } catch {
    // The workspace renders its own empty state if the store is unreachable.
  }

  return <Workspace user={user} initialKits={kits} />;
}
