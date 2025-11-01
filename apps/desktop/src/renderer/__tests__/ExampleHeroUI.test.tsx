import { HeroUIProvider } from "@heroui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ExampleHeroUI } from "../components/ExampleHeroUI";

const renderWithProviders = (ui: ReactNode) => {
  return render(<HeroUIProvider>{ui}</HeroUIProvider>);
};

describe("ExampleHeroUI", () => {
  it("renders default state and updates the developer name", async () => {
    const onPingMain = vi.fn();
    const onPingWorker = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <ExampleHeroUI onPingMain={onPingMain} onPingWorker={onPingWorker} />,
    );

    const developerName = screen.getByText("Anonymous");
    expect(developerName).toBeInTheDocument();

    const input = screen.getByLabelText("Developer name");
    await user.type(input, "Codex");

    expect(screen.getByText("Codex")).toBeInTheDocument();

    const pingMainButton = screen.getByRole("button", { name: "Ping Main" });
    const pingWorkerButton = screen.getByRole("button", {
      name: "Ping Worker",
    });
    const clearNameButton = screen.getByRole("button", { name: "Clear Name" });

    await user.click(pingMainButton);
    await user.click(pingWorkerButton);
    await user.click(clearNameButton);

    expect(onPingMain).toHaveBeenCalledTimes(1);
    expect(onPingWorker).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
  });
});
