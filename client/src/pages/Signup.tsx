import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import {
  signUp,
  signIn,
  DEFAULT_AUTH_REDIRECT,
  getAuthErrorMessage,
  isTimeoutError,
} from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
} from "@/lib/auth-constraints";
import { Eye, EyeOff } from "lucide-react";
import { FaGithub } from "react-icons/fa6";
import { FcGoogle } from "react-icons/fc";
import { toast } from "sonner";

export default function SignupPage() {
  useDocumentTitle("Sign Up");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") || DEFAULT_AUTH_REDIRECT;
  const { isAuthenticated, isPending, isFetching } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // Only redirect once auth state is confirmed fresh (not stale cache).
  // Without the isFetching guard, stale React Query cache can cause
  // spurious redirects on HMR or StrictMode re-mounts.
  useEffect(() => {
    if (!isPending && !isFetching && isAuthenticated) {
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, isPending, isFetching, navigate, returnTo]);

  // Clear stale error when user modifies inputs
  useEffect(() => {
    if (error) setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, email, password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setLoading(true);

    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        setError(getAuthErrorMessage(result.error, "Signup failed"));
        requestAnimationFrame(() => errorRef.current?.focus());
      } else {
        navigate(returnTo, { replace: true });
      }
    } catch (err) {
      setError(
        isTimeoutError(err)
          ? "Request timed out. Please try again."
          : "Unable to connect. Please check your internet connection.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleSocialSignIn = async (provider: "github" | "google") => {
    setError("");
    const providerName = provider === "github" ? "GitHub" : "Google";
    try {
      const result = await signIn.social(provider, returnTo);
      if (result?.error) {
        console.error(`${providerName} social sign-in error:`, result.error);
        toast.error(`${providerName} sign-in is not available`);
      }
    } catch {
      toast.error(`${providerName} sign-in failed. Please try again later.`);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader className="text-center">
          <h1 className="leading-none font-semibold text-2xl">
            Create an account
          </h1>
          <CardDescription>Get started for free</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {error && (
              <Alert ref={errorRef} variant="destructive" tabIndex={-1}>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="John Doe"
                  maxLength={MAX_NAME_LENGTH}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="name@example.com"
                  maxLength={MAX_EMAIL_LENGTH}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="--------"
                    maxLength={MAX_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Creating account..." : "Sign up"}
              </Button>

              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">
                  or continue with
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleSocialSignIn("google")}
                  className="flex-1"
                >
                  <FcGoogle className="w-5 h-5 mr-2" />
                  Google
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleSocialSignIn("github")}
                  className="flex-1"
                >
                  <FaGithub className="w-4 h-4 mr-2" />
                  GitHub
                </Button>
              </div>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                to={`/login${returnTo !== DEFAULT_AUTH_REDIRECT ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                className="font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
