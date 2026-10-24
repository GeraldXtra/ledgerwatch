import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { currentTheme, onThemeChange, toggleTheme } from "../theme";

export default function ThemeToggle({ className = "topbar-icon" }) {
  const [theme, setTheme] = useState(() => currentTheme());

  useEffect(() => onThemeChange(() => setTheme(currentTheme())), []);

  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={className}
      onClick={toggleTheme}
      title={dark ? "Switch to light" : "Switch to dark"}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
