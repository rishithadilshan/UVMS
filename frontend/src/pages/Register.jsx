import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "../context/ThemeContext";
import { errMsg } from "../lib/format";

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", role: "", registrationNumber: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (f, v) => setForm((x) => ({ ...x, [f]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.role) return setError("Please select a role");
    if (form.password.length < 8 || form.password.length > 12) return setError("Password must be 8 to 12 characters long");
    if (form.password !== form.confirmPassword) return setError("Passwords do not match");
    if (form.role === "STUDENT" && !form.registrationNumber.trim()) return setError("Registration number is required for students");
    setBusy(true);
    try {
      const payload = { ...form };
      if (form.role !== "STUDENT") delete payload.registrationNumber;
      const r = await register(payload);
      setDone(r.message);
    } catch (err) { setError(errMsg(err, "Could not register")); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="auth-wrap"><div className="auth-card">
        <span className="brand">Registration submitted</span>
        <div className="alert alert-success" style={{ marginTop: 14 }}>{done}</div>
        <p className="hint-text">You will receive an in-app notification and an email once an administrator has reviewed your registration.</p>
        <Link className="btn btn-primary" to="/login">Back to sign in</Link>
      </div></div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-top"><ThemeToggle /></div>
        <span className="brand">Create an account</span>
        <span className="brand-sub">An administrator reviews every registration</span>
        <form onSubmit={handleSubmit}>
          <label htmlFor="name">Full name</label>
          <input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} required />
          <label htmlFor="email">Email address</label>
          <input id="email" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
          <label htmlFor="role">Role</label>
          <select id="role" value={form.role} onChange={(e) => update("role", e.target.value)} required>
            <option value="">Select your role…</option>
            <option value="LECTURER">Lecturer</option>
            <option value="INSTRUCTOR">Instructor</option>
            <option value="STUDENT">Student</option>
          </select>
          {form.role === "STUDENT" && (<>
            <label htmlFor="reg">Registration number</label>
            <input id="reg" value={form.registrationNumber} onChange={(e) => update("registrationNumber", e.target.value)} placeholder="e.g. EG/2021/1234" required />
          </>)}
          <label htmlFor="password">Password (8–12 characters)</label>
          <input id="password" type="password" minLength={8} maxLength={12} value={form.password} onChange={(e) => update("password", e.target.value)} required autoComplete="new-password" />
          <label htmlFor="confirm">Confirm password</label>
          <input id="confirm" type="password" minLength={8} maxLength={12} value={form.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} required autoComplete="new-password" />
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit registration"}</button></div>
        </form>
        <p className="hint-text" style={{ marginTop: 14 }}>Already registered? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
