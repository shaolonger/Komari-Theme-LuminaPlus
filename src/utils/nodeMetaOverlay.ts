import type { AdminClient, NodeInfo } from "@/types/komari";

export function overlayAdminClientMeta(
  meta: NodeInfo,
  adminClient: AdminClient | undefined,
): NodeInfo {
  if (!adminClient) return meta;

  return {
    ...meta,
    version: adminClient.version,
    ipv4: adminClient.ipv4 || meta.ipv4,
    ipv6: adminClient.ipv6 || meta.ipv6,
    capability_ping: adminClient.capability_ping ?? meta.capability_ping,
    capability_private_ping_targets:
      adminClient.capability_private_ping_targets ??
      meta.capability_private_ping_targets,
  };
}

export function shouldIncludeAgentVersionCompleteness({
  loggedIn,
  adminMetadataReady,
}: {
  loggedIn: boolean;
  adminMetadataReady: boolean;
}) {
  return loggedIn && adminMetadataReady;
}
