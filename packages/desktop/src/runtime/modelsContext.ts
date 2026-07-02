import type { PiClient } from "@assistant-ui/react-pi";
import { createContext, useContext } from "react";

// Carries the active PiClient down to the composer's model selector so it can
// list available models (`getAvailableModels`). Current selection and mutations
// go through `usePiRuntimeExtras()` instead.
export const PiClientContext = createContext<PiClient | null>(null);

export const usePiClient = () => useContext(PiClientContext);
