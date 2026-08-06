import { NavLink } from 'react-router-dom';

export function Sidebar() {
  return (
    <nav className="sidebar">
      <p className="sidebar-label">API Runner</p>
      <NavLink
        to="/"
        end
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Simple Mode
      </NavLink>
      <NavLink
        to="/e2e-test"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        End-to-end test
      </NavLink>
      <NavLink
        to="/api-automation"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        API Automation
      </NavLink>
      <NavLink
        to="/kafka-checks"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Check Kafka
      </NavLink>
    </nav>
  );
}
