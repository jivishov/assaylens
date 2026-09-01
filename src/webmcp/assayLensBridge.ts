import type { AssayLensSiteApi } from "./contracts";

let currentApi: AssayLensSiteApi | undefined;

export const assayLensBridge = {
  attach(api: AssayLensSiteApi): () => void {
    currentApi = api;
    return () => {
      if (currentApi === api) currentApi = undefined;
    };
  },
  get(): AssayLensSiteApi | undefined {
    return currentApi;
  }
};
