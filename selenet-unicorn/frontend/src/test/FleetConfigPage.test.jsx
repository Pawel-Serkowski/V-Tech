import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import FleetConfigPage from "../pages/FleetConfigPage";

describe("FleetConfigPage", () => {
  it("adds a node from modal editor", async () => {
    const onSaveNodes = vi.fn().mockResolvedValue({ inserted: 1, updated: 0 });

    render(
      <FleetConfigPage
        nodes={[]}
        loadingNodes={false}
        onSaveNodes={onSaveNodes}
        onUploadNodesFile={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dodaj satelite" }));
    fireEvent.change(screen.getByLabelText("node_id"), { target: { value: "SAT_NEW" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz satelite" }));

    await waitFor(() => {
      expect(onSaveNodes).toHaveBeenCalledTimes(1);
    });

    const savedNodes = onSaveNodes.mock.calls[0][0];
    expect(savedNodes[0].node_id).toBe("SAT_NEW");
  });

  it("applies diverse orbital configuration for satellites", async () => {
    const onSaveNodes = vi.fn().mockResolvedValue({ inserted: 0, updated: 3 });

    render(
      <FleetConfigPage
        nodes={[
          { node_id: "SAT_A", node_type: "satellite", body: "earth", links: [] },
          { node_id: "SAT_B", node_type: "satellite", body: "earth", links: [] },
          { node_id: "LUNA_R1", node_type: "relay", body: "moon", links: [] },
        ]}
        loadingNodes={false}
        onSaveNodes={onSaveNodes}
        onUploadNodesFile={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Ustaw rozne orbity satelit" }));

    await waitFor(() => {
      expect(onSaveNodes).toHaveBeenCalledTimes(1);
    });

    const savedNodes = onSaveNodes.mock.calls[0][0];
    const orbitalNodes = savedNodes.filter((node) => node.node_type !== "ground_station");
    const altitudes = orbitalNodes.map((node) => node.orbit_altitude_km);

    expect(new Set(altitudes).size).toBeGreaterThan(1);
    expect(orbitalNodes.every((node) => node.orbiting_body === "earth" || node.orbiting_body === "moon")).toBe(true);
  });
});
