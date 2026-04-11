import { render, screen } from "@testing-library/react";

import VisualizationPage from "../pages/VisualizationPage";

describe("VisualizationPage", () => {
  it("renders 3D visualization shell with toolbar controls", () => {
    render(
      <VisualizationPage
        nodes={[
          { node_id: "EARTH_GATEWAY", node_type: "ground_station", body: "earth" },
          { node_id: "SAT_1", node_type: "satellite", orbiting_body: "earth", orbit_altitude_km: 500 },
        ]}
        packets={[
          {
            packet_id: "abc-1",
            source_node: "EARTH_GATEWAY",
            destination_node: "SAT_1",
            current_status: "IN_TRANSIT",
            current_node_id: "EARTH_GATEWAY",
            next_hop: "SAT_1",
            status_history: [],
          },
        ]}
      />
    );

    // MQTT card still renders
    expect(screen.getByText("MQTT laser link")).toBeInTheDocument();

    // Toolbar: fullscreen button has a title attribute
    expect(screen.getByTitle("Pełny ekran")).toBeInTheDocument();

    // Toolbar: top-down view button
    expect(screen.getByTitle(/Widok z g/)).toBeInTheDocument();

    // Toolbar: slow simulation button
    expect(screen.getByTitle(/Zwolnij symulacj/)).toBeInTheDocument();

    // Toolbar: hide UI button
    expect(screen.getByTitle(/Ukryj panele/)).toBeInTheDocument();
  });
});
