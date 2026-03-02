import { useEffect, useState } from "react";
import "./Login.css";
import { TOKEN_KEY } from "./App";

interface Props {
  onLogin: (token: string) => void;
}

type LoginResponse = { access_token: string; token_type: "bearer" };

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || "/api";

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (error) setError("");
  }, [username, password, error]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Login failed");
      }

      const data = (await res.json()) as LoginResponse;
      if (!data?.access_token) throw new Error("Invalid login response");

      console.log("LOGIN OK token:", data.access_token);
      localStorage.setItem(TOKEN_KEY, data.access_token);
      onLogin(data.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="authPage">
      <div className="authCard">
        <div className="authHeader">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Logo" />
          <h1 className="authTitle">Logistics Apply AI Pro</h1>
          <p className="authSub">Sign in to access the dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="authForm" autoComplete="off">
          <div className="field">
            <label className="label" htmlFor="la-username">Username</label>
            <input
              id="la-username"
              name="la-username"
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="la-password">Password</label>
            <input
              id="la-password"
              name="la-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="btn btnPrimary" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>

          {error ? <div className="authError">{error}</div> : null}
        </form>
      </div>
    </div>
  );
}
