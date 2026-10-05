import { redirect } from "next/navigation";
import { authorized } from "@/lib/auth";
import { Homebase } from "@/components/homebase";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!(await authorized())) redirect("/login");
  return <Homebase />;
}
