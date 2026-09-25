import type { BinanceKline, FetchKlinesFn, FetchKlinesParams } from "./index";

export interface HttpTransportConfig {
  /** Origin of the data service, e.g. `http://127.0.0.1:8787`. */
  baseUrl: string;
  /** Injectable transport; defaults to the platform `fetch`. */
  fetchImpl?: typeof globalThis.fetch;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    // Not a JSON body (proxy/HTML error page); fall through to the status.
  }
  return response.statusText || `HTTP ${response.status}`;
}

/**
 * The transport swap: identical `FetchKlinesFn` contract as a direct Binance
 * call or the old bundled fixture, but the rows come back from the data
 * service over HTTP. Everything downstream (pagination guard, forming-candle
 * exclusion, validation, cache, Future Data Rule) is unchanged, and the
 * service's error response is surfaced as a thrown error so a failed range
 * can never look like an empty-but-successful load.
 */
export function createHttpFetchKlines(config: HttpTransportConfig): FetchKlinesFn {
  if (!config.baseUrl) throw new Error("baseUrl is required");
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const fetchImpl: typeof globalThis.fetch =
    config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  return async (params: FetchKlinesParams): Promise<BinanceKline[]> => {
    const query = new URLSearchParams({
      symbol: params.symbol,
      timeframe: params.interval,
      start: String(params.startTime),
      end: String(params.endTime)
    });
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const url = `${baseUrl}/klines?${query.toString()}`;

    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch (err) {
      throw new Error(`Data service unreachable: ${message(err)}`);
    }
    if (!response.ok) {
      throw new Error(`Data service responded ${response.status}: ${await errorDetail(response)}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error(`Data service returned a body that is not JSON: ${message(err)}`);
    }
    if (!Array.isArray(payload)) {
      throw new Error("Data service returned an unexpected payload: expected an array of klines");
    }
    return payload as BinanceKline[];
  };
}
