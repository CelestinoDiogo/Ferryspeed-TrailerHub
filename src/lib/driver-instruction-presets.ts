export const DRIVER_INSTRUCTION_PRESETS = [
  "Call office",
  "Go to quay",
  "Return to compound",
  "Priority",
  "Wait",
  "Temperature required",
] as const;

export type DriverInstructionPreset = (typeof DRIVER_INSTRUCTION_PRESETS)[number];