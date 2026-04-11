import os
import requests
import time
import uuid

API_URL = os.getenv("API_URL", "http://localhost:8000/api/packets")
INTERVAL = int(os.getenv("PING_INTERVAL", "10"))

def send_packet():
    packet_id = str(uuid.uuid4())
    packet_data = {
        "source_node": "EARTH_GATEWAY",
        "destination_node": "LUNAR_GATEWAY",
        "priority": 1,
        "size_bytes": 1024,
        "payload": {
            "command": "telemetry_ping", 
            "timestamp": time.time(), 
            "auto": True,
            "ref_id": packet_id
        }
    }
    
    try:
        response = requests.post(API_URL, json=packet_data)
        if response.status_code in (200, 202):
            print(f"[{time.strftime('%H:%M:%S')}] Packet sent (ref: {packet_id})")
        else:
            print(f"[{time.strftime('%H:%M:%S')}] Failed to send packet: {response.status_code} {response.text}")
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] Error: {e}")

if __name__ == "__main__":
    print(f"Waiting 5s for API to start... Then sending packet every {INTERVAL}s (EARTH_GATEWAY -> LUNAR_GATEWAY)")
    time.sleep(5)
    try:
        while True:
            send_packet()
            time.sleep(INTERVAL)
    except KeyboardInterrupt:
        print("\nAuto-ping stopped.")
