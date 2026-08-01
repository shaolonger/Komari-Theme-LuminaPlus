import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcCall } = vi.hoisted(() => ({ rpcCall: vi.fn() }));

vi.mock("@/services/rpc2Client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/rpc2Client")>();
  return {
    ...actual,
    getRpc2Client: () => ({ call: rpcCall }),
  };
});

import { getLoadRecords } from "@/services/api";
import {
  RpcProtocolError,
  RpcResponseError,
  RpcTransportError,
} from "@/services/rpc2Client";

describe("RPC compatibility fallback", () => {
  beforeEach(() => {
    rpcCall.mockReset();
    vi.unstubAllGlobals();
  });

  it("falls back to legacy HTTP only for a typed transport failure", async () => {
    rpcCall.mockRejectedValueOnce(new RpcTransportError("offline"));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      count: 1,
      records: [{ time: 1, cpu: 3 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLoadRecords("node-a", 1);

    expect(result.count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    new RpcResponseError("method not found", -32601),
    new RpcProtocolError("invalid response"),
    new Error("schema mismatch"),
  ])("does not hide a server or protocol defect behind REST: %s", async (error) => {
    rpcCall.mockRejectedValueOnce(error);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLoadRecords("node-a", 1)).rejects.toBe(error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
