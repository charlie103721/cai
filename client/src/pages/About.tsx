import { Link } from "react-router";
import { Button } from "@/components/ui/button";

const PAGE_HEADING = "About";
const APP_DESCRIPTION =
  "This is a fullstack application built on Cloudflare Workers with Hono on the backend and React on the frontend. It features authentication, database access via Hyperdrive, and a modern UI powered by Tailwind CSS.";

export default function About() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-5xl font-bold tracking-tight">{PAGE_HEADING}</h1>
      <p className="max-w-xl text-center text-xl text-muted-foreground">
        {APP_DESCRIPTION}
      </p>
      <Button asChild variant="link">
        <Link to="/">Back to Home</Link>
      </Button>
    </main>
  );
}
