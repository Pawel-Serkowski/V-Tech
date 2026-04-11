import { CCard, CCardBody, CCardHeader, CCol, CRow } from "@coreui/react";

import EventFeedPanel from "../components/EventFeedPanel";
import PacketDispatchForm from "../components/PacketDispatchForm";
import PacketTable from "../components/PacketTable";

export default function DispatchPage({
  onDispatch,
  nodes,
  loadingNodes,
  dispatchContext,
  loadingDispatchContext,
  packets,
  events,
  loadingPackets,
  onCancelPacket,
  cancellingPacketIds,
}) {
  return (
    <>
      <CRow className="g-4 mb-2">
        <CCol xs={12}>
          <CCard className="surface-card">
            <CCardHeader>
              <h2 className="h6 mb-0">Packet Dispatch</h2>
            </CCardHeader>
            <CCardBody>
              <p className="mb-0 text-body-secondary">
                Create and submit packet payloads from sources allowed by backend location policy.
                The route is evaluated immediately and shown in the packet monitor after submission.
              </p>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>

      <CRow className="g-4">
        <CCol xl={7}>
          <PacketDispatchForm
            onDispatch={onDispatch}
            nodes={nodes}
            loadingNodes={loadingNodes}
            dispatchContext={dispatchContext}
            loadingDispatchContext={loadingDispatchContext}
          />
        </CCol>
        <CCol xl={5}>
          <EventFeedPanel events={events} title="Dispatch Event Feed" />
        </CCol>
      </CRow>

      <CRow className="g-4 mt-1">
        <CCol xs={12}>
          <PacketTable
            packets={packets.slice(0, 25)}
            loading={loadingPackets}
            onCancelPacket={onCancelPacket}
            cancellingPacketIds={cancellingPacketIds}
          />
        </CCol>
      </CRow>
    </>
  );
}
