// Copy this file to firmware/include/StationSecrets.h and fill values during provisioning.
// Keep StationSecrets.h out of source control. Certificates must be PEM strings.
#pragma once

#define STATION_WIFI_SSID "<wifi-ssid>"
#define STATION_WIFI_PASSWORD "<wifi-password>"
#define STATION_ID "mausam-sgr-001"
#define STATION_GPS_LAT 26.9847F
#define STATION_GPS_LON 94.9376F
#define STATION_GPS_ALT 96.5F
#define STATION_AWS_IOT_ENDPOINT "<endpoint>.iot.<region>.amazonaws.com"
#define STATION_AWS_IOT_ROOT_CA "<PEM-root-CA>"
#define STATION_AWS_IOT_CLIENT_CERT "<PEM-device-certificate>"
#define STATION_AWS_IOT_PRIVATE_KEY "<PEM-private-key>"
