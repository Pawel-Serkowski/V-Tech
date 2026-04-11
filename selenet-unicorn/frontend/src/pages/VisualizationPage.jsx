import { useEffect, useRef, useState } from "react";

import { mountVisualization } from "../visualization/main";
import "../visualization/visualization-page.css";

export default function VisualizationPage({ packets = [], nodes = [] }) {
  const rootRef = useRef(null);
  const telemetryRef = useRef({ packets: [], nodes: [] });
  const vizApiRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSlow, setIsSlow] = useState(false);
  const [isTopDown, setIsTopDown] = useState(false);
  const [hideUi, setHideUi] = useState(false);

  useEffect(() => {
    telemetryRef.current = { packets, nodes };
  }, [packets, nodes]);

  useEffect(() => {
    if (!rootRef.current) {
      return undefined;
    }

    if (typeof window === "undefined" || typeof window.WebGLRenderingContext === "undefined") {
      return undefined;
    }

    const api = mountVisualization({
      root: rootRef.current,
      getTelemetrySnapshot: () => telemetryRef.current,
    });
    vizApiRef.current = api;

    return () => api?.unmount?.();
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    try {
      if (document.fullscreenElement === root) {
        await document.exitFullscreen();
        return;
      }

      if (document.fullscreenElement && document.fullscreenElement !== root) {
        await document.exitFullscreen();
      }

      await root.requestFullscreen();
    } catch {
      // Ignore fullscreen API rejections (e.g. user denied gesture constraints).
    }
  };

  return (
    <section className="viz-root" ref={rootRef}>
      <div className="viz-toolbar">
        <button
          className="viz-tool-btn"
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          title={isFullscreen ? "Wyjdź z pełnego ekranu" : "Pełny ekran"}
        >
          {isFullscreen ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 0 2-2h3M3 16h3a2 2 0 0 0 2 2v3"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
          )}
          <span>{isFullscreen ? "Wyjdź" : "Pełny ekran"}</span>
        </button>

        <div className="viz-toolbar-sep" />

        <button
          className={`viz-tool-btn ${isTopDown ? "is-active" : ""}`}
          type="button"
          title="Widok z góry (przegląd całej sieci)"
          onClick={() => {
            if (isTopDown) {
              vizApiRef.current?.setCameraDefault?.();
              setIsTopDown(false);
            } else {
              vizApiRef.current?.setCameraTopDown?.();
              setIsTopDown(true);
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="2" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
          </svg>
          <span>Widok z góry</span>
        </button>

        <button
          className={`viz-tool-btn ${isSlow ? "is-active is-warn" : ""}`}
          type="button"
          title={isSlow ? "Tryb spowolnienia aktywny – kliknij aby przyspieszyć" : "Zwolnij symulację (0.12×)"}
          onClick={() => {
            const next = !isSlow;
            setIsSlow(next);
            vizApiRef.current?.setSimulationSlow?.(next);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>{isSlow ? "Przyspiesz" : "Zwolnij"}</span>
        </button>
        <button
          className={`viz-tool-btn ${hideUi ? "is-active is-warn" : ""}`}
          type="button"
          title={hideUi ? "Pokaż panele informacyjne" : "Ukryj panele – tryb czysty"}
          onClick={() => setHideUi((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {hideUi ? (
              <>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </>
            ) : (
              <>
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </>
            )}
          </svg>
          <span>{hideUi ? "Pokaż UI" : "Ukryj UI"}</span>
        </button>
      </div>
      <div id="app">
        <section className="view is-active" data-view="network">
          <div className="canvas-host" data-canvas-host="network"></div>

          <div className={`viz-overlay${hideUi ? " viz-hidden" : ""}`}>
            <aside className="satellite-card">
              <p className="card-eyebrow">Satelita</p>
              <h2 data-satellite-name>Wybierz satelite</h2>
              <div className="card-meta" data-satellite-meta>
                Kliknij obiekt na orbicie Ziemi lub Ksiezyca
              </div>
              <p className="card-description" data-satellite-description>
                Po zaznaczeniu pokaze nazwe, typ misji i krotka informacje o orbicie.
              </p>
              <div className="card-hint" data-satellite-hint>
                Aktywne: brak
              </div>
            </aside>

            <aside className="mqtt-card">
              <p className="card-eyebrow">MQTT laser link</p>
              <h2>Siec transmisji</h2>
              <div className="card-meta" data-mqtt-topic>Temat: mqtt/relay/idle</div>
              <p className="card-description" data-mqtt-route>Trasa: oczekiwanie na aktywna sciezke</p>
              <p className="card-description" data-mqtt-payload>Payload: brak aktywnych pakietow</p>
              <div className="card-hint" data-mqtt-status>Status: broker gotowy</div>
            </aside>

            <div className="help">
              <span>Obrot: przeciagnij</span>
              <span>Zoom: scroll</span>
              <span>Klik: wybor satelity</span>
            </div>
          </div>
        </section>

        <section className="view" data-view="planner">
          <div className="canvas-host" data-canvas-host="planner"></div>

          <div className="hud planner-hud">
            <div>
              <p className="eyebrow">Uklad Sloneczny 3D</p>
              <h1>Optymalizator LEO do TLI</h1>
              <p className="description">
                Osobna scena z pelnym kontekstem planet, orbitami wokol Slonca i wyrazna
                wizualizacja transferu Ziemia-Ksiezyc. Optymalizator szuka manewru TLI z orbity LEO.
              </p>
            </div>
            <div className="legend">
              <div><span className="dot burn"></span> Slonce</div>
              <div><span className="dot earth"></span> Ziemia</div>
              <div><span className="dot moon"></span> Ksiezyc</div>
              <div><span className="dot transfer"></span> Trajektoria TLI</div>
              <div><span className="dot laser"></span> Orbity planet</div>
            </div>
          </div>

          <aside className="planner-card">
            <p className="card-eyebrow">Parametry manewru</p>
            <h2>Optymalizator</h2>
            <label className="field">
              <span>LEO wysokosc [km]</span>
              <input data-planner-input="leo-altitude" type="range" min="160" max="450" defaultValue="185" />
              <strong data-planner-value="leo-altitude">185 km</strong>
            </label>
            <label className="field">
              <span>Czas lotu [dni]</span>
              <input data-planner-input="flight-days" type="range" min="3.0" max="6.5" step="0.1" defaultValue="4.2" />
              <strong data-planner-value="flight-days">4.2 dni</strong>
            </label>
            <label className="field">
              <span>Docelowa wysokosc perilune [km]</span>
              <input data-planner-input="perilune" type="range" min="80" max="300" defaultValue="110" />
              <strong data-planner-value="perilune">110 km</strong>
            </label>
            <button className="action-button" data-planner-run type="button">
              Przelicz trajektorie
            </button>
            <div className="planner-note" data-planner-note>
              Model: planeta po planecie w scenie heliocentrycznej, a transfer TLI liczony w ukladzie Ziemia-Ksiezyc.
            </div>
          </aside>

          <aside className="results-card">
            <p className="card-eyebrow">Wyniki</p>
            <h2 data-planner-title>Transfer translunarny</h2>
            <div className="stats">
              <div><span>Delta-v TLI</span><strong data-result="delta-v">-</strong></div>
              <div><span>Predkosc C3-ish</span><strong data-result="vinf">-</strong></div>
              <div><span>Closest approach</span><strong data-result="closest">-</strong></div>
              <div><span>Czas lotu</span><strong data-result="tof">-</strong></div>
            </div>
            <p className="card-description" data-result="summary">
              Uruchom optymalizator, aby policzyc impuls i wyswietlic trajektorie translunarna.
            </p>
            <div className="card-hint" data-result="status">Status: gotowy do analizy</div>
          </aside>

          <div className="help">
            <span>Obrot: przeciagnij</span>
            <span>Zoom: scroll</span>
            <span>Widok: planety plus korytarz Ziemia-Ksiezyc</span>
          </div>
        </section>
      </div>
    </section>
  );
}
