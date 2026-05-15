import type { PluginContext } from "@sharkord/plugin-sdk";
import type { DiagRouter, DiagTransport, DiagProducer, DiagConsumerLike, StageReporter } from "./diagnose-types";

export async function runDiagnoseRouter(
  ctx: PluginContext,
  router: DiagRouter,
  transport: DiagTransport,
  producer: DiagProducer,
  voiceChannelId: number,
  invokerUserId: number | undefined,
  reporter: StageReporter,
  debugLog: (msg: string) => void,
  lines: string[],
): Promise<void> {
  const { pass, fail, info } = reporter;

  try {
    const dump = await router.dump();
    const entry = dump.mapProducerIdConsumerIds?.find((e: { key: string }) => e.key === producer.id);
    const consumerIds = entry?.values ?? [];
    const consumerCount = consumerIds.length;
    info("Stage 5", `Router: ${dump.transportIds?.length ?? 0} transports`);
    info("Stage 5", `Consumers for our producer: ${consumerCount} — IDs: ${JSON.stringify(consumerIds)}`);

    if (consumerCount === 0) {
      fail("Stage 5", "No consumers exist for our producer! SDK did not create a consumer.");
    } else {
      pass("Stage 5", `${consumerCount} consumer(s) found in router`);
    }

    const allTransports: Map<string, DiagTransport> | undefined = (router as unknown as { transportsForTesting?: Map<string, DiagTransport> }).transportsForTesting;
    if (allTransports && allTransports instanceof Map) {
      info("Stage 5", `router.transportsForTesting: ${allTransports.size} transports`);

      for (const [tId, tObj] of allTransports) {
        if (tId === transport.id) continue;
        const consumers: Map<string, DiagConsumerLike> | undefined = tObj.consumers;
        if (consumers && consumers instanceof Map && consumers.size > 0) {
          for (const [cId, cObj] of consumers) {
            if (!consumerIds.includes(cId)) continue;
            const cPaused = cObj.paused;
            const cKind = cObj.kind ?? "unknown";
            const cType = cObj.type ?? "unknown";
            const cProducerPaused = cObj.producerPaused;
            info("Stage 5", `CONSUMER ${cId}:`);
            info("Stage 5", `  paused=${cPaused}, producerPaused=${cProducerPaused ?? "unknown"}, kind=${cKind}, type=${cType}`);
            info("Stage 5", `  on transport ${tId} (type=${typeof tObj.dump === "function" ? "has dump()" : "no dump"})`);

            if (cPaused) {
              fail("Stage 5", `Consumer ${cId} is PAUSED! This is likely BUG-001!`);
              info("Stage 5", "The Sharkord SDK may not be calling consumer.resume() for plugin-created producers.");
            } else {
              pass("Stage 5", `Consumer ${cId} is RESUMED (paused=false)`);
            }

            try {
              const cStats = await cObj.getStats();
              info("Stage 5", `  stats: ${JSON.stringify(cStats)}`);
            } catch (e) {
              info("Stage 5", `  stats error: ${String(e)}`);
            }
            try {
              info("Stage 5", `  score: ${JSON.stringify(cObj.score)}`);
            } catch { /* ignore */ }
            const cKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(cObj) ?? {});
            info("Stage 5", `  proto keys: [${cKeys.join(", ")}]`);
          }
        }
      }
    } else {
      info("Stage 5", "router.transportsForTesting not available");
    }

    info("Stage 5", `All mappings: ${JSON.stringify(dump.mapProducerIdConsumerIds)}`);

    lines.push("");
    if (allTransports && allTransports instanceof Map) {
      for (const [tId, tObj] of allTransports) {
        if (tId === transport.id) continue;
        const tConsumers: Map<string, DiagConsumerLike> | undefined = tObj.consumers;
        const hasOurConsumer = tConsumers instanceof Map
          && [...tConsumers.keys()].some((k) => consumerIds.includes(k));
        if (!hasOurConsumer) continue;

        info("Stage 6", `=== CLIENT TRANSPORT ${tId} ===`);
        const tProtoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(tObj) ?? {});
        const tOwnKeys = Object.getOwnPropertyNames(tObj);
        info("Stage 6", `proto keys: [${tProtoKeys.join(", ")}]`);
        info("Stage 6", `own keys: [${tOwnKeys.join(", ")}]`);

        try {
          const tDump = await tObj.dump();
          info("Stage 6", `type: ${tDump.type ?? "unknown"}`);
          info("Stage 6", `iceState: ${tDump.iceState ?? "n/a"}`);
          info("Stage 6", `iceRole: ${tDump.iceRole ?? "n/a"}`);
          info("Stage 6", `dtlsState: ${tDump.dtlsState ?? "n/a"}`);
          info("Stage 6", `sctpState: ${tDump.sctpState ?? "n/a"}`);
          info("Stage 6", `iceSelectedTuple: ${JSON.stringify(tDump.iceSelectedTuple ?? null)}`);
          info("Stage 6", `producerIds: ${JSON.stringify(tDump.producerIds ?? [])}`);
          info("Stage 6", `consumerIds: ${JSON.stringify(tDump.consumerIds ?? [])}`);

          if (tDump.iceState && tDump.iceState !== "completed") {
            fail("Stage 6", `ICE state is '${tDump.iceState}' (expected 'completed') — WebRTC handshake not complete!`);
          } else if (tDump.iceState === "completed") {
            pass("Stage 6", "ICE state: completed");
          }

          if (tDump.dtlsState && tDump.dtlsState !== "connected") {
            fail("Stage 6", `DTLS state is '${tDump.dtlsState}' (expected 'connected') — encryption handshake not complete!`);
          } else if (tDump.dtlsState === "connected") {
            pass("Stage 6", "DTLS state: connected");
          }

          if (tDump.bytesReceived !== undefined || tDump.bytesSent !== undefined) {
            info("Stage 6", `bytesReceived=${tDump.bytesReceived ?? 0}, bytesSent=${tDump.bytesSent ?? 0}`);
          }
          info("Stage 6", `full dump: ${JSON.stringify(tDump)}`);
        } catch (e) {
          info("Stage 6", `dump error: ${String(e)}`);
        }

        try {
          if (typeof tObj.getStats === "function") {
            const tStats = await tObj.getStats();
            info("Stage 6", `transport stats: ${JSON.stringify(tStats)}`);
          }
        } catch { /* ignore */ }

        if (tConsumers instanceof Map) {
          for (const [cId, cObj] of tConsumers) {
            try {
              const cStats = await cObj.getStats();
              const outbound = (cStats as Array<Record<string, unknown>>).find(
                (s) => s.type === "outbound-rtp",
              );
              const inbound = (cStats as Array<Record<string, unknown>>).find(
                (s) => s.type === "inbound-rtp",
              );
              if (outbound) {
                const outPkts = (outbound.packetCount as number) ?? 0;
                const outBytes = (outbound.byteCount as number) ?? 0;
                if (outPkts === 0) {
                  fail("Stage 6", `Consumer ${cId} outbound: 0 packets sent to client! Audio not reaching WebRTC transport.`);
                } else {
                  pass("Stage 6", `Consumer ${cId} outbound: ${outPkts} pkts, ${outBytes} bytes sent`);
                }
                info("Stage 6", `Consumer ${cId} outbound-rtp: ${JSON.stringify(outbound)}`);
              }
              if (inbound) {
                info("Stage 6", `Consumer ${cId} inbound-rtp: ${JSON.stringify(inbound)}`);
              }
            } catch { /* ignore */ }
          }
        }
      }
    }
  } catch (err) {
    fail("Stage 5", `Router dump failed: ${String(err)}`);
  }
}
