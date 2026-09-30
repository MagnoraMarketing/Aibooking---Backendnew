import { redirect } from "next/navigation";

// Short alias for the direct download link.
export default function DownloadRedirect() {
  redirect("/app/download");
}
