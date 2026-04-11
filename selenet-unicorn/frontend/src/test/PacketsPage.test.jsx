import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import PacketsPage from "../pages/PacketsPage";

function createPacket(index) {
  return {
    packet_id: `packet-${index}`,
    source_node: "SRC",
    destination_node: "DST",
    priority: 2,
    current_status: index % 2 === 0 ? "IN_TRANSIT" : "DELIVERED",
    current_node_id: "SRC",
    next_hop: "MID",
    earth_timestamp: `2026-04-${String(index).padStart(2, "0")}T10:00:00Z`,
    status_history: [],
  };
}

describe("PacketsPage", () => {
  it("supports filtering and pagination", () => {
    const packets = Array.from({ length: 13 }, (_, index) => createPacket(index + 1));

    render(
      <MemoryRouter>
        <PacketsPage
          packets={packets}
          loading={false}
          cancellingPacketIds={[]}
          onCancelPacket={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("13")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("packet_id, status, node"), {
      target: { value: "packet-13" },
    });

    expect(screen.getByText("packet-13")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("packet_id, status, node"), {
      target: { value: "" },
    });

    const nextButton = screen.getByRole("button", { name: "Nastepna" });
    fireEvent.click(nextButton);

    expect(screen.getByText("packet-1")).toBeInTheDocument();
  });
});
