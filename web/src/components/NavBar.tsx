import { NavLink } from "react-router-dom";
import { LayoutDashboard, Smartphone, Shield, FolderOpen } from "lucide-react";

const links = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/capture", label: "Capture", icon: Smartphone },
  { to: "/verify", label: "Verify", icon: Shield },
  { to: "/evidence", label: "Evidence", icon: FolderOpen },
] as const;

export default function NavBar() {
  return (
    <nav className="top-nav" aria-label="Primary navigation">
      <ul className="top-nav__list">
        {links.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `top-nav__link${isActive ? " top-nav__link--active" : ""}`
              }
            >
              <Icon size={15} strokeWidth={2} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
