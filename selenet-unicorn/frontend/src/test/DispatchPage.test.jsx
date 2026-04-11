import { fireEvent, render, screen } from "@testing-library/react";

import DispatchPage from "../pages/DispatchPage";

describe("DispatchPage", () => {
  it("submits payload from selected template", async () => {
    const onDispatch = vi.fn().mockResolvedValue({});

    render(
      <DispatchPage
        nodes={[
          { node_id: "EARTH_GATEWAY" },
          { node_id: "SAT_1" },
        ]}
        packets={[]}
        dispatchContext={{
          service_location: "Earth Mission Control",
          dispatch_origin_scope: "earth",
          allowed_source_nodes: ["EARTH_GATEWAY"],
        }}
        loadingNodes={false}
        loadingDispatchContext={false}
        onDispatch={onDispatch}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Szablon cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Wyslij pakiet" }));

    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch.mock.calls[0][0].payload.command).toBe("cancel-window");
  });
});
