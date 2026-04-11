from datetime import datetime, timezone
import heapq
import math
from typing import Any


SPEED_OF_LIGHT_KM_S = 299792.458


def _to_timestamp(value: Any) -> float | None:
    if isinstance(value, datetime):
        return value.timestamp()

    if isinstance(value, str):
        try:
            normalized = value.replace("Z", "+00:00")
            return datetime.fromisoformat(normalized).timestamp()
        except ValueError:
            return None

    return None

def calculate_link_delays(packet_size_bytes: int, bandwidth_bps: int, range_km: float) -> tuple[float, float]:
    if bandwidth_bps <= 0:
        return float('inf'), float('inf')
        
    packet_size_bits = packet_size_bytes * 8
    
    propagation_delay = range_km / SPEED_OF_LIGHT_KM_S
    transmission_delay = packet_size_bits / bandwidth_bps
    
    return propagation_delay, transmission_delay

class CGREngine:
    @staticmethod
    def compute_route_hops(
        source_node: str,
        destination_node: str,
        contact_plan: list[dict],
        earth_timestamp: datetime,
        packet_size_bytes: int, 
        ttl_seconds: int = 3600,
        hop_limit: int = 10
    ) -> list[str] | None:
        current_time_ts = earth_timestamp.timestamp()
        deadline = current_time_ts + ttl_seconds

        plan_by_source = {} #mapa sasiedztwa z perspektywy nadawcy
        for contact in contact_plan:
            src = contact["source"]
            if src not in plan_by_source:
                plan_by_source[src] = []
            plan_by_source[src].append(contact)

        earliest_arrival = {source_node: current_time_ts}
        priority_queue = [(current_time_ts, source_node, [])]

        while priority_queue:
            arrival_time, current_node, path = heapq.heappop(priority_queue)

            if len(path) >= hop_limit or arrival_time > deadline:
                continue

            if arrival_time > earliest_arrival.get(current_node, float('inf')):
                continue
            
            if current_node == destination_node:
                return path 
            
            for link in plan_by_source.get(current_node, []):
                dest_node = link["dest"]
                
                if dest_node in path:
                    continue # Unikamy pętli
                
                bandwidth = link.get("bandwidth_bps", 1)
                
                for window in link.get("windows", []):
                    window_start = _to_timestamp(window.get("start"))
                    window_end = _to_timestamp(window.get("end"))
                    if window_start is None or window_end is None:
                        continue
                    range_km = window.get("avg_range_km", 384000)

                    start_tx_time = max(arrival_time, window_start)

                    prop_delay, trans_delay = calculate_link_delays(packet_size_bytes, bandwidth, range_km)
                    end_rx_time = start_tx_time + trans_delay + prop_delay
                    
                    if start_tx_time + trans_delay + prop_delay <= window_end:
                        
                        if end_rx_time < earliest_arrival.get(dest_node, float('inf')):
                            earliest_arrival[dest_node] = end_rx_time
                            heapq.heappush(priority_queue, (end_rx_time, dest_node, path + [dest_node]))

        return None 
