import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "./components/AppLayout";
import { useTelemetry } from "./hooks/useTelemetry";
import DashboardPage from "./pages/DashboardPage";
import DispatchPage from "./pages/DispatchPage";
import FleetConfigPage from "./pages/FleetConfigPage";
import PacketDetailsPage from "./pages/PacketDetailsPage";
import PacketsPage from "./pages/PacketsPage";
import VisualizationPage from "./pages/VisualizationPage";
import { computeMetrics } from "./utils/packet-utils";

export default function App() {
  const telemetry = useTelemetry();
  const metrics = computeMetrics(telemetry.packets);

  return (
    <AppLayout
      streamOnline={telemetry.streamOnline}
      message={telemetry.message}
      error={telemetry.error}
      onClearFeedback={telemetry.actions.clearFeedback}
      onRefresh={telemetry.actions.refreshAll}
    >
      <Routes>
        <Route
          path="/"
          element={(
            <DashboardPage
              metrics={metrics}
              packets={telemetry.packets}
              queueLoad={telemetry.queueLoad}
              events={telemetry.events}
              loadingTelemetry={telemetry.loadingTelemetry}
            />
          )}
        />
        <Route
          path="/packets"
          element={(
            <PacketsPage
              packets={telemetry.packets}
              loading={telemetry.loadingTelemetry}
              cancellingPacketIds={telemetry.cancellingPacketIds}
              onCancelPacket={telemetry.actions.requestCancel}
              onClearPackets={telemetry.actions.clearTelemetry}
            />
          )}
        />
        <Route
          path="/packets/:packetId"
          element={(
            <PacketDetailsPage
              packets={telemetry.packets}
              onLoadPacket={telemetry.actions.loadPacket}
            />
          )}
        />
        <Route
          path="/dispatch"
          element={(
            <DispatchPage
              nodes={telemetry.nodes}
              packets={telemetry.packets}
              dispatchContext={telemetry.dispatchContext}
              loadingNodes={telemetry.loadingNodes}
              loadingDispatchContext={telemetry.loadingDispatchContext}
              onDispatch={telemetry.actions.sendPacket}
            />
          )}
        />
        <Route
          path="/fleet"
          element={(
            <FleetConfigPage
              nodes={telemetry.nodes}
              loadingNodes={telemetry.loadingNodes}
              onSaveNodes={telemetry.actions.saveNodes}
              onUploadNodesFile={telemetry.actions.saveNodesFromFile}
            />
          )}
        />
        <Route
          path="/visualization"
          element={(
            <VisualizationPage
              nodes={telemetry.nodes}
              packets={telemetry.packets}
            />
          )}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
