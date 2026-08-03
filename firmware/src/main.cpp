#include <Adafruit_BME280.h>
#include <Adafruit_INA219.h>
#include <BH1750.h>
#include <PubSubClient.h>
#include <SD.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_sleep.h>
#include <time.h>

#include <cmath>
#include <cstdlib>
#include <cstring>

#include "StationConfig.h"

namespace {

enum class SensorStatus : uint8_t { ready, unavailable, read_error, disabled, timed_out };

struct SensorSnapshot {
  float temperatureC = NAN;
  float humidityPct = NAN;
  float pressureHpa = NAN;
  float lightLux = NAN;
  float soilMoisturePct = NAN;
  bool rainDetected = false;
  SensorStatus bmeStatus = SensorStatus::unavailable;
  SensorStatus lightStatus = SensorStatus::unavailable;
  SensorStatus soilStatus = SensorStatus::unavailable;
  SensorStatus rainStatus = SensorStatus::unavailable;
};

struct PowerSnapshot {
  float batteryV = NAN;
  float solarV = NAN;
  float chargingMa = NAN;
  SensorStatus status = SensorStatus::unavailable;
};

struct TelemetryRecord {
  String stationId;
  String timestamp;
  float latitude = NAN;
  float longitude = NAN;
  float altitude = NAN;
  SensorSnapshot sensors;
  PowerSnapshot power;
};

constexpr EventBits_t kBmeComplete = BIT0;
constexpr EventBits_t kLightComplete = BIT1;
constexpr EventBits_t kSoilComplete = BIT2;
constexpr EventBits_t kRainComplete = BIT3;
constexpr EventBits_t kAllSensorsComplete =
    kBmeComplete | kLightComplete | kSoilComplete | kRainComplete;
constexpr const char* kOfflineCsvPath = "/offline-readings-v2.csv";
constexpr const char* kOfflinePendingPath = "/offline-readings-v2.pending";
constexpr const char* kOfflineCsvHeader =
    "station_id,timestamp_utc,uptime_ms,clock_status,gps_lat,gps_lon,gps_alt,"
    "temperature_c,humidity_pct,pressure_hpa,light_lux,soil_moisture_pct,rain_detected,"
    "bme280_status,bh1750_status,soil_status,rain_status,battery_v,solar_v,charging_ma,"
    "ina219_status";
constexpr size_t kOfflineFieldCount = 21;

Adafruit_BME280 bme;
Adafruit_INA219 batteryIna(station::config::kBatteryIna219Address);
Adafruit_INA219 solarIna(station::config::kSolarIna219Address);
BH1750 lightMeter;
SPIClass sdSpi(FSPI);
WiFiClientSecure tlsClient;
PubSubClient mqttClient(tlsClient);
SensorSnapshot latest;
PowerSnapshot latestPower;
station::core::PowerPolicy powerPolicy;
SemaphoreHandle_t i2cMutex;
SemaphoreHandle_t snapshotMutex;
EventGroupHandle_t sensorEvents;
TaskHandle_t bmeTaskHandle;
TaskHandle_t lightTaskHandle;
TaskHandle_t soilTaskHandle;
TaskHandle_t rainTaskHandle;
bool bmeAvailable = false;
bool lightAvailable = false;
bool batteryInaAvailable = false;
bool solarInaAvailable = false;
bool sdAvailable = false;
bool tlsConfigured = false;
station::core::WifiFailureTracker wifiFailures;

const char* statusText(SensorStatus status) {
  switch (status) {
    case SensorStatus::ready: return "ready";
    case SensorStatus::unavailable: return "unavailable";
    case SensorStatus::read_error: return "read_error";
    case SensorStatus::disabled: return "disabled";
    case SensorStatus::timed_out: return "timed_out";
  }
  return "unknown";
}

float soilMoisturePercent(int rawAdc) {
  const int span = station::config::kSoilDryAdc - station::config::kSoilWetAdc;
  if (span == 0) return NAN;
  const float percent =
      100.0F * static_cast<float>(station::config::kSoilDryAdc - rawAdc) / span;
  return constrain(percent, 0.0F, 100.0F);
}

String utcTimestamp() {
  const time_t now = time(nullptr);
  if (now < 1704067200) return "";
  tm utc{};
  gmtime_r(&now, &utc);
  char buffer[21];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(buffer);
}

String csvFloat(float value) {
  return std::isfinite(value) ? String(value, 3) : "";
}

String jsonFloat(float value) {
  return std::isfinite(value) ? String(value, 3) : "null";
}

SensorSnapshot copySnapshot() {
  xSemaphoreTake(snapshotMutex, portMAX_DELAY);
  const SensorSnapshot snapshot = latest;
  xSemaphoreGive(snapshotMutex);
  return snapshot;
}

PowerSnapshot copyPowerSnapshot() {
  xSemaphoreTake(snapshotMutex, portMAX_DELAY);
  const PowerSnapshot snapshot = latestPower;
  xSemaphoreGive(snapshotMutex);
  return snapshot;
}

bool initialiseBme() {
  if (xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(500)) != pdTRUE) return false;
  const bool found = bme.begin(0x76, &Wire) || bme.begin(0x77, &Wire);
  xSemaphoreGive(i2cMutex);
  if (!found) Serial.println("BME280 unavailable: no I2C response at 0x76 or 0x77");
  return found;
}

bool initialiseLightMeter() {
  if (xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(500)) != pdTRUE) return false;
  const bool found = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x23, &Wire) ||
                     lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x5C, &Wire);
  xSemaphoreGive(i2cMutex);
  if (!found) Serial.println("BH1750 unavailable: no I2C response at 0x23 or 0x5C");
  return found;
}

void initialisePowerMonitors() {
  if (!station::config::kIna219Enabled ||
      xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(500)) != pdTRUE) {
    return;
  }
  batteryInaAvailable = batteryIna.begin(&Wire);
  solarInaAvailable = solarIna.begin(&Wire);
  xSemaphoreGive(i2cMutex);
  if (!batteryInaAvailable || !solarInaAvailable) {
    Serial.println("INA219 monitor unavailable; battery telemetry is marked unavailable");
  }
}

void refreshPowerMeasurement() {
  PowerSnapshot power;
  if ((batteryInaAvailable || solarInaAvailable) &&
      xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
    if (batteryInaAvailable) {
      // Include the shunt drop so the reported value represents battery terminal voltage.
      power.batteryV = batteryIna.getBusVoltage_V() + batteryIna.getShuntVoltage_mV() / 1000.0F;
      power.chargingMa = batteryIna.getCurrent_mA();
    }
    if (solarInaAvailable) power.solarV = solarIna.getBusVoltage_V();
    xSemaphoreGive(i2cMutex);
    power.status = (std::isfinite(power.batteryV) || std::isfinite(power.solarV))
        ? SensorStatus::ready : SensorStatus::read_error;
  }

  xSemaphoreTake(snapshotMutex, portMAX_DELAY);
  latestPower = power;
  xSemaphoreGive(snapshotMutex);
  powerPolicy = station::core::powerPolicyForBattery(
      power.batteryV, station::config::kMeasurementIntervalSeconds);
  if (powerPolicy.criticalLowPower) {
    Serial.println("Critical battery voltage: using five-minute intervals and disabling optional sensors");
  }
}

void bmeReadTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    float temperature = NAN;
    float humidity = NAN;
    float pressure = NAN;
    SensorStatus status = bmeAvailable ? SensorStatus::read_error : SensorStatus::unavailable;
    if (bmeAvailable && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
      temperature = bme.readTemperature();
      humidity = bme.readHumidity();
      pressure = bme.readPressure() / 100.0F;
      xSemaphoreGive(i2cMutex);
      if (std::isfinite(temperature) && std::isfinite(humidity) && std::isfinite(pressure)) {
        status = SensorStatus::ready;
      }
    }
    xSemaphoreTake(snapshotMutex, portMAX_DELAY);
    latest.temperatureC = temperature;
    latest.humidityPct = humidity;
    latest.pressureHpa = pressure;
    latest.bmeStatus = status;
    xSemaphoreGive(snapshotMutex);
    xEventGroupSetBits(sensorEvents, kBmeComplete);
  }
}

void lightReadTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    float lux = NAN;
    SensorStatus status = lightAvailable ? SensorStatus::read_error : SensorStatus::unavailable;
    if (lightAvailable && xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
      lux = static_cast<float>(lightMeter.readLightLevel());
      xSemaphoreGive(i2cMutex);
      status = std::isfinite(lux) ? SensorStatus::ready : SensorStatus::read_error;
    }
    xSemaphoreTake(snapshotMutex, portMAX_DELAY);
    latest.lightLux = lux;
    latest.lightStatus = status;
    xSemaphoreGive(snapshotMutex);
    xEventGroupSetBits(sensorEvents, kLightComplete);
  }
}

void soilReadTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    float moisture = NAN;
    SensorStatus status = SensorStatus::disabled;
    if (station::config::kSoilSensorEnabled) {
      const int rawAdc = analogRead(station::config::kSoilAdcPin);
      moisture = soilMoisturePercent(rawAdc);
      status = std::isfinite(moisture) ? SensorStatus::ready : SensorStatus::read_error;
    }
    xSemaphoreTake(snapshotMutex, portMAX_DELAY);
    latest.soilMoisturePct = moisture;
    latest.soilStatus = status;
    xSemaphoreGive(snapshotMutex);
    xEventGroupSetBits(sensorEvents, kSoilComplete);
  }
}

void rainReadTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    bool raining = false;
    SensorStatus status = SensorStatus::disabled;
    if (station::config::kRainSensorEnabled) {
      const int level = digitalRead(station::config::kRainDigitalPin);
      raining = station::config::kRainActiveLow ? level == LOW : level == HIGH;
      status = SensorStatus::ready;
    }
    xSemaphoreTake(snapshotMutex, portMAX_DELAY);
    latest.rainDetected = raining;
    latest.rainStatus = status;
    xSemaphoreGive(snapshotMutex);
    xEventGroupSetBits(sensorEvents, kRainComplete);
  }
}

void setNonEssentialSensorsDisabled() {
  xSemaphoreTake(snapshotMutex, portMAX_DELAY);
  latest.lightLux = NAN;
  latest.soilMoisturePct = NAN;
  latest.rainDetected = false;
  latest.lightStatus = SensorStatus::disabled;
  latest.soilStatus = SensorStatus::disabled;
  latest.rainStatus = SensorStatus::disabled;
  xSemaphoreGive(snapshotMutex);
  xEventGroupSetBits(sensorEvents, kLightComplete | kSoilComplete | kRainComplete);
}

void markTimedOutSensors(EventBits_t completed) {
  xSemaphoreTake(snapshotMutex, portMAX_DELAY);
  if (!(completed & kBmeComplete)) {
    latest.temperatureC = NAN;
    latest.humidityPct = NAN;
    latest.pressureHpa = NAN;
    latest.bmeStatus = SensorStatus::timed_out;
  }
  if (!(completed & kLightComplete)) {
    latest.lightLux = NAN;
    latest.lightStatus = SensorStatus::timed_out;
  }
  if (!(completed & kSoilComplete)) {
    latest.soilMoisturePct = NAN;
    latest.soilStatus = SensorStatus::timed_out;
  }
  if (!(completed & kRainComplete)) latest.rainStatus = SensorStatus::timed_out;
  xSemaphoreGive(snapshotMutex);
}

bool initialiseSdCard() {
  sdSpi.begin(station::config::kSdSckPin, station::config::kSdMisoPin,
              station::config::kSdMosiPin, station::config::kSdCsPin);
  const bool ready = SD.begin(station::config::kSdCsPin, sdSpi);
  if (!ready) Serial.println("MicroSD unavailable: offline readings cannot be buffered");
  return ready;
}

TelemetryRecord currentRecord(const SensorSnapshot& sensors, const PowerSnapshot& power) {
  TelemetryRecord record;
  record.stationId = station::config::kStationId;
  record.timestamp = utcTimestamp();
  record.latitude = station::config::kGpsLatitude;
  record.longitude = station::config::kGpsLongitude;
  record.altitude = station::config::kGpsAltitude;
  record.sensors = sensors;
  record.power = power;
  return record;
}

String buildTelemetryPayload(const TelemetryRecord& record) {
  if (record.stationId != station::config::kStationId ||
      !station::core::telemetryProvenanceIsValid(
          record.stationId.c_str(), record.timestamp.c_str(), record.latitude,
          record.longitude, record.altitude)) {
    return "";
  }

  String payload;
  payload.reserve(720);
  payload += "{\"station_id\":\"" + record.stationId + "\",\"timestamp\":\"";
  payload += record.timestamp + "\",\"gps\":{\"lat\":" + jsonFloat(record.latitude);
  payload += ",\"lon\":" + jsonFloat(record.longitude) + ",\"alt\":";
  payload += jsonFloat(record.altitude) + "},\"sensors\":{\"temperature_c\":";
  payload += jsonFloat(record.sensors.temperatureC) + ",\"humidity_pct\":";
  payload += jsonFloat(record.sensors.humidityPct) + ",\"pressure_hpa\":";
  payload += jsonFloat(record.sensors.pressureHpa) + ",\"light_lux\":";
  payload += jsonFloat(record.sensors.lightLux) + ",\"soil_moisture_pct\":";
  payload += jsonFloat(record.sensors.soilMoisturePct) + ",\"rain_detected\":";
  payload += record.sensors.rainStatus == SensorStatus::ready
      ? (record.sensors.rainDetected ? "true" : "false") : "null";
  payload += "},\"power\":{\"battery_v\":" + jsonFloat(record.power.batteryV);
  payload += ",\"solar_v\":" + jsonFloat(record.power.solarV) + ",\"charging_ma\":";
  payload += jsonFloat(record.power.chargingMa);
  payload += "},\"provenance\":{\"source\":\"esp32-s3\",\"transport\":"
             "\"mqtt-tls-x509\",\"schema_version\":1}}";
  return payload;
}

bool appendOfflineCsv(const TelemetryRecord& record) {
  if (!sdAvailable) return false;
  const bool needsHeader = !SD.exists(kOfflineCsvPath);
  File file = SD.open(kOfflineCsvPath, FILE_APPEND);
  if (!file) {
    Serial.println("MicroSD write failure: telemetry was neither transmitted nor buffered");
    return false;
  }
  if (needsHeader) file.println(kOfflineCsvHeader);
  const String clockStatus = record.timestamp.isEmpty() ? "unsynchronised" : "synchronised";
  const String rain = record.sensors.rainStatus == SensorStatus::ready
      ? String(record.sensors.rainDetected ? "true" : "false") : "";
  file.printf("%s,%s,%lu,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n",
              record.stationId.c_str(), record.timestamp.c_str(), millis(), clockStatus.c_str(),
              csvFloat(record.latitude).c_str(), csvFloat(record.longitude).c_str(),
              csvFloat(record.altitude).c_str(), csvFloat(record.sensors.temperatureC).c_str(),
              csvFloat(record.sensors.humidityPct).c_str(), csvFloat(record.sensors.pressureHpa).c_str(),
              csvFloat(record.sensors.lightLux).c_str(), csvFloat(record.sensors.soilMoisturePct).c_str(),
              rain.c_str(), statusText(record.sensors.bmeStatus), statusText(record.sensors.lightStatus),
              statusText(record.sensors.soilStatus), statusText(record.sensors.rainStatus),
              csvFloat(record.power.batteryV).c_str(), csvFloat(record.power.solarV).c_str(),
              csvFloat(record.power.chargingMa).c_str(), statusText(record.power.status));
  file.close();
  Serial.println("Telemetry buffered to MicroSD; MQTT delivery was not confirmed");
  return true;
}

bool configureTlsAndMqtt() {
  if (!station::config::mqttIsProvisioned()) return false;
  if (!tlsConfigured) {
    // WiFiClientSecure on ESP32 uses the TLS 1.2-capable secure transport; no insecure fallback is used.
    tlsClient.setCACert(station::config::kAwsIotRootCa);
    tlsClient.setCertificate(station::config::kAwsIotClientCertificate);
    tlsClient.setPrivateKey(station::config::kAwsIotPrivateKey);
    tlsClient.setHandshakeTimeout(15);
    mqttClient.setServer(station::config::kAwsIotEndpoint, station::config::kAwsIotPort);
    mqttClient.setBufferSize(1024);
    mqttClient.setKeepAlive(300);
    tlsConfigured = true;
  }
  return true;
}

bool ensureMqttConnection() {
  if (WiFi.status() != WL_CONNECTED || !configureTlsAndMqtt()) return false;
  if (mqttClient.connected()) return true;
  if (!mqttClient.connect(station::config::kStationId)) {
    Serial.printf("AWS IoT MQTT connection unavailable (state %d); retaining telemetry locally\n",
                  mqttClient.state());
    return false;
  }
  Serial.println("AWS IoT MQTT TLS/X.509 session established");
  return true;
}

String telemetryTopic() {
  return String("mausam/stations/") + station::config::kStationId + "/data";
}

bool publishPayload(const String& payload, bool replay) {
  if (payload.isEmpty() || !ensureMqttConnection()) return false;
  mqttClient.loop();
  if (!mqttClient.publish(telemetryTopic().c_str(), payload.c_str())) {
    Serial.println("MQTT client rejected telemetry payload; retaining it on MicroSD");
    return false;
  }
  Serial.printf("%s payload accepted by MQTT transport (QoS 0 is not a broker delivery receipt)\n",
                replay ? "Buffered telemetry" : "Current telemetry");
  return true;
}

bool splitCsvRow(const String& line, String (&fields)[kOfflineFieldCount]) {
  size_t field = 0;
  size_t start = 0;
  for (size_t i = 0; i <= line.length(); ++i) {
    if (i != line.length() && line[i] != ',') continue;
    if (field >= kOfflineFieldCount) return false;
    fields[field++] = line.substring(start, i);
    start = i + 1;
  }
  return field == kOfflineFieldCount;
}

float parseCsvFloat(const String& field) {
  if (field.isEmpty()) return NAN;
  char* end = nullptr;
  const float value = strtof(field.c_str(), &end);
  return end != field.c_str() && end != nullptr && *end == '\0' && std::isfinite(value)
      ? value : NAN;
}

bool parseOfflineRecord(const String& line, TelemetryRecord& record) {
  String fields[kOfflineFieldCount];
  if (!splitCsvRow(line, fields)) return false;
  record.stationId = fields[0];
  record.timestamp = fields[1];
  record.latitude = parseCsvFloat(fields[4]);
  record.longitude = parseCsvFloat(fields[5]);
  record.altitude = parseCsvFloat(fields[6]);
  record.sensors.temperatureC = parseCsvFloat(fields[7]);
  record.sensors.humidityPct = parseCsvFloat(fields[8]);
  record.sensors.pressureHpa = parseCsvFloat(fields[9]);
  record.sensors.lightLux = parseCsvFloat(fields[10]);
  record.sensors.soilMoisturePct = parseCsvFloat(fields[11]);
  if (fields[12] == "true" || fields[12] == "false") {
    record.sensors.rainDetected = fields[12] == "true";
    record.sensors.rainStatus = SensorStatus::ready;
  }
  record.power.batteryV = parseCsvFloat(fields[17]);
  record.power.solarV = parseCsvFloat(fields[18]);
  record.power.chargingMa = parseCsvFloat(fields[19]);
  return true;
}

bool replayLegacyOfflineCsv() {
  constexpr const char* legacyPath = "/offline-readings.csv";
  constexpr const char* legacyPendingPath = "/offline-readings.pending";
  constexpr const char* legacyHeader =
      "timestamp_utc,uptime_ms,clock_status,temperature_c,humidity_pct,pressure_hpa,"
      "light_lux,soil_moisture_pct,rain_detected,bme280_status,bh1750_status,soil_status,"
      "rain_status";
  constexpr size_t legacyFieldCount = 13;
  if (!sdAvailable || !SD.exists(legacyPath) || !ensureMqttConnection()) return false;
  File source = SD.open(legacyPath, FILE_READ);
  if (!source) return false;
  String header = source.readStringUntil('\n');
  header.trim();
  if (header != legacyHeader) {
    source.close();
    Serial.println("Legacy offline CSV schema is unknown; preserving file without replay");
    return false;
  }
  SD.remove(legacyPendingPath);
  File pending = SD.open(legacyPendingPath, FILE_WRITE);
  if (!pending) {
    source.close();
    Serial.println("Cannot create legacy replay journal; preserving buffered telemetry");
    return false;
  }
  pending.println(legacyHeader);
  bool hasPending = false;
  bool replayed = false;
  while (source.available()) {
    String line = source.readStringUntil('\n');
    line.trim();
    if (line.isEmpty()) continue;
    String fields[legacyFieldCount];
    size_t field = 0;
    size_t start = 0;
    bool validFieldCount = true;
    for (size_t i = 0; i <= line.length(); ++i) {
      if (i != line.length() && line[i] != ',') continue;
      if (field >= legacyFieldCount) {
        validFieldCount = false;
        break;
      }
      fields[field++] = line.substring(start, i);
      start = i + 1;
    }
    TelemetryRecord record;
    if (validFieldCount && field == legacyFieldCount) {
      record.stationId = station::config::kStationId;
      record.timestamp = fields[0];
      record.latitude = station::config::kGpsLatitude;
      record.longitude = station::config::kGpsLongitude;
      record.altitude = station::config::kGpsAltitude;
      record.sensors.temperatureC = parseCsvFloat(fields[3]);
      record.sensors.humidityPct = parseCsvFloat(fields[4]);
      record.sensors.pressureHpa = parseCsvFloat(fields[5]);
      record.sensors.lightLux = parseCsvFloat(fields[6]);
      record.sensors.soilMoisturePct = parseCsvFloat(fields[7]);
      if (fields[8] == "true" || fields[8] == "false") {
        record.sensors.rainDetected = fields[8] == "true";
        record.sensors.rainStatus = SensorStatus::ready;
      }
    }
    const String payload = validFieldCount && field == legacyFieldCount
        ? buildTelemetryPayload(record) : "";
    if (!payload.isEmpty() && publishPayload(payload, true)) {
      replayed = true;
      continue;
    }
    pending.println(line);
    hasPending = true;
  }
  source.close();
  pending.close();
  SD.remove(legacyPath);
  if (hasPending) {
    if (!SD.rename(legacyPendingPath, legacyPath)) {
      Serial.println("Legacy replay journal rename failed; retained pending telemetry file");
    }
  } else {
    SD.remove(legacyPendingPath);
  }
  return replayed;
}

bool replayOfflineCsv() {
  const bool legacyReplayed = replayLegacyOfflineCsv();
  if (!sdAvailable || !SD.exists(kOfflineCsvPath) || !ensureMqttConnection()) return legacyReplayed;
  File source = SD.open(kOfflineCsvPath, FILE_READ);
  if (!source) return legacyReplayed;
  String header = source.readStringUntil('\n');
  header.trim();
  if (header != kOfflineCsvHeader) {
    source.close();
    Serial.println("Offline CSV schema is unknown; preserving file without attempting replay");
    return legacyReplayed;
  }
  SD.remove(kOfflinePendingPath);
  File pending = SD.open(kOfflinePendingPath, FILE_WRITE);
  if (!pending) {
    source.close();
    Serial.println("Cannot create replay journal; preserving buffered telemetry");
    return legacyReplayed;
  }
  pending.println(kOfflineCsvHeader);
  bool hasPending = false;
  bool replayed = false;
  while (source.available()) {
    String line = source.readStringUntil('\n');
    line.trim();
    if (line.isEmpty()) continue;
    TelemetryRecord record;
    const String payload = parseOfflineRecord(line, record) ? buildTelemetryPayload(record) : "";
    if (!payload.isEmpty() && publishPayload(payload, true)) {
      replayed = true;
      continue;
    }
    pending.println(line);
    hasPending = true;
  }
  source.close();
  pending.close();
  SD.remove(kOfflineCsvPath);
  if (hasPending) {
    if (!SD.rename(kOfflinePendingPath, kOfflineCsvPath)) {
      Serial.println("Replay journal rename failed; retained pending telemetry file for recovery");
    }
  } else {
    SD.remove(kOfflinePendingPath);
  }
  return replayed || legacyReplayed;
}

void requestSensorCycle() {
  xEventGroupClearBits(sensorEvents, kAllSensorsComplete);
  xTaskNotifyGive(bmeTaskHandle);
  if (powerPolicy.readNonEssentialSensors) {
    xTaskNotifyGive(lightTaskHandle);
    xTaskNotifyGive(soilTaskHandle);
    xTaskNotifyGive(rainTaskHandle);
  } else {
    setNonEssentialSensorsDisabled();
  }
}

void startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  if (!station::config::wifiIsConfigured()) {
    Serial.println("Wi-Fi is not configured; buffering to MicroSD until credentials are supplied");
    WiFi.disconnect(false, false);
    return;
  }
  WiFi.begin(station::config::kWifiSsid, station::config::kWifiPassword);
}

[[noreturn]] void enterWifiRetrySleep() {
  Serial.println("Wi-Fi unavailable for five minutes; sleeping for 15 minutes before retry");
  SD.end();
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_OFF);
  esp_sleep_enable_timer_wakeup(station::core::kWifiRetrySleepUs);
  delay(100);
  esp_deep_sleep_start();
  abort();
}

void measurementCoordinatorTask(void*) {
  for (;;) {
    refreshPowerMeasurement();
    requestSensorCycle();
    const EventBits_t completed = xEventGroupWaitBits(
        sensorEvents, kAllSensorsComplete, pdTRUE, pdTRUE, pdMS_TO_TICKS(5000));
    if ((completed & kAllSensorsComplete) != kAllSensorsComplete) {
      markTimedOutSensors(completed);
      Serial.println("One or more sensor tasks timed out; affected values are null in telemetry");
    }

    const bool wifiConnected = WiFi.status() == WL_CONNECTED;
    wifiFailures.observe(wifiConnected, millis());
    const TelemetryRecord record = currentRecord(copySnapshot(), copyPowerSnapshot());
    bool acceptedByMqtt = false;
    if (wifiConnected) {
      replayOfflineCsv();
      const String payload = buildTelemetryPayload(record);
      if (payload.isEmpty()) {
        Serial.println("Telemetry provenance/configuration is incomplete; retaining reading on MicroSD");
      } else {
        acceptedByMqtt = publishPayload(payload, false);
      }
    }
    if (!acceptedByMqtt) appendOfflineCsv(record);
    if (wifiFailures.shouldEnterRetrySleep(millis())) enterWifiRetrySleep();

    vTaskDelay(pdMS_TO_TICKS(powerPolicy.measurementIntervalSeconds));
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("MAUSAM ESP32-S3 sensor station starting");
  Serial.printf("Measurement interval: %lu seconds\n",
                station::config::kMeasurementIntervalSeconds);

  Wire.begin(station::config::kI2cSdaPin, station::config::kI2cSclPin);
  i2cMutex = xSemaphoreCreateMutex();
  snapshotMutex = xSemaphoreCreateMutex();
  sensorEvents = xEventGroupCreate();
  if (!i2cMutex || !snapshotMutex || !sensorEvents) {
    Serial.println("FreeRTOS allocation failure; halting to avoid invalid sensor data");
    while (true) delay(1000);
  }

  bmeAvailable = initialiseBme();
  lightAvailable = initialiseLightMeter();
  initialisePowerMonitors();
  analogReadResolution(12);
  pinMode(station::config::kRainDigitalPin, INPUT);
  sdAvailable = initialiseSdCard();
  startWifi();

  xTaskCreate(bmeReadTask, "read_bme280", 4096, nullptr, 2, &bmeTaskHandle);
  xTaskCreate(lightReadTask, "read_bh1750", 4096, nullptr, 2, &lightTaskHandle);
  xTaskCreate(soilReadTask, "read_soil", 3072, nullptr, 2, &soilTaskHandle);
  xTaskCreate(rainReadTask, "read_yl83", 3072, nullptr, 2, &rainTaskHandle);
  xTaskCreate(measurementCoordinatorTask, "measurement", 8192, nullptr, 3, nullptr);
}

void loop() {
  vTaskDelay(portMAX_DELAY);
}
