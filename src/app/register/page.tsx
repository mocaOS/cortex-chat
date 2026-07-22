import { redirect } from "next/navigation";
import { isRegistrationEnabled } from "@/lib/registration";
import RegisterForm from "./RegisterForm";

export const dynamic = "force-dynamic";

// Server-side gate: with the feature off, /register does not exist — bounce to
// login without ever rendering the form (no client-side flash).
export default function RegisterPage() {
  if (!isRegistrationEnabled()) redirect("/login");
  return <RegisterForm />;
}
