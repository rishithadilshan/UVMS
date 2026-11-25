import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("uvms_theme", theme); } catch { /* storage unavailable */ }
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="icon-btn" onClick={toggle} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle light/dark mode">
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
