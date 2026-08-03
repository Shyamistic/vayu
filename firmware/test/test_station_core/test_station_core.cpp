#include <unity.h>

#include "StationCore.h"

using station::core::WifiFailureTracker;

void setUp() {}
void tearDown() {}

void test_measurement_interval_defaults_to_sixty_seconds() {
  TEST_ASSERT_EQUAL_UINT32(60, station::core::kDefaultMeasurementIntervalSeconds);
  TEST_ASSERT_EQUAL_UINT32(60, station::core::clampMeasurementIntervalSeconds(60));
}

void test_measurement_interval_is_bounded_for_invalid_configuration() {
  TEST_ASSERT_EQUAL_UINT32(10, station::core::clampMeasurementIntervalSeconds(0));
  TEST_ASSERT_EQUAL_UINT32(3600, station::core::clampMeasurementIntervalSeconds(7200));
}

void test_wifi_failure_requires_five_minutes_before_sleep() {
  WifiFailureTracker tracker;
  tracker.observe(false, 1000);
  TEST_ASSERT_FALSE(tracker.shouldEnterRetrySleep(1000 + 299999));
  TEST_ASSERT_TRUE(tracker.shouldEnterRetrySleep(1000 + 300000));
}

void test_wifi_reconnection_clears_the_sleep_condition() {
  WifiFailureTracker tracker;
  tracker.observe(false, 0);
  tracker.observe(true, 300000);
  TEST_ASSERT_FALSE(tracker.isFailing());
  TEST_ASSERT_FALSE(tracker.shouldEnterRetrySleep(600000));
}

void test_critical_power_policy_uses_five_minute_interval_and_disables_optional_sensors() {
  const auto policy = station::core::powerPolicyForBattery(3.19F, 60);
  TEST_ASSERT_TRUE(policy.criticalLowPower);
  TEST_ASSERT_FALSE(policy.readNonEssentialSensors);
  TEST_ASSERT_EQUAL_UINT32(300, policy.measurementIntervalSeconds);
}

void test_normal_power_policy_preserves_configured_measurement_interval() {
  const auto policy = station::core::powerPolicyForBattery(3.2F, 120);
  TEST_ASSERT_FALSE(policy.criticalLowPower);
  TEST_ASSERT_TRUE(policy.readNonEssentialSensors);
  TEST_ASSERT_EQUAL_UINT32(120, policy.measurementIntervalSeconds);
}

void test_telemetry_provenance_rejects_missing_or_invalid_identity_fields() {
  TEST_ASSERT_TRUE(station::core::telemetryProvenanceIsValid(
      "mausam-sgr-001", "2025-07-15T10:30:00Z", 26.9847F, 94.9376F, 96.5F));
  TEST_ASSERT_FALSE(station::core::telemetryProvenanceIsValid(
      "bad station id", "2025-07-15T10:30:00Z", 26.9847F, 94.9376F, 96.5F));
  TEST_ASSERT_FALSE(station::core::telemetryProvenanceIsValid(
      "mausam-sgr-001", "not-a-timestamp", 26.9847F, 94.9376F, 96.5F));
  TEST_ASSERT_FALSE(station::core::telemetryProvenanceIsValid(
      "mausam-sgr-001", "2025-07-15T10:30:00Z", 91.0F, 94.9376F, 96.5F));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_measurement_interval_defaults_to_sixty_seconds);
  RUN_TEST(test_measurement_interval_is_bounded_for_invalid_configuration);
  RUN_TEST(test_wifi_failure_requires_five_minutes_before_sleep);
  RUN_TEST(test_wifi_reconnection_clears_the_sleep_condition);
  RUN_TEST(test_critical_power_policy_uses_five_minute_interval_and_disables_optional_sensors);
  RUN_TEST(test_normal_power_policy_preserves_configured_measurement_interval);
  RUN_TEST(test_telemetry_provenance_rejects_missing_or_invalid_identity_fields);
  return UNITY_END();
}
