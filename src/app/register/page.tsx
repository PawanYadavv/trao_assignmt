"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error?.message ?? "Registration failed.");
      return;
    }

    router.push("/");
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand"><span>◎</span> prepwise</div>
        <p className="auth-kicker">START WITH A CLEAR PLAN</p>
        <h1>Build your edge.</h1>
        <p className="auth-description">Turn the job description into a preparation plan made for you.</p>
        <label>Name<input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Email<input aria-label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="error-text">{error}</p>}
        <button className="auth-submit" type="submit">Create account <span>→</span></button>
        <p className="auth-switch">Already have an account? <a href="/login">Log in</a></p>
      </form>
    </main>
  );
}
