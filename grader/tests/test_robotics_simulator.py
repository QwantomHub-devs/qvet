"""
Unit tests for Robotics 2D Kinematic Simulator & Grader (Milestone 8).
"""

from __future__ import annotations

import unittest
from grader.graders.robotics_simulator import (
    Pose2D,
    SimulatedWorld,
    RobotSimulator,
    ReferenceWarehouseController,
    ReferencePerceptionAndTransformModule,
    run_single_robotics_seed,
    score_robotics_project,
)


class TestRoboticsSimulator(unittest.TestCase):
    def test_reference_implementation_scores_100_percent_median(self):
        """The standard reference implementation must earn all 65 automatic points across 3 seeds."""
        res = score_robotics_project("")
        self.assertEqual(res["points"], 65.0)
        self.assertEqual(res["component_points"]["A1"], 20.0)
        self.assertEqual(res["component_points"]["A2"], 15.0)
        self.assertEqual(res["component_points"]["A3"], 10.0)
        self.assertEqual(res["component_points"]["B1"], 10.0)
        self.assertEqual(res["component_points"]["B2"], 10.0)

    def test_unicycle_kinematics_step(self):
        """Verifies (x, y, theta) integration for straight line and pure rotation."""
        world = SimulatedWorld(seed=42)
        start = Pose2D(0.0, 0.0, 0.0)
        robot = RobotSimulator(start, max_linear_vel=1.0)

        # Drive forward at 1.0 m/s for 1.0s (dt=0.1, 10 steps)
        for _ in range(10):
            robot.step(v_cmd=1.0, omega_cmd=0.0, dt=0.1, world=world)

        self.assertAlmostEqual(robot.pose.x, 1.0, places=2)
        self.assertAlmostEqual(robot.pose.y, 0.0, places=2)
        self.assertAlmostEqual(robot.pose.theta, 0.0, places=2)

        # Pure rotation at pi rad/s for 0.5s -> theta should reach pi/2
        math_pi = 3.14159265
        for _ in range(5):
            robot.step(v_cmd=0.0, omega_cmd=math_pi, dt=0.1, world=world)

        self.assertAlmostEqual(robot.pose.theta, math_pi / 2.0, places=2)

    def test_speed_limit_violation_detection(self):
        """Violating the 1.0 m/s velocity limit increments speed_limit_violations."""
        world = SimulatedWorld(seed=42)
        robot = RobotSimulator(Pose2D(0, 0, 0), max_linear_vel=1.0)
        robot.step(v_cmd=2.0, omega_cmd=0.0, dt=0.1, world=world)
        self.assertEqual(robot.speed_limit_violations, 1)

    def test_multi_seed_variation_handling(self):
        """Evaluates consistent median aggregation across seeds."""
        for s in [42, 101, 202]:
            run = run_single_robotics_seed(s)
            self.assertEqual(run["A1"], 20.0)
            self.assertEqual(run["A2"], 15.0)
            self.assertEqual(run["B1"], 10.0)
            self.assertEqual(run["B2"], 10.0)

    def test_marker_detection_and_transform_tree(self):
        """Validates ArUco marker pose ground truth and SE(2) frame hierarchy."""
        perception = ReferencePerceptionAndTransformModule()
        gt_pose = Pose2D(8.0, 0.0, 0.0)
        est = perception.estimate_marker_pose({"noise_x": 0.01, "noise_y": 0.02}, gt_pose)
        self.assertLess(est.distance_to(gt_pose), 0.05)

        valid = perception.verify_transform_tree({
            "base_link": "odom",
            "camera_link": "base_link",
            "laser_frame": "base_link",
        })
        self.assertTrue(valid)


if __name__ == "__main__":
    unittest.main()
