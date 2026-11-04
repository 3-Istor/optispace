# Simulator
- Fake ESP32 boxes posting `optispace.telemetry/1` heartbeats (`source: "simulated"`) every 10 s; stdlib only.
- `python3 simulator/simulate.py --url http://localhost:8081 --key "$DEVICE_API_KEY" --devices 3 --pattern demo`
- The backend refuses simulated data (`422 SIMULATED_NOT_ALLOWED`) unless `ALLOW_SIMULATED_TELEMETRY=true`: on in `docker-compose.yml`, off in prod.
- `--key` defaults to `$DEVICE_API_KEY`; `--pattern present|absent` holds one value, `demo` alternates every 3 min per box.
- New boxes arrive sealed: assign them (`PATCH /api/v1/devices/{id}`) and unseal them before their observations count.
