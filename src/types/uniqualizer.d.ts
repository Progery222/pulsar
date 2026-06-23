export interface UniqualizerSettings {
  enabled: boolean;
  colorShift: boolean;
  mirrorFlip: boolean;
  noise: boolean;
  speed: boolean;
  cropEdges: boolean;
  audioShift: boolean;
}

export interface UniqualizerResult {
  appliedFilters: string[];
  metadataChanges: Record<string, string>;
  randomBytesAdded: number;
}
