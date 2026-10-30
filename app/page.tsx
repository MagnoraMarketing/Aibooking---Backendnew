import { redirect } from "next/navigation";

// app.aibooking.dk is the customer app, not a landing page — the marketing
// site lives on aibooking.dk. Send visitors straight to login; middleware
// forwards signed-in users from /login on to /dashboard.
export default function HomePage() {
  redirect("/login");
}
