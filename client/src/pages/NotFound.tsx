import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function NotFound() {
  useDocumentTitle("Page Not Found");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-6xl font-bold tracking-tight">404</h1>
      <p className="text-xl text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Button asChild size="lg">
        <Link to="/">Go Home</Link>
      </Button>
    </main>
  );
}
