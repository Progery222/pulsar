export interface UniqualizerSettings {
  enabled: boolean;
  colorShift: boolean;
  mirrorFlip: boolean;
  noise: boolean;
  speed: boolean;
  cropEdges: boolean;
  audioShift: boolean;
  // Режим «видимая вариация»: каждая копия с заметно разным фильтром/зумом/отражением.
  visibleVariation: boolean;
}

export interface UniqualizerResult {
  appliedFilters: string[];
  metadataChanges: Record<string, string>;
  randomBytesAdded: number;
}
