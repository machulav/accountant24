// Loads the @testing-library/jest-dom matcher type augmentations (toBeInTheDocument,
// toBeDisabled, toHaveAttribute, …) into the desktop TypeScript program, matching
// the runtime import wired in the root vitest.setup.ts. Without this, tsc doesn't
// see the matchers on Vitest's `expect` and component tests fail typecheck.
import "@testing-library/jest-dom/vitest";
