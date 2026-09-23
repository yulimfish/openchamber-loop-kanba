export type MissingAutomationContract =
  | "promptSession"
  | "sessionDetailsAndEvents"
  | "openWorktreeReview"
  | "sessionGoalRun";

export interface AutomationState {
  available: boolean;
  missing: MissingAutomationContract[];
}

const MISSING: MissingAutomationContract[] = [
  "promptSession",
  "sessionDetailsAndEvents",
  "openWorktreeReview",
  "sessionGoalRun",
];

export const automationState = (): AutomationState => ({
  available: MISSING.length === 0,
  missing: [...MISSING],
});

export const assertNoAutomaticTransition = (_summary: { activity?: string; outcome?: string | null }): void => {
  if (!automationState().available) {
    throw new Error("Automation is unavailable on this OpenChamber version");
  }
};
