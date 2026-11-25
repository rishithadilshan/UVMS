import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "../context/ThemeContext";
import { errMsg } from "../lib/format";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const { message } = await login(identifier, password);
      if (message) sessionStorage.setItem("uvms_flash", message);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(errMsg(err, "Could not log in"));
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-top"><ThemeToggle /></div>
        <span className="brand">UVMS</span>
        <span className="brand-sub">University Venue Management System</span>
        <form onSubmit={handleSubmit}>
          <label htmlFor="identifier">Email or username</label>
          <input id="identifier" data-testid="login-email" type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoComplete="username" />
          <label htmlFor="password">Password</label>
          <input id="password" data-testid="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="form-actions"><button className="btn btn-primary" data-testid="login-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></div>
        </form>
        <p className="hint-text" style={{ marginTop: 14 }}>No account? <Link to="/register">Register</Link>. New accounts must be approved by an administrator before you can sign in.</p>
      </div>
    </div>
  );
}
