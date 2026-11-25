import { createContext, useContext, useEffect, useState } from "react";
import api from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = sessionStorage.getItem("uvms_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem("uvms_token");
    if (!token) { setLoading(false); return; }
    api.get("/auth/me")
      .then((res) => { setUser(res.data.user); sessionStorage.setItem("uvms_user", JSON.stringify(res.data.user)); })
      .catch(() => { sessionStorage.removeItem("uvms_token"); sessionStorage.removeItem("uvms_user"); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  /** Returns { user, message } — message is set the first time an approved user signs in. */
  async function login(identifier, password) {
    const res = await api.post("/auth/login", { email: identifier, password });
    sessionStorage.setItem("uvms_token", res.data.token);
    sessionStorage.setItem("uvms_user", JSON.stringify(res.data.user));
    setUser(res.data.user);
    return { user: res.data.user, message: res.data.message };
  }
  /** Registration creates a PENDING account; nobody is signed in until an admin approves it. */
  async function register(payload) {
    const res = await api.post("/auth/register", payload);
    return res.data;
  }
  function logout() {
    sessionStorage.removeItem("uvms_token");
    sessionStorage.removeItem("uvms_user");
    setUser(null);
  }
  return <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
