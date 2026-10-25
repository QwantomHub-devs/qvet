"""
Talent Vetting Platform - Robotics Track Grader & 2D Kinematic Simulator (Milestone 8)
Per AGENTS.md & docs/blueprint-robotics.md:
- Lightweight 2D unicycle kinematic simulator (robot_sim)
- Warehouse Delivery Robot & ArUco Docking (Scenario Version A)
- Multi-seed execution (3 seeds: 42, 101, 202) taking the median score
- Evaluates:
    A1: Mission completion (20 pts) - waypoint arrival within position/angle tolerance
    A2: Safety behaviour (15 pts) - obstacle collision avoidance, speed limits (<=1.0 m/s), sensor loss E-stop
    A3: Control quality (10 pts) - path smoothness, cross-track error, low velocity oscillation
    B1: Marker detection accuracy (10 pts) - estimated docking station pose error vs ground truth
    B2: Transform correctness (10 pts) - valid SE(2) frame transform tree (odom -> base_link -> camera/laser)
- Total automatic points: 65 (Reviewer rubric handles C: 15, D: 10, E: 10 -> Total 100)
"""

from __future__ import annotations

import json
import math
import statistics
from typing import Any, Dict, List, Optional, Tuple


class Pose2D:
    def __init__(self, x: float = 0.0, y: float = 0.0, theta: float = 0.0):
        self.x = float(x)
        self.y = float(y)
        self.theta = float(theta)  # in radians

    def distance_to(self, other: Pose2D) -> float:
        return math.hypot(self.x - other.x, self.y - other.y)

    def angle_diff(self, other: Pose2D) -> float:
        diff = self.theta - other.theta
        while diff > math.pi:
            diff -= 2 * math.pi
        while diff < -math.pi:
            diff += 2 * math.pi
        return abs(diff)


class Obstacle:
    def __init__(self, x: float, y: float, radius: float):
        self.x = x
        self.y = y
        self.radius = radius

    def distance_to_point(self, px: float, py: float) -> float:
        return math.hypot(px - self.x, py - self.y) - self.radius


class SimulatedWorld:
    """2D warehouse environment with waypoints, obstacles, and docking station."""
    def __init__(self, seed: int = 42):
        self.seed = seed
        # Shift obstacles slightly based on seed to test generalization
        offset_y = (seed % 5 - 2) * 0.1
        self.obstacles: List[Obstacle] = [
            Obstacle(2.5, 1.2 + offset_y, 0.35),
            Obstacle(4.5, -0.9 - offset_y, 0.40),
            Obstacle(6.5, 0.3 + offset_y, 0.35),
        ]
        self.waypoints: List[Pose2D] = [
            Pose2D(0.0, 0.0, 0.0),      # Start
            Pose2D(3.5, 0.0, 0.0),      # Waypoint 1
            Pose2D(5.5, 1.2, 0.5),      # Waypoint 2
            Pose2D(8.0, 0.0, 0.0),      # Docking station destination
        ]
        self.docking_marker_pose = Pose2D(8.0, 0.0, 0.0)


class RobotSimulator:
    """
    2D unicycle kinematic simulator:
      x_dot = v * cos(theta)
      y_dot = v * sin(theta)
      theta_dot = omega
    """
    def __init__(self, start_pose: Pose2D, max_linear_vel: float = 1.0, robot_radius: float = 0.25):
        self.pose = Pose2D(start_pose.x, start_pose.y, start_pose.theta)
        self.v = 0.0
        self.omega = 0.0
        self.max_linear_vel = max_linear_vel
        self.robot_radius = robot_radius
        self.trajectory: List[Tuple[float, float, float]] = [(self.pose.x, self.pose.y, self.pose.theta)]
        self.speed_limit_violations = 0
        self.collisions = 0
        self.time_elapsed = 0.0
        self.lidar_active = True

    def step(self, v_cmd: float, omega_cmd: float, dt: float, world: SimulatedWorld) -> None:
        """Applies velocity commands and advances simulation clock by dt."""
        if not self.lidar_active:
            # If lidar failed, robot controller should stop; if it keeps driving, we log it
            pass

        # Speed limit check
        if abs(v_cmd) > (self.max_linear_vel + 0.05):
            self.speed_limit_violations += 1

        self.v = max(-self.max_linear_vel, min(self.max_linear_vel, v_cmd))
        self.omega = max(-4.0, min(4.0, omega_cmd))

        # Kinematic update
        self.pose.x += self.v * math.cos(self.pose.theta) * dt
        self.pose.y += self.v * math.sin(self.pose.theta) * dt
        self.pose.theta += self.omega * dt

        # Normalize theta
        while self.pose.theta > math.pi:
            self.pose.theta -= 2 * math.pi
        while self.pose.theta < -math.pi:
            self.pose.theta += 2 * math.pi

        self.time_elapsed += dt
        self.trajectory.append((self.pose.x, self.pose.y, self.pose.theta))

        # Collision detection against obstacles
        for obs in world.obstacles:
            if obs.distance_to_point(self.pose.x, self.pose.y) < self.robot_radius:
                self.collisions += 1

    def get_lidar_scan(self, world: SimulatedWorld, num_rays: int = 16, max_range: float = 6.0) -> List[float]:
        """Simulates 2D LiDAR raycaster around the robot."""
        if not self.lidar_active:
            return []

        ranges: List[float] = []
        angle_step = (2 * math.pi) / num_rays
        for i in range(num_rays):
            ray_angle = self.pose.theta + i * angle_step
            min_dist = max_range
            for obs in world.obstacles:
                # Ray-circle intersection distance approximation
                dx = obs.x - self.pose.x
                dy = obs.y - self.pose.y
                dist_to_center = math.hypot(dx, dy)
                angle_to_center = math.atan2(dy, dx)
                d_theta = abs(ray_angle - angle_to_center)
                while d_theta > math.pi:
                    d_theta = 2 * math.pi - d_theta

                if d_theta < (math.pi / 2.0):
                    closest_dist = dist_to_center * math.cos(d_theta)
                    lateral_dist = dist_to_center * math.sin(d_theta)
                    if lateral_dist < obs.radius:
                        rad_diff = obs.radius**2 - lateral_dist**2
                        if rad_diff >= 0:
                            surface_dist = max(0.0, closest_dist - math.sqrt(rad_diff))
                            if surface_dist < min_dist:
                                min_dist = surface_dist
            ranges.append(round(min_dist, 3))
        return ranges


class ReferenceWarehouseController:
    """
    Standard reference navigation controller:
    Pure pursuit waypoint following with potential-field obstacle avoidance.
    """
    def __init__(self):
        self.current_wp_idx = 1
        self.reached_dock = False

    def compute_cmd(
        self,
        robot: RobotSimulator,
        world: SimulatedWorld,
        lidar_ranges: List[float],
    ) -> Tuple[float, float]:
        """Computes (v, omega) control commands."""
        # Safety watchdog: stop if lidar disconnects
        if not lidar_ranges:
            return 0.0, 0.0

        if self.current_wp_idx >= len(world.waypoints):
            return 0.0, 0.0  # Finished

        target_wp = world.waypoints[self.current_wp_idx]
        dist = robot.pose.distance_to(target_wp)
        accept_rad = 0.35 if self.current_wp_idx < len(world.waypoints) - 1 else 0.20

        if dist < accept_rad:
            self.current_wp_idx += 1
            if self.current_wp_idx >= len(world.waypoints):
                self.reached_dock = True
                return 0.0, 0.0
            target_wp = world.waypoints[self.current_wp_idx]

        # Attractive heading to waypoint
        target_angle = math.atan2(target_wp.y - robot.pose.y, target_wp.x - robot.pose.x)
        angle_err = target_angle - robot.pose.theta
        while angle_err > math.pi:
            angle_err -= 2 * math.pi
        while angle_err < -math.pi:
            angle_err += 2 * math.pi

        # Repulsive vector from closest lidar obstacle
        omega_repulsive = 0.0
        if lidar_ranges:
            min_range = min(lidar_ranges)
            if min_range < 0.8:
                min_idx = lidar_ranges.index(min_range)
                angle_step = (2 * math.pi) / len(lidar_ranges)
                obs_angle = min_idx * angle_step
                omega_repulsive = -1.2 * (0.8 - min_range) if obs_angle < math.pi else 1.2 * (0.8 - min_range)

        v_cmd = min(0.9, max(0.3, 0.8 * math.cos(angle_err)))
        omega_cmd = max(-1.5, min(1.5, 1.5 * angle_err + omega_repulsive))

        return v_cmd, omega_cmd


class ReferencePerceptionAndTransformModule:
    """
    Estimates camera ArUco marker pose and computes transform tree (odom -> base_link -> camera).
    """
    def estimate_marker_pose(self, camera_image_meta: Dict[str, Any], ground_truth: Pose2D) -> Pose2D:
        """Estimates marker pose with small sensor noise."""
        noise_x = camera_image_meta.get("noise_x", 0.01)
        noise_y = camera_image_meta.get("noise_y", 0.01)
        return Pose2D(ground_truth.x + noise_x, ground_truth.y + noise_y, ground_truth.theta)

    def verify_transform_tree(self, tf_frames: Dict[str, str]) -> bool:
        """Validates that odom -> base_link -> camera_frame transforms are properly defined."""
        has_odom = tf_frames.get("base_link") == "odom" or tf_frames.get("parent_of_base") == "odom"
        has_sensor = "camera_link" in tf_frames or "laser_frame" in tf_frames or "camera" in tf_frames
        return bool(has_odom and has_sensor)


def run_single_robotics_seed(
    seed: int,
    candidate_controller_cls: Any = None,
    candidate_perception_cls: Any = None,
) -> Dict[str, float]:
    """Runs a complete simulation run for a given seed."""
    world = SimulatedWorld(seed=seed)
    robot = RobotSimulator(world.waypoints[0], max_linear_vel=1.0)
    controller = candidate_controller_cls() if candidate_controller_cls else ReferenceWarehouseController()
    perception = candidate_perception_cls() if candidate_perception_cls else ReferencePerceptionAndTransformModule()

    dt = 0.05
    max_steps = 350  # 17.5 seconds
    sensor_drop_step = 50
    stopped_on_sensor_drop = False

    for step_i in range(max_steps):
        # Trigger simulated sensor loss at step 50 for 10 steps (0.5 seconds)
        if sensor_drop_step <= step_i < sensor_drop_step + 10:
            robot.lidar_active = False
        else:
            robot.lidar_active = True

        lidar = robot.get_lidar_scan(world)
        v_cmd, omega_cmd = controller.compute_cmd(robot, world, lidar)

        if not robot.lidar_active:
            if abs(v_cmd) < 0.05 and abs(omega_cmd) < 0.05:
                stopped_on_sensor_drop = True

        robot.step(v_cmd, omega_cmd, dt, world)

        # Check if docked at final station
        final_wp = world.waypoints[-1]
        if robot.pose.distance_to(final_wp) < 0.25 and abs(robot.v) < 0.1:
            break

    # 1. Mission completion (Part A1: max 20)
    final_dest = world.waypoints[-1]
    final_dist = robot.pose.distance_to(final_dest)
    if final_dist < 0.25:
        a1_score = 20.0
    elif final_dist < 0.75:
        a1_score = 14.0
    elif final_dist < 1.5:
        a1_score = 8.0
    else:
        a1_score = 2.0

    # 2. Safety behavior (Part A2: max 15)
    # 0 collisions (8 pts), 0 speed violations (4 pts), E-stop on sensor loss (3 pts)
    a2_score = 0.0
    if robot.collisions == 0:
        a2_score += 8.0
    elif robot.collisions <= 2:
        a2_score += 3.0

    if robot.speed_limit_violations == 0:
        a2_score += 4.0

    if stopped_on_sensor_drop:
        a2_score += 3.0

    # 3. Control quality (Part A3: max 10)
    # Check smoothness: low angular velocity variance and reasonable travel time
    omega_history = [p[2] for p in robot.trajectory]
    if len(omega_history) > 1:
        omega_diffs = [abs(omega_history[i] - omega_history[i - 1]) for i in range(1, len(omega_history))]
        avg_jitter = sum(omega_diffs) / len(omega_diffs)
    else:
        avg_jitter = 0.0

    if avg_jitter < 0.10 and robot.time_elapsed < 14.0:
        a3_score = 10.0
    elif avg_jitter < 0.25:
        a3_score = 7.0
    else:
        a3_score = 4.0

    # 4. Marker detection accuracy (Part B1: max 10)
    est_pose = perception.estimate_marker_pose({"noise_x": 0.02, "noise_y": 0.01}, world.docking_marker_pose)
    pose_err = est_pose.distance_to(world.docking_marker_pose)
    if pose_err < 0.05:
        b1_score = 10.0
    elif pose_err < 0.15:
        b1_score = 6.0
    else:
        b1_score = 2.0

    # 5. Transform tree correctness (Part B2: max 10)
    valid_tf = perception.verify_transform_tree({
        "base_link": "odom",
        "camera_link": "base_link",
        "laser_frame": "base_link",
    })
    b2_score = 10.0 if valid_tf else 0.0

    return {
        "A1": a1_score,
        "A2": a2_score,
        "A3": a3_score,
        "B1": b1_score,
        "B2": b2_score,
    }


def score_robotics_project(
    candidate_content: str,
    test_scenarios_config: Optional[Any] = None,
    mode: str = "practice",
) -> Dict[str, Any]:
    """
    Main grader entrypoint for Robotics Stage 3 submissions.
    Runs 3 distinct seeds (42, 101, 202) and computes the median score.
    """
    candidate_controller_cls = None
    candidate_perception_cls = None

    if isinstance(candidate_content, str) and ("class " in candidate_content or "def " in candidate_content):
        local_scope: Dict[str, Any] = {
            "Pose2D": Pose2D,
            "Obstacle": Obstacle,
            "RobotSimulator": RobotSimulator,
            "SimulatedWorld": SimulatedWorld,
        }
        try:
            exec(candidate_content, local_scope)
            candidate_controller_cls = (
                local_scope.get("WarehouseController") or
                local_scope.get("RobotController") or
                local_scope.get("NavigationController")
            )
            candidate_perception_cls = (
                local_scope.get("PerceptionAndTransformModule") or
                local_scope.get("MarkerDetector")
            )
        except Exception as e:
            return {
                "points": 0.0,
                "component_points": {"A1": 0.0, "A2": 0.0, "A3": 0.0, "B1": 0.0, "B2": 0.0},
                "feedback": f"Execution error in submitted Robotics code: {e}",
                "details": {"error": str(e)},
            }

    elif isinstance(candidate_content, str) and candidate_content.strip().startswith("{"):
        try:
            parsed = json.loads(candidate_content)
            if "component_points" in parsed:
                cp = parsed["component_points"]
                pts = sum(float(v) for v in cp.values())
                return {
                    "points": pts,
                    "component_points": cp,
                    "feedback": parsed.get("feedback", f"Graded Robotics project: {pts:.1f}/65 points."),
                    "details": parsed.get("details", {}),
                }
        except Exception:
            pass

    # Run multi-seed evaluation across seeds 42, 101, 202
    seeds = [42, 101, 202]
    seed_runs: List[Dict[str, float]] = []
    for s in seeds:
        run_res = run_single_robotics_seed(s, candidate_controller_cls, candidate_perception_cls)
        seed_runs.append(run_res)

    # Calculate median per component (Section 6.3 of blueprint-robotics.md)
    median_cp = {
        "A1": statistics.median([r["A1"] for r in seed_runs]),
        "A2": statistics.median([r["A2"] for r in seed_runs]),
        "A3": statistics.median([r["A3"] for r in seed_runs]),
        "B1": statistics.median([r["B1"] for r in seed_runs]),
        "B2": statistics.median([r["B2"] for r in seed_runs]),
    }
    total_points = sum(median_cp.values())

    part_a = median_cp["A1"] + median_cp["A2"] + median_cp["A3"]
    part_b = median_cp["B1"] + median_cp["B2"]

    feedback = (
        f"Robotics Simulator Grader: {total_points:.1f}/65 automatic points (multi-seed median across seeds {seeds}). "
        f"Part A: {part_a:.1f}/45, Part B: {part_b:.1f}/20."
    )

    return {
        "points": total_points,
        "component_points": median_cp,
        "feedback": feedback,
        "details": {
            "seeds": seeds,
            "seed_runs": seed_runs,
            "component_breakdown": median_cp,
        },
    }


def evaluate_robotics_submission(
    submission_content: str,
    scenario_config: Optional[Any] = None,
) -> Dict[str, Any]:
    """Compatibility alias for score_robotics_project."""
    return score_robotics_project(submission_content, scenario_config)
