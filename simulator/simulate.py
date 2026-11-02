"""Simulated ESP32 boxes posting the optispace.telemetry/1 contract (spec §7). Python stdlib only."""
import argparse
import json
import os
import secrets
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

HEARTBEAT_S = 10
DEMO_PERIOD = 18  # ticks (3 min) per presence phase in the demo pattern


def presence(pattern: str, device: int, tick: int) -> str:
    if pattern == "demo":  # devices alternate present and absent, each shifted by one phase
        return "present" if (tick // DEMO_PERIOD + device) % 2 == 0 else "absent"
    return pattern


def post(url: str, key: str, body: dict) -> str:
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "X-Api-Key": key},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return f"{response.status} {response.read().decode()}"
    except urllib.error.HTTPError as error:
        return f"{error.code} {error.read().decode()}"
    except urllib.error.URLError as error:
        return f"unreachable: {error.reason}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8081", help="backend base URL")
    parser.add_argument("--key", default=os.environ.get("DEVICE_API_KEY", ""), help="default: $DEVICE_API_KEY")
    parser.add_argument("--devices", type=int, default=3)
    parser.add_argument("--pattern", choices=("demo", "present", "absent"), default="demo")
    args = parser.parse_args()

    url = args.url.rstrip("/") + "/api/v1/telemetry"
    # Locally administered MAC prefix 02, so ids never collide with a real box.
    boxes = [{"device_id": f"esp32-02{i:010X}", "boot_id": secrets.token_hex(4), "seq": 0, "last": None}
             for i in range(args.devices)]
    tick = 0
    while True:
        for i, box in enumerate(boxes):
            now = presence(args.pattern, i, tick)
            box["seq"] += 1
            body = {
                "schema": "optispace.telemetry/1", "device_id": box["device_id"], "boot_id": box["boot_id"],
                "seq": box["seq"], "kind": "heartbeat" if now == box["last"] else "transition",
                "presence": now, "target": "static" if now == "present" else "none",
                "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "firmware_version": "sim-1.0", "source": "simulated",
            }
            box["last"] = now
            print(f"{box['device_id']} seq={box['seq']} {now} -> {post(url, args.key, body)}", flush=True)
        tick += 1
        time.sleep(HEARTBEAT_S)


if __name__ == "__main__":
    main()
