import { useEffect, useRef, useState } from "react";

import { mountVisualization } from "../visualization/main";
import "../visualization/visualization-page.css";

export default function VisualizationPage({ packets = [], nodes = [] }) {
  const rootRef = useRef(null);
  const telemetryRef = useRef({ packets: [], nodes: [] });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    telemetryRef.current = { packets, nodes };
  }, [packets, nodes]);

  useEffect(() => {
    if (!rootRef.current) {
      return undefined;
    }

    const cleanup = mountVisualization({
      root: rootRef.current,
      getTelemetrySnapshot: () => telemetryRef.current,
    });

    return cleanup;
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
      <button
        className="fullscreen-toggle"
        type="button"
        onClick={toggleFullscreen}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? "Wyjdz z pelnego ekranu" : "Pelny ekran"}
      </button>
      <div id="app">
        <section className="view is-active" data-view="network">
          <div className="canvas-host" data-canvas-host="network"></div>

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
