import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useLoad } from "../src/shared/async";

function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((complete) => {
    resolve = complete;
  });
  return { resolve, promise };
}
it("ignores a late response from the previous organization even if transport ignores abort", async () => {
  const first = deferred();
  const second = deferred();
  function Probe({ org }: { org: string }) {
    const state = useLoad(
      () => (org === "first" ? first.promise : second.promise),
      [org],
    );
    return <div>{state.loading ? "Chargement" : state.data}</div>;
  }
  const { rerender } = render(<Probe org="first" />);
  rerender(<Probe org="second" />);
  await act(async () => {
    second.resolve("second-tenant-data");
  });
  expect(screen.getByText("second-tenant-data")).toBeInTheDocument();
  await act(async () => {
    first.resolve("first-tenant-data");
  });
  expect(screen.queryByText("first-tenant-data")).not.toBeInTheDocument();
});
it("hides a previous document immediately when resource identity changes", async () => {
  const second = deferred();
  function Probe({ org }: { org: string }) {
    const state = useLoad(
      () =>
        org === "first" ? Promise.resolve("first-tenant-data") : second.promise,
      [org],
    );
    return <div>{state.loading ? "Chargement" : state.data}</div>;
  }
  const { rerender } = render(<Probe org="first" />);
  await screen.findByText("first-tenant-data");
  rerender(<Probe org="second" />);
  expect(screen.queryByText("first-tenant-data")).not.toBeInTheDocument();
  expect(screen.getByText("Chargement")).toBeInTheDocument();
  await act(async () => {
    second.resolve("second-tenant-data");
  });
});
