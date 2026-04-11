import requests
import time
import uuid

API_URL = "http://localhost:8002/api/packets"

def send_packet():
    packet_id = str(uuid.uuid4())
    payload = {
        "packet_id": packet_id,
        "payload": {"command": "telemetry_ping", "timestamp": time.time(), "auto": True},
        "priority": 1,
        "source_node": "EARTH_GATEWAY",
        "destination_node": "LUNAR_GATEWAY"
    }
    
    try:
        response = requests.post(API_URL, json=payload)
        if response.status_code in (200, 202):
            print(f"[{time.strftime('%H:%M:%S')}] Packet sent: {packet_id}")
        else:
            print(f"[{time.strftime('%H:%M:%S')}] Failed to send packet: {response.text}")
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] Error: {e}")

if __name__ == "__main__":
    print("Starting auto-ping script... Sending packet every 10s (EARTH_GATEWAY -> LUNAR_GATEWAY)")
    try:
        while True:
            send_packet()
            time.sleep(10)
    except KeyboardInterrupt:
        print("\nAuto-ping stopped.")
