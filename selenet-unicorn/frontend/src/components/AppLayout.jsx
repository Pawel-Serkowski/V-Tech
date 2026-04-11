import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard" },
  { to: "/packets", label: "Pakiety" },
  { to: "/dispatch", label: "Wysylka" },
  { to: "/fleet", label: "Flota" },
  { to: "/visualization", label: "Wizualizacja" },
];

function navClassName({ isActive }) {
  return isActive ? "nav-link is-active" : "nav-link";
}

export default function AppLayout({ children, streamOnline, message, error, onClearFeedback, onRefresh }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <p className="eyebrow">Earth-Moon Mission Operations</p>
          <h1>selenet Command Console</h1>
          <p className="subtitle">Panel monitoringu, dispatchu i konfiguracji floty satelitarnej.</p>
        </div>

        <div className="header-actions">
          <button className="btn ghost" type="button" onClick={onRefresh}>
            Odswiez
          </button>
          <div className={`stream-pill ${streamOnline ? "online" : "offline"}`}>
            {streamOnline ? "Live stream online" : "Stream reconnecting"}
          </div>
        </div>
      </header>

      <nav className="main-nav" aria-label="Nawigacja glowna">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"} className={navClassName}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {(message || error) && (
        <section className="feedback-stack" aria-live="polite">
          {message && (
            <article className="feedback success">
              <div>{message}</div>
              <button type="button" className="btn tiny ghost" onClick={onClearFeedback}>
                Zamknij
              </button>
            </article>
          )}
          {error && (
            <article className="feedback danger">
              <div>{error}</div>
              <button type="button" className="btn tiny ghost" onClick={onClearFeedback}>
                Zamknij
              </button>
            </article>
          )}
        </section>
      )}

      <main className="page-content">{children}</main>
    </div>
  );
}
