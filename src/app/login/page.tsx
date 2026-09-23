"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("user@example.com");
  const [password, setPassword] = useState("secret123");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error?.message ?? "Login failed.");
      return;
    }

    router.push("/");
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand"><span>◎</span> prepwise</div>
        <p className="auth-kicker">YOUR INTERVIEW, PREPARED</p>
        <h1>Welcome back.</h1>
        <p className="auth-description">Pick up where you left off and keep your preparation moving.</p>
        <label>Email<input aria-label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="error-text">{error}</p>}
        <button className="auth-submit" type="submit">Log in <span>→</span></button>
        <p className="auth-switch">New to Prepwise? <a href="/register">Create an account</a></p>
      </form>
    </main>
  );
}
