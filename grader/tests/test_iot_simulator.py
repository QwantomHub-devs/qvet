"""
Unit tests for IoT Virtual Peripheral Simulator & Grader (Milestone 7).
"""

from __future__ import annotations

import unittest
from grader.graders.iot_simulator import (
    VirtualDeviceEnvironment,
    VirtualSensorSuite,
    ReferenceVaccineMonitor,
    ReferenceCloudIngestService,
    run_iot_test_scenarios,
    score_iot_project,
)


class TestIoTSimulator(unittest.TestCase):
    def test_reference_implementation_scores_100_percent(self):
        """The standard reference implementation must earn all 65 automatic points."""
        res = score_iot_project("")
        self.assertEqual(res["points"], 65.0)
        self.assertEqual(res["component_points"]["A1"], 20.0)
        self.assertEqual(res["component_points"]["A2"], 15.0)
        self.assertEqual(res["component_points"]["A3"], 10.0)
        self.assertEqual(res["component_points"]["B1"], 10.0)
        self.assertEqual(res["component_points"]["B2"], 10.0)

    def test_single_spike_vs_consecutive_breaches(self):
        """A single transient spike must not trigger alarm, while 3 consecutive breaches must."""
        env = VirtualDeviceEnvironment()
        dev = ReferenceVaccineMonitor(env)

        # 1. Normal
        env.sensors.temperature = 4.0
        dev.execute_sampling_cycle()
        self.assertFalse(env.buzzer_active)

        # 2. Single spike
        env.sensors.temperature = 12.0
        dev.execute_sampling_cycle()
        self.assertFalse(env.buzzer_active)  # Filtered!

        # 3. Second breach
        env.sensors.temperature = 12.0
        dev.execute_sampling_cycle()
        self.assertFalse(env.buzzer_active)  # Still not 3

        # 4. Third breach -> ALARM
        env.sensors.temperature = 12.0
        dev.execute_sampling_cycle()
        self.assertTrue(env.buzzer_active)

    def test_network_outage_buffering_and_resend(self):
        """Readings during 120s network outage must be buffered and resent in order."""
        env = VirtualDeviceEnvironment()
        dev = ReferenceVaccineMonitor(env)

        env.network_online = False
        for _ in range(12):
            dev.execute_sampling_cycle()

        self.assertEqual(len(dev.telemetry_buffer), 12)
        self.assertEqual(len(env.published_messages), 0)

        # Network back online
        env.network_online = True
        dev.execute_sampling_cycle()

        self.assertEqual(len(dev.telemetry_buffer), 0)
        self.assertEqual(len(env.published_messages), 13)
        seqs = [msg["payload"]["seq"] for msg in env.published_messages]
        self.assertEqual(seqs, list(range(1, 14)))

    def test_sleep_ratio_power_management(self):
        """Device must use low-power sleep waiting between cycles."""
        env = VirtualDeviceEnvironment()
        dev = ReferenceVaccineMonitor(env)
        for _ in range(5):
            dev.execute_sampling_cycle()

        total = env.sleep_time_s + env.active_time_s
        self.assertGreater(total, 0)
        ratio = env.sleep_time_s / total
        self.assertGreaterEqual(ratio, 0.90)

    def test_cloud_deduplication_and_sorting(self):
        """Cloud service must discard duplicate sequence packets and maintain order."""
        cloud = ReferenceCloudIngestService()
        cloud.ingest_message({"seq": 10, "timestamp": 100.0, "temperature": 4.0})
        cloud.ingest_message({"seq": 10, "timestamp": 100.0, "temperature": 4.0})  # Duplicate
        cloud.ingest_message({"seq": 12, "timestamp": 120.0, "temperature": 4.2})
        cloud.ingest_message({"seq": 11, "timestamp": 110.0, "temperature": 4.1})  # Out of order

        self.assertEqual(len(cloud.stored_records), 3)
        self.assertEqual([r["seq"] for r in cloud.stored_records], [10, 11, 12])


if __name__ == "__main__":
    unittest.main()
