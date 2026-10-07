import { authorized } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Login } from "@/components/login";
import { hasPasskeys } from "@/lib/auth/passkeys";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (await authorized()) redirect("/");
  return (
    <Login
      email={process.env.HOMEBASE_ADMIN_EMAIL}
      passkeys={await hasPasskeys()}
    />
  );
}
