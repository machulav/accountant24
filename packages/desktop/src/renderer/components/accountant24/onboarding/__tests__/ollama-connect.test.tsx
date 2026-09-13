// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OllamaInfo } from "@/rpc/types";

const addAllOllama = vi.hoisted(() => vi.fn());
vi.mock("@/rpc/api", () => ({ authApi: { addAllOllama } }));

import { OllamaConnect } from "../ollama-connect";

const running = (models: string[]): OllamaInfo => ({ type: "ollama", running: true, models });
const stopped: OllamaInfo = { type: "ollama", running: false, models: [] };

beforeEach(() => addAllOllama.mockResolvedValue({ type: "done", provider: "ollama", count: 1 }));
afterEach(() => cleanup());

describe("OllamaConnect", () => {
  it("should say it is checking while the detection is in flight", () => {
    render(<OllamaConnect info={null} onRecheck={() => {}} onConnected={() => {}} />);
    expect(screen.getByText(/Checking for Ollama/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("should offer to connect when Ollama is running with models", () => {
    render(<OllamaConnect info={running(["llama3", "qwen3"])} onRecheck={() => {}} onConnected={() => {}} />);
    expect(screen.getByText(/running with 2 models/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Ollama" })).toBeEnabled();
  });

  it("should count a single model in the singular", () => {
    render(<OllamaConnect info={running(["llama3"])} onRecheck={() => {}} onConnected={() => {}} />);
    expect(screen.getByText(/running with 1 model /)).toBeInTheDocument();
  });

  it("should ask for a model to be pulled when Ollama has none", () => {
    render(<OllamaConnect info={running([])} onRecheck={() => {}} onConnected={() => {}} />);
    expect(screen.getByText(/has no models yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Ollama" })).toBeNull();
  });

  it("should link to the download when Ollama is not running", () => {
    render(<OllamaConnect info={stopped} onRecheck={() => {}} onConnected={() => {}} />);
    expect(screen.getByRole("link", { name: "Install Ollama" })).toHaveAttribute("href", "https://ollama.com/download");
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("should re-detect when Check again is clicked", () => {
    const onRecheck = vi.fn();
    render(<OllamaConnect info={stopped} onRecheck={onRecheck} onConnected={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("should register every local model and report success", async () => {
    const onConnected = vi.fn();
    render(<OllamaConnect info={running(["llama3"])} onRecheck={() => {}} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Ollama" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(addAllOllama).toHaveBeenCalledTimes(1);
  });

  it("should explain a failure that came back without a message", async () => {
    addAllOllama.mockResolvedValue({ type: "error" });
    render(<OllamaConnect info={running(["llama3"])} onRecheck={() => {}} onConnected={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Ollama" }));
    expect(await screen.findByText(/Failed to connect Ollama/)).toBeInTheDocument();
  });

  it("should surface a failure and let the user try again", async () => {
    addAllOllama.mockResolvedValue({ type: "error", message: "Ollama went away" });
    const onConnected = vi.fn();
    render(<OllamaConnect info={running(["llama3"])} onRecheck={() => {}} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Ollama" }));
    expect(await screen.findByText(/Ollama went away/)).toBeInTheDocument();
    expect(onConnected).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Connect Ollama" })).toBeEnabled();
  });
});
