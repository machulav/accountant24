// @vitest-environment jsdom

import type { PiClient } from "@assistant-ui/react-pi";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PiClientContext, usePiClient } from "../modelsContext";

describe("usePiClient()", () => {
  it("should return null when used outside a provider", () => {
    const { result } = renderHook(() => usePiClient());
    expect(result.current).toBeNull();
  });

  it("should return the client supplied by the nearest provider", () => {
    const client = { id: "fake-client" } as unknown as PiClient;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PiClientContext.Provider value={client}>{children}</PiClientContext.Provider>
    );
    const { result } = renderHook(() => usePiClient(), { wrapper });
    expect(result.current).toBe(client);
  });
});
