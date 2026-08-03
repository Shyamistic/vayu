#pragma once

#include <Arduino.h>

#include "StationCore.h"

#if defined(__has_include)
#if __has_include("StationSecrets.h")
#include "StationSecrets.h"
#endif
#endif

#ifndef STATION_MEASUREMENT_INTERVAL_SECONDS
#define STATION_MEASUREMENT_INTERVAL_SECONDS 60
#endif
#ifndef STATION_WIFI_SSID
#define STATION_WIFI_SSID ""
#endif
#ifndef STATION_WIFI_PASSWORD
#define STATION_WIFI_PASSWORD ""
#endif
#ifndef STATION_ID
#define STATION_ID ""
#endif
#ifndef STATION_GPS_LAT
#define STATION_GPS_LAT NAN
#endif
#ifndef STATION_GPS_LON
#define STATION_GPS_LON NAN
#endif
#ifndef STATION_GPS_ALT
#define STATION_GPS_ALT NAN
#endif
#ifndef STATION_AWS_IOT_ENDPOINT
#define STATION_AWS_IOT_ENDPOINT ""
#endif
#ifndef STATION_AWS_IOT_ROOT_CA
#define STATION_AWS_IOT_ROOT_CA ""
#endif
#ifndef STATION_AWS_IOT_CLIENT_CERT
#define STATION_AWS_IOT_CLIENT_CERT ""
#endif
#ifndef STATION_AWS_IOT_PRIVATE_KEY
#define STATION_AWS_IOT_PRIVATE_KEY ""
#endif
#ifndef STATION_ENABLE_SOIL_SENSOR
#define STATION_ENABLE_SOIL_SENSOR 1
#endif
#ifndef STATION_ENABLE_RAIN_SENSOR
#define STATION_ENABLE_RAIN_SENSOR 1
#endif
#ifndef STATION_ENABLE_INA219
#define STATION_ENABLE_INA219 1
#endif

namespace station::config {

constexpr uint8_t kI2cSdaPin = 8;
constexpr uint8_t kI2cSclPin = 9;
constexpr uint8_t kSoilAdcPin = 4;
constexpr uint8_t kRainDigitalPin = 5;
constexpr bool kRainActiveLow = true;
constexpr int kSoilDryAdc = 3200;
constexpr int kSoilWetAdc = 1400;
constexpr uint8_t kBatteryIna219Address = 0x40;
constexpr uint8_t kSolarIna219Address = 0x41;

constexpr uint8_t kSdSckPin = 12;
constexpr uint8_t kSdMisoPin = 13;
constexpr uint8_t kSdMosiPin = 11;
constexpr uint8_t kSdCsPin = 10;
constexpr uint16_t kAwsIotPort = 8883;

constexpr uint32_t kMeasurementIntervalSeconds =
    core::clampMeasurementIntervalSeconds(STATION_MEASUREMENT_INTERVAL_SECONDS);
constexpr bool kSoilSensorEnabled = STATION_ENABLE_SOIL_SENSOR != 0;
constexpr bool kRainSensorEnabled = STATION_ENABLE_RAIN_SENSOR != 0;
constexpr bool kIna219Enabled = STATION_ENABLE_INA219 != 0;
constexpr const char* kWifiSsid = STATION_WIFI_SSID;
constexpr const char* kWifiPassword = STATION_WIFI_PASSWORD;
constexpr const char* kStationId = STATION_ID;
constexpr float kGpsLatitude = STATION_GPS_LAT;
constexpr float kGpsLongitude = STATION_GPS_LON;
constexpr float kGpsAltitude = STATION_GPS_ALT;
constexpr const char* kAwsIotEndpoint = STATION_AWS_IOT_ENDPOINT;
constexpr const char* kAwsIotRootCa = STATION_AWS_IOT_ROOT_CA;
constexpr const char* kAwsIotClientCertificate = STATION_AWS_IOT_CLIENT_CERT;
constexpr const char* kAwsIotPrivateKey = STATION_AWS_IOT_PRIVATE_KEY;

inline bool wifiIsConfigured() { return kWifiSsid[0] != '\0'; }

inline bool mqttIsProvisioned() {
  return core::isValidStationId(kStationId) && kAwsIotEndpoint[0] != '\0' &&
         kAwsIotRootCa[0] != '\0' && kAwsIotClientCertificate[0] != '\0' &&
         kAwsIotPrivateKey[0] != '\0';
}

inline bool telemetryProvenanceIsConfigured() {
  return core::hasValidGpsCoordinates(kGpsLatitude, kGpsLongitude, kGpsAltitude);
}

}  // namespace station::config
