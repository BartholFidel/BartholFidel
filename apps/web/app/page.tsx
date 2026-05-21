import { redirect } from "next/navigation";

/** Root route redirects to the operational dashboard. */
export default function HomePage(): never {
  redirect("/dashboard");
}
