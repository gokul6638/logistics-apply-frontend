import { useEffect, useMemo, useState } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";

export const TOKEN_KEY = "la_token";

export default function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const isAuthed = useMemo(() => Boolean(token), [token]);

  useEffect(() => {
  console.log("APP token changed:", token);
}, [token]);

  const handleLogout = () => setToken("");

  return (
    <div className="page">
      {!isAuthed ? (
        <Login onLogin={setToken} />
      ) : (
        <Dashboard token={token} onLogout={handleLogout} />
      )}
    </div>
  );
}
