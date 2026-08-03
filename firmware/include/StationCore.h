#pragma once

#include <cmath>
#include <cstdint>
#include <cstring>

namespace station::core {

constexpr uint32_t kDefaultMeasurementIntervalSeconds = 60;
constexpr uint32_t kCriticalLowPowerIntervalSeconds = 5 * 60;
constexpr float kCriticalBatteryVoltage = 3.2F;
constexpr uint32_t kMinimumMeasurementIntervalSeconds = 10;
constexpr uint32_t kMaximumMeasurementIntervalSeconds = 3600;
constexpr uint32_t kWifiFailureSleepAfterMs = 5UL * 60UL * 1000UL;
constexpr uint64_t kWifiRetrySleepUs = 15ULL * 60ULL * 1000ULL * 1000ULL;
constexpr uint32_t kNoFailureRecorded = UINT32_MAX;

constexpr uint32_t clampMeasurementIntervalSeconds(uint32_t seconds) {
  return seconds < kMinimumMeasurementIntervalSeconds
      ? kMinimumMeasurementIntervalSeconds
      : (seconds > kMaximumMeasurementIntervalSeconds
          ? kMaximumMeasurementIntervalSeconds
          : seconds);
}

struct PowerPolicy {
  bool criticalLowPower = false;
  bool readNonEssentialSensors = true;
  uint32_t measurementIntervalSeconds = kDefaultMeasurementIntervalSeconds;
};

inline PowerPolicy powerPolicyForBattery(float batteryVoltage,
                                         uint32_t configuredIntervalSeconds) {
  const bool critical = std::isfinite(batteryVoltage) &&
                        batteryVoltage < kCriticalBatteryVoltage;
  return {
      critical,
      !critical,
      critical ? kCriticalLowPowerIntervalSeconds
               : clampMeasurementIntervalSeconds(configuredIntervalSeconds),
  };
}

inline bool isValidStationId(const char* stationId) {
  if (stationId == nullptr) return false;
  const size_t length = std::strlen(stationId);
  if (length < 3 || length > 50) return false;
  for (size_t i = 0; i < length; ++i) {
    const char c = stationId[i];
    const bool allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                         (c >= '0' && c <= '9') || c == '-' || c == '_';
    if (!allowed) return false;
  }
  return true;
}

inline bool isValidIso8601UtcTimestamp(const char* timestamp) {
  if (timestamp == nullptr || std::strlen(timestamp) != 20) return false;
  for (size_t i = 0; i < 20; ++i) {
    if (i == 4 || i == 7) {
      if (timestamp[i] != '-') return false;
    } else if (i == 10) {
      if (timestamp[i] != 'T') return false;
    } else if (i == 13 || i == 16) {
      if (timestamp[i] != ':') return false;
    } else if (i == 19) {
      if (timestamp[i] != 'Z') return false;
    } else if (timestamp[i] < '0' || timestamp[i] > '9') {
      return false;
    }
  }
  return true;
}

inline bool hasValidGpsCoordinates(float latitude, float longitude, float altitude) {
  return std::isfinite(latitude) && std::isfinite(longitude) && std::isfinite(altitude) &&
         latitude >= -90.0F && latitude <= 90.0F &&
         longitude >= -180.0F && longitude <= 180.0F &&
         altitude >= -500.0F && altitude <= 10000.0F;
}

inline bool telemetryProvenanceIsValid(const char* stationId, const char* timestamp,
                                       float latitude, float longitude, float altitude) {
  return isValidStationId(stationId) && isValidIso8601UtcTimestamp(timestamp) &&
         hasValidGpsCoordinates(latitude, longitude, altitude);
}

class WifiFailureTracker {
 public:
  void observe(bool connected, uint32_t nowMs) {
    if (connected) {
      failureStartedAtMs_ = kNoFailureRecorded;
    } else if (failureStartedAtMs_ == kNoFailureRecorded) {
      failureStartedAtMs_ = nowMs;
    }
  }

  bool shouldEnterRetrySleep(uint32_t nowMs) const {
    return failureStartedAtMs_ != kNoFailureRecorded &&
           static_cast<uint32_t>(nowMs - failureStartedAtMs_) >= kWifiFailureSleepAfterMs;
  }

  bool isFailing() const { return failureStartedAtMs_ != kNoFailureRecorded; }

 private:
  uint32_t failureStartedAtMs_ = kNoFailureRecorded;
};

}  // namespace station::core
