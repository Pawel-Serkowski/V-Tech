import { CCard, CCardBody, CCol, CRow } from "@coreui/react";

import EventFeedPanel from "../components/EventFeedPanel";
import PacketTable from "../components/PacketTable";
import QueueLoadPanel from "../components/QueueLoadPanel";

export default function MonitoringPage({
  metrics,
  packets,
  queueLoad,
  events,
  loadingPackets,
  onCancelPacket,
  cancellingPacketIds,
}) {
  return (
    <>
      <CRow className="g-3 mb-4">
        <CCol sm={6} xl={3}>
          <CCard className="metric-card">
            <CCardBody>
              <div className="metric-title">Total Packets</div>
              <div className="metric-value">{metrics.total}</div>
            </CCardBody>
          </CCard>
        </CCol>
        <CCol sm={6} xl={3}>
          <CCard className="metric-card">
            <CCardBody>
              <div className="metric-title">Delivered</div>
              <div className="metric-value">{metrics.delivered}</div>
            </CCardBody>
          </CCard>
        </CCol>
        <CCol sm={6} xl={3}>
          <CCard className="metric-card">
            <CCardBody>
              <div className="metric-title">In Transit / Queued</div>
              <div className="metric-value">{metrics.inTransit}</div>
            </CCardBody>
          </CCard>
        </CCol>
        <CCol sm={6} xl={3}>
          <CCard className="metric-card">
            <CCardBody>
              <div className="metric-title">Critical Priority</div>
              <div className="metric-value">{metrics.critical}</div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>

      <CRow className="g-4">
        <CCol xl={8}>
          <PacketTable
            packets={packets}
            loading={loadingPackets}
            onCancelPacket={onCancelPacket}
            cancellingPacketIds={cancellingPacketIds}
          />
        </CCol>
        <CCol xl={4}>
          <QueueLoadPanel queueLoad={queueLoad} />
        </CCol>
      </CRow>

      <CRow className="g-4 mt-1">
        <CCol xs={12}>
          <EventFeedPanel events={events} />
        </CCol>
      </CRow>
    </>
  );
}
