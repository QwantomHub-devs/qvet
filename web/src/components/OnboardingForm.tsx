"use client";

import React, { useEffect, useState, useTransition } from "react";
import { submitOnboardingAction } from "@/actions/candidate";
import type { Cohort, Institution, Profile, Track } from "@/lib/types/database";

interface OnboardingFormProps {
  profile: Profile;
  institutions: Institution[];
  cohorts: Cohort[];
}

const DRAFT_STORAGE_KEY = "vetting_stage0_onboarding_draft_v1";

const IOT_BOARDS = ["ESP32", "STM32", "Arduino / AVR", "Raspberry Pi Pico (RP2040)", "nRF52"];
const IOT_SENSORS = [
  "Temperature & Humidity (DHT/SHT/BME)",
  "Door / Reed Switch",
  "IMU / Accelerometer",
  "ADC / Voltage / Current Sensor",
  "Ultrasonic / Distance Sensor",
];
const IOT_PROTOCOLS = ["I2C", "SPI", "UART", "MQTT", "HTTP/REST", "Wi-Fi", "BLE", "LoRa"];

const ROBOTICS_TOOLS = [
  "ROS 2",
  "ROS 1",
  "Gazebo",
  "Webots",
  "Isaac Sim",
  "OpenCV",
  "Nav2",
  "MoveIt",
  "Docker",
];

export function OnboardingForm({ profile, institutions, cohorts }: OnboardingFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [fullName, setFullName] = useState(profile.full_name || "");
  const [country, setCountry] = useState(profile.country || "Nigeria");
  const [phone, setPhone] = useState(profile.phone || "");
  const [githubUrl, setGithubUrl] = useState(profile.github_url || "");
  const [yearsExperience, setYearsExperience] = useState(
    profile.years_experience !== null ? String(profile.years_experience) : "1"
  );
  const [selfDeclaredStrengths, setSelfDeclaredStrengths] = useState(
    profile.self_declared_strengths || ""
  );
  const [timeZone, setTimeZone] = useState(profile.time_zone || "Africa/Lagos");
  const [weeklyAvailabilityHours, setWeeklyAvailabilityHours] = useState(
    profile.weekly_availability_hours !== null ? String(profile.weekly_availability_hours) : "20"
  );
  const [institutionId, setInstitutionId] = useState(
    profile.institution_id || (institutions[0]?.id ?? "other")
  );
  const [otherInstitutionName, setOtherInstitutionName] = useState(
    profile.other_institution_name || ""
  );
  const [track, setTrack] = useState<Track>("ai");
  const [cohortId, setCohortId] = useState<string>("");

  // Restore saved draft after power or connection interruption
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, string>;
      if (parsed.fullName) setFullName(parsed.fullName);
      if (parsed.country) setCountry(parsed.country);
      if (parsed.phone) setPhone(parsed.phone);
      if (parsed.githubUrl) setGithubUrl(parsed.githubUrl);
      if (parsed.yearsExperience) setYearsExperience(parsed.yearsExperience);
      if (parsed.selfDeclaredStrengths) setSelfDeclaredStrengths(parsed.selfDeclaredStrengths);
      if (parsed.timeZone) setTimeZone(parsed.timeZone);
      if (parsed.weeklyAvailabilityHours) setWeeklyAvailabilityHours(parsed.weeklyAvailabilityHours);
      if (parsed.institutionId) setInstitutionId(parsed.institutionId);
      if (parsed.otherInstitutionName) setOtherInstitutionName(parsed.otherInstitutionName);
      if (parsed.track === "ai" || parsed.track === "iot" || parsed.track === "robotics") {
        setTrack(parsed.track);
      }
    } catch {
      // Ignore malformed local draft
    }
  }, []);

  // Autosave draft locally on field changes
  useEffect(() => {
    try {
      window.localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          fullName,
          country,
          phone,
          githubUrl,
          yearsExperience,
          selfDeclaredStrengths,
          timeZone,
          weeklyAvailabilityHours,
          institutionId,
          otherInstitutionName,
          track,
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [
    fullName,
    country,
    phone,
    githubUrl,
    yearsExperience,
    selfDeclaredStrengths,
    timeZone,
    weeklyAvailabilityHours,
    institutionId,
    otherInstitutionName,
    track,
  ]);

  const matchingCohorts = cohorts.filter((c) => c.track === track);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await submitOnboardingAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not save your application.");
        return;
      }
      try {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Ignore
      }
      setSuccess(result.message ?? "Application saved.");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-xs"
    >
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          Stage 0: Candidate Application &amp; Track Selection
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Your progress is saved automatically in this browser while you type. You can apply to one
          track at a time.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900"
        >
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-slate-800">
            Full legal name (must match your Government ID) *
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-slate-800">
            Phone number (with country code) *
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            placeholder="+234 803 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>

        <div>
          <label htmlFor="country" className="block text-sm font-medium text-slate-800">
            Country *
          </label>
          <input
            id="country"
            name="country"
            type="text"
            required
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>

        <div>
          <label htmlFor="timeZone" className="block text-sm font-medium text-slate-800">
            Time zone *
          </label>
          <input
            id="timeZone"
            name="timeZone"
            type="text"
            required
            placeholder="Africa/Lagos (UTC+1)"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>

        <div>
          <label htmlFor="githubUrl" className="block text-sm font-medium text-slate-800">
            GitHub or portfolio link (must be publicly reachable) *
          </label>
          <input
            id="githubUrl"
            name="githubUrl"
            type="url"
            required
            placeholder="https://github.com/yourusername"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="yearsExperience" className="block text-sm font-medium text-slate-800">
              Years of experience *
            </label>
            <input
              id="yearsExperience"
              name="yearsExperience"
              type="number"
              step="0.5"
              min="0"
              max="60"
              required
              value={yearsExperience}
              onChange={(e) => setYearsExperience(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="weeklyAvailabilityHours"
              className="block text-sm font-medium text-slate-800"
            >
              Weekly availability (hrs) *
            </label>
            <input
              id="weeklyAvailabilityHours"
              name="weeklyAvailabilityHours"
              type="number"
              min="1"
              max="168"
              required
              value={weeklyAvailabilityHours}
              onChange={(e) => setWeeklyAvailabilityHours(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="institutionId" className="block text-sm font-medium text-slate-800">
            Institution or Bootcamp *
          </label>
          <select
            id="institutionId"
            name="institutionId"
            value={institutionId}
            onChange={(e) => setInstitutionId(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            {institutions.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.country})
              </option>
            ))}
            <option value="other">Other / Independent</option>
          </select>
        </div>

        {institutionId === "other" && (
          <div>
            <label
              htmlFor="otherInstitutionName"
              className="block text-sm font-medium text-slate-800"
            >
              Specify Institution or Independent Status *
            </label>
            <input
              id="otherInstitutionName"
              name="otherInstitutionName"
              type="text"
              required
              placeholder="e.g. Independent Self-Taught / Other University"
              value={otherInstitutionName}
              onChange={(e) => setOtherInstitutionName(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="track" className="block text-sm font-medium text-slate-800">
            Certification Track *
          </label>
          <select
            id="track"
            name="track"
            value={track}
            onChange={(e) => {
              setTrack(e.target.value as Track);
              setCohortId("");
            }}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="ai">Artificial Intelligence (AI)</option>
            <option value="iot">Internet of Things (IoT)</option>
            <option value="robotics">Robotics</option>
          </select>
        </div>

        <div>
          <label htmlFor="cohortId" className="block text-sm font-medium text-slate-800">
            Cohort (optional)
          </label>
          <select
            id="cohortId"
            name="cohortId"
            value={cohortId}
            onChange={(e) => setCohortId(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="">General Open Pool</option>
            {matchingCohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label
          htmlFor="selfDeclaredStrengths"
          className="block text-sm font-medium text-slate-800"
        >
          Self-declared technical strengths *
        </label>
        <textarea
          id="selfDeclaredStrengths"
          name="selfDeclaredStrengths"
          rows={3}
          required
          placeholder="Describe your strongest engineering skills, tools, and projects..."
          value={selfDeclaredStrengths}
          onChange={(e) => setSelfDeclaredStrengths(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
        />
      </div>

      {/* Track-specific Stage 0 fields per IoT and Robotics blueprints */}
      {track === "iot" && (
        <fieldset className="space-y-4 rounded border border-slate-200 bg-slate-50 p-4">
          <legend className="px-1 text-sm font-bold text-slate-900">
            IoT Track Background (Stage 0)
          </legend>

          <div>
            <p className="text-xs font-semibold uppercase text-slate-700">Boards used</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {IOT_BOARDS.map((board) => (
                <label key={board} className="flex items-center gap-1.5 text-sm text-slate-800">
                  <input type="checkbox" name="iotBoards" value={board} />
                  {board}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase text-slate-700">Sensors used</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {IOT_SENSORS.map((sensor) => (
                <label key={sensor} className="flex items-center gap-1.5 text-sm text-slate-800">
                  <input type="checkbox" name="iotSensors" value={sensor} />
                  {sensor}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase text-slate-700">Protocols used</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {IOT_PROTOCOLS.map((protocol) => (
                <label key={protocol} className="flex items-center gap-1.5 text-sm text-slate-800">
                  <input type="checkbox" name="iotProtocols" value={protocol} />
                  {protocol}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="iotHardwareAccess" className="block text-sm font-medium text-slate-800">
                Do you have access to physical hardware or a partner lab?
              </label>
              <select
                id="iotHardwareAccess"
                name="iotHardwareAccess"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="no">No (simulation only)</option>
                <option value="yes">Yes (have hardware or lab access)</option>
              </select>
            </div>

            <div>
              <label htmlFor="iotProjectUrl" className="block text-sm font-medium text-slate-800">
                Link to past hardware project (optional)
              </label>
              <input
                id="iotProjectUrl"
                name="iotProjectUrl"
                type="url"
                placeholder="https://..."
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>
        </fieldset>
      )}

      {track === "robotics" && (
        <fieldset className="space-y-4 rounded border border-slate-200 bg-slate-50 p-4">
          <legend className="px-1 text-sm font-bold text-slate-900">
            Robotics Track Background (Stage 0)
          </legend>

          <div>
            <p className="text-xs font-semibold uppercase text-slate-700">Tools &amp; Frameworks used</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {ROBOTICS_TOOLS.map((tool) => (
                <label key={tool} className="flex items-center gap-1.5 text-sm text-slate-800">
                  <input type="checkbox" name="roboticsTools" value={tool} />
                  {tool}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pythonComfort" className="block text-sm font-medium text-slate-800">
                Python comfort rating (1 = beginner, 5 = strong)
              </label>
              <select
                id="pythonComfort"
                name="pythonComfort"
                defaultValue="4"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="1">1 - Beginner</option>
                <option value="2">2 - Basic</option>
                <option value="3">3 - Intermediate</option>
                <option value="4">4 - Comfortable</option>
                <option value="5">5 - Advanced</option>
              </select>
            </div>

            <div>
              <label htmlFor="cppComfort" className="block text-sm font-medium text-slate-800">
                C++ comfort rating (1 = beginner, 5 = strong)
              </label>
              <select
                id="cppComfort"
                name="cppComfort"
                defaultValue="3"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="1">1 - Beginner</option>
                <option value="2">2 - Basic</option>
                <option value="3">3 - Intermediate</option>
                <option value="4">4 - Comfortable</option>
                <option value="5">5 - Advanced</option>
              </select>
            </div>

            <div>
              <label htmlFor="roboticsLabAccess" className="block text-sm font-medium text-slate-800">
                Access to a physical robot or partner lab?
              </label>
              <select
                id="roboticsLabAccess"
                name="roboticsLabAccess"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="no">No (simulation only)</option>
                <option value="yes">Yes (have robot or lab access)</option>
              </select>
            </div>

            <div>
              <label htmlFor="roboticsProjectUrl" className="block text-sm font-medium text-slate-800">
                Link to robot project, video, or repository (optional)
              </label>
              <input
                id="roboticsProjectUrl"
                name="roboticsProjectUrl"
                type="url"
                placeholder="https://..."
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>
        </fieldset>
      )}

      <div className="rounded border border-slate-200 bg-slate-50 p-4">
        <label className="flex items-start gap-2.5 text-sm text-slate-800">
          <input
            type="checkbox"
            name="consent"
            required
            className="mt-1 h-4 w-4 rounded border-slate-300"
          />
          <span>
            I consent to the processing of my personal data and identity document for talent
            vetting, and I consent to sharing my certified profile and scorecard with prospective
            employers and my attached partner institution. *
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Verifying links & saving..." : "Save Application & Continue to ID Upload"}
      </button>
    </form>
  );
}
