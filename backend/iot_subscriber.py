"""AWS IoT Core MQTT subscriber for real-time ESP32 station telemetry.

Connects to AWS IoT Core via MQTT over TLS and subscribes to the wildcard
topic ``mausam/stations/+/telemetry``.  Each message is:
  1. Validated against the expected MQTT payload schema.
  2. Inserted into the ``station_readings`` PostgreSQL table.
  3. Stored in the in-memory ``_latest_readings`` dict for low-latency API reads.

Environment variables (all optional — subscriber degrades gracefully):
  IOT_ENDPOINT    AWS IoT Core ATS endpoint (e.g. xxxxx-ats.iot.ap-south-1.amazonaws.com)
  IOT_CERT_PATH   Path to device certificate (.crt)
  IOT_KEY_PATH    Path to private key (.key)
  IOT_CA_PATH     Path to Amazon Root CA (AmazonRootCA1.pem)
  IOT_CLIENT_ID   MQTT client identifier (default: vayu-backend-subscriber)
  IOT_TOPIC       MQTT topic prefix (default: mausam/stations/+/telemetry)

When the AWS credentials/certs are absent the subscriber logs a warning and
returns immediately so the rest of the backend continues to function.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

# In-memory cache: station_id -> latest parsed telemetry payload
_latest_readings: dict[str, dict[str, Any]] = {}

# Asyncio queue filled by the MQTT callback, drained by the writer coroutine
_ingest_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)


def get_latest_readings() -> dict[str, dict[str, Any]]:
    """Return a shallow copy of the latest readings dict (thread-safe read)."""
    return dict(_latest_readings)


def get_latest_reading(station_id: str) -> dict[str, Any] | None:
    """Return the most recent telemetry for a specific station, or None."""
    return _latest_readings.get(station_id)


# ── Payload validation ─────────────────────────────────────────────────────────

def _validate_payload(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Validate and normalise an MQTT telemetry payload.

    Returns the normalised payload dict, or None if validation fails.
    """
    required_top = {"station_id", "timestamp"}
    if not required_top.issubset(raw.keys()):
        logger.warning("IoT payload missing required fields: %s", raw.keys())
        return None

    station_id: str = raw["station_id"]
    if not isinstance(station_id, str) or not station_id.strip():
        return None

    # Evidence timestamps must be source-supplied and timezone-aware.  Do not
    # fabricate a current time for a malformed station message.
    try:
        ts = datetime.fromisoformat(raw["timestamp"].replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        logger.warning("IoT payload rejected due to bad timestamp '%s'", raw.get("timestamp"))
        return None
    if ts.tzinfo is None or ts.utcoffset() is None:
        logger.warning("IoT payload rejected due to timezone-less timestamp '%s'", raw.get("timestamp"))
        return None
    ts = ts.astimezone(UTC)

    sensors: dict[str, Any] = raw.get("sensors", {})
    power: dict[str, Any] = raw.get("power", {})
    gps: dict[str, Any] = raw.get("gps", {})

    return {
        "station_id": station_id.strip(),
        "timestamp": ts.isoformat(),
        "gps": {
            "lat": gps.get("lat"),
            "lon": gps.get("lon"),
            "alt": gps.get("alt"),
        },
        "sensors": {
            "temperature_c": sensors.get("temperature_c"),
            "humidity_pct": sensors.get("humidity_pct"),
            "pressure_hpa": sensors.get("pressure_hpa"),
            "light_lux": sensors.get("light_lux"),
            "soil_moisture_pct": sensors.get("soil_moisture_pct"),
            "rain_detected": bool(sensors.get("rain_detected", False)),
            "wind_speed_ms": sensors.get("wind_speed_ms"),
            "wind_gust_ms": sensors.get("wind_gust_ms"),
            "water_level_cm": sensors.get("water_level_cm"),
        },
        "power": {
            "battery_v": power.get("battery_v"),
            "solar_v": power.get("solar_v"),
            "charging_ma": power.get("charging_ma"),
        },
    }


# ── MQTT connection ────────────────────────────────────────────────────────────

def _start_mqtt_client(topic: str) -> None:
    """Attempt to connect to AWS IoT Core using awsiot / paho-mqtt.

    If the required packages or credentials are absent this function logs a
    warning and returns without raising so the server starts cleanly.
    """
    endpoint = os.getenv("IOT_ENDPOINT", "")
    cert_path = os.getenv("IOT_CERT_PATH", "")
    key_path = os.getenv("IOT_KEY_PATH", "")
    ca_path = os.getenv("IOT_CA_PATH", "")
    client_id = os.getenv("IOT_CLIENT_ID", "vayu-backend-subscriber")

    if not all([endpoint, cert_path, key_path, ca_path]):
        logger.warning(
            "AWS IoT Core credentials not configured (IOT_ENDPOINT / IOT_CERT_PATH / "
            "IOT_KEY_PATH / IOT_CA_PATH).  Real-time MQTT ingestion disabled."
        )
        return

    # Prefer the official AWS IoT Device SDK v2; fall back to raw paho-mqtt.
    try:
        from awsiot import mqtt_connection_builder  # type: ignore

        def _on_message_received(topic_str: str, payload: bytes, **_kwargs: Any) -> None:
            try:
                data = json.loads(payload.decode("utf-8"))
                validated = _validate_payload(data)
                if validated:
                    _latest_readings[validated["station_id"]] = validated
                    try:
                        _ingest_queue.put_nowait(validated)
                    except asyncio.QueueFull:
                        logger.warning("IoT ingest queue full — dropping message from %s", validated["station_id"])
            except Exception as exc:
                logger.warning("IoT message parse error: %s", exc)

        connection = mqtt_connection_builder.mtls_from_path(
            endpoint=endpoint,
            cert_filepath=cert_path,
            pri_key_filepath=key_path,
            ca_filepath=ca_path,
            client_id=client_id,
            clean_session=False,
            keep_alive_secs=30,
        )
        connect_future = connection.connect()
        connect_future.result(timeout=10)
        logger.info("AWS IoT Core MQTT connected to %s", endpoint)

        subscribe_future, _ = connection.subscribe(
            topic=topic,
            qos=mqtt_connection_builder.mqtt.QoS.AT_LEAST_ONCE,
            callback=_on_message_received,
        )
        subscribe_future.result(timeout=5)
        logger.info("Subscribed to MQTT topic: %s", topic)

    except ImportError:
        # awsiot not installed — try paho-mqtt as a fallback
        _start_paho_mqtt_client(endpoint, cert_path, key_path, ca_path, client_id, topic)
    except Exception as exc:
        logger.warning("AWS IoT Core MQTT connection failed: %s — ingestion disabled", exc)


def _start_paho_mqtt_client(
    endpoint: str,
    cert_path: str,
    key_path: str,
    ca_path: str,
    client_id: str,
    topic: str,
) -> None:
    """Fallback: connect to AWS IoT Core using paho-mqtt with TLS."""
    try:
        import paho.mqtt.client as paho  # type: ignore

        def _on_connect(client: Any, userdata: Any, flags: Any, rc: int) -> None:
            if rc == 0:
                logger.info("paho-mqtt connected to AWS IoT Core")
                client.subscribe(topic, qos=1)
                logger.info("Subscribed to topic: %s", topic)
            else:
                logger.warning("paho-mqtt connection refused, rc=%d", rc)

        def _on_message(client: Any, userdata: Any, msg: Any) -> None:
            try:
                data = json.loads(msg.payload.decode("utf-8"))
                validated = _validate_payload(data)
                if validated:
                    _latest_readings[validated["station_id"]] = validated
                    try:
                        _ingest_queue.put_nowait(validated)
                    except asyncio.QueueFull:
                        logger.warning("IoT ingest queue full — dropping message")
            except Exception as exc:
                logger.warning("paho IoT message parse error: %s", exc)

        client = paho.Client(client_id=client_id)
        client.tls_set(ca_certs=ca_path, certfile=cert_path, keyfile=key_path)
        client.on_connect = _on_connect
        client.on_message = _on_message
        client.connect(endpoint, port=8883, keepalive=30)
        client.loop_start()
        logger.info("paho-mqtt loop started for %s", endpoint)

    except ImportError:
        logger.warning("Neither awsiot nor paho-mqtt is installed — IoT ingestion disabled")
    except Exception as exc:
        logger.warning("paho-mqtt setup failed: %s — IoT ingestion disabled", exc)


# ── Async DB writer coroutine ──────────────────────────────────────────────────

async def _db_writer_loop(db: Any, evidence_ingestion: Any | None = None) -> None:
    """Drain station telemetry into the operational table and evidence archive."""
    logger.info("IoT DB writer loop started")
    while True:
        try:
            payload = await asyncio.wait_for(_ingest_queue.get(), timeout=5.0)
            if db is not None:
                try:
                    await db.insert_station_reading(payload)
                    if evidence_ingestion is not None:
                        result = await evidence_ingestion.append_live(
                            "aws-iot-core-stations", payload, retrieved_at=datetime.now(UTC)
                        )
                        if result.state != "fresh":
                            logger.warning("Station evidence not archived: %s", result.reason)
                except Exception as exc:
                    logger.warning("IoT DB insert or evidence archive failed: %s", exc)
            _ingest_queue.task_done()
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            logger.info("IoT DB writer loop cancelled")
            break
        except Exception as exc:
            logger.warning("IoT DB writer unexpected error: %s", exc)


# ── Public API ─────────────────────────────────────────────────────────────────

async def start_iot_subscriber(db: Any, evidence_ingestion: Any | None = None) -> asyncio.Task:
    """Start MQTT ingestion and retain a fail-closed station-evidence adapter.

    Args:
        db: DatabaseClient instance (may be unavailable).
        evidence_ingestion: configured live evidence adapter; rejected records are
            logged with their explicit status and never archived.
    """
    topic = os.getenv("IOT_TOPIC", "mausam/stations/+/data")

    # Connect MQTT in a thread-pool executor so blocking I/O doesn't block the loop
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _start_mqtt_client, topic)

    # Launch DB writer coroutine
    task = asyncio.create_task(_db_writer_loop(db, evidence_ingestion), name="iot-db-writer")
    return task
