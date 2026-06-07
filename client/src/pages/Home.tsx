import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "../lib/api";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Home() {
  const [count, setCount] = useState(0);
  const { isAuthenticated, session } = useAuth();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["hello"],
    queryFn: () =>
      fetchApi<{ message: string; timestamp: string }>("/api/hello"),
    enabled: false,
  });

  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 p-8">
      <h1 className="text-4xl font-bold">{__APP_NAME__}</h1>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Counter</CardTitle>
          <CardDescription>
            Edit{" "}
            <code className="text-sm font-mono bg-muted px-1 py-0.5 rounded">
              src/App.tsx
            </code>{" "}
            and save to test HMR
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={() => setCount((c) => c + 1)}>
            count is {count}
          </Button>
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Public API</CardTitle>
          <CardDescription>
            Calls the public <code className="font-mono">hello</code> route
            — no auth required.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : "Fetch from API"}
          </Button>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>Error: {error.message}</AlertDescription>
            </Alert>
          )}
          {data && !error && (
            <p className="text-muted-foreground">{data.message}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3 items-center">
        {isAuthenticated ? (
          <>
            <span className="text-sm text-muted-foreground">
              Signed in as {session?.user.email}
            </span>
            <Button variant="link" asChild>
              <Link to="/users">Users (protected)</Link>
            </Button>
            <Button variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          </>
        ) : (
          <>
            <Button asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/signup">Sign up</Link>
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
